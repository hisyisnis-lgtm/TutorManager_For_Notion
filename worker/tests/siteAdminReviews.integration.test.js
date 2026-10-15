import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { hashSitePassword } from '../lib/siteAuth.js';
import { handleSiteAdminReviewRoutes } from '../lib/siteAdminReviews.js';
import { siteD1 } from './helpers/siteD1.js';

const ORIGIN = 'https://tiantianchinese.com';
const PASSWORD = 'Synthetic-review-admin-password42';
const MEMBER_PASSWORD = 'Synthetic-review-member-password42';
const MEMBER_ID = '8d2e26d5-5a26-4e45-a56e-9353bbec175f';
const ctx = { waitUntil: promise => promise.catch(() => {}) };
let local, env, teacher, credential;
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { method = 'GET', body, session, headers = {} } = {}) {
  return new Request(`https://fixture.example.workers.dev${path}`, { method,
    headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '198.51.100.77',
      ...(session?.cookie ? { Cookie: session.cookie } : {}),
      ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
const send = (path, options) => worker.fetch(request(path, options), env, ctx);
const adminSend = (path = '', options) => send(`/api/site/admin/reviews${path}`, options);
async function login() {
  const response = await send('/api/site/admin/session');
  expect(response.status).toBe(200);
  const anonymous = { cookie: cookie(response), ...(await response.json()) };
  const entered = await send('/api/site/admin/auth/login', {
    method: 'POST', session: anonymous, body: { password: PASSWORD },
  });
  expect(entered.status).toBe(200);
  return { cookie: cookie(entered), ...(await entered.json()) };
}
function seed({ member = false, at = '2026-10-14T00:00:00.000Z', title = '즐거웠던 수업', body } = {}) {
  const id = crypto.randomUUID();
  const content = { nickname: '참여자', experienceType: 'external', activityName: '외부 활동', title,
    body: body || '중국어를 재미있게 배웠습니다. 수업에서 배운 표현을 여러 번 연습하며 자신감이 생겼어요.',
    rating: 5, targetId: null, targetName: null, purchaseConfirmed: true };
  local.sqlite.prepare(`INSERT INTO reviews(id,latest_content,pending_version,created_at,updated_at,
    idempotency_key_hash,request_hash,request_expires_at,password_salt,password_hash,password_iterations,member_id,latest_rating)
    VALUES(?,?,1,?,?,?,? ,2147483647,?,?,100000,?,5)`)
    .run(id, JSON.stringify(content), at, at, crypto.randomUUID(), crypto.randomUUID(),
      member ? null : 'private-guest-salt', member ? null : 'private-guest-verifier', member ? MEMBER_ID : null);
  return { id, version: 1, content };
}
const moderate = (review, action, session, extras = {}) => adminSend(`/${review.id}/moderate`, {
  method: 'POST', session, body: { action, version: review.version, ...extras },
});
async function changed(review, action, session, extras) {
  const response = await moderate(review, action, session, extras);
  expect(response.status).toBe(200);
  return (await response.json()).review;
}
function editPending(review, title = '아직 공개되지 않은 수정본') {
  const content = { ...review, title, body: '작성자가 변경한 수정본입니다. 개인정보 없이 경험을 다시 정리해 제출합니다.' };
  for (const key of ['id','version','status','authorType','pendingVersion','publishedVersion','moderationHistory','publishedContent']) delete content[key];
  local.sqlite.prepare(`UPDATE reviews SET latest_content=?,version=version+1,pending_version=version+1,
    updated_at='2026-10-14T01:00:00.000Z',last_action='edit',last_actor='author',last_reason=NULL WHERE id=?`)
    .run(JSON.stringify(content), review.id);
  return { ...review, version: review.version + 1 };
}

beforeAll(async () => { credential = await hashSitePassword(MEMBER_PASSWORD, 'synthetic-review-member-pepper-32-characters'); });
beforeEach(async () => {
  local = siteD1();
  local.sqlite.exec(readFileSync(new URL('../migrations/0014_site_admin_sessions.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, SITE_ORIGIN: ORIGIN, SITE_ADMIN_ENABLED: 'true', AUTH_PASSWORD: PASSWORD,
    SITE_SESSION_SECRET: 'synthetic-review-site-session-secret-32', SITE_PASSWORD_SECRET: 'synthetic-review-member-pepper-32-characters',
    JWT_SECRET: 'synthetic-review-teacher-secret', REVIEW_PASSWORD_SECRET: 'synthetic-guest-review-pepper' };
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  local.sqlite.prepare(`INSERT INTO site_members(id,status,email,name,nickname,member_code,customer_key,provider,
    password_hash,password_salt,password_iterations,terms_accepted_at,privacy_accepted_at,created_at,updated_at)
    VALUES(?,'active','member@example.invalid','합성 회원','참여 회원','HREVIEW',?,'email',?,?,?, ?,?,?,?)`)
    .run(MEMBER_ID, crypto.randomUUID(), credential.hash, credential.salt, credential.iterations,
      '2026-10-14', '2026-10-14', '2026-10-14', '2026-10-14');
  local.sqlite.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
    VALUES('email','member@example.invalid',?,'member@example.invalid','2026-10-14')`).run(MEMBER_ID);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network denied'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); local.close(); });

describe('website administrator review security boundary', () => {
  it('denies anonymous listing, detail and moderation without revealing pending content', async () => {
    const review = seed();
    for (const [path, options] of [['', {}], [`/${review.id}`, {}], [`/${review.id}/moderate`, {
      method: 'POST', body: { action: 'approve', version: 1 },
    }]]) {
      const response = await adminSend(path, options);
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain(review.content.body);
    }
    expect(local.sqlite.prepare('SELECT version FROM reviews').get().version).toBe(1);
  });
  it('does not promote a real authenticated website member cookie to administrator', async () => {
    const response = await send('/api/site/session');
    const anonymous = { cookie: cookie(response), ...(await response.json()) };
    const entered = await send('/api/site/auth/login', { method: 'POST', session: anonymous,
      body: { email: 'member@example.invalid', password: MEMBER_PASSWORD } });
    expect(entered.status).toBe(200);
    const member = { cookie: cookie(entered), ...(await entered.json()) };
    expect(member.member.id).toBe(MEMBER_ID);
    const review = seed({ member: true });
    expect((await adminSend('', { session: member })).status).toBe(401);
    expect((await moderate(review, 'approve', member)).status).toBe(401);
  });
  it.each([
    { Origin: 'https://attacker.invalid' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' },
  ])('rejects unsafe cookie request origin metadata %j', async headers => {
    const session = await login(), review = seed();
    expect((await adminSend('', { session, headers })).status).toBe(403);
    expect((await adminSend(`/${review.id}/moderate`, { method: 'POST', session, headers,
      body: { action: 'approve', version: 1 } })).status).toBe(403);
    expect(local.sqlite.prepare('SELECT version FROM reviews').get().version).toBe(1);
  });
  it.each([undefined, 'x'.repeat(43)])('rejects writes without matching administrator CSRF %s', async csrfToken => {
    const session = await login(), review = seed();
    expect((await moderate(review, 'approve', { ...session, csrfToken })).status).toBe(403);
    expect(local.sqlite.prepare('SELECT version FROM reviews').get().version).toBe(1);
  });
  it.each([['student','personal:fixture'], ['game','fixture-player'], ['review','review:11111111-1111-4111-8111-111111111111'], ['dashboard','dashboard']])
    ('never promotes signed %s tokens even alongside a valid administrator cookie', async (purpose, subject) => {
      const session = await login(), token = await signTypedToken(env.JWT_SECRET, purpose, subject, 600);
      expect((await adminSend('', { session, headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    });
  it('fails closed for forged teacher payloads and direct handlers lacking an authorization verifier', async () => {
    expect((await adminSend('', { headers: { Authorization: 'Bearer forged.teacher.payload' } })).status).toBe(401);
    const response = await handleSiteAdminReviewRoutes(request('/api/site/admin/reviews'), env, {}, {
      authorizeTeacher: async () => undefined,
    });
    expect(response.status).toBe(401);
  });
  it('rechecks authentication after request body parsing and rejects intervening revocation', async () => {
    const session = await login(), review = seed();
    const req = request(`/api/site/admin/reviews/${review.id}/moderate`, {
      method: 'POST', session, body: { action: 'approve', version: 1 },
    });
    const original = req.json.bind(req);
    req.json = async () => {
      const body = await original();
      local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run();
      return body;
    };
    const response = await handleSiteAdminReviewRoutes(req, env, {});
    expect(response.status).toBe(401);
    expect(local.sqlite.prepare('SELECT version FROM reviews').get().version).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM review_moderation_log').get().n).toBe(0);
  });
});

describe('shared administrator review listing and moderation', () => {
  it('lists member and guest reviews with real computed purchase facts and no private credentials or IDs', async () => {
    const session = await login();
    seed(); seed({ member: true });
    const response = await adminSend('', { session }), data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(data.counts).toEqual({ pending: 2, published: 0, rejected: 0, hidden: 0 });
    expect(data.reviews.map(item => item.authorType).sort()).toEqual(['guest','member']);
    expect(data.reviews.every(item => item.purchaseConfirmed === false)).toBe(true);
    expect(data.reviews.every(item => Array.isArray(item.moderationHistory))).toBe(true);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/password_hash|password_salt|password_iterations|member_id|purchase_item_id|token_hash|csrf_hash/);
    expect(serialized).not.toContain(MEMBER_ID);
    expect(serialized).not.toContain('private-guest-verifier');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('paginates pending reviews deterministically and rejects malformed or unsupported query inputs', async () => {
    const session = await login();
    for (let index = 0; index < 21; index++) seed({ at: `2026-10-14T00:00:${String(index).padStart(2,'0')}.000Z` });
    const first = await (await adminSend('', { session })).json();
    expect(first.reviews).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
    const next = await (await adminSend(`?cursor=${first.nextCursor}`, { session })).json();
    expect(next.reviews).toHaveLength(1); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.reviews, ...next.reviews].map(item => item.id)).size).toBe(21);
    expect(next.counts.pending).toBe(21);
    for (const query of ['?status=deleted', '?cursor=bad!', '?limit=500', '?status=all']) {
      expect((await adminSend(query, { session })).status).toBe(400);
    }
  });
  it('publishes only an approved snapshot and retains it when a subsequent revision is rejected', async () => {
    const session = await login(), initial = seed();
    let review = await changed(initial, 'approve', session);
    expect(review).toMatchObject({ status: 'published', version: 2, publishedVersion: 1, pendingVersion: null, authorType: 'guest' });
    const publicReview = await (await send(`/reviews/${initial.id}`)).json();
    expect(publicReview.review.title).toBe(initial.content.title);
    review = editPending(review);
    const pending = await (await adminSend('?status=pending', { session })).json();
    expect(pending.counts).toMatchObject({ pending: 1, published: 1 });
    expect(pending.reviews[0].title).toBe('아직 공개되지 않은 수정본');
    expect(pending.reviews[0].publishedContent.title).toBe(initial.content.title);
    review = await changed(review, 'reject', session, { reason: '개인정보를 삭제한 뒤 다시 작성해주세요.' });
    expect(review).toMatchObject({ status: 'published', pendingVersion: null, publishedVersion: 1 });
    expect((await (await send(`/reviews/${initial.id}`)).json()).review.title).toBe(initial.content.title);
    const detail = await (await adminSend(`/${initial.id}`, { session })).json();
    expect(detail.review.moderationHistory.map(log => log.action)).toEqual(['reject','approve']);
    expect(detail.review.moderationHistory[0].reason).toContain('개인정보');
  });
  it('enforces hide and restore gates, explicit reasons and required permission', async () => {
    const session = await login();
    let review = await changed(seed(), 'approve', session);
    expect((await moderate(review, 'hide', session)).status).toBe(400);
    review = await changed(review, 'hide', session, { reason: '개인정보 확인이 필요합니다.' });
    expect((await send(`/reviews/${review.id}`)).status).toBe(404);
    expect((await moderate(review, 'restore', session, { reason: '확인이 끝났습니다.' })).status).toBe(409);
    let restorable = await changed(seed(), 'approve', session);
    restorable = await changed(restorable, 'hide', session, { reason: '일시적인 확인 중입니다.', allowRestore: true });
    const hidden = await (await adminSend('?status=hidden', { session })).json();
    expect(hidden.counts.hidden).toBe(2);
    restorable = await changed(restorable, 'restore', session, { reason: '확인을 완료했습니다.' });
    expect(restorable).toMatchObject({ status: 'published', restoreAllowed: false });
    expect((await send(`/reviews/${restorable.id}`)).status).toBe(200);
    const pendingHidden = editPending(review);
    expect((await moderate(pendingHidden, 'restore', session, { reason: '새 수정본 검수 전입니다.' })).status).toBe(409);
  });
  it('rejects stale competing updates without additional mutation or audit and permits fresh detail recovery', async () => {
    const session = await login(), initial = seed();
    const results = await Promise.all([moderate(initial, 'approve', session), moderate(initial, 'reject', session, { reason: '내용 확인이 필요합니다.' })]);
    expect(results.map(response => response.status).sort()).toEqual([200,409]);
    expect(local.sqlite.prepare('SELECT version FROM reviews WHERE id=?').get(initial.id).version).toBe(2);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM review_moderation_log').get().n).toBe(1);
    const fresh = await (await adminSend(`/${initial.id}`, { session })).json();
    expect(fresh.review.version).toBe(2); expect(fresh.review.moderationHistory).toHaveLength(1);
  });
  it('keeps the original typed teacher moderation route compatible with the shared website state and history', async () => {
    const session = await login(), initial = seed();
    const approved = await send(`/reviews/admin/${initial.id}/moderate`, { method: 'POST',
      headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${teacher}` }, body: { action: 'approve', version: 1 } });
    expect(approved.status).toBe(200);
    let review = (await approved.json()).review;
    review = await changed(review, 'hide', session, { reason: '운영 확인 중입니다.', allowRestore: true });
    const restored = await send(`/reviews/admin/${initial.id}/moderate`, { method: 'POST',
      headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${teacher}` },
      body: { action: 'restore', version: review.version, reason: '운영 확인을 마쳤습니다.' } });
    expect(restored.status).toBe(200);
    const teacherList = await adminSend('?status=published', {
      headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${teacher}` },
    });
    expect(teacherList.status).toBe(200);
    expect((await teacherList.json()).reviews[0].moderationHistory.map(log => log.action)).toEqual(['restore','hide','approve']);
  });
  it('never exposes deleted reviews and refuses unsupported routes, methods or mutation payloads', async () => {
    const session = await login(), initial = seed();
    local.sqlite.prepare(`UPDATE reviews SET status='deleted',version=version+1,latest_content=NULL,published_content=NULL,
      password_hash=NULL,password_salt=NULL,password_iterations=NULL,pending_version=NULL,published_version=NULL,
      moderation_reason=NULL,hidden_reason=NULL,restore_allowed=0,last_reason=NULL,member_id=NULL,latest_rating=NULL,
      last_action='delete',last_actor='author' WHERE id=?`).run(initial.id);
    expect((await adminSend(`/${initial.id}`, { session })).status).toBe(404);
    expect((await moderate(initial, 'approve', session)).status).toBe(404);
    expect((await adminSend('/not-a-review-id', { session })).status).toBe(404);
    expect((await adminSend(`/${crypto.randomUUID()}/unknown`, { session })).status).toBe(404);
    expect((await adminSend('', { session, method: 'POST', body: {} })).status).toBe(405);
    expect((await adminSend(`/${crypto.randomUUID()}`, { session, method: 'DELETE', body: {} })).status).toBe(405);
    expect((await (await adminSend('', { session })).json()).reviews).toEqual([]);
    const active = seed();
    expect((await moderate(active, 'delete', session)).status).toBe(400);
    expect((await moderate(active, 'approve', session, { member_id: MEMBER_ID })).status).toBe(400);
    expect((await moderate(active, 'approve', session, { version: 0 })).status).toBe(400);
  });
});

