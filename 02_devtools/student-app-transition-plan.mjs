// Offline only. Production grants go through the teacher provision API, never direct SQL.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sections = ['students', 'legacy', 'access', 'sync', 'members', 'links', 'claims', 'enrollments'];
const identifier = value => {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)) throw new Error('Invalid identity ID');
  return value.replaceAll('-', '').toLowerCase();
};
const instant = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Explicit ISO timestamp required'); return new Date(value).toISOString(); };
const reference = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value)) throw new Error('Use a non-personal operator/evidence reference'); return value; };
const integer = value => Number.isSafeInteger(value) && value >= 0;
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected snapshot fields; names, contacts, tokens and passwords are not accepted');
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
export const transitionDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function optionsOf({ batchId, actor = 'operator', at } = {}) { return { batchId: reference(batchId), actor: reference(actor), at: instant(at) }; }

export function validateStudentTransitionSnapshot(snapshot) {
  keys(snapshot, ['schema', 'environment', 'capturedAt', 'storageState', 'complete', ...sections]);
  if (snapshot.schema !== 1 || !['production', 'synthetic'].includes(snapshot.environment) || !['not-installed', 'installed'].includes(snapshot.storageState)) throw new Error('Invalid transition snapshot version/environment/storage state');
  instant(snapshot.capturedAt); keys(snapshot.complete, sections);
  if (sections.some(key => typeof snapshot.complete[key] !== 'boolean' || !Array.isArray(snapshot[key]))) throw new Error('Every section needs rows and an explicit completeness flag');
  const shapes = {
    students: ['studentId', 'vip', 'archived', 'sharedAt', 'status'],
    legacy: ['studentId', 'allowed', 'evidence', 'evidenceId', 'reviewedAt'],
    access: ['student_id', 'allowed', 'revision'],
    sync: ['student_id', 'state', 'result_revision', 'verified_allowed'],
    members: ['memberId', 'status', 'profileComplete', 'phoneVerified'],
    links: ['member_id', 'student_id', 'verified_at', 'verified_by'],
    claims: ['member_id', 'student_id'],
    enrollments: ['member_id', 'student_id', 'state'],
  };
  for (const section of sections) {
    const seen = new Set();
    for (const row of snapshot[section]) {
      keys(row, shapes[section]);
      const studentId = section === 'members' ? null : identifier(row.studentId || row.student_id);
      const memberId = ['members', 'links', 'claims', 'enrollments'].includes(section) ? identifier(row.memberId || row.member_id) : null;
      const unique = ['links', 'claims', 'enrollments'].includes(section) ? `${memberId}:${studentId}` : studentId || memberId;
      if (seen.has(unique)) throw new Error(`Duplicate ${section} row`); seen.add(unique);
      if (section === 'students' && (typeof row.vip !== 'boolean' || ![true, false, null].includes(row.archived) || row.sharedAt !== null && !Number.isFinite(Date.parse(row.sharedAt)) || !['active', 'paused', 'ended', 'unknown'].includes(row.status))) throw new Error('Invalid Notion student facts');
      if (section === 'legacy') {
        if (![true, false, null].includes(row.allowed) || !['teacher-reviewed', 'historical-share', 'unknown'].includes(row.evidence)) throw new Error('Invalid legacy permission evidence');
        if (row.allowed !== null && (row.evidence !== 'teacher-reviewed' || !row.evidenceId || !row.reviewedAt)) throw new Error('VIP/shared date is not explicit current permission');
        if (row.evidenceId) reference(row.evidenceId); if (row.reviewedAt) instant(row.reviewedAt);
      }
      if (section === 'access' && (![0, 1].includes(row.allowed) || !integer(row.revision) || row.revision < 1)) throw new Error('Invalid access revision');
      if (section === 'sync' && (!['synced', 'processing', 'unknown', 'failed'].includes(row.state) || row.result_revision !== null && !integer(row.result_revision) || ![0, 1, null].includes(row.verified_allowed))) throw new Error('Invalid provision state');
      if (section === 'members' && (!['active', 'pending', 'suspended', 'withdrawn'].includes(row.status) || typeof row.profileComplete !== 'boolean' || typeof row.phoneVerified !== 'boolean')) throw new Error('Invalid member facts');
      if (section === 'links' && (typeof row.verified_by !== 'string' || row.verified_at !== null && !Number.isFinite(Date.parse(row.verified_at)))) throw new Error('Invalid link evidence');
      if (section === 'enrollments' && !['pending', 'creating', 'created', 'unknown', 'linked', 'granted'].includes(row.state)) throw new Error('Invalid enrollment state');
    }
  }
  return snapshot;
}

