import { siteJson } from './siteAuth.js';
import { changeStudentAppProvision } from './studentAppProvision.js';

const PREFIX = '/api/site/admin/members';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[0-9a-f]{32}$/;
const STATUSES = new Set(['pending','active','suspended','withdrawn']);
const fail = (status, code, error, extra = {}) => siteJson({ error, code, ...extra }, { status });
const unavailable = () => fail(503, 'member_lifecycle_unavailable', '회원 정보를 처리하지 못했습니다. 잠시 후 다시 확인해주세요.');
const compact = value => String(value || '').replaceAll('-', '').toLowerCase();
const ownSessions = 'SELECT id FROM site_sessions WHERE member_id=?1';
const ownEmails = `SELECT lower(trim(email)) FROM site_members WHERE id=?1 AND email IS NOT NULL
  UNION SELECT lower(trim(email)) FROM site_member_identities WHERE member_id=?1 AND email IS NOT NULL`;
const exclusiveEmails = `${ownEmails}
  EXCEPT SELECT lower(trim(email)) FROM site_members WHERE id!=?1 AND status!='withdrawn' AND email IS NOT NULL
  EXCEPT SELECT lower(trim(email)) FROM site_member_identities WHERE member_id!=?1 AND email IS NOT NULL`;
const ownPhones = `SELECT provider_subject FROM site_member_identities WHERE member_id=?1 AND provider='phone'
  UNION SELECT provider_subject FROM site_members WHERE id=?1 AND provider='phone'`;
const safeSession = 'session_id IN (SELECT id FROM site_sessions WHERE member_id=?1 OR member_id IS NULL)';
const emailScope = `(session_id IN (${ownSessions}) OR (lower(trim(email)) IN (${exclusiveEmails}) AND ${safeSession}))`;
const phoneScope = `(member_id=?1 OR session_id IN (${ownSessions}) OR (phone_e164 IN (${ownPhones}) AND ${safeSession}))`;
const enrollmentStudent = `SELECT lower(replace(student_id,'-','')) FROM site_student_links WHERE member_id=?1`;
// This stable database snapshot is compared again INSIDE the D1 transaction. It
// includes every row that affects the plan, rather than a read-then-write check.
const aggregate = (table, fields, where, order) => `(SELECT json_group_array(json_array(${fields})) FROM
  (SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}))`;
