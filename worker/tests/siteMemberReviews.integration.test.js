import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAuthRoutes, hashSitePassword } from '../lib/siteAuth.js';
import { handleSiteMemberReviewRoutes } from '../lib/siteMemberReviews.js';
import { handleReviewRoutes } from '../lib/reviews.js';
import { handleSiteCommerceRoutes } from '../lib/siteCommerce.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';

const ORIGIN = 'https://tiantianchinese.com';
const TARGET_A = '11111111-1111-4111-8111-111111111111';
const TARGET_B = '22222222-2222-4222-8222-222222222222';
const SESSION_SECRET = 'site-review-fixture-session-secret-32';
const PASSWORD_SECRET = 'site-review-fixture-password-secret-32';
const PASSWORD = 'Synthetic-review-password42';
const fixture = extra => ({ nickname: '참여 회원', experienceType: 'external', activityName: '지역 외부 활동',
  title: '함께 배운 즐거운 시간', body: '처음 참여한 외부 활동에서 중국어를 재미있게 배웠습니다. 다음에도 참여하고 싶습니다.',
  rating: 5, targetId: null, ...extra });
let database, env, alice, bob, credential, teacher;

const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { method = 'GET', body, session = alice, origin = ORIGIN, token, headers = {}, raw } = {}) {
  return new Request(`${ORIGIN}${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}),
    'CF-Connecting-IP': '198.51.100.24', ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body || raw ? { body: raw || JSON.stringify(body) } : {}) });
}
const memberSend = (path = '', options) => handleSiteMemberReviewRoutes(request(`/api/site/reviews${path}`, options), env);
const commerceSend = (path, options) => handleSiteCommerceRoutes(request(`/api/site${path}`, options), env, {});
const teacherAccess = async req => await verifyTypedToken(env.JWT_SECRET, req.headers.get('Authorization')?.slice(7) || '', 'teacher')
  ? null : Response.json({ error: '강사 권한이 필요합니다.' }, { status: 401 });
const guestSend = (path = '', options) => handleReviewRoutes(request(`/reviews${path}`, options), env, {}, { authorizeTeacher: teacherAccess });
async function create(extra = {}, session = alice, key = crypto.randomUUID()) {
  const input = { ...fixture(extra), idempotencyKey: key };
  const response = await memberSend('', { method: 'POST', session, body: input });
  expect(response.status).toBe(201);
  return { input, ...(await response.json()).review };
}
async function moderate(review, action = 'approve', extra = {}) {
  const response = await guestSend(`/admin/${review.id}/moderate`, { method: 'POST', token: teacher,
    body: { action, version: review.version, ...extra } });
  expect(response.status).toBe(200);
  return (await response.json()).review;
}
async function account(name) {
  const id = crypto.randomUUID(), at = new Date().toISOString(), email = `${name}@example.invalid`;
  database.sqlite.prepare(`INSERT INTO site_members(id,status,email,name,nickname,member_code,customer_key,provider,
    password_hash,password_salt,password_iterations,terms_accepted_at,privacy_accepted_at,created_at,updated_at)
    VALUES(?,'active',?,?,?, ?,?,'email',?,?,?,?,?,?,?)`)
    .run(id, email, name, `${name} 닉네임`, `H${name.toUpperCase()}`, crypto.randomUUID(), credential.hash, credential.salt,
      credential.iterations, at, at, at, at);
  database.sqlite.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
    VALUES('email',?,?,?,?)`).run(email, id, email, at);
  const guest = await handleSiteAuthRoutes(request('/api/site/session', { session: null }), env);
  const guestSession = { cookie: cookie(guest), ...(await guest.json()) };
  const entered = await handleSiteAuthRoutes(request('/api/site/auth/login', { method: 'POST', session: guestSession,
    body: { email, password: PASSWORD } }), env);
  expect(entered.status).toBe(200);
  return { cookie: cookie(entered), ...(await entered.json()) };
}
function paidItem(member = alice, targetId = TARGET_A, pgEnvironment = 'live', approved = true) {
  const requestId = crypto.randomUUID(), orderId = crypto.randomUUID(), itemId = crypto.randomUUID(), attemptId = crypto.randomUUID();
  const pgId = `pg_${crypto.randomUUID()}`, paymentKey = `payment_${crypto.randomUUID()}`, at = new Date().toISOString();
  database.sqlite.prepare(`INSERT INTO site_payment_requests(id,member_id,target_id,billing_key,billing_period,snapshot,amount,
    terms_version,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,'2026-10','{}',10000,'fixture-terms','2030-01-01T00:00:00.000Z','paid',?,?)`)
    .run(requestId, member.member.id, targetId, crypto.randomUUID(), at, at);
  database.sqlite.prepare(`INSERT INTO site_orders(id,member_id,request_id,idempotency_hash,payload_hash,snapshot,amount,status,
    active_attempt_id,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,'{}',10000,?,?,?, ?,?)`)
    .run(orderId, member.member.id, requestId, crypto.randomUUID(), crypto.randomUUID(), approved ? 'paid' : 'pending', attemptId, approved ? at : null, at, at);
  database.sqlite.prepare('INSERT INTO site_order_items(id,order_id,target_id,snapshot) VALUES(?,?,?,\'{}\')').run(itemId, orderId, targetId);
  database.sqlite.prepare(`INSERT INTO site_payment_attempts(id,order_id,pg_order_id,pg_environment,payment_key,idempotency_key,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?, ?,?)`).run(attemptId, orderId, pgId, pgEnvironment, approved ? paymentKey : null, crypto.randomUUID(), approved ? 'paid' : 'ready', at, at);
  if (approved) database.sqlite.prepare(`INSERT INTO site_payments(payment_key,order_id,attempt_id,pg_order_id,pg_environment,merchant_id,
    amount,currency,method,approved_at,evidence_hash,updated_at) VALUES(?,?,?,?,?,'fixture-merchant',10000,'KRW','카드',?,?,?)`)
    .run(paymentKey, orderId, attemptId, pgId, pgEnvironment, at, crypto.randomUUID(), at);
  return { itemId, orderId, paymentKey };
}