export function createStudentTransitionPlan(input, options) {
  const snapshot = validateStudentTransitionSnapshot(input), config = optionsOf(options);
  const byStudent = section => new Map(snapshot[section].map(row => [identifier(row.studentId || row.student_id), row]));
  const students = byStudent('students'), legacy = byStudent('legacy'), access = byStudent('access'), sync = byStudent('sync');
  const members = new Map(snapshot.members.map(row => [identifier(row.memberId), row]));
  const allIds = [...new Set([...students.keys(), ...legacy.keys(), ...access.keys(), ...sync.keys(), ...snapshot.links.map(row => identifier(row.student_id)), ...snapshot.claims.map(row => identifier(row.student_id))])].sort();
  const blockers = sections.filter(section => !snapshot.complete[section]).map(section => `incomplete_${section}_snapshot`);
  if (snapshot.storageState !== 'installed') blockers.push('additive_migrations_required');
  const age = Date.parse(config.at) - Date.parse(snapshot.capturedAt);
  if (age < 0 || age > 15 * 60 * 1000) blockers.push('fresh_snapshot_required');
  const rows = allIds.map((studentId, index) => {
    const student = students.get(studentId), old = legacy.get(studentId), grant = access.get(studentId), provision = sync.get(studentId);
    const links = snapshot.links.filter(row => identifier(row.student_id) === studentId);
    const claims = snapshot.claims.filter(row => identifier(row.student_id) === studentId);
    const linkedId = links.length === 1 ? identifier(links[0].member_id) : null, member = members.get(linkedId);
    const conflicts = links.length > 1 || claims.length > 1 || links.some(link => snapshot.links.some(other => identifier(other.member_id) === identifier(link.member_id) && identifier(other.student_id) !== studentId))
      || claims.some(claim => linkedId && identifier(claim.member_id) !== linkedId || snapshot.claims.some(other => identifier(other.member_id) === identifier(claim.member_id) && identifier(other.student_id) !== studentId));
    const memberReady = !conflicts && links.length === 1 && links[0].verified_by === 'teacher' && !!links[0].verified_at && member?.status === 'active' && member.profileComplete && member.phoneVerified;
    const relevant = old?.allowed === true || grant?.allowed === 1 || !!student?.sharedAt;
    const row = { ref: `S${String(index + 1).padStart(3, '0')}`, studentId, currentAllowed: grant?.allowed === 1,
      expectedRevision: grant?.revision || 0, vip: student?.vip ?? null, legacyEvidence: old?.evidence || 'unknown',
      memberReady: !!memberReady, action: 'none', blockers: [] };
    if (grant?.allowed === 0) { if (old?.allowed === true) row.blockers.push('explicit_revocation_conflicts_with_legacy_list'); return { ...row, action: 'preserve_revocation' }; }
    if (old?.allowed === false && !grant) return { ...row, action: 'preserve_revocation' };
    if (!relevant) return { ...row, action: 'no_explicit_permission' };
    if (!student || student.archived !== false) row.blockers.push('student_missing_archived_or_unverified');
    if (student?.vip !== true) row.blockers.push('homework_policy_requires_teacher_decision');
    if (old?.allowed !== true && grant?.allowed !== 1) row.blockers.push('current_permission_unverified');
    if (old?.allowed === false && grant?.allowed === 1) row.blockers.push('explicit_legacy_revocation_conflicts_with_grant');
    if (conflicts) row.blockers.push('identity_ownership_conflict');
    if (links.length && !memberReady) row.blockers.push('verified_active_member_required');
    if (provision && provision.state !== 'synced') row.blockers.push('provision_recovery_required');
    if (snapshot.enrollments.some(enrollment => identifier(enrollment.student_id) === studentId && enrollment.state !== 'granted')) row.blockers.push('enrollment_in_progress');
    if (row.blockers.length) return { ...row, action: 'manual_review_required' };
    const ready = grant?.allowed === 1 && provision?.state === 'synced' && provision.result_revision === grant.revision && provision.verified_allowed === 1;
    return { ...row, action: ready ? 'preserve_current' : 'review_provision_request' };
  });
  const plan = { schema: 1, mode: 'student-transition-plan', environment: snapshot.environment, ...config,
    capturedAt: instant(snapshot.capturedAt), snapshotDigest: transitionDigest(snapshot), blockers, rows,
    summary: { students: snapshot.students.length, vip: snapshot.students.filter(row => row.vip).length,
      historicalShared: snapshot.students.filter(row => row.sharedAt).length,
      explicitLegacyAllowed: snapshot.legacy.filter(row => row.allowed === true).length,
      currentGrants: snapshot.access.filter(row => row.allowed === 1).length, verifiedLinkedMembers: rows.filter(row => row.memberReady).length,
      permissionUnverified: rows.filter(row => row.blockers.includes('current_permission_unverified')).length,
      blockingStudents: rows.filter(row => row.blockers.length).length, provisionCandidates: rows.filter(row => row.action === 'review_provision_request').length,
      legacyOnlyStudents: rows.filter(row => ['preserve_current', 'review_provision_request'].includes(row.action) && !row.memberReady).length },
    rollout: { applied: false, canReplaceExistingStudentApp: false, requiresPostflightEvidence: true,
      memberCoverageComplete: blockers.length === 0 && rows.every(row => row.blockers.length === 0 && (!['preserve_current', 'review_provision_request'].includes(row.action) || row.memberReady)),
      legacyAppMustRemain: rows.some(row => !row.memberReady && (row.currentAllowed || row.legacyEvidence === 'historical-share' || row.action === 'review_provision_request')),
      instructions: ['Keep the existing student-app deployment and authenticated OTP/JWT route until each current user has a phone-verified member account and a teacher-verified student link.', 'Apply additive migrations and reviewed entitlement provision requests before enabling new Worker grant checks.', 'Never replace the old PWA with the member-only build while any current user is unresolved.'] } };
  return { ...plan, planDigest: transitionDigest(plan) };
}

