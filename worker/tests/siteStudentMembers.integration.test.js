import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { SITE_LEDGER_DATABASES } from '../lib/siteNotionSync.js';
import { readStudentAppAccess, writeStudentAppAccess } from '../lib/studentAppAccess.js';
import { linkSiteStudentMember } from '../lib/siteStudentMembers.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'http://localhost:4323', TEACHER_ORIGIN = 'http://localhost:5173';
const STUDENT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const PASSWORD = 'Synthetic-student-member42', TOKEN = 'ABCDEFGH1234';
const compact = id => id.replaceAll('-', '').toLowerCase();
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
let local, env, teacher, mail, pages, createCount, queryCount, loseCreateResponse, createBarrier, loseVipResponse, vipWrites;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = (path, { method = 'GET', body, session, admin = false, authorization, headers = {}, origin } = {}) => worker.fetch(new Request(`${ORIGIN}/api/site${path}`, {
  method, headers: { Origin: origin || (admin ? TEACHER_ORIGIN : ORIGIN), 'CF-Connecting-IP': '198.51.100.113',
    ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(admin ? { Authorization: `Bearer ${teacher}` } : {}), ...(authorization ? { Authorization: authorization } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env, ctx);
const list = (query = '', options = {}) => send(`/admin/student-members${query}`, { admin: true, ...options });
const approve = (id, body, options = {}) => send(`/admin/student-members/${id}/approve`, { admin: true, method: 'POST', body, ...options });
function studentPage(id = STUDENT, code = TOKEN) {
  return { object: 'page', id, parent: { database_id: SITE_LEDGER_DATABASES.student }, properties: {
    이름: { title: [{ text: { content: '기존 학생' } }] }, '예약 코드': { rich_text: [{ text: { content: code } }] },
    상태: { select: { name: '🟡 일시중단' } }, VIP: { id: 'D%3D%7DP', type: 'checkbox', checkbox: true }, '잔여 시간 회차': { formula: { number: 8 } },
  } };
}
function seedMember({ status = 'active', name = '김회원', provider = 'kakao', terms = '2026-10-15', privacy = '2026-10-15',
  createdAt = '2026-10-15T03:00:00.000Z', email = 'member@fixture.invalid', phone = '01012345678' } = {}) {
  const id = crypto.randomUUID();
  local.sqlite.prepare(`INSERT INTO site_members(id,status,name,nickname,email,phone,provider,provider_subject,member_code,customer_key,
    terms_accepted_at,privacy_accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, status, name, name, email, phone, provider, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), terms, privacy, createdAt, createdAt);
  return id;
}
async function memberSession(id) {
  const response = await send('/session'), session = { cookie: cookie(response), ...(await response.json()) };
  const row = local.sqlite.prepare('SELECT id FROM site_sessions ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
  local.sqlite.prepare('UPDATE site_sessions SET member_id=? WHERE id=?').run(id, row.id);
  return session;
}
async function signup() {
  const initial = await send('/session'), session = { cookie: cookie(initial), ...(await initial.json()) };
  const requested = await send('/auth/email/request', { method: 'POST', session, body: { email: 'signup@fixture.invalid' } });
  expect(requested.status).toBe(200);
  const verified = await send('/auth/email/verify', { method: 'POST', session, body: {
    challengeId: (await requested.json()).challengeId, code: mail.at(-1).text.match(/\b\d{6}\b/)[0],
  } });
  expect(verified.status).toBe(200);
  const response = await send('/auth/signup', { method: 'POST', session, body: {
    registrationToken: (await verified.json()).registrationToken, password: PASSWORD, passwordConfirm: PASSWORD,
    name: '홍가입', phone: '01098765432', nickname: '가입자', termsAccepted: true, privacyAccepted: true,
  } });
  expect(response.status).toBe(201);
  return { cookie: cookie(response), ...(await response.json()) };
}
beforeEach(async () => {
  local = siteD1();
  for (const migration of ['0011_student_app_access.sql', '0014_site_admin_sessions.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  env = { GAME_DB: local.db, SITE_ENVIRONMENT: 'development', SITE_ORIGIN: ORIGIN,
    SITE_SESSION_SECRET: 'synthetic-student-site-session-secret32', SITE_PASSWORD_SECRET: 'synthetic-student-password-pepper-32',
    JWT_SECRET: 'synthetic-student-teacher-secret', SITE_ADMIN_ENABLED: 'true', AUTH_PASSWORD: PASSWORD,
    SITE_EMAIL_FROM: 'sender@fixture.invalid', SITE_EMAIL: { send: async message => { mail.push(message); return { messageId: 'fixture' }; } },
    NOTION_TOKEN: 'synthetic-notion-only' };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  mail = []; pages = new Map([[compact(STUDENT), studentPage()], [compact(OTHER), studentPage(OTHER, 'IJKLMNOP5678')]]);
  createCount = 0; queryCount = 0; loseCreateResponse = false; createBarrier = null; loseVipResponse = false; vipWrites = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => {
    const url = new URL(raw), method = options.method || 'GET';
    if (url.origin !== 'https://api.notion.com') throw new Error('External network denied');
    if (url.pathname === '/v1/pages' && method === 'POST') {
      createCount++;
      if (createBarrier) await createBarrier;
      const input = JSON.parse(options.body), id = crypto.randomUUID();
      const page = { object: 'page', id, parent: input.parent, properties: { ...input.properties, VIP: { id: 'D%3D%7DP', type: 'checkbox', ...input.properties.VIP } } };
      pages.set(compact(id), page);
      if (loseCreateResponse) throw new Error('Synthetic Notion response lost after creation');
      return Response.json(page);
    }
    if (url.pathname === `/v1/databases/${SITE_LEDGER_DATABASES.student}/query` && method === 'POST') {
      queryCount++;
      const code = JSON.parse(options.body).filter.rich_text.equals;
      const results = [...pages.values()].filter(page => (page.properties['예약 코드']?.rich_text || []).map(part => part.plain_text ?? part.text?.content ?? '').join('') === code);
      return Response.json({ results: results.slice(0, 2), has_more: results.length > 2 });
    }
    const match = url.pathname.match(/^\/v1\/pages\/([^/]+)$/);
    if (match && method === 'PATCH' && pages.has(compact(match[1]))) {
      const target = JSON.parse(options.body).properties.VIP.checkbox; vipWrites.push(target);
      pages.get(compact(match[1])).properties.VIP.checkbox = target;
      if (loseVipResponse) throw new Error('Synthetic VIP response lost');
      return Response.json(pages.get(compact(match[1])));
    }
    if (match && method === 'GET') return pages.has(compact(match[1])) ? Response.json(pages.get(compact(match[1]))) : Response.json({ object: 'error' }, { status: 404 });
    throw new Error('Unexpected isolated Notion path');
  }));
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('one common member account with explicit teacher approval', () => {
  it('adds completed signup to the teacher list without Notion and denies the student app until approval', async () => {
    const session = await signup();
    expect(fetch).not.toHaveBeenCalled();
    const data = await (await list()).json();
    expect(data.members).toHaveLength(1);
    expect(data.members[0]).toMatchObject({ id: session.member.id, name: '홍가입', email: 'signup@fixture.invalid', provider: 'email', enrollment: null });
    expect(JSON.stringify(data)).not.toMatch(/password|hash|customerKey|memberCode|registrationToken/i);
    expect(await (await send('/student-app/context', { session })).json()).toEqual({ allowed: false, reason: 'not_linked' });
    const input = { mode: 'new', idempotencyKey: crypto.randomUUID() }, response = await approve(session.member.id, input);
    expect(response.status).toBe(200);
    const granted = await response.json();
    expect(granted.access).toMatchObject({ allowed: true, revision: 1 });
    expect(createCount).toBe(1);
    const page = pages.get(granted.studentId);
    expect(page.properties.이름.title[0].text.content).toBe('홍가입');
    expect(page.properties['예약 코드'].rich_text[0].text.content).toMatch(/^[A-Z0-9]{12}$/);
    expect(page.properties.전화번호.phone_number).toBe('01098765432');
    expect(page.properties.이메일.email).toBe('signup@fixture.invalid');
    expect(page.properties.VIP).toMatchObject({ type: 'checkbox', checkbox: true });
    expect(await (await send('/student-app/context', { session })).json()).toMatchObject({ allowed: true, memberId: session.member.id, studentId: granted.studentId, revision: 1 });
    expect((await (await list()).json()).members).toEqual([]);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    await writeStudentAppAccess(env, granted.studentId, { allowed: false, expectedRevision: 1 });
    expect(await (await send('/student-app/context', { session })).json()).toEqual({ allowed: false, reason: 'not_provided' });
    const retry = await approve(session.member.id, input);
    expect(retry.status).toBe(409); expect((await retry.json()).code).toBe('access_revision_changed');
    expect(await readStudentAppAccess(env, granted.studentId)).toMatchObject({ allowed: false, revision: 2 });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(2);
    expect(createCount).toBe(1);
  }, 20_000);
  it('requires teacher JWT even when the request has a real website administrator session', async () => {
    const id = seedMember(), session = await memberSession(id), body = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    expect((await list('', { admin: false })).status).toBe(401);
    expect((await list('', { admin: false, session })).status).toBe(401);
    const started = await send('/admin/session'), anonymous = { cookie: cookie(started), ...(await started.json()) };
    const entered = await send('/admin/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } });
    expect(entered.status).toBe(200);
    const administrator = { cookie: cookie(entered), ...(await entered.json()) };
    expect((await list('', { admin: false, session: administrator })).status).toBe(401);
    expect((await approve(id, body, { admin: false, session: administrator })).status).toBe(401);
    const game = await signTypedToken(env.JWT_SECRET, 'game', 'fixture-game-user', 600);
    expect((await list('', { admin: false, authorization: `Bearer ${game}` })).status).toBe(401);
    expect((await approve(id, body, { admin: false, session })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled(); expect(createCount).toBe(0);
  });
  it('lists only complete active unlinked accounts, with bounded stable pagination and escaped search', async () => {
    const visible = [seedMember({ name: '김회원가' }), seedMember({ name: '김회원나', provider: 'google' }), seedMember({ name: '다른회원' })];
    seedMember({ status: 'pending' }); seedMember({ status: 'suspended' }); seedMember({ status: 'withdrawn' });
    seedMember({ name: '' }); seedMember({ terms: null }); seedMember({ privacy: null });
    seedMember({ terms: '' }); seedMember({ privacy: '' });
    const linked = seedMember(); await linkSiteStudentMember(env, linked, STUDENT);
    const all = [];
    let cursor = '';
    do {
      const response = await list(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(response.status).toBe(200);
      const data = await response.json(); all.push(...data.members.map(row => row.id)); cursor = data.nextCursor;
    } while (cursor);
    expect(all).toEqual([...visible].sort().reverse());
    expect((await (await list('?query=김회원')).json()).members).toHaveLength(2);
    expect((await (await list('?query=%25%25')).json()).members).toHaveLength(0);
    for (const query of ['?limit=101', '?limit=-1', '?limit=foo', '?query=x', '?cursor=invalid']) expect((await list(query)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks incomplete and suspended member approval without creating a teaching record', async () => {
    for (const id of [seedMember({ status: 'pending' }), seedMember({ privacy: null }), seedMember({ status: 'suspended' })]) {
      const response = await approve(id, { mode: 'new', idempotencyKey: crypto.randomUUID() });
      expect(response.status).toBe(404); expect((await response.json()).code).toBe('member_unavailable');
    }
    expect(fetch).not.toHaveBeenCalled(); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_enrollments').get().n).toBe(0);
  });
});

describe('safe existing student attachment and identity claims', () => {
  it('connects an existing student and preserves all Notion history and fields', async () => {
    const id = seedMember(), before = structuredClone([...pages.values()]);
    const input = { mode: 'existing', studentId: STUDENT.toUpperCase(), idempotencyKey: crypto.randomUUID() };
    const response = await approve(id, input); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ studentId: compact(STUDENT), access: { allowed: true, revision: 1 } });
    expect([...pages.values()]).toEqual(before); expect(createCount).toBe(0);
    expect((await approve(id, input)).status).toBe(200);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    expect((await approve(id, { ...input, idempotencyKey: crypto.randomUUID() })).status).toBe(409);
    expect((await approve(id, { ...input, studentId: OTHER })).status).toBe(409);
  });
  it('does not falsely grant existing students with no valid reservation code or an archived/foreign page', async () => {
    for (const change of [page => { page.properties['예약 코드'].rich_text = []; }, page => { page.archived = true; }, page => { page.parent.database_id = SITE_LEDGER_DATABASES.payment; }]) {
      pages.set(compact(STUDENT), studentPage()); change(pages.get(compact(STUDENT)));
      const id = seedMember(), response = await approve(id, { mode: 'existing', studentId: STUDENT, idempotencyKey: crypto.randomUUID() });
      expect([409, 503]).toContain(response.status);
      expect((await response.json()).canChangeSelection).toBe(true);
      expect(local.sqlite.prepare('SELECT * FROM site_student_links WHERE member_id=?').get(id)).toBeUndefined();
      expect(local.sqlite.prepare('SELECT * FROM site_student_enrollments WHERE member_id=?').get(id)).toBeUndefined();
      expect(await readStudentAppAccess(env, STUDENT)).toMatchObject({ allowed: false, revision: 0 });
    }
    expect(createCount).toBe(0);
  });
  it('rejects normalized duplicate links across new and old routes without reassignment', async () => {
    const owner = seedMember(), other = seedMember();
    await linkSiteStudentMember(env, owner, STUDENT.toUpperCase());
    const response = await approve(other, { mode: 'existing', studentId: compact(STUDENT), idempotencyKey: crypto.randomUUID() });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'student_already_linked', canChangeSelection: true });
    const manual = await send(`/admin/members/${other}/student-link`, { admin: true, method: 'POST', body: { studentId: STUDENT } });
    expect(manual.status).toBe(409);
    const reassigned = await send(`/admin/members/${owner}/student-link`, { admin: true, method: 'POST', body: { studentId: OTHER } });
    expect(reassigned.status).toBe(409);
    expect(compact(local.sqlite.prepare('SELECT student_id FROM site_student_links WHERE member_id=?').get(owner).student_id)).toBe(compact(STUDENT));
    expect(await readStudentAppAccess(env, STUDENT)).toMatchObject({ revision: 0 });
  });
  it('protects simultaneous legacy/new link attempts with one atomic owner', async () => {
    const first = seedMember(), second = seedMember();
    const results = await Promise.allSettled([linkSiteStudentMember(env, first, STUDENT), linkSiteStudentMember(env, second, compact(STUDENT))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_identity_claims').get().n).toBe(1);
  });
  it('keeps ambiguous legacy duplicates intact and blocks a new claimant instead of failing migration', async () => {
    const first = seedMember(), second = seedMember();
    const insert = local.sqlite.prepare("INSERT INTO site_student_links(member_id,student_id,verified_at,verified_by) VALUES(?,?,?,'teacher')");
    insert.run(first, STUDENT, '2026-10-14'); insert.run(second, compact(STUDENT).toUpperCase(), '2026-10-14');
    expect(() => local.sqlite.exec(readFileSync(new URL('../migrations/0025_site_student_members.sql', import.meta.url), 'utf8'))).not.toThrow();
    await expect(linkSiteStudentMember(env, first, STUDENT)).rejects.toMatchObject({ code: 'student_already_linked' });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(2);
    expect(await readStudentAppAccess(env, STUDENT)).toMatchObject({ allowed: false });
  });
});

describe('at most once Notion provisioning and resumable teacher approval', () => {
  it('resumes a saved existing-student selection after a lookup fails and the teacher reloads the queue', async () => {
    const id = seedMember(), input = { mode: 'existing', studentId: STUDENT, idempotencyKey: crypto.randomUUID() };
    const original = fetch.getMockImplementation(); let lookups = 0;
    fetch.mockImplementation(async (raw, options) => {
      if (new URL(raw).pathname === `/v1/pages/${compact(STUDENT)}` && (!options?.method || options.method === 'GET')
        && ++lookups === 2) throw new Error('Synthetic Notion temporary failure');
      return original(raw, options);
    });
    const failed = await approve(id, input); expect(failed.status).toBe(503);
    const stored = local.sqlite.prepare('SELECT * FROM site_student_enrollments WHERE member_id=?').get(id);
    expect(stored).toMatchObject({ state: 'pending', student_id: null, target_student_id: compact(STUDENT) });
    const queued = (await (await list()).json()).members.find(member => member.id === id);
    expect(queued.enrollment).toEqual({ state: 'pending', mode: 'existing', studentId: compact(STUDENT), idempotencyKey: input.idempotencyKey });
    const resumed = await approve(id, { mode: queued.enrollment.mode, studentId: queued.enrollment.studentId,
      idempotencyKey: queued.enrollment.idempotencyKey });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ studentId: compact(STUDENT), access: { allowed: true, revision: 1 } });
    expect(createCount).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    expect((await (await list()).json()).members.some(member => member.id === id)).toBe(false);
  });
  it('keeps a linked but unfinished approval in the queue and resumes VIP confirmation with the same key', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    loseVipResponse = true;
    const pending = await approve(id, input);
    expect(pending.status).toBe(503);
    expect(await pending.json()).toMatchObject({ code: 'student_app_sync_unknown', access: { allowed: false, revision: 0 }, sync: { state: 'unknown', ready: false } });
    const linked = local.sqlite.prepare('SELECT student_id FROM site_student_links WHERE member_id=?').get(id);
    expect(linked).toBeTruthy();
    const queued = (await (await list()).json()).members.find(member => member.id === id);
    expect(queued.enrollment).toMatchObject({ state: 'linked', studentId: linked.student_id, idempotencyKey: input.idempotencyKey });
    loseVipResponse = false;
    const resumed = await approve(id, input); expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ studentId: linked.student_id, access: { allowed: true, revision: 1 },
      sync: { state: 'synced', ready: true, homeworkEnabled: true } });
    expect(createCount).toBe(1); expect(vipWrites).toEqual([true]);
    expect((await (await list()).json()).members.some(member => member.id === id)).toBe(false);
  });
  it('checks VIP again when replaying an already completed approval without duplicating the grant', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    const first = await approve(id, input); expect(first.status).toBe(200);
    const approved = await first.json();
    pages.get(approved.studentId).properties.VIP.checkbox = false;
    const replay = await approve(id, input); expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ access: { allowed: true, revision: 1 }, sync: { state: 'synced', ready: true, homeworkEnabled: true } });
    expect(createCount).toBe(1); expect(vipWrites).toEqual([true, true]);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
  });
  it('deduplicates concurrent approval and subsequent clicks without a second Notion create or grant', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    let release;
    createBarrier = new Promise(resolve => { release = resolve; });
    const first = approve(id, input);
    await vi.waitFor(() => expect(createCount).toBe(1));
    const duplicate = await approve(id, input);
    expect(duplicate.status).toBe(409); expect((await duplicate.json()).code).toBe('enrollment_in_progress');
    expect(createCount).toBe(1); release();
    expect((await first).status).toBe(200);
    expect((await approve(id, input)).status).toBe(200);
    expect(createCount).toBe(1); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    expect((await approve(id, { ...input, idempotencyKey: crypto.randomUUID() })).status).toBe(409);
    expect((await approve(id, { mode: 'existing', studentId: OTHER, idempotencyKey: input.idempotencyKey })).status).toBe(409);
  });
  it('recovers a lost create response only by its persisted reservation code', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    loseCreateResponse = true;
    const response = await approve(id, input);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('enrollment_unknown');
    const queued = (await (await list()).json()).members[0];
    expect(queued.enrollment).toMatchObject({ state: 'unknown', mode: 'new', studentId: null, idempotencyKey: input.idempotencyKey });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0);
    const recovered = await approve(id, input);
    expect(recovered.status).toBe(200); expect((await recovered.json()).access.allowed).toBe(true);
    expect(createCount).toBe(1); expect(queryCount).toBe(1);
  });
  it('keeps an unresolvable or ambiguous creation closed to retrying POST /pages', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    loseCreateResponse = true; await approve(id, input);
    const created = [...pages.values()].find(page => ![compact(STUDENT), compact(OTHER)].includes(compact(page.id)));
    pages.delete(compact(created.id));
    for (let i = 0; i < 2; i++) {
      const response = await approve(id, input); expect(response.status).toBe(409); expect((await response.json()).code).toBe('enrollment_unknown');
    }
    pages.set(compact(created.id), created); const duplicate = { ...created, id: crypto.randomUUID() }; pages.set(compact(duplicate.id), duplicate);
    expect((await approve(id, input)).status).toBe(409);
    expect(createCount).toBe(1); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(0);
  });
  it('reports a stale in-flight operation as unknown without starting another create', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    loseCreateResponse = true; await approve(id, input);
    const created = [...pages.values()].find(page => ![compact(STUDENT), compact(OTHER)].includes(compact(page.id)));
    pages.delete(compact(created.id));
    local.sqlite.prepare("UPDATE site_student_enrollments SET state='creating',updated_at='2020-01-01T00:00:00.000Z' WHERE member_id=?").run(id);
    const response = await approve(id, input);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('enrollment_unknown');
    expect(local.sqlite.prepare('SELECT state FROM site_student_enrollments WHERE member_id=?').get(id).state).toBe('unknown');
    expect(createCount).toBe(1);
  });
  it('blocks an old manual route from replacing the identity during new provisioning', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    let release; createBarrier = new Promise(resolve => { release = resolve; });
    const first = approve(id, input); await vi.waitFor(() => expect(createCount).toBe(1));
    const manual = await send(`/admin/members/${id}/student-link`, { admin: true, method: 'POST', body: { studentId: OTHER } });
    expect(manual.status).toBe(409); expect((await manual.json()).code).toBe('enrollment_in_progress');
    release(); expect((await first).status).toBe(200);
    expect(local.sqlite.prepare('SELECT student_id FROM site_student_links WHERE member_id=?').get(id).student_id).not.toBe(compact(OTHER));
  });
  it('retains an existing entitlement revision instead of creating another grant event', async () => {
    const id = seedMember(); await writeStudentAppAccess(env, STUDENT, { allowed: true, expectedRevision: 0 });
    const response = await approve(id, { mode: 'existing', studentId: STUDENT, idempotencyKey: crypto.randomUUID() });
    expect(response.status).toBe(200); expect((await response.json()).access.revision).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
  });
  it('allows a definite Notion setup rejection to be fixed without treating it as an uncertain create', async () => {
    const id = seedMember(), input = { mode: 'new', idempotencyKey: crypto.randomUUID() };
    fetch.mockImplementationOnce(async () => Response.json({ object: 'error' }, { status: 400 }));
    const rejected = await approve(id, input);
    expect(rejected.status).toBe(503); expect((await rejected.json()).code).toBe('student_setup_required');
    expect(local.sqlite.prepare('SELECT state FROM site_student_enrollments WHERE member_id=?').get(id).state).toBe('pending');
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_student_links').get().n).toBe(0);
    expect((await approve(id, input)).status).toBe(200); expect(createCount).toBe(1);
  });
  it('does not overwrite a concurrent teacher decision after saving the grant revision', async () => {
    const id = seedMember(), input = { mode: 'existing', studentId: STUDENT, idempotencyKey: crypto.randomUUID() };
    let injected = false;
    const prepare = local.db.prepare.bind(local.db);
    env.GAME_DB = { ...local.db, prepare(sql) {
      const statement = prepare(sql);
      if (!sql.includes("state='linked',grant_base_revision=")) return statement;
      return { ...statement, bind(...values) {
        const bound = statement.bind(...values);
        return { ...bound, async run() {
          const result = await bound.run();
          if (!injected) {
            injected = true;
            await writeStudentAppAccess({ GAME_DB: local.db }, STUDENT, { allowed: true, expectedRevision: 0 });
            await writeStudentAppAccess({ GAME_DB: local.db }, STUDENT, { allowed: false, expectedRevision: 1 });
          }
          return result;
        } };
      } };
    } };
    const response = await approve(id, input);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('access_revision_changed');
    expect(local.sqlite.prepare('SELECT state FROM site_student_enrollments WHERE member_id=?').get(id).state).toBe('linked');
    expect(await readStudentAppAccess(env, STUDENT)).toMatchObject({ allowed: false, revision: 2 });
    expect((await approve(id, input)).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(2);
  });
});