beforeAll(async () => { credential = await hashSitePassword(PASSWORD, PASSWORD_SECRET); });
beforeEach(async () => {
  database = siteD1();
  env = { GAME_DB: database.db, SITE_SESSION_SECRET: SESSION_SECRET, SITE_PASSWORD_SECRET: PASSWORD_SECRET,
    JWT_SECRET: 'synthetic-jwt-secret-for-other-apps', REVIEW_PASSWORD_SECRET: 'synthetic-guest-review-password-secret' };
  const at = new Date().toISOString();
  for (const [id, name] of [[TARGET_A, '특강 A'], [TARGET_B, '특강 B']]) database.sqlite.prepare(`INSERT INTO site_targets
    (id,name,experience_type,class_type_id,student_required,time_ledger_mode,unit_price,created_at,updated_at)
    VALUES(?,?,'special',?,0,'none',0,?,?)`).run(id, name, crypto.randomUUID(), at, at);
  alice = await account('alice'); bob = await account('bob');
  teacher = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No external service in review fixtures'); }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('member review ownership, input and retry contracts', () => {
  it('accepts body-only titles on create and edit while keeping idempotent retries and approved snapshots', async () => {
    const body = '중국어  수업에서\n\n새로운 표현을 배우고\t자신 있게 말할 수 있었어요.';
    const title = '중국어 수업에서 새로운 표현을 배우고 자신 있게 말할 수 있었어요.';
    let current = await create({ title: undefined, body });
    expect(current.title).toBe(title);
    for (const submittedTitle of ['', '  ', title]) {
      const response = await memberSend('', { method: 'POST', body: { ...current.input, title: submittedTitle } });
      expect(response.status).toBe(200);
      expect((await response.json()).review.id).toBe(current.id);
    }
    current = await moderate(current);
    const revisedBody = '👩‍👩‍👧‍👦가 '.repeat(25).trim(), revisedTitle = '👩‍👩‍👧‍👦가 '.repeat(20).trim();
    const edited = await memberSend(`/${current.id}`, { method: 'PUT', body: { ...fixture({ title: undefined, body: revisedBody }), version: current.version } });
    expect(edited.status).toBe(200);
    current = (await edited.json()).review;
    expect(current.title).toBe(revisedTitle);
    expect(current.publishedContent).toMatchObject({ title, body });
    expect((await (await guestSend(`/${current.id}`)).json()).review).toMatchObject({ title, body });
    current = await moderate(current);
    expect((await (await guestSend(`/${current.id}`)).json()).review).toMatchObject({ title: revisedTitle, body: revisedBody });
  });
  it('creates a password-free external review with a mandatory rating and no invented purchase', async () => {
    const review = await create();
    expect(review).toMatchObject({ rating: 5, targetId: null, targetName: null, purchaseConfirmed: false, status: 'pending' });
    const row = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(review.id);
    expect(row.member_id).toBe(alice.member.id);
    for (const field of ['password_salt','password_hash','password_iterations','latest_purchase_item_id']) expect(row[field]).toBeNull();
    expect((await guestSend(`/${review.id}`)).status).toBe(404);
    const listed = await memberSend();
    expect(listed.headers.get('Cache-Control')).toContain('no-store');
    const ownList = await listed.json();
    expect(ownList.memberId).toBe(alice.member.id);
    expect(ownList.reviews).toHaveLength(1);
    const ownDetail = await memberSend(`/${review.id}`);
    expect(ownDetail.headers.get('Cache-Control')).toContain('no-store');
    expect(await ownDetail.json()).toMatchObject({ memberId: alice.member.id, review: { id: review.id, body: review.body } });
    expect(JSON.stringify(review)).not.toMatch(/member_id|payment_key|purchase_item_id|orderId|customerKey/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a real member cookie and CSRF, denies foreign ownership, and keeps teacher and guest tokens separate', async () => {
    const review = await create();
    expect((await memberSend('', { session: null })).status).toBe(401);
    expect((await memberSend('', { method: 'POST', session: { cookie: alice.cookie }, body: { ...fixture(), idempotencyKey: crypto.randomUUID() } })).status).toBe(403);
    expect((await memberSend('', { method: 'POST', origin: 'https://attacker.invalid', body: {} })).status).toBe(403);
    expect((await memberSend('', { session: null, token: teacher })).status).toBe(401);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await memberSend(`/${review.id}`, { method, session: bob,
        ...(method !== 'GET' ? { body: method === 'PUT' ? { ...fixture(), version: review.version } : { version: review.version } } : {}) });
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      expect(await response.text()).not.toContain(review.body);
    }
    expect((await guestSend(`/${review.id}/auth`, { method: 'POST', body: { password: PASSWORD } })).status).toBe(401);
    const forgedReviewAuthority = await signTypedToken(env.JWT_SECRET, 'review', `review:${review.id}`, 600);
    expect((await guestSend(`/${review.id}/manage`, { token: forgedReviewAuthority })).status).toBe(401);
    expect((await guestSend(`/${review.id}`, { method: 'PUT', token: forgedReviewAuthority, body: { ...fixture(), version: 1 } })).status).toBe(401);
  });
  it('rejects client asserted identity/purchases/canonical names and enforces strict rating and grapheme bounds', async () => {
    for (const patch of [{ password: PASSWORD }, { memberId: alice.member.id }, { id: crypto.randomUUID() }, { purchaseConfirmed: true },
      { orderItemId: crypto.randomUUID() }, { purchaseItemId: crypto.randomUUID() }, { targetName: '조작한 이름' }, { version: 1 },
      { rating: undefined }, { rating: null }, { rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: '5' },
      { title: '가' }, { body: '짧아요' }, { activityName: '가'.repeat(61) }]) {
      const response = await memberSend('', { method: 'POST', body: { ...fixture(patch), idempotencyKey: crypto.randomUUID() } });
      expect(response.status).toBe(400);
    }
    expect((await memberSend('', { method: 'POST', raw: '가'.repeat(50000) })).status).toBe(413);
    const unicode = await create({ nickname: '👩‍👩‍👧‍👦👨‍👩‍👦' });
    expect(unicode.nickname).toBe(alice.member.name);
  });
  it('uses the registered name instead of client nicknames and masks only the public list and detail', async () => {
    database.sqlite.prepare('UPDATE site_members SET name=?,nickname=? WHERE id=?').run('최하늘', '계정 별명', alice.member.id);
    const submitted = await create({ nickname: '김사칭' });
    expect(submitted.nickname).toBe('최하늘');
    let current = await moderate(submitted);
    expect(current.nickname).toBe('최하늘');
    expect(current.publishedContent.nickname).toBe('최하늘');
    for (const response of [await guestSend(), await guestSend(`/${current.id}`)]) {
      expect(response.status).toBe(200);
      const value = await response.json(), review = value.review || value.reviews[0];
      expect(review.nickname).toBe('최*늘');
      expect(JSON.stringify(value)).not.toMatch(/최하늘|김사칭|계정 별명|member_id|memberId|public_author_name/);
      expect(JSON.stringify(value)).not.toContain(alice.member.id);
    }
    const edited = await memberSend(`/${current.id}`, { method: 'PUT', body: { ...fixture({ nickname: '이사칭', title: '승인 전 수정 제목' }), version: current.version } });
    expect(edited.status).toBe(200);
    current = (await edited.json()).review;
    expect(current.nickname).toBe('최하늘');
    expect(current.publishedContent.nickname).toBe('최하늘');
    expect((await (await guestSend(`/${current.id}`)).json()).review).toMatchObject({ nickname: '최*늘', title: submitted.title });
  });
  it('publishes registered names for legacy member snapshots and falls back safely when a name is missing', async () => {
    database.sqlite.prepare('UPDATE site_members SET name=? WHERE id=?').run('남궁하늘', alice.member.id);
    const current = await moderate(await create());
    const row = database.sqlite.prepare('SELECT published_content FROM reviews WHERE id=?').get(current.id);
    database.sqlite.prepare('UPDATE reviews SET published_content=? WHERE id=?')
      .run(JSON.stringify({ ...JSON.parse(row.published_content), nickname: '기존 공개 별명' }), current.id);
    expect((await (await guestSend(`/${current.id}`)).json()).review.nickname).toBe('남**늘');
    database.sqlite.prepare('UPDATE site_members SET name=? WHERE id=?').run('', alice.member.id);
    const publicValue = await (await guestSend()).json();
    expect(publicValue.reviews[0].nickname).toBe('회원');
    expect(JSON.stringify(publicValue)).not.toContain('기존 공개 별명');
  });
  it('does not restrict registered names to the legacy nickname length and accepts omitted nickname fields', async () => {
    for (const name of ['김', '가'.repeat(40)]) {
      database.sqlite.prepare('UPDATE site_members SET name=? WHERE id=?').run(name, alice.member.id);
      const input = { ...fixture(), idempotencyKey: crypto.randomUUID() };
      delete input.nickname;
      const response = await memberSend('', { method: 'POST', body: input });
      expect(response.status).toBe(201);
      const created = (await response.json()).review;
      expect(created.nickname).toBe(name);
      const published = await moderate(created);
      expect((await (await guestSend(`/${published.id}`)).json()).review.nickname).toBe(name.length === 1 ? '*' : `가${'*'.repeat(38)}가`);
    }
  });
  it('keeps legacy nickname trim normalization and existing stored content on idempotent retries', async () => {
    const submitted = await create({ nickname: '  이전 별명  ' });
    const row = database.sqlite.prepare('SELECT latest_content FROM reviews WHERE id=?').get(submitted.id);
    database.sqlite.prepare('UPDATE reviews SET latest_content=? WHERE id=?')
      .run(JSON.stringify({ ...JSON.parse(row.latest_content), nickname: '이전 별명' }), submitted.id);
    for (const nickname of ['  이전 별명  ', '이전 별명']) {
      const response = await memberSend('', { method: 'POST', body: { ...submitted.input, nickname } });
      expect(response.status).toBe(200);
      expect((await response.json()).review).toMatchObject({ id: submitted.id, nickname: '이전 별명', version: 1 });
    }
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM reviews').get().n).toBe(1);
  });
  it('accepts the full 2000-grapheme emoji body while retaining the actual 128 KiB payload bound', async () => {
    const body = '👩‍👩‍👧‍👦'.repeat(2000);
    const review = await create({ body });
    expect(review.body).toBe(body);
    expect((await memberSend('', { method: 'POST', body: { ...fixture({ body: `${body}👩‍👩‍👧‍👦` }), idempotencyKey: crypto.randomUUID() } })).status).toBe(400);
  });
  it('supports idempotent parallel retries without sharing identity across members and rejects changed payloads', async () => {
    const input = { ...fixture(), idempotencyKey: crypto.randomUUID() };
    const responses = await Promise.all([memberSend('', { method: 'POST', body: input }), memberSend('', { method: 'POST', body: input })]);
    expect(responses.map(value => value.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(value => value.json()));
    expect(results[0].review.id).toBe(results[1].review.id);
    for (const patch of [{ rating: 2 }, { targetId: TARGET_A }, { body: `${input.body} 수정한 요청입니다.` }]) {
      expect((await memberSend('', { method: 'POST', body: { ...input, ...patch } })).status).toBe(409);
    }
    const differentOwner = await memberSend('', { method: 'POST', session: bob, body: input });
    expect(differentOwner.status).toBe(201);
    expect((await differentOwner.json()).review.id).not.toBe(results[0].review.id);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM reviews').get().n).toBe(2);
  });
  it('allows one canonical target review per member atomically and permits target-free activities', async () => {
    const first = { ...fixture({ targetId: TARGET_A }), idempotencyKey: crypto.randomUUID() };
    const second = { ...first, idempotencyKey: crypto.randomUUID() };
    const outcomes = await Promise.all([memberSend('', { method: 'POST', body: first }), memberSend('', { method: 'POST', body: second })]);
    expect(outcomes.map(value => value.status).sort()).toEqual([201, 409]);
    expect((await memberSend('', { method: 'POST', session: bob, body: first })).status).toBe(201);
    await create({ targetId: null }); await create({ targetId: null });
    const inactive = crypto.randomUUID();
    expect((await memberSend('', { method: 'POST', body: { ...fixture({ targetId: inactive }), idempotencyKey: crypto.randomUUID() } })).status).toBe(400);
    database.sqlite.prepare('UPDATE site_targets SET active=0 WHERE id=?').run(TARGET_B);
    expect((await memberSend('', { method: 'POST', body: { ...fixture({ targetId: TARGET_B }), idempotencyKey: crypto.randomUUID() } })).status).toBe(400);
  });
  it('returns the same canonical review on parallel same-key retries even when the DB cross-target guard wins first', async () => {
    const input = { ...fixture({ targetId: TARGET_A }), idempotencyKey: crypto.randomUUID() };
    const responses = await Promise.all([memberSend('', { method: 'POST', body: input }), memberSend('', { method: 'POST', body: input })]);
    expect(responses.map(value => value.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(value => value.json()));
    expect(results[0].review.id).toBe(results[1].review.id);
  });
  it('atomically reserves the published target while an edit to a new target is pending', async () => {
    let current = await moderate(await create({ targetId: TARGET_A }));
    const results = await Promise.all([
      memberSend(`/${current.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_B }), version: current.version } }),
      memberSend('', { method: 'POST', body: { ...fixture({ targetId: TARGET_A }), idempotencyKey: crypto.randomUUID() } }),
    ]);
    expect(results.map(value => value.status)).toEqual([200, 409]);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM reviews WHERE member_id=?').get(alice.member.id).n).toBe(1);
    current = (await results[0].json()).review;
    expect(current.publishedContent.targetId).toBe(TARGET_A);
    await moderate(current);
    await create({ targetId: TARGET_A });
  });
  it('paginates only the logged-in member and excludes deleted reviews', async () => {
    for (let i = 0; i < 21; i++) await create({ title: `외부 활동 후기 ${i}` });
    await create({}, bob);
    const page1 = await (await memberSend()).json();
    expect(page1.reviews).toHaveLength(20);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await (await memberSend(`?cursor=${page1.nextCursor}`)).json();
    expect(page2.reviews).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.reviews, ...page2.reviews].map(row => row.id)).size).toBe(21);
    expect((await (await memberSend('', { session: bob })).json()).reviews).toHaveLength(1);
    expect((await memberSend('?cursor=bad')).status).toBe(400);
    expect((await memberSend(`?memberId=${bob.member.id}`)).status).toBe(400);
  });
  it('limits submission independently per member and emits no-store retry information', async () => {
    for (let i = 0; i < 30; i++) await create();
    const denied = await memberSend('', { method: 'POST', body: { ...fixture(), idempotencyKey: crypto.randomUUID() } });
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toBe('3600');
    expect(denied.headers.get('Cache-Control')).toContain('no-store');
    expect((await memberSend('', { method: 'POST', session: bob, body: { ...fixture(), idempotencyKey: crypto.randomUUID() } })).status).toBe(201);
  });
});

describe('approved rating and purchase snapshots', () => {
  it('sorts modern public reviews using the approved rating column even when JSON differs or the column is null', async () => {
    const highest = await moderate(await create({ rating: 1 }));
    const middle = await moderate(await create({ rating: 4 }));
    const lowest = await moderate(await create({ rating: 5 }));
    const unrated = await moderate(await create({ rating: 5 }));
    for (const [review, rating] of [[highest, 5], [middle, 3], [lowest, 2], [unrated, null]]) {
      database.sqlite.prepare('UPDATE reviews SET published_rating=?,latest_rating=5 WHERE id=?').run(rating, review.id);
    }
    const response = await guestSend(), page = await response.json();
    expect(response.status).toBe(200);
    expect(page.reviews.map(review => review.id)).toEqual([highest.id, middle.id, lowest.id, unrated.id]);
    expect(page.reviews.map(review => review.rating)).toEqual([5, 3, 2, null]);
    expect(page.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toMatch(/public_sort_rating|published_rating|latest_rating|member_id/);
  });
  it('does not change public rating order until a pending higher rating has been approved', async () => {
    const low = await moderate(await create({ rating: 2 }));
    const high = await moderate(await create({ rating: 4 }));
    const edited = await memberSend(`/${low.id}`, { method: 'PUT', body: { ...fixture({ rating: 5 }), version: low.version } });
    expect(edited.status).toBe(200);
    const pending = (await edited.json()).review;
    expect(pending).toMatchObject({ rating: 5, publishedContent: { rating: 2 } });
    const beforeApproval = (await (await guestSend()).json()).reviews;
    expect(beforeApproval.map(review => [review.id, review.rating])).toEqual([[high.id, 4], [low.id, 2]]);
    await moderate(pending);
    const afterApproval = (await (await guestSend()).json()).reviews;
    expect(afterApproval.map(review => [review.id, review.rating])).toEqual([[low.id, 5], [high.id, 4]]);
  });
  it('publishes general canonical ratings while never exposing financial or membership identifiers', async () => {
    paidItem(bob);
    const pending = await create({ targetId: TARGET_A, rating: 4 });
    expect(pending.targetName).toBe('특강 A');
    expect(pending.purchaseConfirmed).toBe(false);
    const approved = await moderate(pending);
    expect(approved.publishedContent).toMatchObject({ targetId: TARGET_A, targetName: '특강 A', rating: 4, purchaseConfirmed: false });
    const publicResponse = await guestSend(`/${pending.id}`), publicReview = (await publicResponse.json()).review;
    expect(publicReview).toMatchObject({ targetId: TARGET_A, targetName: '특강 A', rating: 4, purchaseConfirmed: false });
    expect(JSON.stringify(publicReview)).not.toMatch(/member_id|memberId|order_id|orderId|payment_key|paymentKey|purchase_item|customerKey/);
    const summary = await (await commerceSend(`/targets/${TARGET_A}/review-summary`)).json();
    expect(summary.general).toMatchObject({ count: 1, average: 4 });
    expect(summary.purchase.count).toBe(0);
  });
  it('recognizes only the member own approved item and keeps purchase history after refund', async () => {
    paidItem(bob, TARGET_B);
    paidItem(alice, TARGET_B, 'live', false);
    const unapproved = await create({ targetId: TARGET_B });
    expect(unapproved.purchaseConfirmed).toBe(false);
    const purchase = paidItem();
    const pending = await create({ targetId: TARGET_A });
    expect(pending.purchaseConfirmed).toBe(true);
    expect(database.sqlite.prepare('SELECT latest_purchase_item_id FROM reviews WHERE id=?').get(pending.id).latest_purchase_item_id).toBe(purchase.itemId);
    await moderate(pending);
    database.sqlite.prepare("UPDATE site_orders SET status='refunded',refunded_amount=amount WHERE id=?").run(purchase.orderId);
    database.sqlite.prepare('UPDATE site_payments SET refunded_amount=amount WHERE payment_key=?').run(purchase.paymentKey);
    const publicReview = (await (await guestSend(`/${pending.id}`)).json()).review;
    expect(publicReview.purchaseConfirmed).toBe(true);
    const current = (await (await memberSend(`/${pending.id}`)).json()).review;
    const edited = await memberSend(`/${pending.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_A, rating: 4 }), version: current.version } });
    expect((await edited.json()).review.purchaseConfirmed).toBe(true);
    const summary = await (await commerceSend(`/targets/${TARGET_A}/review-summary`)).json();
    expect(summary.purchase).toMatchObject({ count: 1, average: 5 });
  });
  it.each([
    ['production', 'test', false], ['development', 'live', false], ['development', 'test', true], [undefined, 'test', false],
  ])('recognizes synthetic test purchase only with explicit development and test mode: %s / %s', async (environment, mode, expected) => {
    env.SITE_ENVIRONMENT = environment; env.SITE_TOSS_MODE = mode;
    paidItem(alice, TARGET_A, 'test');
    const pending = await create({ targetId: TARGET_A });
    expect(pending.purchaseConfirmed).toBe(expected);
    await moderate(pending);
    expect((await (await guestSend(`/${pending.id}`)).json()).review.purchaseConfirmed).toBe(expected);
  });
  it('revalidates badges from the PG source when environment changes and agrees with public rating summaries', async () => {
    env.SITE_ENVIRONMENT = 'development'; env.SITE_TOSS_MODE = 'test';
    paidItem(alice, TARGET_A, 'test');
    const approved = await moderate(await create({ targetId: TARGET_A }));
    expect((await (await guestSend(`/${approved.id}`)).json()).review.purchaseConfirmed).toBe(true);
    expect((await (await commerceSend(`/targets/${TARGET_A}/review-summary`)).json()).purchase.count).toBe(1);
    env.SITE_ENVIRONMENT = 'production';
    expect((await (await guestSend(`/${approved.id}`)).json()).review.purchaseConfirmed).toBe(false);
    expect((await (await guestSend()).json()).reviews[0].purchaseConfirmed).toBe(false);
    const privateReview = (await (await memberSend(`/${approved.id}`)).json()).review;
    expect(privateReview.purchaseConfirmed).toBe(false);
    expect(privateReview.publishedContent.purchaseConfirmed).toBe(false);
    const summary = await (await commerceSend(`/targets/${TARGET_A}/review-summary`)).json();
    expect(summary.purchase.count).toBe(0);
    expect(summary.general.count).toBe(1);
  });
  it('keeps approved target, name, rating and purchase while a different target edit awaits review or is rejected', async () => {
    paidItem();
    let current = await moderate(await create({ targetId: TARGET_A }));
    const edited = await memberSend(`/${current.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_B, rating: 2 }), version: current.version } });
    expect(edited.status).toBe(200);
    current = (await edited.json()).review;
    expect(current).toMatchObject({ targetId: TARGET_B, targetName: '특강 B', rating: 2, purchaseConfirmed: false });
    expect(current.publishedContent).toMatchObject({ targetId: TARGET_A, targetName: '특강 A', rating: 5, purchaseConfirmed: true });
    expect((await (await guestSend(`/${current.id}`)).json()).review).toMatchObject({ targetId: TARGET_A, rating: 5, purchaseConfirmed: true });
    expect((await memberSend('', { method: 'POST', body: { ...fixture({ targetId: TARGET_A }), idempotencyKey: crypto.randomUUID() } })).status).toBe(409);
    current = await moderate(current, 'reject', { reason: '활동명을 확인해주세요.' });
    expect((await (await guestSend(`/${current.id}`)).json()).review.targetId).toBe(TARGET_A);
    expect((await memberSend('', { method: 'POST', body: { ...fixture({ targetId: TARGET_A }), idempotencyKey: crypto.randomUUID() } })).status).toBe(409);
    const revised = await memberSend(`/${current.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_B, rating: 3 }), version: current.version } });
    current = await moderate((await revised.json()).review);
    expect(current.publishedContent).toMatchObject({ targetId: TARGET_B, targetName: '특강 B', rating: 3, purchaseConfirmed: false });
    const publicReview = (await (await guestSend(`/${current.id}`)).json()).review;
    expect(publicReview).toMatchObject({ targetId: TARGET_B, rating: 3, purchaseConfirmed: false });
    const aSummary = await (await commerceSend(`/targets/${TARGET_A}/review-summary`)).json();
    const bSummary = await (await commerceSend(`/targets/${TARGET_B}/review-summary`)).json();
    expect(aSummary.purchase.count).toBe(0);
    expect(bSummary.general).toMatchObject({ count: 1, average: 3 });
  });
  it('uses version CAS for edits and prevents switching into a second existing canonical review', async () => {
    const original = await create({ targetId: TARGET_A });
    const outcomes = await Promise.all([memberSend(`/${original.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_A, rating: 3 }), version: original.version } }),
      memberSend(`/${original.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_A, rating: 4 }), version: original.version } })]);
    expect(outcomes.map(value => value.status).sort()).toEqual([200, 409]);
    await create({ targetId: TARGET_B });
    const current = (await (await memberSend(`/${original.id}`)).json()).review;
    expect((await memberSend(`/${original.id}`, { method: 'PUT', body: { ...fixture({ targetId: TARGET_B }), version: current.version } })).status).toBe(409);
    expect((await (await memberSend(`/${original.id}`)).json()).review.targetId).toBe(TARGET_A);
  });
  it('scrubs deleted text, credentials, facts, member links and reasons while preserving immutable tombstones', async () => {
    const purchase = paidItem();
    const submitted = await create({ targetId: TARGET_A });
    let current = await moderate(submitted);
    database.sqlite.prepare('INSERT INTO site_review_purchase_facts VALUES(?,?,?)').run(current.id, purchase.itemId, new Date().toISOString());
    const originalRow = database.sqlite.prepare('SELECT idempotency_key_hash FROM reviews WHERE id=?').get(current.id);
    current = await moderate(current, 'hide', { reason: '개인정보 포함으로 확인 중입니다.' });
    expect((await memberSend(`/${current.id}`, { method: 'DELETE', body: { version: current.version - 1 } })).status).toBe(409);
    expect((await memberSend(`/${current.id}`, { method: 'DELETE', body: { version: current.version } })).status).toBe(200);
    const deleted = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(current.id);
    for (const field of ['latest_content','published_content','password_hash','password_salt','password_iterations','member_id',
      'latest_rating','published_rating','latest_target_id','published_target_id','latest_purchase_item_id','published_purchase_item_id',
      'moderation_reason','hidden_reason','last_reason']) expect(deleted[field]).toBeNull();
    expect(deleted.idempotency_key_hash).toBe(originalRow.idempotency_key_hash);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_review_purchase_facts WHERE review_id=?').get(current.id).n).toBe(0);
    expect(database.sqlite.prepare('SELECT reason FROM review_moderation_log WHERE review_id=?').all(current.id).every(row => row.reason === null)).toBe(true);
    expect((await memberSend(`/${current.id}`)).status).toBe(404);
    expect((await guestSend(`/${current.id}`)).status).toBe(404);
    expect((await memberSend('', { method: 'POST', body: submitted.input })).status).toBe(410);
    expect(() => database.sqlite.prepare("UPDATE reviews SET status='published' WHERE id=?").run(current.id)).toThrow('review_deleted');
    expect((await guestSend(`/admin/${current.id}/moderate`, { method: 'POST', token: teacher, body: { action: 'restore', version: deleted.version, reason: '다시 공개 시도' } })).status).toBe(404);
    await create({ targetId: TARGET_A });
  });
});

