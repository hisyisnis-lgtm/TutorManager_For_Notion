import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { handleSiteMemberLifecycleRoutes, cleanupPendingSiteMembers, recoverWithdrawalReceipts } from '../lib/siteMemberLifecycle.js';
import { authorizeSiteAdminRequest, handleSiteAdminAuthRoutes } from '../lib/siteAdminAuth.js';
import { SITE_LEDGER_DATABASES } from '../lib/siteNotionSync.js';
import { writeStudentAppAccess } from '../lib/studentAppAccess.js';
import { changeStudentAppProvision } from '../lib/studentAppProvision.js';
import worker from '../src/index.js';

const ORIGIN = 'http://localhost:4323', MEMBER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333333343338333333333333333', LEGACY = '44444444444444448444444444444444';
let sqlite, env, db, session, beforeBatch, notionFail, vip, objects, objectWrites, storageFail, queryCount;
function adapter(sqlite) {
  return { prepare(sql) { const statement = sqlite.prepare(sql);
    // Keep the D1 binding implementation independent of its caller.
    const realBound = (args = []) => ({ bind: (...values) => realBound(values), first: async () => { queryCount++; return statement.get(...args) || null; },
      all: async () => { queryCount++; return { results: statement.all(...args) }; }, run: async () => run(args), _execute: () => run(args) });
    function run(args) { queryCount++; const results = statement.columns().length ? statement.all(...args) : []; const meta = statement.columns().length ? { changes: sqlite.prepare('SELECT changes() n').get().n } : statement.run(...args); return { results, meta }; }
    return realBound();
  }, async batch(statements) { if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook(); } sqlite.exec('BEGIN IMMEDIATE'); try { const result = statements.map(s => s._execute()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
function seed(id = MEMBER, phone = '+821012345678') {
  sqlite.prepare(`INSERT INTO site_members(id,status,email,name,nickname,phone,member_code,customer_key,provider,provider_subject,password_hash,password_salt,password_iterations,
    registration_token_hash,terms_accepted_at,privacy_accepted_at,marketing_accepted,created_at,updated_at) VALUES(?,'active',?,'김하늘','하늘',?,?,?,'phone',?,'hash','salt',1,?,'2026-10-15','2026-10-15',1,'2026-10-15','2026-10-15')`)
    .run(id, `${id}@fixture.invalid`, phone, `code-${id}`, `key-${id}`, phone, `registration-${id}`);
  sqlite.prepare("INSERT INTO site_member_identities VALUES('phone',?,?,NULL,'2026-10-15')").run(phone, id);
  sqlite.prepare("INSERT INTO site_sessions VALUES(?,?,?, ?,9999999999,NULL,'2026-10-15')").run(`s-${id}`, `t-${id}`, 'csrf', id);
}
const request = (path = '', method = 'GET', body, headers = {}) => new Request(`${ORIGIN}/api/site/admin/members${path}`, { method,
  headers: { Origin: ORIGIN, ...(session?.cookie ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const send = (path = '', method = 'GET', body, headers = {}) => handleSiteMemberLifecycleRoutes(request(path, method, body, headers), env, {}, {
  authorizeTeacher: (req, context) => authorizeSiteAdminRequest(req, context),
});
const details = async (id = MEMBER) => { const response = await send(`/${id}`); expect(response.status).toBe(200); return response.json(); };
const execute = async (id = MEMBER, overrides = {}) => send(`/${id}/withdraw`, 'POST', { expectedVersion: (await details(id)).expectedVersion, confirmMemberId: id, requestConfirmed: true, ...overrides });
function link() {
  sqlite.prepare("INSERT INTO site_student_links VALUES(?,?, '2026-10-15','teacher')").run(MEMBER, STUDENT);
  sqlite.prepare("INSERT INTO site_student_identity_claims VALUES(?,?,'2026-10-15')").run(STUDENT, MEMBER);
}
function authProofs() {
  const sid = `s-${MEMBER}`;
  sqlite.prepare("INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at) VALUES('email',?,'proof',?,9999999999,'2026-10-15')").run(`${MEMBER}@fixture.invalid`, sid);
  sqlite.prepare("INSERT INTO site_registration_tokens VALUES('reg',?,?,9999999999,NULL,'2026-10-15')").run(`${MEMBER}@fixture.invalid`, sid);
  sqlite.prepare("INSERT INTO site_password_resets(token_hash,member_id,expires_at,created_at) VALUES('reset',?,9999999999,'2026-10-15')").run(MEMBER);
  sqlite.prepare("INSERT INTO site_oauth_states VALUES('oauth','google','nonce',?,'https://fixture.invalid/callback','/',9999999999,NULL,'2026-10-15')").run(sid);
  sqlite.prepare("INSERT INTO site_member_link_intents(id,provider,member_id,session_id,oauth_state_hash,expires_at,created_at) VALUES('intent','google',?,?,'oauth',9999999999,'2026-10-15')").run(MEMBER, sid);
  sqlite.prepare("INSERT INTO site_phone_challenges(id,phone_e164,phone_hash,purpose,member_id,session_id,csrf_hash,proof_hash,expires_at,created_at) VALUES('phone','+821012345678','phonehash','link',?,?,'csrf','proof',9999999999,'2026-10-15')").run(MEMBER, sid);
  sqlite.prepare("INSERT INTO site_phone_proofs(token_hash,phone_e164,purpose,member_id,session_id,csrf_hash,expires_at,created_at) VALUES('phoneproof','+821012345678','link',?,?,'csrf',9999999999,'2026-10-15')").run(MEMBER, sid);
  sqlite.prepare("INSERT INTO site_phone_send_cooldowns VALUES('phonehash',9999999999)").run();
}
function shop(status = 'paid', shipping = 'delivered') {
  sqlite.exec("INSERT INTO site_shop_products(slug,name,product_type,price,created_at,updated_at) VALUES('book','교재','physical',10000,'2026-10-15','2026-10-15')");
  sqlite.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,pg_order_id,
    pg_environment,pg_client_id,callback_nonce,status,approval_key,stock_state,shipping_status,expires_at,created_at,updated_at)
    VALUES('order',?,'book','physical','ih','ph','{"customerName":"법정보관","customerPhone":"01012345678"}',10000,0,'pg','test','client','nonce',?,'approval','committed',?,'2030-01-01','2026-10-15','2026-10-15')`).run(MEMBER, status, shipping);
}
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => /^\d{4}.*\.sql$/.test(f)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  db = adapter(sqlite); env = { GAME_DB: db, SITE_ORIGIN: ORIGIN, SITE_ENVIRONMENT: 'development', SITE_ADMIN_ENABLED: 'true',
    AUTH_PASSWORD: 'fixture-password', JWT_SECRET: 'fixture-jwt', SITE_SESSION_SECRET: 'fixture-lifecycle-secret-32-characters', NOTION_TOKEN: 'fixture' };
  beforeBatch = null; session = null; notionFail = false; vip = true; queryCount = 0;
  objects = new Map(); objectWrites = 0; storageFail = false;
  env.SITE_SHOP_FILES = { async put(key, value) { objectWrites++; if (storageFail) throw new Error('Synthetic R2 unavailable'); objects.set(key, value); return { key, etag: 'synthetic' }; } };
  const first = await handleSiteAdminAuthRoutes(new Request(`${ORIGIN}/api/site/admin/session`, { headers: { Origin: ORIGIN } }), env);
  session = { cookie: first.headers.get('Set-Cookie').split(';')[0], ...(await first.json()) };
  const logged = await handleSiteAdminAuthRoutes(new Request(`${ORIGIN}/api/site/admin/auth/login`, { method: 'POST', headers: { Origin: ORIGIN,
    Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.AUTH_PASSWORD }) }), env);
  session = { cookie: logged.headers.get('Set-Cookie').split(';')[0], ...(await logged.json()) };
  seed(); seed(OTHER, '+821087654321');
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => {
    if (notionFail) throw new Error('Synthetic network failure');
    const url = new URL(raw); if (url.origin !== 'https://api.notion.com' || !url.pathname.endsWith(STUDENT)) throw new Error('External network denied');
    if (options.method === 'PATCH') vip = JSON.parse(options.body).properties.VIP.checkbox;
    return Response.json({ object: 'page', id: STUDENT, parent: { database_id: SITE_LEDGER_DATABASES.student }, properties: { VIP: { type: 'checkbox', checkbox: vip } } });
  }));
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('explicit administrator member withdrawal', () => {
  it('requires a real administrator session and CSRF, rejects foreign origins and member cookies', async () => {
    const current = session; session = null; expect((await send()).status).toBe(401); session = current;
    expect((await send('', 'GET', undefined, { Origin: 'https://evil.invalid' })).status).toBe(403);
    const body = { expectedVersion: (await details()).expectedVersion, confirmMemberId: MEMBER, requestConfirmed: true };
    expect((await send(`/${MEMBER}/withdraw`, 'POST', body, { 'X-CSRF-Token': 'invalid' })).status).toBe(403);
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('active');
  });
  it('lists only masked personal fields and uses a strict confirmation body', async () => {
    const rows = await (await send()).json(); expect(rows.members.find(m => m.id === MEMBER)).toMatchObject({ name: '김*늘', phone: '***-****-5678' });
    expect(JSON.stringify(rows)).not.toMatch(/password|provider_subject|customer_key|01012345678/);
    expect((await execute(MEMBER, { requestConfirmed: false })).status).toBe(400);
    expect((await execute(MEMBER, { confirmMemberId: OTHER })).status).toBe(400);
  });
  it('leaves the existing exact-member search and student-link handlers in charge of their routes', async () => {
    expect(await send('?query=existing')).toBe(null); expect(await send('?code=existing-code')).toBe(null);
    expect(await send(`/${MEMBER}/student-link`, 'POST', { studentId: STUDENT })).toBe(null);
  });
  it('atomically scrubs credentials and short-lived proofs, leaves another member unchanged, and cannot revive', async () => {
    authProofs(); const other = sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(OTHER);
    const preview = await details(); expect(preview.deletion).toMatchObject({ sessions: 1, identities: 1, authProofs: 7 });
    const result = await execute(); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ withdrawn: true, syncState: 'not_required' });
    const member = sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(MEMBER);
    expect(member).toMatchObject({ status: 'withdrawn', name: '', nickname: '', phone: '', email: null, provider_subject: null,
      password_hash: null, password_salt: null, password_iterations: null, registration_token_hash: null, marketing_accepted: 0 });
    for (const table of ['site_email_challenges','site_registration_tokens','site_password_resets','site_oauth_states','site_phone_challenges','site_phone_proofs','site_member_link_intents','site_phone_send_cooldowns']) expect(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_sessions WHERE member_id=?').get(MEMBER).n).toBe(0);
    expect(sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(OTHER)).toEqual(other);
    expect(() => sqlite.prepare("UPDATE site_members SET status='active' WHERE id=?").run(MEMBER)).toThrow(/member_withdrawn/);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks the snapshot inside the transaction and does not partially delete on a race', async () => {
    const body = { expectedVersion: (await details()).expectedVersion, confirmMemberId: MEMBER, requestConfirmed: true };
    beforeBatch = () => sqlite.prepare("UPDATE site_members SET name='변경' WHERE id=?").run(MEMBER);
    const response = await send(`/${MEMBER}/withdraw`, 'POST', body); expect(response.status).toBe(409);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_withdrawals').get().n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_identities WHERE member_id=?').get(MEMBER).n).toBe(1);
  });
  it('returns the same receipt for concurrent confirmed requests without repeating mutations', async () => {
    const body = { expectedVersion: (await details()).expectedVersion, confirmMemberId: MEMBER, requestConfirmed: true };
    const results = await Promise.all([send(`/${MEMBER}/withdraw`, 'POST', body), send(`/${MEMBER}/withdraw`, 'POST', body)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const values = await Promise.all(results.map(r => r.json())); expect(values.map(v => v.alreadyWithdrawn).sort()).toEqual([false, true]);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_withdrawals').get().n).toBe(1);
  });
  it('deletes matching anonymous proofs without deleting another signed-in member proofs for the same email', async () => {
    const email = `${MEMBER}@fixture.invalid`;
    sqlite.prepare("INSERT INTO site_sessions VALUES('anonymous','anon-token','anon-csrf',NULL,9999999999,NULL,'2026-10-15')").run();
    sqlite.prepare("INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at) VALUES('anon-email',?,'p','anonymous',9999999999,'2026-10-15')").run(email);
    sqlite.prepare("INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at) VALUES('other-email',?,'p',?,9999999999,'2026-10-15')").run(email, `s-${OTHER}`);
    expect((await execute()).status).toBe(200);
    expect(sqlite.prepare('SELECT id FROM site_email_challenges').all()).toEqual([{ id: 'other-email' }]);
    expect(sqlite.prepare('SELECT id FROM site_sessions WHERE member_id=?').get(OTHER).id).toBe(`s-${OTHER}`);
  });
  it('never deletes an anonymous proof also owned by another active canonical account', async () => {
    const email = `${MEMBER}@fixture.invalid`;
    sqlite.prepare('UPDATE site_members SET email=? WHERE id=?').run(email, OTHER);
    sqlite.prepare("INSERT INTO site_sessions VALUES('anonymous','anon-token','anon-csrf',NULL,9999999999,NULL,'2026-10-15')").run();
    sqlite.prepare("INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at) VALUES('shared-email',?,'p','anonymous',9999999999,'2026-10-15')").run(email);
    expect((await execute()).status).toBe(200); expect(sqlite.prepare('SELECT id FROM site_email_challenges').get().id).toBe('shared-email');
  });
  it('rolls back every mutation if a later deletion fails', async () => {
    authProofs(); sqlite.exec("CREATE TRIGGER synthetic_failure BEFORE UPDATE ON site_members WHEN NEW.status='withdrawn' BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    expect((await execute()).status).toBe(503);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_withdrawals').get().n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_phone_challenges').get().n).toBe(1);
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('active');
  });
  it.each([['pending','pending'],['confirming','pending'],['paid','processing'],['paid','shipped']])('blocks unfinished %s/%s orders', async (status, shipping) => {
    shop(status, shipping); expect((await details()).blockers.some(b => b.code === 'open_orders')).toBe(true); expect((await execute()).status).toBe(409);
  });
  it('keeps separately retained completed transaction evidence byte-for-byte and blocks inflight refunds', async () => {
    shop(); const original = sqlite.prepare('SELECT * FROM site_shop_orders').get();
    sqlite.exec("INSERT INTO site_shop_refunds(id,order_id,reason,requested_amount,cancel_order_id,state,created_at,updated_at) VALUES('refund','order','환불',10000,'cancel','unknown','2026-10-15','2026-10-15')");
    expect((await execute()).status).toBe(409); sqlite.exec("UPDATE site_shop_refunds SET state='completed'");
    expect((await execute()).status).toBe(200); expect(sqlite.prepare('SELECT * FROM site_shop_orders').get()).toEqual(original);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('deletes general review text, published snapshots, passwords, and moderation free text', async () => {
    sqlite.prepare(`INSERT INTO reviews(id,latest_content,published_content,status,version,pending_version,published_version,idempotency_key_hash,request_hash,request_expires_at,
      created_at,updated_at,member_id) VALUES('review','개인정보 본문','공개 개인정보','published',1,1,1,'idem','hash',9999999999,'2026-10-15','2026-10-15',?)`).run(MEMBER);
    sqlite.exec("INSERT INTO review_moderation_log(review_id,version,action,reason,actor,created_at) VALUES('review',1,'approve','개인 사유','teacher','2026-10-15')");
    expect((await execute()).status).toBe(200); expect(sqlite.prepare('SELECT status,latest_content,published_content FROM reviews').get()).toMatchObject({ status: 'deleted', latest_content: null, published_content: null });
    expect(sqlite.prepare('SELECT reason FROM review_moderation_log').get().reason).toBe(null);
  });
  it('revokes only the linked member student, synchronizes VIP OFF, preserves unlinked legacy access and idempotent receipts', async () => {
    link(); await writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: 0 }); await writeStudentAppAccess(env, LEGACY, { allowed: true, expectedRevision: 0 });
    const legacy = sqlite.prepare('SELECT * FROM student_app_access WHERE student_id=?').get(LEGACY);
    const response = await execute(); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ syncState: 'synced', alreadyWithdrawn: false });
    expect(vip).toBe(false); expect(sqlite.prepare('SELECT allowed FROM student_app_access WHERE student_id=?').get(STUDENT).allowed).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(0);
    expect(sqlite.prepare('SELECT * FROM student_app_access WHERE student_id=?').get(LEGACY)).toEqual(legacy);
    const calls = fetch.mock.calls.length; expect(await (await execute()).json()).toMatchObject({ alreadyWithdrawn: true, syncState: 'synced' }); expect(fetch).toHaveBeenCalledTimes(calls);
    expect((await details()).withdrawal.syncState).toBe('synced');
  });
  it('fails closed on external VIP failure without pretending synchronization is complete or permitting stale ON', async () => {
    link(); await writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: 0 }); notionFail = true;
    const response = await execute(); expect(response.status).toBe(200); const result = await response.json(); expect(result.syncState).toBe('needs_attention'); expect(result.warning).toContain('별도 확인');
    const access = sqlite.prepare('SELECT allowed,revision FROM student_app_access WHERE student_id=?').get(STUDENT); expect(access.allowed).toBe(0);
    await expect(writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: access.revision })).rejects.toMatchObject({ status: 503 });
    expect(sqlite.prepare('SELECT allowed FROM student_app_access WHERE student_id=?').get(STUDENT).allowed).toBe(0);
    const audit = JSON.stringify(sqlite.prepare('SELECT * FROM site_member_withdrawals').get()); expect(audit).not.toContain('+821012345678'); expect(audit).not.toContain('김하늘');
    const calls = fetch.mock.calls.length;
    await expect(changeStudentAppProvision(env, STUDENT, { allowed: true, expectedRevision: access.revision })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(calls);
    notionFail = false;
    const fresh = await details(), recovered = await send(`/${MEMBER}/withdraw/sync`, 'POST', { expectedVersion: fresh.expectedVersion, confirmMemberId: MEMBER, requestConfirmed: true });
    expect(recovered.status).toBe(200); expect(await recovered.json()).toMatchObject({ withdrawn: true, syncState: 'synced' }); expect(vip).toBe(false);
  });
  it('refuses ambiguous links and unresolved external enrollment instead of touching other student grants', async () => {
    link(); sqlite.prepare("INSERT INTO site_student_links VALUES(?,?,'2026-10-15','teacher')").run(OTHER, STUDENT);
    expect((await details()).blockers.some(b => b.code === 'student_link_needs_review')).toBe(true); expect((await execute()).status).toBe(409);
  });
  it('blocks uncertain student provision writes before detaching their owner', async () => {
    link(); await writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: 0 });
    sqlite.prepare(`INSERT INTO student_app_homework_sync(student_id,operation_id,requested_allowed,expected_revision,result_revision,state,write_target,write_started_at,updated_at)
      VALUES(?,'old-on',1,0,1,'unknown',1,'2026-10-15','2026-10-15')`).run(STUDENT);
    expect((await details()).blockers.some(b => b.code === 'student_sync_in_progress')).toBe(true); expect((await execute()).status).toBe(409);
    expect(sqlite.prepare('SELECT allowed FROM student_app_access WHERE student_id=?').get(STUDENT).allowed).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects stale callback/session/identity/review writes after completion', async () => {
    expect((await execute()).status).toBe(200);
    expect(() => sqlite.prepare("INSERT INTO site_sessions VALUES('late','late-token','csrf',?,9999999999,NULL,'2026-10-15')").run(MEMBER)).toThrow(/member_withdrawn/);
    expect(() => sqlite.prepare("INSERT INTO site_member_identities VALUES('google','late-subject',?,NULL,'2026-10-15')").run(MEMBER)).toThrow(/member_withdrawn/);
    expect(() => sqlite.prepare("INSERT INTO site_password_resets(token_hash,member_id,expires_at,created_at) VALUES('late-reset',?,9999999999,'2026-10-15')").run(MEMBER)).toThrow(/member_withdrawn/);
  });
  it('stores only an opaque four-field receipt outside D1 with a deterministic private key', async () => {
    expect((await execute()).status).toBe(200); const result = await details(); expect(result.withdrawal.recordState).toBe('stored');
    expect(objects.size).toBe(1); const [key, body] = [...objects][0]; const record = JSON.parse(body);
    expect(Object.keys(record).sort()).toEqual(['memberId','reason','receiptId','withdrawnAt']);
    expect(record).toMatchObject({ memberId: MEMBER, reason: 'requested' });
    expect(key).toBe(`member-withdrawal-ledger/v1/${MEMBER}/${record.receiptId}.json`);
    expect(body).not.toMatch(/fixture\.invalid|김하늘|821012345678|hash|password/);
    await execute(); expect(objectWrites).toBe(1);
  });
  it('does not undo deletion or pretend the recovery ledger is stored when R2 fails, and cron retries idempotently', async () => {
    storageFail = true; const response = await execute(); const result = await response.json(); expect(result.recordState).toBe('needs_attention'); expect(result.warning).toContain('복구용 탈퇴 기록');
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('withdrawn');
    storageFail = false; expect(await recoverWithdrawalReceipts(env)).toEqual({ stored: 1, pending: 0 }); expect(objects.size).toBe(1);
    expect(await recoverWithdrawalReceipts(env)).toEqual({ stored: 0, pending: 0 }); expect(objectWrites).toBe(2);
    expect((await details()).withdrawal.recordState).toBe('stored');
  });
  it('reports a missing private R2 binding as pending work rather than successful record storage', async () => {
    delete env.SITE_SHOP_FILES; const result = await (await execute()).json(); expect(result).toMatchObject({ withdrawn: true, recordState: 'needs_attention' });
    expect(await recoverWithdrawalReceipts(env)).toEqual({ stored: 0, pending: 1 });
  });
  it('expires only unfinished social signup older than 24 hours, never an active student awaiting teacher approval', async () => {
    sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject='pending-subject',terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(MEMBER);
    const active = sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(OTHER);
    const result = await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-16T00:00:00.000Z') }); expect(result).toEqual({ cleaned: 1 });
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('withdrawn');
    expect(sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(OTHER)).toEqual(active);
    expect(sqlite.prepare('SELECT reason,record_state FROM site_member_withdrawals').get()).toMatchObject({ reason: 'incomplete_expired', record_state: 'stored' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('leaves fresh unfinished signup and pending profiles with retained orders untouched', async () => {
    sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject='pending-subject',terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(MEMBER);
    expect(await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-15T23:59:59Z') })).toEqual({ cleaned: 0 });
    shop(); expect(await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-17T00:00:00Z') })).toEqual({ cleaned: 0 });
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('pending');
  });
  it('lets completed-profile concurrency win over the pending expiry transaction', async () => {
    sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject='pending-subject',terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(MEMBER);
    beforeBatch = () => sqlite.prepare("UPDATE site_members SET status='active',terms_accepted_at='2026-10-16',privacy_accepted_at='2026-10-16' WHERE id=?").run(MEMBER);
    expect(await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-17T00:00:00Z') })).toEqual({ cleaned: 0 });
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('active');
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_withdrawals').get().n).toBe(0);
  });
  it('bounds expiry and ledger retries to one member and one object per invocation', async () => {
    for (const [id, subject] of [[MEMBER, 'pending-one'], [OTHER, 'pending-two']]) sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject=?,terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(subject, id);
    queryCount = 0;
    expect(await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-17T00:00:00Z') })).toEqual({ cleaned: 1 });
    expect(queryCount).toBeLessThanOrEqual(24); expect(objectWrites).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM site_members WHERE status='pending'").get().n).toBe(1);
    expect(await cleanupPendingSiteMembers(env, { now: Date.parse('2026-10-17T00:00:00Z') })).toEqual({ cleaned: 1 });
    sqlite.exec("UPDATE site_member_withdrawals SET record_state='needs_attention'"); objectWrites = 0; queryCount = 0;
    expect(await recoverWithdrawalReceipts(env)).toEqual({ stored: 1, pending: 0 }); expect(objectWrites).toBe(1); expect(queryCount).toBe(2);
  });
  it('keeps one linked withdrawal within the D1 free invocation query budget', async () => {
    link(); await writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: 0 });
    const body = { expectedVersion: (await details()).expectedVersion, confirmMemberId: MEMBER, requestConfirmed: true };
    queryCount = 0; const response = await send(`/${MEMBER}/withdraw`, 'POST', body); expect(response.status).toBe(200);
    // The main Worker applies the same two-query admin check before this handler.
    expect(queryCount + 2).toBeLessThanOrEqual(50);
  });
  it('runs expired signup cleanup on its own complete cron invocation under the free query budget', async () => {
    sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject='pending-subject',terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(MEMBER);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T00:17:00Z'));
    const tasks = []; queryCount = 0;
    await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.now() }, env, { waitUntil: promise => tasks.push(promise) });
    await Promise.all(tasks);
    expect(tasks).toHaveLength(1); expect(queryCount).toBeLessThanOrEqual(24);
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('withdrawn');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['0 * * * *','*/5 * * * *'])('keeps the existing %s cron separate from expired member deletion', async cron => {
    sqlite.prepare("UPDATE site_members SET status='pending',provider='google',provider_subject='pending-subject',terms_accepted_at=NULL,privacy_accepted_at=NULL WHERE id=?").run(MEMBER);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T00:05:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const tasks = []; queryCount = 0;
    await worker.scheduled({ cron, scheduledTime: Date.now() }, env, { waitUntil: promise => tasks.push(promise) });
    await Promise.all(tasks);
    expect(queryCount).toBeGreaterThan(0); expect(queryCount).toBeLessThanOrEqual(50);
    expect(sqlite.prepare('SELECT status FROM site_members WHERE id=?').get(MEMBER).status).toBe('pending');
    expect(sqlite.prepare('SELECT COUNT(*) n FROM site_member_withdrawals').get().n).toBe(0);
  });
});
