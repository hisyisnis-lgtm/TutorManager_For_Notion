import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudentTransitionPackage, createStudentTransitionPlan, redactedStudentTransitionReport, transitionDigest, validateStudentTransitionSnapshot } from '../../02_devtools/student-app-transition-plan.mjs';
import { createStudentAppAccessPlan, studentAppAccessPlanSql, syntheticStudentAppSnapshot } from '../../02_devtools/student-app-access-plan.mjs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteStudentAppRoutes } from '../lib/siteStudentApp.js';
import { readStudentAppProvision } from '../lib/studentAppProvision.js';
import { requireStudentAppAccess, writeStudentAppAccess } from '../lib/studentAppAccess.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';
import { SITE_LEDGER_DATABASES } from '../lib/siteNotionSync.js';

const ID = '11111111111141118111111111111111', OTHER = '22222222222242228222222222222222';
const MEMBER = '33333333333343338333333333333333', MEMBER_OTHER = '44444444444444448444444444444444';
const capturedAt = '2026-10-15T10:00:00.000Z';
const options = { batchId: 'synthetic-transition', actor: 'fixture-reviewer', at: '2026-10-15T10:01:00.000Z' };
const packageAt = { at: '2026-10-15T10:03:00.000Z' };
const student = (studentId = ID) => ({ studentId, vip: true, archived: false, sharedAt: '2026-09-01T00:00:00.000Z', status: 'active' });
const legacy = (studentId = ID) => ({ studentId, allowed: true, evidence: 'teacher-reviewed', evidenceId: 'existing-permission-fixture', reviewedAt: capturedAt });
const snapshot = extra => ({ schema: 1, environment: 'synthetic', storageState: 'installed', capturedAt,
  complete: { students: true, legacy: true, access: true, sync: true, members: true, links: true, claims: true, enrollments: true },
  students: [student()], legacy: [legacy()], access: [], sync: [], members: [], links: [], claims: [], enrollments: [], ...extra });
const review = plan => ({ schema: 1, planDigest: plan.planDigest, reviewedBy: 'teacher-fixture', reviewedAt: '2026-10-15T10:02:00.000Z',
  legacyDeploymentPreserved: true, legacyDeploymentReference: 'old-student-build-fixture',
  decisions: plan.rows.filter(row => row.action === 'review_provision_request').map(row => ({ studentId: row.studentId, decision: 'retain-existing-access', evidenceId: 'explicit-permission-fixture' })) });
