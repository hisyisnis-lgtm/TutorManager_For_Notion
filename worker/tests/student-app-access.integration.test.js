import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { MAX_FILE_BYTES } from '../lib/upload.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'https://tiantianchinese.com';
const TEACHER_ORIGIN = 'http://localhost:5173';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
const CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const PAYMENT_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const HOMEWORK_DB = '5ce7d5ef-7b80-4795-843f-325f4ca868e2';
const NOTICE_DB = 'f93b423b-8ab0-493b-bdf3-78fde6ec430f';
const STUDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_STUDENT = '22222222-2222-4222-8222-222222222222';
const HOMEWORK = '33333333-3333-4333-8333-333333333333';
const OTHER_HOMEWORK = '44444444-4444-4444-8444-444444444444';
const UPLOAD = '55555555-5555-4555-8555-555555555555';
const CODE = 'ABCDEF123456';
const OTHER_CODE = 'XYZABC987654';
const PASSWORD = 'Synthetic-password-42';
const FILE_URL = 'https://api.notion.com/v1/fixture-download';
const normalized = id => id.replaceAll('-', '').toLowerCase();
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
let local, env, mail, calls, background, teacher, legacy, students, homework, notionHook;

function studentPage(id, code) {
  return { object: 'page', id, parent: { database_id: STUDENT_DB }, properties: {
    '이름': { title: [{ plain_text: id === STUDENT ? '합성 학생' : '다른 합성 학생' }] },
    '예약 코드': { rich_text: [{ plain_text: code }] }, 'VIP': { id: 'D%3D%7DP', type: 'checkbox', checkbox: false },
    '공유일': { date: null }, '결제 시간 회차 합계': { rollup: { number: 0 } },
    '잔여 시간 회차': { formula: { number: 0 } }, '총 수업 횟수': { rollup: { number: 0 } },
    '숙제 제출 먹이': { rollup: { number: 0 } }, '피드백 확인 먹이': { rollup: { number: 0 } },
  } };
}
function homeworkPage(id, owner) {
  return { object: 'page', id, parent: { database_id: HOMEWORK_DB }, properties: {
    '제목': { title: [{ plain_text: '합성 숙제' }] }, '학생': { relation: [{ id: owner }] },
    '제출 상태': { select: { name: '미제출' } },
    '학생 제출 파일': { files: [{ name: 'fixture.pdf', file: { url: FILE_URL } }] },
  } };
}
const list = results => Response.json({ object: 'list', results, has_more: false, next_cursor: null });
function pdfForm(bytes = 30) {
  const data = new Uint8Array(bytes); data.set(new TextEncoder().encode('%PDF-1.7 synthetic'));
  const form = new FormData();
  form.append('file', new File([data], 'fixture.pdf', { type: 'application/pdf' }));
  form.append('fileName', 'fixture.pdf'); form.append('fileSize', String(bytes)); form.append('size', String(bytes));
  return form;
}
const send = (path, { method = 'GET', body, session, admin = false, origin, headers = {} } = {}) => worker.fetch(new Request(`https://audit.invalid${path}`, {
  method,
  headers: {
    Origin: origin || (admin ? TEACHER_ORIGIN : ORIGIN), 'CF-Connecting-IP': '198.51.100.30',
    ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(admin ? { Authorization: `Bearer ${teacher}` } : {}),
    ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
}), env, { waitUntil: promise => background.push(promise.catch(() => {})) });
const site = (path, options) => send(`/api/site${path}`, options);
const app = (path, session, options = {}) => site(`/student-app${path}`, { session, ...options });
const adminAccess = (id = STUDENT, options = {}) => site(`/admin/student-app/access/${id}`, { admin: true, ...options });
async function registered(email = 'member@fixture.invalid') {
  let response = await site('/session'); expect(response.status).toBe(200);
  const guest = { cookie: cookie(response), ...(await response.json()) };
  response = await site('/auth/email/request', { method: 'POST', session: guest, body: { email } }); expect(response.status).toBe(200);
  const { challengeId } = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
  response = await site('/auth/email/verify', { method: 'POST', session: guest, body: { challengeId, code } }); expect(response.status).toBe(200);
  const { registrationToken } = await response.json();
  response = await site('/auth/signup', { method: 'POST', session: guest, body: { registrationToken,
    password: PASSWORD, passwordConfirm: PASSWORD, name: '합성 회원', termsAccepted: true, privacyAccepted: true } });
  expect(response.status).toBe(201);
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
  return { cookie: cookie(response), ...(await response.json()) };
}
async function linked(session, id = STUDENT) {
  const response = await site(`/admin/members/${session.member.id}/student-link`, { admin: true, method: 'POST', body: { studentId: id } });
  expect(response.status).toBe(200);
}
async function setAccess(allowed, expectedRevision, id = STUDENT) {
  const response = await adminAccess(id, { method: 'PUT', body: { allowed, expectedRevision } });
  expect(response.status).toBe(200);
  const { access } = await response.json();
  expect(access).toMatchObject({ studentId: normalized(id), allowed });
  return access;
}
async function permitted() {
  const session = await registered(); await linked(session);
  const access = await setAccess(true, 0);
  calls = []; return { session, access };
}
async function assertContextDenied(session, reason) {
  const response = await app('/context', session);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ allowed: false, reason });
}
const reads = ['/student', '/classes?month=2026-10', '/homework', '/notices', '/consent', '/panda', `/homework/${HOMEWORK}/file?name=fixture.pdf&kind=submit`];
const writes = [
  ['/homework/upload', () => pdfForm()],
  [`/homework/${HOMEWORK}/submit`, () => ({ files: [], deleteFileNames: [] })],
  ['/homework/feedback-seen', () => ({ homeworkId: HOMEWORK })],
  ['/panda/action', () => ({})],
];
const legacyReads = [
  `/booking/student/${CODE}`, `/booking/my-classes/${CODE}?month=2026-10`, `/homework/student/${CODE}`,
  `/notice/student/${CODE}`, `/booking/consent/${CODE}`, `/personal/student/${CODE}/panda`,
  `/homework/student/${CODE}/${HOMEWORK}/file?name=fixture.pdf&kind=submit`,
];
function seedPaidOrder(memberId) {
  const now = new Date().toISOString();
  // Synthetic commerce rows exercise the access boundary without calling a PG.
  local.sqlite.prepare(`INSERT INTO site_targets(id,name,experience_type,class_type_id,student_required,time_ledger_mode,created_at,updated_at)
    VALUES('fixture-target','합성 수업','class',?,1,'hours',?,?)`).run(STUDENT, now, now);
  local.sqlite.prepare(`INSERT INTO site_payment_requests(id,member_id,target_id,billing_key,billing_period,snapshot,amount,terms_version,expires_at,status,created_at,updated_at)
    VALUES('fixture-request',?,'fixture-target','fixture-billing','2026-10','{}',1000,'fixture-terms',?,'paid',?,?)`).run(memberId, now, now, now);
  local.sqlite.prepare(`INSERT INTO site_orders(id,member_id,request_id,idempotency_hash,payload_hash,snapshot,amount,status,approved_at,created_at,updated_at)
    VALUES('fixture-order',?,'fixture-request','fixture-idempotency','fixture-payload','{}',1000,'paid',?,?,?)`).run(memberId, now, now, now);
}