describe('legacy and rated guest compatibility', () => {
  it('requires stars on new full-site guest posts but preserves unrated legacy edits', async () => {
    const { rating, targetId, ...legacy } = fixture();
    const input = { ...legacy, password: PASSWORD, idempotencyKey: crypto.randomUUID() };
    expect((await guestSend('', { method: 'POST', body: input })).status).toBe(400);
    delete env.SITE_SESSION_SECRET;
    const created = await guestSend('', { method: 'POST', body: input });
    expect(created.status).toBe(201);
    const review = (await created.json()).review;
    env.SITE_SESSION_SECRET = SESSION_SECRET;
    const auth = await guestSend(`/${review.id}/auth`, { method: 'POST', body: { password: PASSWORD } });
    const owner = await auth.json();
    expect(owner.review).toMatchObject({ rating: null, targetId: null, purchaseConfirmed: false });
    const edited = await guestSend(`/${review.id}`, { method: 'PUT', token: owner.token,
      body: { ...legacy, rating: null, targetId: null, version: owner.review.version } });
    expect(edited.status).toBe(200);
    expect((await edited.json()).review.rating).toBeNull();
    expect((await memberSend(`/${review.id}`)).status).toBe(404);
  });
  it('publishes guest canonical stars without a purchase badge and keeps metadata scrubbing on delete', async () => {
    paidItem();
    const input = { ...fixture({ targetId: TARGET_A, rating: 4 }), password: PASSWORD, idempotencyKey: crypto.randomUUID() };
    const created = await guestSend('', { method: 'POST', body: input });
    expect(created.status).toBe(201);
    let current = await moderate((await created.json()).review);
    const publicReview = (await (await guestSend(`/${current.id}`)).json()).review;
    expect(publicReview).toMatchObject({ targetId: TARGET_A, targetName: '특강 A', rating: 4, purchaseConfirmed: false });
    expect(database.sqlite.prepare('SELECT member_id,latest_purchase_item_id FROM reviews WHERE id=?').get(current.id)).toEqual({ member_id: null, latest_purchase_item_id: null });
    const auth = await (await guestSend(`/${current.id}/auth`, { method: 'POST', body: { password: PASSWORD } })).json();
    expect((await guestSend(`/${current.id}`, { method: 'PUT', token: auth.token, body: { ...fixture({ targetId: TARGET_A, rating: null }), version: current.version } })).status).toBe(400);
    expect((await guestSend(`/${current.id}`, { method: 'DELETE', token: auth.token, body: { version: current.version } })).status).toBe(200);
    const row = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(current.id);
    for (const field of ['member_id','latest_rating','published_rating','latest_target_id','published_target_id','latest_purchase_item_id','published_purchase_item_id']) expect(row[field]).toBeNull();
    expect((await guestSend(`/${current.id}`)).status).toBe(404);
  });
  it('rejects forged guest purchase metadata and inactive canonical targets', async () => {
    const input = { ...fixture({ targetId: TARGET_A }), password: PASSWORD, idempotencyKey: crypto.randomUUID() };
    for (const patch of [{ purchaseConfirmed: true }, { orderItemId: crypto.randomUUID() }, { targetName: '조작한 특강' }, { memberId: alice.member.id }]) {
      expect((await guestSend('', { method: 'POST', body: { ...input, ...patch } })).status).toBe(400);
    }
    database.sqlite.prepare('UPDATE site_targets SET active=0 WHERE id=?').run(TARGET_A);
    expect((await guestSend('', { method: 'POST', body: input })).status).toBe(400);
  });
});