export function createStudentTransitionPackage(snapshot, options, review, { at: preparedAt } = {}) {
  const plan = createStudentTransitionPlan(snapshot, options);
  keys(review, ['schema', 'planDigest', 'reviewedBy', 'reviewedAt', 'legacyDeploymentPreserved', 'legacyDeploymentReference', 'decisions']);
  if (review.schema !== 1 || review.planDigest !== plan.planDigest || !Array.isArray(review.decisions)) throw new Error('Review must bind to this exact plan digest');
  reference(review.reviewedBy); const reviewedAt = instant(review.reviewedAt), packagedAt = instant(preparedAt);
  if (Date.parse(reviewedAt) < Date.parse(plan.at) || Date.parse(reviewedAt) > Date.parse(packagedAt)) throw new Error('Review timestamp must follow the plan and precede package time');
  const packageAge = Date.parse(packagedAt) - Date.parse(plan.capturedAt);
  if (packageAge < 0 || packageAge > 15 * 60 * 1000) throw new Error('Refresh the snapshot before preparing a package');
  if (plan.blockers.length || plan.rows.some(row => row.blockers.length)) throw new Error('Resolve incomplete, stale or conflicted evidence before packaging grants');
  if (plan.rollout.legacyAppMustRemain && (review.legacyDeploymentPreserved !== true || !review.legacyDeploymentReference)) throw new Error('Existing legacy student deployment must be preserved before preparing these grants');
  if (review.legacyDeploymentReference) reference(review.legacyDeploymentReference);
  const seen = new Set(), requests = [];
  for (const decision of review.decisions) {
    keys(decision, ['studentId', 'decision', 'evidenceId']);
    const studentId = identifier(decision.studentId), row = plan.rows.find(item => item.studentId === studentId);
    if (seen.has(studentId) || decision.decision !== 'retain-existing-access' || row?.action !== 'review_provision_request') throw new Error('Only individually reviewed existing-access candidates can be packaged');
    seen.add(studentId); reference(decision.evidenceId);
    const path = `/api/site/admin/student-app/access/${studentId}`;
    requests.push({ ref: row.ref, studentId, evidenceId: decision.evidenceId,
      preflight: { method: 'GET', path, require: { studentId, allowed: row.currentAllowed, revision: row.expectedRevision, homeworkEnabled: true, noPendingOperation: true } },
      request: { method: 'PUT', path, body: { allowed: true, expectedRevision: row.expectedRevision } },
      postflight: { method: 'GET', path, require: { allowed: true, ready: true, homeworkEnabled: true, resultRevisionMatchesAccess: true } },
      onConflictOrUnknown: 'STOP. Read current provision state and re-plan; never retry with a newer revision or write a direct D1 grant.' });
  }
  if (seen.size !== plan.summary.provisionCandidates) throw new Error('Every provision candidate needs an explicit individual decision');
  return { schema: 1, mode: 'reviewed-teacher-provision-package', environment: plan.environment,
    batchId: plan.batchId, actor: plan.actor, at: packagedAt, planCreatedAt: plan.at, snapshotDigest: plan.snapshotDigest, planDigest: plan.planDigest,
    reviewedBy: review.reviewedBy, reviewedAt, legacyDeploymentReference: review.legacyDeploymentReference || null,
    applied: false, execution: { automaticApplyProvided: false, authentication: 'existing teacher JWT; never website administrator/member cookie',
      order: 'Sequential, preflight then one PUT then verified postflight for each student; stop on any mismatch.',
      forbid: ['direct SQL grants or synthetic sync rows', 'name/phone matching', 'Notion VIP changes without a separate teacher decision', 'replacing the legacy student deployment with unresolved users'] },
    requests };
}