beforeEach(async () => {
  local = siteD1();
  for (const migration of ['0003_notification_followups.sql', '0005_student_panda.sql', '0006_panda_transition.sql', '0011_student_app_access.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  mail = []; calls = []; background = []; notionHook = null;
  students = new Map([[normalized(STUDENT), studentPage(STUDENT, CODE)], [normalized(OTHER_STUDENT), studentPage(OTHER_STUDENT, OTHER_CODE)]]);
  homework = new Map([[HOMEWORK, homeworkPage(HOMEWORK, STUDENT)], [OTHER_HOMEWORK, homeworkPage(OTHER_HOMEWORK, OTHER_STUDENT)]]);
  env = { GAME_DB: local.db, JWT_SECRET: 'fixture-student-app-jwt-secret', NOTION_TOKEN: 'synthetic-notion',
    SITE_ADMIN_ENABLED: 'true', AUTH_PASSWORD: 'Synthetic-admin-fixture-42',
    SITE_SESSION_SECRET: 'fixture-site-session-secret-32-characters', SITE_PASSWORD_SECRET: 'fixture-site-password-secret-32-characters',
    SITE_EMAIL_FROM: 'sender@fixture.invalid', SITE_EMAIL: { send: vi.fn(async message => { mail.push(message); return { messageId: 'fixture' }; }) } };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  legacy = await signTypedToken(env.JWT_SECRET, 'student', `personal:${CODE}`, 180 * 24 * 60 * 60);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // All fetch calls, including uploads and downloads, terminate in this fixture.
  vi.stubGlobal('fetch', vi.fn(async (raw, init = {}) => {
    const url = new URL(typeof raw === 'string' ? raw : raw.url);
    const call = { host: url.hostname, path: url.pathname, method: init.method || 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, redirect: init.redirect };
    calls.push(call);
    if (url.hostname !== 'api.notion.com') throw new Error('Unmocked network denied');
    const intercepted = await notionHook?.(call);
    if (intercepted) return intercepted;
    if (url.href === FILE_URL) return new Response('%PDF-1.7 synthetic', { headers: { 'Content-Type': 'application/pdf' } });
    const page = url.pathname.match(/^\/v1\/pages\/([^/]+)$/);
    if (page && call.method === 'GET') {
      const found = students.get(normalized(page[1])) || homework.get(page[1]);
      if (found) return Response.json(found);
    }
    if (page && call.method === 'PATCH' && students.has(normalized(page[1]))) {
      const student = students.get(normalized(page[1])); student.properties.VIP.checkbox = call.body.properties.VIP.checkbox;
      return Response.json(student);
    }
    if (page && call.method === 'PATCH' && homework.has(page[1])) return Response.json(homework.get(page[1]));
    if (url.pathname === `/v1/databases/${STUDENT_DB}/query`) {
      const code = call.body?.filter?.rich_text?.equals;
      return list(code ? [...students.values()].filter(student => student.properties['예약 코드'].rich_text[0].plain_text === code) : [...students.values()]);
    }
    if (url.pathname === `/v1/databases/${HOMEWORK_DB}/query`) {
      const id = call.body?.filter?.relation?.contains;
      return list([...homework.values()].filter(page => page.properties['학생'].relation.some(owner => owner.id === id)));
    }
    if ([CLASS_DB, PAYMENT_DB, NOTICE_DB].some(id => url.pathname === `/v1/databases/${id}/query`)) return list([]);
    if (url.pathname === '/v1/file_uploads' && call.method === 'POST') return Response.json({ id: UPLOAD, upload_url: `https://api.notion.com/v1/file_uploads/${UPLOAD}/send` });
    if (url.pathname === `/v1/file_uploads/${UPLOAD}/send` && call.method === 'POST') return Response.json({ id: UPLOAD });
    throw new Error(`Unexpected mocked Notion request: ${call.method} ${call.path}`);
  }));
});
afterEach(async () => {
  await Promise.allSettled(background);
  expect(calls.every(call => call.host === 'api.notion.com')).toBe(true);
  local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('feedback completion business lock stays separate from student authorization', () => {
  it.each(['legacy', 'member'])('%s rejects combined add/delete with 409 and performs no PATCH after feedback', async route => {
    const { session } = await permitted();
    homework.get(HOMEWORK).properties['제출 상태'] = { select: { name: '피드백완료' } };
    const uploadReceipt = await signTypedToken(env.JWT_SECRET, 'homework-upload', STUDENT, 600, {
      uploadId: UPLOAD, fileName: 'new.pdf', fileSize: 123,
    });
    const body = { files: [{ fileUploadId: UPLOAD, fileName: 'new.pdf', uploadReceipt }], deleteFileNames: ['fixture.pdf'] };
    const response = route === 'legacy'
      ? await send(`/homework/student/${CODE}/${HOMEWORK}/submit`, { method: 'POST', body, origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } })
      : await app(`/homework/${HOMEWORK}/submit`, session, { method: 'POST', body });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '강사 피드백이 완료되어 더 이상 수정할 수 없습니다.', code: 'homework_feedback_locked' });
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
    expect(homework.get(HOMEWORK).properties['학생 제출 파일'].files).toEqual([{ name: 'fixture.pdf', file: { url: FILE_URL } }]);
    if (route === 'member') {
      const context = await app('/context', session);
      expect(context.status).toBe(200);
      expect(await context.json()).toMatchObject({ allowed: true });
    }
  });

  it.each(['legacy', 'member'])('%s still rejects another student homework with 403 before exposing its lock', async route => {
    const { session } = await permitted();
    homework.get(OTHER_HOMEWORK).properties['제출 상태'] = { select: { name: '피드백완료' } };
    const body = { files: [], deleteFileNames: ['fixture.pdf'] };
    const response = route === 'legacy'
      ? await send(`/homework/student/${CODE}/${OTHER_HOMEWORK}/submit`, { method: 'POST', body, origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } })
      : await app(`/homework/${OTHER_HOMEWORK}/submit`, session, { method: 'POST', body });
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty('code', 'homework_feedback_locked');
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });
});