const SNAPSHOT = `SELECT json_patch(json_object(
  'member',json_array(m.id,m.status,m.email,m.name,m.nickname,m.phone,m.provider,m.provider_subject,m.password_hash,m.password_salt,m.password_iterations,
    m.registration_token_hash,m.terms_accepted_at,m.privacy_accepted_at,m.marketing_accepted,m.updated_at,m.created_at),
  'sessions',${aggregate('site_sessions','id,token_hash,csrf_hash,expires_at,revoked_at','member_id=?1','id')},
  'identities',${aggregate('site_member_identities','provider,provider_subject,email','member_id=?1','provider,provider_subject')},
  'emailProofs',${aggregate('site_email_challenges','id,consumed_at,attempts',emailScope,'id')},
  'registrationProofs',${aggregate('site_registration_tokens','token_hash,consumed_at',emailScope,'token_hash')},
  'phoneChallenges',${aggregate('site_phone_challenges','id,consumed_at,delivery_state,attempts',phoneScope,'id')},
  'phoneProofs',${aggregate('site_phone_proofs','token_hash,consumed_at',phoneScope,'token_hash')},
  'resets',${aggregate('site_password_resets','token_hash,consumed_at','member_id=?1','token_hash')},
  'intents',${aggregate('site_member_link_intents','id,consumed_at','member_id=?1','id')}),json_object(
  'oauth',${aggregate('site_oauth_states','state_hash,consumed_at',`session_id IN (${ownSessions}) OR state_hash IN (SELECT oauth_state_hash FROM site_member_link_intents WHERE member_id=?1)`,'state_hash')},
  'links',${aggregate('site_student_links','member_id,student_id,verified_at,verified_by',`member_id=?1 OR lower(replace(student_id,'-','')) IN (${enrollmentStudent})`,'member_id')},
  'claims',${aggregate('site_student_identity_claims','member_id,student_id',`member_id=?1 OR student_id IN (${enrollmentStudent})`,'member_id')},
  'enrollments',${aggregate('site_student_enrollments','member_id,state,student_id,target_student_id,updated_at','member_id=?1','member_id')},
  'access',${aggregate('student_app_access','student_id,allowed,revision',`student_id IN (${enrollmentStudent})`,'student_id')},
  'sync',${aggregate('student_app_homework_sync','student_id,operation_id,state,result_revision,lease_token',`student_id IN (${enrollmentStudent})`,'student_id')},
  'reviews',${aggregate('reviews','id,status,version','member_id=?1','id')},
  'orders',${aggregate('site_shop_orders','id,status,shipping_status,admin_version,updated_at','member_id=?1','id')},
  'refunds',${aggregate('site_shop_refunds','id,state,version,updated_at','order_id IN (SELECT id FROM site_shop_orders WHERE member_id=?1)','id')},
  'lessonOrders',${aggregate('site_orders','id,status,version,updated_at','member_id=?1','id')},
  'lessonRefunds',${aggregate('site_refund_requests','id,state,updated_at','member_id=?1','id')},
  'requests',${aggregate('site_payment_requests','id,status,version,updated_at','member_id=?1','id')}
)) AS snapshot FROM site_members m WHERE m.id=?1`;
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const maskedName = value => { const chars = Array.from(value || ''); return chars.length <= 1 ? chars[0] || '' : `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 2))}${chars.length > 2 ? chars.at(-1) : ''}`; };
const maskedPhone = value => { const digits = String(value || '').replace(/\D/g, ''); return digits.length >= 8 ? `***-****-${digits.slice(-4)}` : ''; };
const maskedEmail = value => { const [local, domain] = String(value || '').split('@'); return domain ? `${local.slice(0, 1)}***@${domain}` : ''; };
function memberDto(row) {
  return { id: row.id, status: row.status, name: row.status === 'withdrawn' ? '탈퇴 회원' : maskedName(row.name),
    phone: maskedPhone(row.phone), email: maskedEmail(row.email), createdAt: row.created_at, updatedAt: row.updated_at };
}
const receipt = (db, id) => db.prepare('SELECT completed_at,sync_state,record_state,student_id,reason,operation_id FROM site_member_withdrawals WHERE member_id=?1').bind(id).first();
function withdrawalDto(row) { return row ? { completedAt: row.completed_at, syncState: row.sync_state, recordState: row.record_state } : null; }
async function snapshot(db, id) {
  const row = await db.prepare(SNAPSHOT).bind(id).first();
  return row ? { text: row.snapshot, data: JSON.parse(row.snapshot), version: await hash(row.snapshot) } : null;
}
function plan(state, id) {
  const d = state.data, blockers = [], add = (code, message, count) => { if (count) blockers.push({ code, message, count }); };
  add('open_orders', '결제·배송 처리가 끝나지 않은 상품 주문이 있습니다. 주문을 먼저 처리해주세요.',
    d.orders.filter(row => ['pending','confirming'].includes(row[1]) || ['paid','partially_refunded'].includes(row[1]) && ['pending','processing','shipped'].includes(row[2])).length);
  add('open_refunds', '처리 중인 상품 환불 요청이 있습니다. 환불을 먼저 마무리해주세요.', d.refunds.filter(row => ['pending','approving','unknown'].includes(row[1])).length);
  add('open_lesson_orders', '결제 확인 중인 수업 주문이 있습니다.', d.lessonOrders.filter(row => ['pending','confirming'].includes(row[1])).length);
  add('open_lesson_refunds', '처리 중인 수업 환불 요청이 있습니다.', d.lessonRefunds.filter(row => ['pending','approving','unknown'].includes(row[1])).length);
  add('open_payment_requests', '아직 종료되지 않은 수업 결제 요청이 있습니다.', d.requests.filter(row => ['open','ordered'].includes(row[1])).length);
  add('enrollment_in_progress', '학생 등록 결과가 확정되지 않았습니다. 학생 등록을 먼저 확인해주세요.', d.enrollments.filter(row => ['creating','unknown','created'].includes(row[1])).length);
  add('student_sync_in_progress', '숙제 관리 설정의 반영 결과가 확정되지 않았습니다. 학생앱 제공 상태를 먼저 확인해주세요.', d.sync.filter(row => ['processing','unknown'].includes(row[2])).length);
  const ownLinks = d.links.filter(row => row[0] === id), ownClaims = d.claims.filter(row => row[0] === id);
  let studentId = ownLinks.length === 1 ? compact(ownLinks[0][1]) : null;
  const associated = ownLinks.length + ownClaims.length + d.enrollments.filter(row => row[2] || row[3]).length;
  const safe = !associated || studentId && ID.test(studentId) && ownLinks[0][3] === 'teacher' && d.links.length === 1
    && ownClaims.length === 1 && d.claims.length === 1 && ownClaims[0][1] === studentId
    && d.enrollments.every(row => (!row[2] && !row[3]) || compact(row[2] || row[3]) === studentId);
  add('student_link_needs_review', '학생 연결이 중복되거나 확인되지 않았습니다. 학생 연결을 먼저 정리해주세요.', safe ? 0 : 1);
  if (!safe) studentId = null;
  return { blockers, studentId, deletion: { sessions: d.sessions.length, identities: d.identities.length,
    authProofs: d.emailProofs.length + d.registrationProofs.length + d.phoneChallenges.length + d.phoneProofs.length + d.resets.length + d.intents.length + d.oauth.length,
    reviews: d.reviews.filter(row => row[1] !== 'deleted').length, enrollments: d.enrollments.length, studentLinks: ownLinks.length },
  retained: { orders: d.orders.length, lessonOrders: d.lessonOrders.length, studentRecords: studentId ? 1 : 0 } };
}
async function detail(db, id) {
  const member = await db.prepare('SELECT * FROM site_members WHERE id=?1').bind(id).first();
  if (!member) return fail(404, 'member_not_found', '회원을 찾을 수 없습니다.');
  const state = await snapshot(db, id), impact = plan(state, id), previous = await receipt(db, id);
  return siteJson({ member: memberDto(member), expectedVersion: state.version, canWithdraw: member.status !== 'withdrawn' && impact.blockers.length === 0,
    blockers: impact.blockers, deletion: impact.deletion, retained: impact.retained,
    studentApp: { linked: !!impact.studentId, willRevoke: !!impact.studentId }, withdrawal: withdrawalDto(previous) });
}
async function list(url, db) {
  const q = (url.searchParams.get('q') || '').trim(), status = url.searchParams.get('status') || '';
  if (q.length > 80 || status && !STATUSES.has(status)) return fail(400, 'invalid_member_filter', '검색 조건을 확인해주세요.');
  let cursor = null;
  try { if (url.searchParams.has('cursor')) { cursor = JSON.parse(atob(url.searchParams.get('cursor'))); if (!UUID.test(cursor.id) || typeof cursor.at !== 'string' || cursor.at.length > 40) throw new Error(); } }
  catch { return fail(400, 'invalid_member_cursor', '목록을 처음부터 다시 확인해주세요.'); }
  const escaped = q.replace(/[\\%_]/g, '\\$&');
  if (new TextEncoder().encode(escaped).byteLength > 48) return fail(400, 'invalid_member_filter', '검색어를 조금 짧게 입력해주세요.');
  const rows = (await db.prepare(`SELECT id,status,name,phone,email,created_at,updated_at FROM site_members
    WHERE (?1='' OR status=?1) AND (?2='' OR name LIKE ?3 ESCAPE '\\' OR phone LIKE ?3 ESCAPE '\\' OR email LIKE ?3 ESCAPE '\\' OR id=?2)
      AND (?4 IS NULL OR created_at<?4 OR (created_at=?4 AND id<?5)) ORDER BY created_at DESC,id DESC LIMIT 51`)
    .bind(status, q, `%${escaped}%`, cursor?.at ?? null, cursor?.id ?? null).all()).results || [];
  const visible = rows.slice(0, 50), last = visible.at(-1);
  return siteJson({ members: visible.map(memberDto), nextCursor: rows.length > 50 ? btoa(JSON.stringify({ id: last.id, at: last.created_at })) : null });
}
async function input(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '') || Number(request.headers.get('Content-Length') || 0) > 1024) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let size = 0; const chunks = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024) { await reader.cancel(); return null; } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && Object.keys(value).sort().join(',') === 'confirmMemberId,expectedVersion,requestConfirmed' && /^[a-f0-9]{64}$/.test(value.expectedVersion)
      && value.requestConfirmed === true && typeof value.confirmMemberId === 'string' ? value : null;
  } catch { return null; }
}
const GATE = 'EXISTS(SELECT 1 FROM site_member_withdrawals WHERE member_id=?1 AND operation_id=?2)';
async function synchronize(env, id, row) {
  if (!row.student_id || ['synced','not_required'].includes(row.sync_state)) return row.sync_state;
  try {
    const linked = await env.GAME_DB.prepare("SELECT member_id FROM site_student_links WHERE lower(replace(student_id,'-',''))=?1").bind(row.student_id).first();
    if (linked) throw new Error('student_relinked');
    const access = await env.GAME_DB.prepare('SELECT allowed,revision FROM student_app_access WHERE student_id=?1').bind(row.student_id).first();
    if (!access || access.allowed !== 0) throw new Error('student_access_changed');
    const result = await changeStudentAppProvision(env, row.student_id, { allowed: false, expectedRevision: access.revision, actor: 'member_withdrawal' });
    if (!result.sync.ready || result.access.allowed) throw new Error('student_sync_pending');
    await env.GAME_DB.prepare("UPDATE site_member_withdrawals SET sync_state='synced',sync_error_code=NULL WHERE member_id=?1").bind(id).run();
    return 'synced';
  } catch {
    await env.GAME_DB.prepare("UPDATE site_member_withdrawals SET sync_state='needs_attention',sync_error_code='student_homework_sync_pending' WHERE member_id=?1").bind(id).run();
    return 'needs_attention';
  }
}
async function storeReceipt(env, id, row) {
  if (row.record_state === 'stored') return 'stored';
  try {
    if (!env.SITE_SHOP_FILES || typeof env.SITE_SHOP_FILES.put !== 'function') throw new Error('receipt_storage_unavailable');
    const value = JSON.stringify({ memberId: id, receiptId: row.operation_id, withdrawnAt: row.completed_at, reason: row.reason });
    // Each immutable receipt has its own deterministic key. Repeating this put
    // writes identical bytes; there is no shared append/index or PII payload.
    const object = await env.SITE_SHOP_FILES.put(`member-withdrawal-ledger/v1/${id}/${row.operation_id}.json`, value,
      { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
    if (!object) throw new Error('receipt_storage_unconfirmed');
    await env.GAME_DB.prepare("UPDATE site_member_withdrawals SET record_state='stored' WHERE member_id=?1 AND operation_id=?2")
      .bind(id, row.operation_id).run();
    return 'stored';
  } catch {
    await env.GAME_DB.prepare("UPDATE site_member_withdrawals SET record_state='needs_attention' WHERE member_id=?1 AND operation_id=?2")
      .bind(id, row.operation_id).run();
    return 'needs_attention';
  }
}
async function withdraw(request, env, id) {
  const value = await input(request);
  if (!value || value.confirmMemberId !== id) return fail(400, 'withdrawal_confirmation_required', '본인 탈퇴 요청 확인과 회원 ID를 확인해주세요.');
  const db = env.GAME_DB, old = await receipt(db, id);
  if (old) return success(id, old, true); // No external write on a repeated/uncertain browser POST.
  const state = await snapshot(db, id);
  if (!state) return fail(404, 'member_not_found', '회원을 찾을 수 없습니다.');
  if (state.data.member[1] === 'withdrawn') return fail(409, 'withdrawal_needs_review', '이전 탈퇴 처리 기록을 확인해주세요.');
  if (state.version !== value.expectedVersion) return fail(409, 'member_version_changed', '회원 정보가 변경되었습니다. 현재 정보를 다시 확인해주세요.');
  const impact = plan(state, id);
  if (impact.blockers.length) return fail(409, 'withdrawal_blocked', '처리 중인 항목을 먼저 마무리해주세요.', { blockers: impact.blockers });
  return performWithdrawal(env, id, state, impact);
}
async function performWithdrawal(env, id, state, impact, reason = 'requested') {
  const db = env.GAME_DB;
  const operation = crypto.randomUUID(), at = new Date().toISOString(), sid = impact.studentId;
  const statement = (sql, ...extra) => db.prepare(sql).bind(id, operation, ...extra);
  const statements = [db.prepare(`INSERT INTO site_member_withdrawals(member_id,operation_id,completed_at,counts_json,student_id,sync_state,reason)
    SELECT ?1,?2,?4,?5,?6,?7,?8 WHERE (${SNAPSHOT.replace(' AS snapshot FROM', ' FROM')})=?3`)
    .bind(id, operation, state.text, at, JSON.stringify({ deleted: impact.deletion, retained: impact.retained }), sid, sid ? 'pending' : 'not_required', reason)];
  if (sid) {
    statements.push(statement(`INSERT INTO student_app_access(student_id,allowed,revision,revoked_at,revoked_by,last_operation_id)
      SELECT ?3,0,1,?4,'member_withdrawal',?2 WHERE ${GATE}
      ON CONFLICT(student_id) DO UPDATE SET allowed=0,revision=student_app_access.revision+1,revoked_at=?4,revoked_by='member_withdrawal',last_operation_id=?2`, sid, at));
    statements.push(statement(`INSERT INTO student_app_access_events(event_id,student_id,revision,allowed,actor,created_at)
      SELECT ?2,student_id,revision,0,'member_withdrawal',?4 FROM student_app_access WHERE student_id=?3 AND ${GATE}`, sid, at));
    // Close an old ON lease before detaching the member; its CAS can no longer grant.
    statements.push(statement(`INSERT INTO student_app_homework_sync(student_id,operation_id,requested_allowed,expected_revision,result_revision,state,error_code,updated_at)
      SELECT ?3,?2,0,revision,revision,'failed','member_withdrawal',?4 FROM student_app_access WHERE student_id=?3 AND ${GATE}
      ON CONFLICT(student_id) DO UPDATE SET operation_id=?2,requested_allowed=0,expected_revision=excluded.expected_revision,
        result_revision=excluded.result_revision,state='failed',lease_token=NULL,lease_until=NULL,write_target=NULL,write_before=NULL,
        write_started_at=NULL,verified_allowed=NULL,error_code='member_withdrawal',updated_at=?4`, sid, at));
  }
  statements.push(statement(`DELETE FROM site_phone_send_cooldowns WHERE phone_hash IN (SELECT phone_hash FROM site_phone_challenges WHERE ${phoneScope}) AND ${GATE}`));
  // Child proofs precede parent sessions. Matching anonymous proofs are scoped to
  // this verified identity and never delete another signed-in member's session.
  statements.push(statement(`DELETE FROM site_phone_proofs WHERE ${phoneScope} AND ${GATE}`));
  statements.push(statement(`DELETE FROM site_phone_challenges WHERE ${phoneScope} AND ${GATE}`));
  statements.push(statement(`DELETE FROM site_oauth_states WHERE (session_id IN (${ownSessions}) OR state_hash IN (SELECT oauth_state_hash FROM site_member_link_intents WHERE member_id=?1)) AND ${GATE}`));
  statements.push(statement(`DELETE FROM site_email_challenges WHERE ${emailScope} AND ${GATE}`));
  statements.push(statement(`DELETE FROM site_registration_tokens WHERE ${emailScope} AND ${GATE}`));
  for (const table of ['site_member_link_intents','site_password_resets','site_sessions','site_member_identities','site_student_enrollments','site_student_identity_claims','site_student_links']) {
    statements.push(statement(`DELETE FROM ${table} WHERE member_id=?1 AND ${GATE}`));
  }
  statements.push(statement(`UPDATE reviews SET status='deleted',version=version+1,latest_content=NULL,published_content=NULL,password_salt=NULL,
    password_hash=NULL,password_iterations=NULL,pending_version=NULL,published_version=NULL,moderation_reason=NULL,hidden_reason=NULL,last_reason=NULL,
    restore_allowed=0,latest_target_id=NULL,published_target_id=NULL,latest_rating=NULL,published_rating=NULL,latest_purchase_item_id=NULL,
    published_purchase_item_id=NULL,last_action='delete',last_actor='member_withdrawal',deleted_at=?3,updated_at=?3
    WHERE member_id=?1 AND status!='deleted' AND ${GATE}`, at));
  // Existing CHECKs require an enumerated provider; this credential-free scaffold
  // is never a login method. All provider identities and subjects are removed.
  statements.push(statement(`UPDATE site_members SET status='withdrawn',name='',nickname='',email=NULL,phone='',provider='google',provider_subject=NULL,
    password_hash=NULL,password_salt=NULL,password_iterations=NULL,registration_token_hash=NULL,terms_accepted_at=NULL,privacy_accepted_at=NULL,
    marketing_accepted=0,member_code='withdrawn:'||id,customer_key='withdrawn:'||id,updated_at=?3 WHERE id=?1 AND ${GATE}`, at));
  try { await db.batch(statements); }
  catch (error) {
    // An identical administrator action may have committed during this await.
    // Never repeat any deletion or external write when its receipt exists.
    const concurrent = await receipt(db, id); if (concurrent) return success(id, concurrent, true);
    throw error;
  }
  const done = await receipt(db, id);
  if (!done) return fail(409, 'member_version_changed', '회원 정보가 변경되었습니다. 현재 정보를 다시 확인해주세요.');
  if (done.operation_id !== operation) return success(id, done, true);
  const recordState = await storeReceipt(env, id, done);
  const syncState = await synchronize(env, id, done);
  return success(id, { ...done, sync_state: syncState, record_state: recordState }, false);
}
// Only unfinished social signup data expires here. A completed website member
// waiting for student-app approval has status=active and is never a candidate.
export async function cleanupPendingSiteMembers(env, { now = Date.now() } = {}) {
  if (!env.GAME_DB || !Number.isFinite(now)) return { cleaned: 0, unavailable: true };
  const db = env.GAME_DB, cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  try {
    const migrated = await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='site_member_withdrawals'").first();
    if (!migrated) return { cleaned: 0, unavailable: true };
    const rows = (await db.prepare(`SELECT m.id FROM site_members m WHERE m.status='pending' AND m.provider IN ('google','kakao')
      AND julianday(m.created_at)<=julianday(?1) AND (m.terms_accepted_at IS NULL OR m.privacy_accepted_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM site_shop_orders WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM site_orders WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM site_payment_requests WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM site_student_identity_claims WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM site_student_enrollments WHERE member_id=m.id)
      ORDER BY m.created_at,m.id LIMIT 1`).bind(cutoff).all()).results || [];
    let cleaned = 0;
    for (const { id } of rows) {
      const state = await snapshot(db, id); if (!state) continue;
      // Repeat every selection fact in the versioned snapshot before the final
      // transaction; an active-profile or student-approval race must win.
      const m = state.data.member, impact = plan(state, id);
      if (m[1] !== 'pending' || !['google','kakao'].includes(m[6]) || m[12] !== null && m[13] !== null
        || !Number.isFinite(Date.parse(m[16])) || Date.parse(m[16]) > Date.parse(cutoff)
        || state.data.orders.length || state.data.lessonOrders.length || state.data.requests.length
        || state.data.links.length || state.data.claims.length || state.data.enrollments.length || impact.blockers.length) continue;
      const response = await performWithdrawal(env, id, state, impact, 'incomplete_expired');
      if (response.status === 200 && !(await response.json()).alreadyWithdrawn) cleaned++;
    }
    return { cleaned };
  } catch { return { cleaned: 0, unavailable: true }; }
}
export async function recoverWithdrawalReceipts(env) {
  if (!env.GAME_DB) return { stored: 0, pending: 0, unavailable: true };
  try {
    const rows = (await env.GAME_DB.prepare(`SELECT member_id,completed_at,sync_state,record_state,student_id,reason,operation_id
      FROM site_member_withdrawals WHERE record_state!='stored' ORDER BY completed_at,member_id LIMIT 1`).all()).results || [];
    let stored = 0, pending = 0;
    for (const row of rows) { if (await storeReceipt(env, row.member_id, row) === 'stored') stored++; else pending++; }
    return { stored, pending };
  } catch { return { stored: 0, pending: 0, unavailable: true }; }
}
// Kept on a dedicated cron invocation so the existing hourly auth/security and
// payment-recovery work retains its full Free-plan query budget.
export async function runSiteMemberMaintenance(env) {
  const expired = await cleanupPendingSiteMembers(env);
  const records = expired.cleaned ? { stored: 0, pending: 0, skipped: true } : await recoverWithdrawalReceipts(env);
  return { expired, records };
}
function success(id, row, alreadyWithdrawn) {
  const warnings = [];
  if (['pending','needs_attention'].includes(row.sync_state)) warnings.push('숙제 관리 설정의 외부 동기화는 별도 확인이 필요합니다.');
  if (row.record_state !== 'stored') warnings.push('복구용 탈퇴 기록 보관은 별도 확인이 필요합니다.');
  return siteJson({ withdrawn: true, alreadyWithdrawn, memberId: id, completedAt: row.completed_at, syncState: row.sync_state,
    recordState: row.record_state, warning: warnings.length ? `회원정보 삭제와 학생앱 차단을 완료했습니다. ${warnings.join(' ')}` : null });
}
async function retrySync(request, env, id) {
  const value = await input(request);
  if (!value || value.confirmMemberId !== id) return fail(400, 'withdrawal_confirmation_required', '본인 탈퇴 요청 확인과 회원 ID를 확인해주세요.');
  const row = await receipt(env.GAME_DB, id), state = await snapshot(env.GAME_DB, id);
  if (!row || state?.data.member[1] !== 'withdrawn') return fail(409, 'withdrawal_not_completed', '탈퇴 처리 결과를 먼저 확인해주세요.');
  if (state.version !== value.expectedVersion) return fail(409, 'member_version_changed', '현재 정보를 다시 확인해주세요.');
  const recordState = await storeReceipt(env, id, row);
  const syncState = await synchronize(env, id, row);
  return success(id, { ...row, sync_state: syncState, record_state: recordState }, true);
}
export async function handleSiteMemberLifecycleRoutes(request, env, _ctx, { authorizeTeacher } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
  if (url.pathname === PREFIX && (url.searchParams.has('query') || url.searchParams.has('code'))) return null;
  const match = url.pathname === PREFIX ? null : url.pathname.slice(PREFIX.length).match(/^\/([^/]+)(\/withdraw(?:\/sync)?)?$/);
  // The older /members/:id/student-link route belongs to siteCommerce. A new
  // member tool must never claim or replace that existing authorization path.
  if (url.pathname !== PREFIX && !match) return null;
  try {
    if (typeof authorizeTeacher !== 'function') return fail(401, 'admin_login_required', '관리자 로그인이 필요합니다.');
    const denial = await authorizeTeacher(request, env, {}); if (denial) return denial;
    if (!env.GAME_DB) return unavailable();
    if (url.pathname === PREFIX) return request.method === 'GET' ? await list(url, env.GAME_DB) : fail(405, 'method_not_allowed', '지원하지 않는 요청 방식입니다.');
    if (!match || !UUID.test(match[1])) return fail(404, 'member_not_found', '회원을 찾을 수 없습니다.');
    if (!match[2] && request.method === 'GET') return await detail(env.GAME_DB, match[1]);
    if (match[2] === '/withdraw' && request.method === 'POST') return await withdraw(request, env, match[1]);
    if (match[2] === '/withdraw/sync' && request.method === 'POST') return await retrySync(request, env, match[1]);
    return fail(405, 'method_not_allowed', '지원하지 않는 요청 방식입니다.');
  } catch { return unavailable(); }
}
