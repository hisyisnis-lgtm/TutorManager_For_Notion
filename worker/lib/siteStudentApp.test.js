import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleSiteAuthRoutes } from './siteAuth.js';
import { handleSiteStudentAppRoutes } from './siteStudentApp.js';
import { writeStudentAppAccess, readStudentAppAccess } from './studentAppAccess.js';
import { SITE_LEDGER_DATABASES } from './siteNotionSync.js';
import { siteD1 } from '../tests/helpers/siteD1.js';

const ORIGIN = 'http://localhost:4323', STUDENT = '11111111-1111-4111-8111-111111111111', ID = STUDENT.replaceAll('-', '');
const OTHER = '22222222-2222-4222-8222-222222222222', TOKEN = 'ABCDEFGH1234';
let local, env, memberId, session, dispatch, page, hook;
const authorizeTeacher = vi.fn(async request => request.headers.get('Authorization') === 'Bearer fixture-teacher'
  ? null : Response.json({ error: '인증 필요' }, { status: 401 }));
const send = (path, { method = 'GET', body, guest = false, teacher = false, csrf = true, headers = {} } = {}) => handleSiteStudentAppRoutes(new Request(`${ORIGIN}${path}`, {
  method, headers: { Origin: ORIGIN, ...(guest ? {} : { Cookie: session.cookie }), ...(csrf && !guest ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(teacher ? { Authorization: 'Bearer fixture-teacher' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), env, {}, { authorizeTeacher, dispatch });
const consumer = (path, options) => send(`/api/site/student-app${path}`, options);
const admin = (options, id = STUDENT) => send(`/api/site/admin/student-app/access/${id}`, { teacher: true, ...options });
const link = (id = STUDENT, verified = 'teacher') => local.sqlite.prepare('INSERT INTO site_student_links(member_id,student_id,verified_at,verified_by) VALUES(?,?,?,?)')
  .run(memberId, id, '2026-10-07T00:00:00.000Z', verified);
const grant = () => writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 0 });

beforeEach(async () => {
  local = siteD1(); local.sqlite.exec(readFileSync(new URL('../migrations/0011_student_app_access.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, SITE_SESSION_SECRET: 'fixture-site-session-secret-32-characters', SITE_ENVIRONMENT: 'development', SITE_ORIGIN: ORIGIN, NOTION_TOKEN: 'fixture-only-notion' };
  memberId = crypto.randomUUID();
  local.sqlite.prepare(`INSERT INTO site_members(id,status,email,name,nickname,member_code,customer_key,provider,provider_subject,terms_accepted_at,privacy_accepted_at,created_at,updated_at)
    VALUES(?,'active','fixture@fixture.invalid','가상 학생','가상','HINTERNALONLY',?,'kakao',?,'2026-10-07','2026-10-07','2026-10-07','2026-10-07')`).run(memberId, crypto.randomUUID(), crypto.randomUUID());
  const anonymous = await handleSiteAuthRoutes(new Request(`${ORIGIN}/api/site/session`, { headers: { Origin: ORIGIN } }), env);
  session = { cookie: anonymous.headers.get('Set-Cookie').split(';')[0], ...(await anonymous.json()) };
  // Fixture storage only: real cookie/hash/CSRF validation still runs in the router.
  local.sqlite.prepare('UPDATE site_sessions SET member_id=?').run(memberId);
  page = { object: 'page', id: STUDENT, parent: { database_id: SITE_LEDGER_DATABASES.student }, properties: { '예약 코드': { rich_text: [{ plain_text: TOKEN }] }, VIP: { id: 'D%3D%7DP', type: 'checkbox', checkbox: true } } };
  hook = null;
  dispatch = vi.fn(async (_request, context, descriptor) => Response.json({ studentId: context.studentId, operation: descriptor.operation }));
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => { const url = new URL(raw); if (url.origin !== 'https://api.notion.com' || !url.pathname.startsWith('/v1/pages/')) throw new Error('Unmocked network forbidden'); if (hook) await hook(); if (options.method === 'PATCH') page.properties.VIP.checkbox = JSON.parse(options.body).properties.VIP.checkbox; return Response.json(page); }));
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('code-free student-app member routes', () => {
  it('requires a real member session and an explicitly verified student link', async () => {
    expect((await consumer('/context', { guest: true })).status).toBe(401);
    expect(await (await consumer('/context')).json()).toEqual({ allowed: false, reason: 'not_linked' });
    expect((await consumer('/student')).status).toBe(403);
    link(STUDENT, 'unverified'); await grant();
    expect(await (await consumer('/context')).json()).toEqual({ allowed: false, reason: 'not_linked' });
    expect(fetch).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
  it('does not grant from a link or VIP and distinguishes context from protected resources', async () => {
    link();
    expect(await (await consumer('/context')).json()).toEqual({ allowed: false, reason: 'not_provided' });
    expect((await consumer('/homework')).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ allowed: false, revision: 0 });
  });
  it('returns safe scoped context and dispatches only the server-selected identity', async () => {
    link(); await grant();
    const response = await consumer('/context'), context = await response.json();
    expect(context).toMatchObject({ allowed: true, memberId, studentId: ID, revision: 1 });
    expect(context.studentScope).toContain(memberId); expect(context.studentScope).toContain(ID); expect(context.studentScope).toMatch(/:1$/);
    expect(JSON.stringify(context)).not.toMatch(/ABCDEFGH1234|HINTERNALONLY|bookingCode|memberCode|token/i);
    await consumer(`/student?studentId=${OTHER}&token=ATTACKER`);
    expect(dispatch.mock.calls[0][1]).toMatchObject({ memberId, studentId: ID, token: TOKEN, revision: 1 });
  });
  it('checks CSRF on changes and enforces operation paths and methods', async () => {
    link(); await grant();
    expect((await consumer('/panda/action', { method: 'POST', body: {}, csrf: false })).status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await consumer('/panda/action', { method: 'GET' })).status).toBe(405);
    expect((await consumer('/unknown')).status).toBe(404);
    expect((await consumer('/homework/not-an-id/file')).status).toBe(404);
    await consumer(`/homework/${OTHER}/submit`, { method: 'POST', body: {} });
    expect(dispatch.mock.calls[0][2]).toMatchObject({ operation: 'homework-submit', resourceId: OTHER });
  });
  it('denies an already authenticated member immediately after revoke', async () => {
    link(); await grant(); expect((await consumer('/panda')).status).toBe(200);
    await writeStudentAppAccess(env, ID, { allowed: false, expectedRevision: 1 });
    expect((await consumer('/panda')).status).toBe(403);
    expect(await (await consumer('/context')).json()).toEqual({ allowed: false, reason: 'not_provided' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('denies a revoke during Notion lookup and keeps database/Notion errors private', async () => {
    link(); await grant(); hook = async () => { hook = null; await writeStudentAppAccess(env, ID, { allowed: false, expectedRevision: 1 }); };
    expect(await (await consumer('/context')).json()).toEqual({ allowed: false, reason: 'not_provided' });
    await writeStudentAppAccess(env, ID, { allowed: true, expectedRevision: 2 });
    page.parent.database_id = SITE_LEDGER_DATABASES.payment;
    const response = await consumer('/student'); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/notion_relation|SQL|ABCDEFGH1234|fixture-only-notion/);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('refuses missing entitlement schema even for a valid linked session', async () => {
    link(); local.sqlite.exec('DROP TABLE student_app_access_events; DROP TABLE student_app_access;');
    expect((await consumer('/context')).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('teacher-only audited access changes', () => {
  it('requires teacher authorization before reads/writes and validates the actual student page', async () => {
    expect((await admin({ teacher: false })).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
    expect(await (await admin({})).json()).toMatchObject({ access: { allowed: false, revision: 0, studentId: ID } });
    page.archived = true;
    expect((await admin({ method: 'PUT', body: { allowed: true, expectedRevision: 0 } })).status).toBe(503);
    expect(await readStudentAppAccess(env, ID)).toMatchObject({ revision: 0, allowed: false });
  });
  it('uses explicit revision and rejects unknown fields without inventing a grant', async () => {
    expect((await admin({ method: 'PUT', body: { allowed: true } })).status).toBe(400);
    expect((await admin({ method: 'PUT', body: { allowed: true, expectedRevision: 0, vip: true } })).status).toBe(400);
    expect(await (await admin({ method: 'PUT', body: { allowed: true, expectedRevision: 0 } })).json()).toMatchObject({ access: { allowed: true, revision: 1 } });
    expect((await admin({ method: 'PUT', body: { allowed: false, expectedRevision: 0 } })).status).toBe(409);
    expect(await (await admin({ method: 'PUT', body: { allowed: false, expectedRevision: 1 } })).json()).toMatchObject({ access: { allowed: false, revision: 2 } });
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM student_app_access_events').get().n).toBe(2);
  });
});