describe('student app uses explicit access separate from website membership', () => {
  it('requires an actual member session rather than a guest or a bearer token', async () => {
    const guestResponse = await site('/session'), guest = { cookie: cookie(guestResponse), ...(await guestResponse.json()) };
    for (const options of [{}, { session: guest }, { headers: { Authorization: `Bearer ${teacher}` } }, { headers: { Authorization: `Bearer ${legacy}` } }]) {
      expect((await site('/student-app/context', options)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('does not grant access on signup, student linking, payment or VIP changes', async () => {
    const session = await registered();
    await assertContextDenied(session, 'not_linked');
    expect((await app('/student', session)).status).toBe(403);
    await linked(session);
    await assertContextDenied(session, 'not_provided');
    seedPaidOrder(session.member.id);
    students.get(normalized(STUDENT)).properties['VIP'].checkbox = true;
    await assertContextDenied(session, 'not_provided');
    expect((await app('/student', session)).status).toBe(403);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access WHERE allowed=1').get().n).toBe(0);
  });

  it('requires a verified link even when the student has a grant', async () => {
    const session = await registered(); await linked(session); await setAccess(true, 0);
    local.sqlite.prepare('UPDATE site_student_links SET verified_at=? WHERE member_id=?').run('', session.member.id);
    await assertContextDenied(session, 'not_linked');
    expect((await app('/student', session)).status).toBe(403);
  });

  it('allows the linked student after explicit grant without disclosing a booking code', async () => {
    const { session, access } = await permitted();
    const context = await app('/context', session); expect(context.status).toBe(200);
    const data = await context.json();
    expect(data).toMatchObject({ allowed: true, memberId: session.member.id, studentId: normalized(STUDENT), revision: access.revision });
    expect(data.studentScope).toBeTruthy();
    expect(Object.keys(data).sort()).toEqual(['allowed', 'memberId', 'revision', 'studentId', 'studentScope']);
    expect(JSON.stringify(data)).not.toContain(CODE);
    for (const route of reads) {
      const response = await app(route, session); expect(response.status, route).toBe(200);
      if (!route.includes('/file?')) expect(await response.text(), route).not.toContain(CODE);
    }
  });

  it('rechecks every resource after grant revocation while keeping the member session usable', async () => {
    const { session, access } = await permitted(); await setAccess(false, access.revision);
    calls = []; const mailCount = mail.length;
    await assertContextDenied(session, 'not_provided');
    for (const route of reads) expect((await app(route, session)).status, route).toBe(403);
    for (const [route, body] of writes) expect((await app(route, session, { method: 'POST', body: body() })).status, route).toBe(403);
    expect((await site('/me', { session })).status).toBe(200);
    expect(mail).toHaveLength(mailCount);
    expect(calls.some(call => call.method === 'PATCH' || call.path.includes('/file_uploads') || call.path === '/v1/fixture-download')).toBe(false);
  });

  it('rejects student reassignment and preserves the original account, order and access', async () => {
    const { session, access } = await permitted(); seedPaidOrder(session.member.id);
    const originalLink = local.sqlite.prepare('SELECT * FROM site_student_links WHERE member_id=?').get(session.member.id);
    const originalClaim = local.sqlite.prepare('SELECT * FROM site_student_identity_claims WHERE member_id=?').get(session.member.id);
    const originalOrder = local.sqlite.prepare('SELECT * FROM site_orders WHERE member_id=?').get(session.member.id);
    const originalStudents = structuredClone([...students]);
    const reassigned = await site(`/admin/members/${session.member.id}/student-link`, { admin: true, method: 'POST', body: { studentId: OTHER_STUDENT } });
    expect(reassigned.status).toBe(409);
    expect((await reassigned.json()).code).toBe('member_already_linked');
    expect(local.sqlite.prepare('SELECT * FROM site_student_links WHERE member_id=?').get(session.member.id)).toEqual(originalLink);
    expect(local.sqlite.prepare('SELECT * FROM site_student_identity_claims WHERE member_id=?').get(session.member.id)).toEqual(originalClaim);
    expect(local.sqlite.prepare('SELECT * FROM site_orders WHERE member_id=?').get(session.member.id)).toEqual(originalOrder);
    expect([...students]).toEqual(originalStudents);
    const context = await app('/context', session); expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ allowed: true, memberId: session.member.id, studentId: normalized(STUDENT), revision: access.revision });
    expect((await app('/student', session)).status).toBe(200);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access WHERE student_id=?').get(normalized(OTHER_STUDENT)).n).toBe(0);
  });

  it('does not carry a grant to another student after an out-of-band verified-link change', async () => {
    const { session, access } = await permitted();
    // The public link API refuses reassignment. This storage fault independently
    // verifies that readers never reuse the grant belonging to the old student.
    local.sqlite.prepare('UPDATE site_student_links SET student_id=?,verified_at=? WHERE member_id=?')
      .run(OTHER_STUDENT, '2026-10-15T01:00:00.000Z', session.member.id);
    await assertContextDenied(session, 'not_provided');
    expect((await app('/student', session)).status).toBe(403);
    expect(local.sqlite.prepare('SELECT allowed,revision FROM student_app_access WHERE student_id=?').get(normalized(STUDENT)))
      .toMatchObject({ allowed: 1, revision: access.revision });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access WHERE student_id=?').get(normalized(OTHER_STUDENT)).n).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('honors suspension of the website member even when the student remains allowed', async () => {
    const { session } = await permitted();
    local.sqlite.prepare('UPDATE site_members SET status=? WHERE id=?').run('suspended', session.member.id);
    expect((await app('/context', session)).status).toBe(401);
    expect((await app('/student', session)).status).toBe(401);
  });

  it.each(['student_app_access', 'site_student_links'])('fails closed when required storage %s is missing', async table => {
    const { session } = await permitted();
    if (table === 'student_app_access') local.sqlite.exec('DROP TABLE student_app_access_events');
    local.sqlite.exec(`DROP TABLE ${table}`);
    for (const route of ['/context', '/student']) {
      const response = await app(route, session); expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/no such|sqlite|SQL|student_app_access|site_student_links|secret/);
    }
  });

  it('requires teacher authentication, allowed origin and an optimistic revision for access changes', async () => {
    const session = await registered();
    expect((await site(`/admin/student-app/access/${STUDENT}`, { session, origin: ORIGIN })).status).toBe(401);
    expect((await site(`/admin/student-app/access/${STUDENT}`, { session, origin: TEACHER_ORIGIN })).status).toBe(403);
    expect((await adminAccess(STUDENT, { origin: 'https://untrusted.fixture.invalid' })).status).toBe(403);
    const initial = await adminAccess(); expect(initial.status).toBe(200);
    expect((await initial.json()).access).toMatchObject({ allowed: false, revision: 0, studentId: normalized(STUDENT) });
    const granted = await setAccess(true, 0);
    const stale = await adminAccess(STUDENT, { method: 'PUT', body: { allowed: false, expectedRevision: 0 } });
    expect(stale.status).toBe(409);
    const current = await adminAccess(STUDENT.replaceAll('-', '').toUpperCase()); expect(current.status).toBe(200);
    expect((await current.json()).access).toMatchObject({ allowed: true, revision: granted.revision });
  });

  it('preserves the Notion student database boundary when granting access', async () => {
    students.get(normalized(STUDENT)).parent.database_id = CLASS_DB;
    expect((await adminAccess(STUDENT, { method: 'PUT', body: { allowed: true, expectedRevision: 0 } })).status).toBe(503);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access').get().n).toBe(0);
  });
});

describe('legacy student sessions also require a fresh student grant', () => {
  it.each(legacyReads)('rechecks a 180-day JWT on %s before and after revocation', async route => {
    const options = { origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } };
    expect((await send(route, options)).status).toBe(403);
    const granted = await setAccess(true, 0);
    expect((await send(route, options)).status).toBe(200);
    await setAccess(false, granted.revision);
    expect((await send(route, options)).status).toBe(403);
  });

  it('does not accept an allowed student JWT for another student code', async () => {
    await setAccess(true, 0);
    const response = await send(`/booking/student/${OTHER_CODE}`, { origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } });
    expect(response.status).toBe(401);
  });

  it('denies legacy upload, submit, feedback and panda writes after revocation', async () => {
    const granted = await setAccess(true, 0); await setAccess(false, granted.revision); calls = [];
    const routes = [
      [`/homework/student-upload/${CODE}`, () => pdfForm()],
      [`/homework/student/${CODE}/${HOMEWORK}/submit`, () => ({ files: [] })],
      [`/homework/feedback-seen/${CODE}`, () => ({ homeworkId: HOMEWORK })],
      [`/personal/student/${CODE}/panda/action`, () => ({})],
    ];
    for (const [route, body] of routes) {
      expect((await send(route, { method: 'POST', body: body(), origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } })).status, route).toBe(403);
    }
    expect(calls.some(call => call.method === 'PATCH' || call.path.includes('/file_uploads'))).toBe(false);
  });

  it('keeps authenticated teacher preview available without a student grant', async () => {
    const response = await send(`/notice/student/${CODE}`, { origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${teacher}` } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual([]);
  });
});

describe('student authorization is rechecked across upstream awaits', () => {
  const changes = [
    ['suspension', session => local.sqlite.prepare("UPDATE site_members SET status='suspended' WHERE id=?").run(session.member.id), 401],
    ['session revocation', session => local.sqlite.prepare('UPDATE site_sessions SET revoked_at=1 WHERE member_id=?').run(session.member.id), 401],
    ['session expiry', session => local.sqlite.prepare('UPDATE site_sessions SET expires_at=1 WHERE member_id=?').run(session.member.id), 401],
    ['student relinking', session => local.sqlite.prepare('UPDATE site_student_links SET student_id=? WHERE member_id=?').run(OTHER_STUDENT, session.member.id), 403],
    ['grant revocation', () => local.sqlite.prepare("UPDATE student_app_access SET allowed=0,revision=revision+1,revoked_at='fixture',revoked_by='fixture' WHERE student_id=?").run(normalized(STUDENT)), 403],
  ];
  for (const route of ['/context', '/student']) {
    it.each(changes)('blocks %s during the member identity read on ' + route, async (_label, mutate, status) => {
      const { session } = await permitted();
      notionHook = call => {
        if (call.path === `/v1/pages/${STUDENT}`) { notionHook = null; mutate(session); }
      };
      const response = await app(route, session);
      if (route === '/context' && ['student relinking', 'grant revocation'].includes(_label)) {
        expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ allowed: false });
      } else expect(response.status).toBe(status);
      expect(calls.filter(call => call.path.endsWith('/query'))).toHaveLength(0);
    });
  }

  it('does not carry a revoked and reissued grant through an in-flight request', async () => {
    const { session, access } = await permitted();
    notionHook = async call => {
      if (call.path === `/v1/pages/${STUDENT}`) {
        notionHook = null;
        const revoked = await setAccess(false, access.revision);
        await setAccess(true, revoked.revision);
      }
    };
    expect((await app('/student', session)).status).toBe(403);
    expect((await app('/student', session)).status).toBe(200);
  });

  for (const member of [true, false]) {
    it.each(['/student', '/classes?month=2026-10', '/homework', '/panda'])('rejects a replaced final student lookup on %s (member=' + member + ')', async route => {
      const { session } = await permitted();
      let count = 0;
      notionHook = call => {
        if (call.path === `/v1/databases/${STUDENT_DB}/query` && ++count === 2) return list([studentPage(OTHER_STUDENT, CODE)]);
      };
      const legacyRoute = route.startsWith('/student') ? `/booking/student/${CODE}`
        : route.startsWith('/classes') ? `/booking/my-classes/${CODE}?month=2026-10`
        : route === '/homework' ? `/homework/student/${CODE}` : `/personal/student/${CODE}/panda`;
      const response = member ? await app(route, session)
        : await send(legacyRoute, { origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } });
      expect(response.status).toBe(403);
      expect(calls.some(call => [CLASS_DB, PAYMENT_DB, HOMEWORK_DB].some(id => call.path === `/v1/databases/${id}/query`))).toBe(false);
      expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_panda_profiles').get().n).toBe(0);
    });
  }

  it.each(changes)('discards business data after %s during a class read', async (_label, mutate, status) => {
    const { session } = await permitted();
    notionHook = call => {
      if (call.path === `/v1/databases/${CLASS_DB}/query`) { notionHook = null; mutate(session); }
    };
    expect((await app('/classes?month=2026-10', session)).status).toBe(status);
  });

  it.each([
    [`/homework/${HOMEWORK}/submit`, () => ({ files: [] }), `/v1/pages/${HOMEWORK}`],
    ['/homework/feedback-seen', () => ({ homeworkId: HOMEWORK }), `/v1/pages/${HOMEWORK}`],
    ['/homework/upload', () => pdfForm(), '/v1/file_uploads'],
    ['/panda/action', () => ({ requestId: 'race-fixture-action-001', expectedRevision: 0, type: 'feed', count: 1 }), `/v1/databases/${CLASS_DB}/query`],
  ])('blocks a member write revoked during the final upstream read: %s', async (route, body, pausePath) => {
    const { session } = await permitted();
    homework.get(HOMEWORK).properties['제출 상태'].select.name = '피드백완료';
    notionHook = call => {
      if (call.path === pausePath && call.method !== 'PATCH') {
        notionHook = null; local.sqlite.prepare('UPDATE site_sessions SET revoked_at=1 WHERE member_id=?').run(session.member.id);
      }
    };
    expect((await app(route, session, { method: 'POST', body: body() })).status).toBe(401);
    expect(calls.some(call => call.method === 'PATCH' || call.path.endsWith('/send'))).toBe(false);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_panda_profiles').get().n).toBe(0);
  });

  it('discards an attachment when the member session is revoked during download', async () => {
    const { session } = await permitted();
    notionHook = call => {
      if (call.path === '/v1/fixture-download') local.sqlite.prepare('UPDATE site_sessions SET revoked_at=1 WHERE member_id=?').run(session.member.id);
    };
    const response = await app(`/homework/${HOMEWORK}/file?name=fixture.pdf&kind=submit`, session);
    expect(response.status).toBe(401); expect(await response.text()).not.toContain('%PDF');
  });

  it('retains the grant check on legacy data after an upstream read', async () => {
    await setAccess(true, 0);
    notionHook = call => {
      if (call.path === `/v1/databases/${CLASS_DB}/query`) {
        notionHook = null;
        local.sqlite.prepare("UPDATE student_app_access SET allowed=0,revision=revision+1,revoked_at='fixture',revoked_by='fixture' WHERE student_id=?").run(normalized(STUDENT));
      }
    };
    expect((await send(`/booking/my-classes/${CODE}?month=2026-10`, { origin: TEACHER_ORIGIN, headers: { Authorization: `Bearer ${legacy}` } })).status).toBe(403);
  });

  it.each(['upload', 'file'])('does not return internal upstream errors from a student %s', async operation => {
    const { session } = await permitted();
    notionHook = call => {
      if (operation === 'upload' && call.path === '/v1/file_uploads') return Response.json({ object: 'error', status: 400, message: 'internal synthetic-secret SQL no such table' }, { status: 400 });
      if (operation === 'file' && call.path === `/v1/pages/${HOMEWORK}`) return Response.json({ object: 'error', status: 400, message: 'internal synthetic-secret SQL no such table' }, { status: 400 });
    };
    const response = operation === 'upload' ? await app('/homework/upload', session, { method: 'POST', body: pdfForm() })
      : await app(`/homework/${HOMEWORK}/file?name=fixture.pdf&kind=submit`, session);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toMatch(/synthetic-secret|SQL|no such table/);
  });
});

describe('member resources retain CSRF and homework file safeguards', () => {
  it('dispatches member file-size reads through the same ownership and fresh-access checks', async () => {
    const { session } = await permitted();
    homework.get(HOMEWORK).properties['학생 제출 파일'] = { files: [{ name: 'fixture.pdf', type: 'file_upload', file_upload: { id: UPLOAD } }] };
    notionHook = call => call.path === `/v1/file_uploads/${UPLOAD}`
      ? Response.json({ status: 'uploaded', content_length: '3000' }) : null;
    const response = await app(`/homework/${HOMEWORK}/file-sizes?kind=submit`, session);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ files: [{ name: 'fixture.pdf', size: 3000 }] });
    expect((await app(`/homework/${OTHER_HOMEWORK}/file-sizes?kind=submit`, session)).status).toBe(403);
    await setAccess(false, 1);
    expect((await app(`/homework/${HOMEWORK}/file-sizes?kind=submit`, session)).status).toBe(403);
  });
  it('rejects signed member submissions above 50 MiB before any write', async () => {
    const { session } = await permitted();
    homework.get(HOMEWORK).properties['학생 제출 파일'] = { files: [] };
    const uploadReceipt = await signTypedToken(env.JWT_SECRET, 'homework-upload', STUDENT, 3600, {
      uploadId: UPLOAD, fileName: 'fixture.pdf', fileSize: 20 * 1024 * 1024,
    });
    const file = { fileUploadId: UPLOAD, fileName: 'fixture.pdf', uploadReceipt, size: 1 };
    const response = await app(`/homework/${HOMEWORK}/submit`, session, { method: 'POST', body: { files: [file, file, file] } });
    expect(response.status).toBe(413);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });
  it('requires exact site origin and the member CSRF token on every write', async () => {
    const { session } = await permitted(); calls = [];
    for (const [route, body] of writes) {
      expect((await app(route, { cookie: session.cookie }, { method: 'POST', body: body() })).status, route).toBe(403);
      expect((await app(route, session, { method: 'POST', body: body(), headers: { 'X-CSRF-Token': 'forged' } })).status, route).toBe(403);
    }
    expect((await app('/context', session, { origin: 'https://attacker.invalid' })).status).toBe(403);
    expect(calls.some(call => call.method === 'PATCH' || call.path.includes('/file_uploads'))).toBe(false);
  });

  it('blocks another student homework download and submission before fetching files or writing', async () => {
    const { session } = await permitted();
    expect((await app(`/homework/${OTHER_HOMEWORK}/file?name=fixture.pdf&kind=submit`, session)).status).toBe(403);
    expect((await app(`/homework/${OTHER_HOMEWORK}/submit`, session, { method: 'POST', body: { files: [] } })).status).toBe(403);
    expect(calls.some(call => call.path === '/v1/fixture-download' || call.method === 'PATCH')).toBe(false);
  });

  it('does not allow an upload receipt owned by another student', async () => {
    const { session } = await permitted();
    const uploadReceipt = await signTypedToken(env.JWT_SECRET, 'homework-upload', OTHER_STUDENT, 3600, { uploadId: UPLOAD, fileName: 'fixture.pdf' });
    const response = await app(`/homework/${HOMEWORK}/submit`, session, { method: 'POST', body: { files: [{ fileUploadId: UPLOAD, fileName: 'fixture.pdf', uploadReceipt }] } });
    expect(response.status).toBe(403);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });

  it('accepts a genuine PDF above the generic JSON size limit with manual upload redirects', async () => {
    const { session } = await permitted();
    const response = await app('/homework/upload', session, { method: 'POST', body: pdfForm(200 * 1024) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fileUploadId: UPLOAD, fileName: 'fixture.pdf', uploadReceipt: expect.any(String) });
    expect(calls.find(call => call.path.endsWith('/send')).redirect).toBe('manual');
  });

  it('rejects an oversized member upload before any Notion upload', async () => {
    const { session } = await permitted();
    const response = await app('/homework/upload', session, { method: 'POST', body: pdfForm(), headers: { 'Content-Length': String(MAX_FILE_BYTES + 64 * 1024 + 1) } });
    expect(response.status).toBe(413);
    expect(calls.some(call => call.path.includes('/file_uploads'))).toBe(false);
  });

  it('retains attachment downloads without exposing direct file URLs or forwarding credentials', async () => {
    const { session } = await permitted();
    const response = await app(`/homework/${HOMEWORK}/file?name=fixture.pdf&kind=submit`, session);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('attachment;');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('%PDF-1.7 synthetic');
    const download = fetch.mock.calls.find(([url]) => url === FILE_URL);
    expect(download[1]).toEqual({ redirect: 'manual' });
  });
});