export function redactedStudentTransitionReport(plan) {
  return { schema: plan.schema, mode: plan.mode, environment: plan.environment, batchId: plan.batchId, at: plan.at,
    snapshotDigest: plan.snapshotDigest, planDigest: plan.planDigest, summary: plan.summary, blockers: plan.blockers, rollout: plan.rollout,
    students: plan.rows.map(({ ref, currentAllowed, expectedRevision, vip, legacyEvidence, memberReady, action, blockers }) => ({ ref, currentAllowed, expectedRevision, vip, legacyEvidence, memberReady, action, blockers })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const values = new Map(), args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (!['--snapshot', '--review', '--batch', '--actor', '--at', '--package-at', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || values.has(args[i])) throw new Error('Invalid offline arguments');
      values.set(args[i], args[++i]);
    }
    const snapshot = JSON.parse(readFileSync(values.get('--snapshot'), 'utf8'));
    const options = { batchId: values.get('--batch'), actor: values.get('--actor') || 'operator', at: values.get('--at') };
    const plan = createStudentTransitionPlan(snapshot, options);
    if (values.has('--review')) {
      if (!values.has('--output')) throw new Error('An ignored local output path is required; identity-bearing packages are never printed');
      const localRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.tmp_qa');
      const output = resolve(values.get('--output')), child = relative(localRoot, output);
      if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Store identity-bearing packages only inside .tmp_qa/');
      const reviewed = createStudentTransitionPackage(snapshot, options, JSON.parse(readFileSync(values.get('--review'), 'utf8')), { at: values.get('--package-at') });
      mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(reviewed, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    } else if (values.has('--output')) throw new Error('Use shell redirection to save the redacted report; package output requires explicit review');
    process.stdout.write(JSON.stringify(redactedStudentTransitionReport(plan), null, 2) + '\n');
  } catch (error) { process.stderr.write(`Offline transition rejected: ${error.message}\n`); process.exitCode = 1; }
}