describe('public review namespace alias isolation', () => {
  const guestInput = () => ({ nickname: '활동 참여자', experienceType: 'external', activityName: '지역 활동',
    title: '즐거운 중국어 활동', body: '활동에서 배운 중국어를 여러 번 연습했어요. 편안한 분위기여서 다음 활동에도 참여하고 싶습니다.',
    rating: 5, targetId: null, password: 'Synthetic-guest-review-password42', idempotencyKey: crypto.randomUUID() });
  it('uses the same review rows for normal guest create, password management and administrator publication', async () => {
    const input = guestInput(), session = await login();
    const submitted = await send('/api/site/public-reviews', { method: 'POST', body: input });
    expect(submitted.status).toBe(201);
    let review = (await submitted.json()).review;
    expect((await (await send('/api/site/public-reviews')).json()).reviews).toEqual([]);
    const queue = await (await adminSend('', { session })).json();
    expect(queue.reviews[0].id).toBe(review.id);
    review = await changed(review, 'approve', session);
    expect((await (await send(`/api/site/public-reviews/${review.id}`)).json()).review.title).toBe(input.title);
    const authenticated = await send(`/api/site/public-reviews/${review.id}/auth`, {
      method: 'POST', body: { password: input.password },
    });
    expect(authenticated.status).toBe(200);
    const owner = await authenticated.json(), headers = { Authorization: `Bearer ${owner.token}` };
    const manageable = await send(`/api/site/public-reviews/${review.id}/manage`, { headers });
    expect(manageable.status).toBe(200);
    expect((await manageable.json()).review.version).toBe(review.version);
    const { password, idempotencyKey, ...content } = input;
    const edited = await send(`/api/site/public-reviews/${review.id}`, { method: 'PUT', headers,
      body: { ...content, title: '수정하여 제출한 후기', version: review.version } });
    expect(edited.status).toBe(200);
    review = (await edited.json()).review;
    expect((await (await send('/api/site/public-reviews')).json()).reviews[0].title).toBe(input.title);
    expect((await (await adminSend('', { session })).json()).reviews[0].title).toBe('수정하여 제출한 후기');
    expect((await adminSend('', { headers })).status).toBe(401);
    expect((await send(`/api/site/public-reviews/${review.id}/manage`, {
      headers: { Authorization: `Bearer ${teacher}` },
    })).status).toBe(401);
    expect((await send(`/api/site/public-reviews/${review.id}`, { method: 'DELETE', headers,
      body: { version: review.version } })).status).toBe(200);
    expect((await adminSend(`/${review.id}`, { session })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot reach teacher moderation through the public alias even with valid administrator credentials', async () => {
    const review = seed(), session = await login();
    for (const path of ['/admin', `/admin/${review.id}/moderate`, '/admin%2Freviews', '/../admin/reviews']) {
      const response = await send(`/api/site/public-reviews${path}`, {
        method: 'POST', session, headers: { Authorization: `Bearer ${teacher}` },
        body: { action: 'approve', version: review.version },
      });
      expect([404,405]).toContain(response.status);
    }
    expect(local.sqlite.prepare('SELECT version FROM reviews').get().version).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM review_moderation_log').get().n).toBe(0);
  });
  it('requires the configured site origin for public author writes and preserves read-only preflight bearer support', async () => {
    const response = await send('/api/site/public-reviews', { method: 'POST', headers: { Origin: '' }, body: guestInput() });
    expect(response.status).toBe(403);
    const foreign = await send('/api/site/public-reviews', { method: 'POST', headers: { Origin: 'https://attacker.invalid' }, body: guestInput() });
    expect(foreign.status).toBe(403);
    const preflight = await send(`/api/site/public-reviews/${crypto.randomUUID()}/manage`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM reviews').get().n).toBe(0);
  });
  it('keeps the Worker streamed request limit and disallows invented alias operations', async () => {
    const session = await login();
    expect((await send('/api/site/public-reviews', { method: 'POST', body: 'x'.repeat(200000) })).status).toBe(413);
    expect((await send(`/api/site/public-reviews/${crypto.randomUUID()}/upload`, { session })).status).toBe(404);
    expect((await send(`/api/site/public-reviews/${crypto.randomUUID()}/moderate`, {
      method: 'POST', session, body: { action: 'approve', version: 1 },
    })).status).toBe(404);
  });
});