const prepare = data => { const plan = createStudentTransitionPlan(data, options); return createStudentTransitionPackage(data, options, review(plan), packageAt); };
let local, env, page, patches, teacher;
beforeEach(async () => {
  local = siteD1(); local.sqlite.exec(readFileSync(new URL('../migrations/0011_student_app_access.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, NOTION_TOKEN: 'synthetic-transition-notion-only', JWT_SECRET: 'synthetic-transition-jwt-secret' };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  page = { object: 'page', id: ID, parent: { database_id: SITE_LEDGER_DATABASES.student }, properties: { VIP: { type: 'checkbox', checkbox: true } } };
  patches = [];
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    if (new URL(raw).origin !== 'https://api.notion.com' || !new URL(raw).pathname.startsWith('/v1/pages/')) throw new Error('External network denied');
    if ((init.method || 'GET') === 'GET') return Response.json(page);
    patches.push(JSON.parse(init.body)); throw new Error('Transition fixtures prohibit Notion changes');
  }));
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('offline current-student transition review', () => {
  it('never infers current permission from VIP or a historical share and reports missing schema', () => {
    const input = snapshot({ storageState: 'not-installed', legacy: [{ studentId: ID, allowed: null, evidence: 'historical-share', evidenceId: null, reviewedAt: null }] });
    input.complete.legacy = false;
    const plan = createStudentTransitionPlan(input, options);
    expect(plan.blockers).toEqual(['incomplete_legacy_snapshot', 'additive_migrations_required']);
    expect(plan.rows[0]).toMatchObject({ action: 'manual_review_required', blockers: ['current_permission_unverified'] });
    expect(plan.summary.permissionUnverified).toBe(1);
    expect(() => createStudentTransitionPackage(input, options, review(plan), packageAt)).toThrow(/incomplete/);
    expect(fetch).not.toHaveBeenCalled();
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0);
  });
  it('does not invent a grant for an unshared VIP or change an explicit revocation', () => {
    const plan = createStudentTransitionPlan(snapshot({ students: [student(), { ...student(OTHER), sharedAt: null }], legacy: [], access: [{ student_id: ID, allowed: 0, revision: 4 }] }), options);
    expect(plan.rows.map(row => row.action)).toEqual(['preserve_revocation', 'no_explicit_permission']);
    expect(plan.summary.provisionCandidates).toBe(0);
    expect(prepare(snapshot({ access: [{ student_id: ID, allowed: 0, revision: 4 }], legacy: [] })).requests).toEqual([]);
  });
  it('blocks non-VIP existing users, unverified archive status and in-flight operations without changing Notion', () => {
    for (const extra of [{ students: [{ ...student(), vip: false }] }, { students: [{ ...student(), archived: null }] },
      { sync: [{ student_id: ID, state: 'unknown', result_revision: null, verified_allowed: null }] },
      { enrollments: [{ member_id: MEMBER, student_id: ID, state: 'creating' }] }]) {
      const input = snapshot(extra), plan = createStudentTransitionPlan(input, options);
      expect(plan.rows[0].blockers.length).toBeGreaterThan(0);
      expect(() => createStudentTransitionPackage(input, options, review(plan), packageAt)).toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks duplicate member ownership, conflicting claims and unavailable linked accounts', () => {
    const link = member_id => ({ member_id, student_id: ID, verified_at: capturedAt, verified_by: 'teacher' });
    for (const extra of [{ links: [link(MEMBER), link(MEMBER_OTHER)] },
      { links: [link(MEMBER)], claims: [{ member_id: MEMBER_OTHER, student_id: ID }] },
      { links: [link(MEMBER)], members: [{ memberId: MEMBER, status: 'suspended', profileComplete: true, phoneVerified: true }] }]) {
      const plan = createStudentTransitionPlan(snapshot(extra), options);
      expect(plan.rows[0].blockers.length).toBeGreaterThan(0);
      expect(plan.rows[0].memberReady).toBe(false);
    }
  });
  it('requires verified phone ownership and a separate teacher link for member cutover', () => {
    const input = snapshot({ links: [{ member_id: MEMBER, student_id: ID, verified_at: capturedAt, verified_by: 'teacher' }],
      members: [{ memberId: MEMBER, status: 'active', profileComplete: true, phoneVerified: false }] });
    expect(createStudentTransitionPlan(input, options).rows[0]).toMatchObject({ memberReady: false, blockers: ['verified_active_member_required'] });
    input.members[0].phoneVerified = true;
    expect(createStudentTransitionPlan(input, options).rows[0]).toMatchObject({ memberReady: true, blockers: [] });
    input.links = [];
    expect(createStudentTransitionPlan(input, options).rows[0].memberReady).toBe(false);
  });
  it('requires fresh complete snapshots, exact plan review and every individual decision', () => {
    const input = snapshot(), plan = createStudentTransitionPlan(input, options), confirmed = review(plan);
    for (const patch of [{ planDigest: 'changed' }, { decisions: [] }, { decisions: [...confirmed.decisions, confirmed.decisions[0]] },
      { decisions: [{ ...confirmed.decisions[0], studentId: OTHER }] }, { legacyDeploymentPreserved: false }]) {
      expect(() => createStudentTransitionPackage(input, options, { ...confirmed, ...patch }, packageAt)).toThrow();
    }
    expect(() => createStudentTransitionPackage(input, options, confirmed, { at: '2026-10-15T11:00:00.000Z' })).toThrow(/Refresh/);
    expect(createStudentTransitionPlan(input, { ...options, at: '2026-10-15T11:00:00.000Z' }).blockers).toContain('fresh_snapshot_required');
    expect(() => createStudentTransitionPackage(input, options, { ...confirmed, reviewedAt: capturedAt }, packageAt)).toThrow(/timestamp/);
    const changed = snapshot({ students: [{ ...student(), vip: false }] });
    expect(() => createStudentTransitionPackage(changed, options, confirmed, packageAt)).toThrow(/digest/);
  });
  it('rejects personal-data fields and malformed permission proof, accepts UUID casing without auto matching', () => {
    expect(() => validateStudentTransitionSnapshot(snapshot({ students: [{ ...student(), name: 'private name' }] }))).toThrow(/contacts/);
    expect(() => validateStudentTransitionSnapshot(snapshot({ legacy: [{ ...legacy(), evidence: 'historical-share' }] }))).toThrow(/not explicit/);
    expect(() => validateStudentTransitionSnapshot(snapshot({ students: [student(), student()] }))).toThrow(/Duplicate/);
    const input = snapshot({ students: [student('11111111-1111-4111-8111-111111111111')] });
    expect(createStudentTransitionPlan(input, options).rows[0].studentId).toBe(ID);
    const report = redactedStudentTransitionReport(createStudentTransitionPlan(input, options));
    expect(JSON.stringify(report)).not.toContain(ID); expect(report.students[0].ref).toBe('S001');
    expect(transitionDigest({ b: 2, a: 1 })).toBe(transitionDigest({ a: 1, b: 2 }));
  });
  it('only production provision packages can be prepared; direct SQL seed is synthetic-only', () => {
    expect(() => createStudentAppAccessPlan({ ...syntheticStudentAppSnapshot(), source: 'production' }, [], options)).toThrow(/synthetic-only/);
    const seed = createStudentAppAccessPlan(syntheticStudentAppSnapshot(), [], options);
    expect(() => studentAppAccessPlanSql({ ...seed, source: 'production' })).toThrow(/synthetic-only/);
    const pkg = prepare(snapshot());
    expect(pkg).toMatchObject({ applied: false, execution: { automaticApplyProvided: false }, requests: [{ request: { method: 'PUT', body: { allowed: true, expectedRevision: 0 } } }] });
    expect(JSON.stringify(pkg)).not.toMatch(/INSERT INTO|UPDATE student_app|password|Bearer /);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const send = async (descriptor, token = teacher) => handleSiteStudentAppRoutes(new Request(`https://tiantianchinese.com${descriptor.path}`, {
  method: descriptor.method, headers: { Authorization: `Bearer ${token}`, ...(descriptor.body ? { 'Content-Type': 'application/json' } : {}) },
  ...(descriptor.body ? { body: JSON.stringify(descriptor.body) } : {}),
}), env, {}, { authorizeTeacher: async request => await verifyTypedToken(env.JWT_SECRET, request.headers.get('Authorization')?.slice(7) || '', 'teacher')
  ? null : Response.json({ error: 'Teacher required' }, { status: 401 }) });

describe('prepared requests use the real provision path locally', () => {
  it('preserves an existing unlinked legacy student entitlement and records 0027 ready with no VIP write', async () => {
    const data = snapshot(), plan = createStudentTransitionPlan(data, options), pkg = prepare(data);
    expect(plan.rollout).toMatchObject({ legacyAppMustRemain: true, canReplaceExistingStudentApp: false });
    const operation = pkg.requests[0];
    expect((await send(operation.preflight)).status).toBe(200);
    const result = await send(operation.request);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ access: { allowed: true, revision: 1 }, sync: { ready: true, homeworkEnabled: true } });
    expect(await requireStudentAppAccess(env, ID)).toMatchObject({ allowed: true, revision: 1 });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_identity_claims').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(0);
    expect(patches).toEqual([]);
  });
  it('repairs a direct grant with a stale 0027 sync revision through provision, without reviving a newer OFF', async () => {
    await writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 0, actor: 'fixture' });
    local.sqlite.prepare(`INSERT INTO student_app_homework_sync(student_id,operation_id,requested_allowed,expected_revision,result_revision,state,verified_allowed,updated_at)
      VALUES(?,'old-operation',1,0,0,'synced',1,?)`).run(ID, capturedAt);
    expect((await readStudentAppProvision(env, ID)).sync.ready).toBe(false);
    const input = snapshot({ access: [{ student_id: ID, allowed: 1, revision: 1 }], sync: [{ student_id: ID, state: 'synced', result_revision: 0, verified_allowed: 1 }] });
    const operation = prepare(input).requests[0];
    const result = await send(operation.request); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ access: { allowed: true, revision: 1 }, sync: { ready: true } });
    await writeStudentAppAccess(env, ID, { allowed: false, expectedRevision: 1, actor: 'fixture' });
    expect((await send(operation.request)).status).toBe(409);
    expect((await readStudentAppProvision(env, ID)).access).toMatchObject({ allowed: false, revision: 2 });
    expect(patches).toEqual([]);
  });
  it('denies unsigned/legacy student tokens and does not silently execute a prepared package', async () => {
    const operation = prepare(snapshot()).requests[0];
    for (const token of ['', await signTypedToken(env.JWT_SECRET, 'student', 'personal:fixture', 600)]) expect((await send(operation.request, token)).status).toBe(401);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
