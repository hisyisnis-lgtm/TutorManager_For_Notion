import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';
import { maskReviewAuthorName, normalizeReviewTitle } from '../lib/reviews.js';

const SECRET = 'isolated-review-session-secret';
const PEPPER = 'isolated-review-password-secret';
const OFFICIAL = 'https://tiantianchinese.com';
const LOCAL = 'http://localhost:5173';
const PASSWORD = 'isolated-password-42';
const fixture = overrides => ({ nickname: '참여자', password: PASSWORD, experienceType: 'external', activityName: '지역 행사',
  title: '즐거웠던 외부 활동', body: '처음 참여한 외부 활동에서 중국어를 재미있게 배웠습니다. 다음에도 참여하고 싶어요.',
  idempotencyKey: crypto.randomUUID(), ...overrides });
const ctx = { waitUntil: promise => promise.catch(() => {}) };
let database, env, teacher;
const send = (path, { method = 'GET', body, token, origin = OFFICIAL, ip = '198.51.100.12', raw } = {}) => worker.fetch(
  new Request(`https://review-fixture.invalid${path}`, { method,
    headers: { Origin: origin, 'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body || raw ? { body: raw || JSON.stringify(body) } : {}) }), env, ctx);
async function create(overrides) {
  const input = fixture(overrides);
  const response = await send('/reviews', { method: 'POST', body: input });
  expect(response.status).toBe(201);
  return { input, ...(await response.json()).review };
}
async function auth(id, password = PASSWORD, extra = {}) {
  const response = await send(`/reviews/${id}/auth`, { method: 'POST', body: { password }, ...extra });
  return { response, ...(await response.json()) };
}
const moderate = (id, version, action, extras = {}) => send(`/reviews/admin/${id}/moderate`, {
  method: 'POST', token: teacher, origin: LOCAL, body: { version, action, ...extras },
});
const edit = (id, version, token, overrides = {}) => {
  const { password, idempotencyKey, ...content } = fixture();
  return send(`/reviews/${id}`, { method: 'PUT', token, body: { ...content, version, ...overrides } });
};
const approved = async review => {
  const response = await moderate(review.id, review.version, 'approve');
  expect(response.status).toBe(200);
  return (await response.json()).review;
};

beforeEach(async () => {
  database = localD1();
  database.sqlite.exec(readFileSync(new URL('../migrations/0007_reviews.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: database.db, JWT_SECRET: SECRET, REVIEW_PASSWORD_SECRET: PEPPER };
  teacher = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('guest review submission and ownership', () => {
  it('derives a bounded grapheme title for an omitted or blank title and reuses the same submission', async () => {
    const body = '👩‍👩‍👧‍👦가 '.repeat(25).trim(), title = '👩‍👩‍👧‍👦가 '.repeat(20).trim();
    const initial = await create({ title: undefined, body });
    expect(JSON.parse(database.sqlite.prepare('SELECT latest_content FROM reviews WHERE id=?').get(initial.id).latest_content))
      .toMatchObject({ title, body });
    for (const submittedTitle of ['', '  ', title]) {
      const response = await send('/reviews', { method: 'POST', body: { ...initial.input, title: submittedTitle } });
      expect(response.status).toBe(200);
      expect((await response.json()).review.id).toBe(initial.id);
    }
    expect((await send('/reviews', { method: 'POST', body: { ...initial.input, body: `${body} 변경 내용` } })).status).toBe(409);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM reviews').get().n).toBe(1);
    const current = await approved(initial);
    expect(current.title).toBe(title);
    const owner = await auth(initial.id), revisedBody = '수정한 후기 본문입니다.\n\n  새로운 수업 경험을 구체적으로 남겼습니다.';
    const revised = await edit(initial.id, current.version, owner.token, { title: undefined, body: revisedBody });
    expect(revised.status).toBe(200);
    expect((await revised.json()).review.title).toBe('수정한 후기 본문입니다. 새로운 수업 경험을 구체적으로 남겼습니다.');
    expect((await (await send(`/reviews/${initial.id}`)).json()).review).toMatchObject({ title, body });
  });
  it.each(['', '가', ' \n\t '])('uses a safe derived title fallback for too-short helper input: %s', body => {
    expect(normalizeReviewTitle({ body }).title).toBe('수업 후기');
  });
  it('preserves explicit valid titles including internal whitespace and old normalized retry fingerprints', async () => {
    const initial = await create({ title: '  기존  후기 제목  ' });
    const response = await send('/reviews', { method: 'POST', body: { ...initial.input, title: '기존  후기 제목' } });
    expect(response.status).toBe(200);
    const owner = await auth(initial.id);
    expect(owner.review.title).toBe('기존  후기 제목');
    expect((await send('/reviews', { method: 'POST', body: { ...initial.input, title: '' } })).status).toBe(409);
  });
  it('accepts an external participant without a student account and returns only a receipt', async () => {
    const review = await create();
    const row = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(review.id);
    expect(review).toMatchObject({ status: 'pending', version: 1, pendingVersion: 1, publishedVersion: null });
    expect(review).not.toHaveProperty('body');
    expect(row.password_hash).not.toBe(PASSWORD);
    expect(row.password_salt).toHaveLength(22);
    expect(row.password_iterations).toBe(100000);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect((await send('/reviews')).headers.get('Cache-Control')).toContain('no-store');
    expect(await (await send('/reviews')).json()).toEqual({ reviews: [], nextCursor: null });
    expect((await send(`/reviews/${review.id}`)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles parallel/retried submission once and rejects same-key payload changes without granting access', async () => {
    const input = fixture();
    const responses = await Promise.all([send('/reviews', { method: 'POST', body: input }), send('/reviews', { method: 'POST', body: input })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const receipts = await Promise.all(responses.map(response => response.json()));
    expect(receipts[0].review.id).toBe(receipts[1].review.id);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS total FROM reviews').get().total).toBe(1);
    expect((await send('/reviews', { method: 'POST', body: { ...input, body: `${input.body} 변경` } })).status).toBe(409);
    expect((await send('/reviews', { method: 'POST', body: { ...input, password: 'different-password' } })).status).toBe(409);
    expect((await send(`/reviews/${receipts[0].review.id}/manage`, { token: input.idempotencyKey })).status).toBe(401);
    env.JWT_SECRET = 'rotated-session-secret'; // Rotating sessions must not break the independent password or retry key.
    expect((await send('/reviews', { method: 'POST', body: input })).status).toBe(200);
    expect((await auth(receipts[0].review.id)).response.status).toBe(200);
  });

  it('uses grapheme lengths, strict input shapes and actual byte limits', async () => {
    const twoEmoji = '👩‍👩‍👧‍👦👨‍👩‍👦';
    expect((await send('/reviews', { method: 'POST', body: fixture({ nickname: twoEmoji }) })).status).toBe(201);
    for (const patch of [{ nickname: '가' }, { password: 'short' }, { experienceType: 'student' }, { title: '가' }, { body: '너무 짧아요' },
      { activityName: '가'.repeat(61) }, { nickname: '가'.repeat(21) }, { version: 1 }, { studentId: 'private-student' }]) {
      expect((await send('/reviews', { method: 'POST', body: fixture(patch) })).status).toBe(400);
    }
    expect((await send('/reviews', { method: 'POST', raw: '{invalid' })).status).toBe(400);
    expect((await send('/reviews', { method: 'POST', raw: '가'.repeat(50000) })).status).toBe(413);
  });

  it('denies wrong, missing, cross-review and other-domain credentials', async () => {
    const first = await create(), second = await create();
    const owner = await auth(first.id);
    expect(owner.response.status).toBe(200);
    expect(owner.expiresIn).toBe(900);
    expect(owner.response.headers.get('Cache-Control')).toContain('no-store');
    expect(await verifyTypedToken(SECRET, owner.token, 'teacher')).toBeNull();
    expect(await verifyTypedToken(SECRET, owner.token, 'student')).toBeNull();
    expect(await verifyTypedToken(SECRET, owner.token, 'game')).toBeNull();
    expect((await send(`/reviews/${first.id}/manage`)).status).toBe(401);
    expect((await send(`/reviews/${first.id}/manage`, { token: teacher })).status).toBe(401);
    expect((await send(`/reviews/${second.id}/manage`, { token: owner.token })).status).toBe(403);
    expect((await auth(first.id, 'wrong-password')).response.status).toBe(401);
    const nonexistent = await auth(crypto.randomUUID(), 'wrong-password');
    expect(nonexistent.response.status).toBe(401);
    expect(nonexistent.error).toBe('후기 ID 또는 비밀번호를 확인해주세요.');
    expect(owner.review).not.toHaveProperty('password_hash');
    expect((await send('/reviews/admin', { token: owner.token, origin: LOCAL })).status).toBe(401);
  });

  it('limits guessing and new submissions on the server while allowing shared-network participants', async () => {
    const review = await create();
    for (let i = 0; i < 5; i++) expect((await auth(review.id, 'wrong-password')).response.status).toBe(401);
    const limited = (await auth(review.id, 'wrong-password')).response;
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('600');
    expect(limited.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    // Count is shared across Worker invocations through D1, not an isolate variable.
    expect(database.sqlite.prepare('SELECT COUNT(*) AS total FROM security_rate_limits').get().total).toBeGreaterThan(0);
    for (let i = 1; i < 30; i++) expect((await send('/reviews', { method: 'POST', body: fixture() })).status).toBe(201);
    expect((await send('/reviews', { method: 'POST', body: fixture() })).status).toBe(429);
  });
});

describe('review publication, moderation and atomic versions', () => {
  it.each([
    ['최하늘', '최*늘'], ['최늘', '최*'], ['남궁하늘', '남**늘'], ['김', '*'],
    ['  김 \t 하\n늘  ', '김*늘'], ['👩‍👩‍👧‍👦가👨‍👩‍👦', '👩‍👩‍👧‍👦*👨‍👩‍👦'],
    ['최*늘', '최*늘'], ['홍*길동', '홍**동'], ['', '작성자'], [null, '작성자'],
  ])('masks author names by grapheme without exposing more on a repeated pass: %s', (name, expected) => {
    expect(maskReviewAuthorName(name)).toBe(expected);
    if (expected !== '작성자') expect(maskReviewAuthorName(maskReviewAuthorName(name))).toBe(expected);
  });
  it('masks legacy guest names without requiring member tables while retaining private approved snapshots', async () => {
    const initial = await create({ nickname: '최하늘' });
    const current = await approved(initial);
    for (const response of [await send('/reviews'), await send(`/reviews/${initial.id}`)]) {
      expect(response.status).toBe(200);
      const value = await response.json();
      expect((value.review || value.reviews[0]).nickname).toBe('최*늘');
      expect(JSON.stringify(value)).not.toContain('최하늘');
    }
    const owner = await auth(initial.id);
    expect(owner.review.nickname).toBe('최하늘');
    expect(current.publishedContent.nickname).toBe('최하늘');
  });
  it('keeps the approved snapshot through edits and rejections and publishes only an explicitly approved revision', async () => {
    const initial = await create();
    const createdAt = '2026-01-01T00:00:00.000Z';
    database.sqlite.prepare('UPDATE reviews SET created_at=? WHERE id=?').run(createdAt, initial.id);
    let current = await approved(initial);
    const owner = await auth(initial.id);
    expect(owner.review.createdAt).toBe(createdAt);
    expect(current.createdAt).toBe(createdAt);
    expect(current.publishedAt).not.toBe(createdAt);
    expect(current.updatedAt).not.toBe(createdAt);
    const pending = await edit(initial.id, current.version, owner.token, { body: '수정본은 처음 승인된 공개 본문과 다르며 아직 검수받지 않았습니다.' });
    expect(pending.status).toBe(200);
    current = (await pending.json()).review;
    expect(current.createdAt).toBe(createdAt);
    expect(current).toMatchObject({ status: 'published', pendingVersion: 3, publishedVersion: 1, version: 3 });
    expect((await (await send(`/reviews/${initial.id}`)).json()).review.body).toBe(initial.input.body);
    const adminPending = await (await send('/reviews/admin?status=pending', { token: teacher, origin: LOCAL })).json();
    expect(adminPending.counts).toMatchObject({ pending: 1, published: 1 });
    expect(adminPending.reviews[0].body).toBe(current.body);
    expect(adminPending.reviews[0].createdAt).toBe(createdAt);
    expect((await moderate(initial.id, 2, 'approve')).status).toBe(409);
    current = (await (await moderate(initial.id, current.version, 'reject', { reason: '타인의 개인정보를 제거해주세요.' })).json()).review;
    expect(current).toMatchObject({ status: 'published', pendingVersion: null, publishedVersion: 1, version: 4 });
    expect(current.moderationReason).toContain('개인정보');
    expect((await (await send(`/reviews/${initial.id}`)).json()).review.body).toBe(initial.input.body);
    const newBody = '다시 수정한 내용은 개인정보 없이 수업과 활동에서 느낀 경험만 작성했습니다.';
    current = (await (await edit(initial.id, current.version, owner.token, { body: newBody })).json()).review;
    current = await approved(current);
    const publicReview = (await (await send(`/reviews/${initial.id}`)).json()).review;
    expect(publicReview.body).toBe(newBody);
    expect(publicReview).not.toHaveProperty('moderationReason');
    expect(publicReview).not.toHaveProperty('version');
    expect(publicReview).not.toHaveProperty('pendingVersion');
    expect(current.publishedVersion).toBe(5);
    const history = await (await send('/reviews/admin?status=published', { token: teacher, origin: LOCAL })).json();
    expect(history.reviews[0].moderationHistory.map(log => log.action)).toEqual(['approve', 'reject', 'approve']);
    expect(JSON.stringify(history.reviews[0].moderationHistory)).not.toContain(initial.input.body);
  });

  it('requires teacher auth and a reason, handles initial rejection, and records moderation atomically', async () => {
    const initial = await create();
    expect((await moderate(initial.id, 1, 'reject')).status).toBe(400);
    expect((await send(`/reviews/admin/${initial.id}/moderate`, { origin: LOCAL, method: 'POST', body: { action: 'approve', version: 1 } })).status).toBe(401);
    const rejected = (await (await moderate(initial.id, 1, 'reject', { reason: '관련 경험을 구체적으로 작성해주세요.' })).json()).review;
    expect(rejected.status).toBe('rejected');
    expect((await send(`/reviews/${initial.id}`)).status).toBe(404);
    const logs = database.sqlite.prepare('SELECT * FROM review_moderation_log').all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ version: 2, content_version: 1, action: 'reject', actor: 'teacher' });
    expect((await moderate(initial.id, 1, 'approve')).status).toBe(409);
    expect(database.sqlite.prepare('SELECT COUNT(*) AS total FROM review_moderation_log').get().total).toBe(1);
  });

  it('keeps privacy-hidden originals unavailable until a replacement is approved', async () => {
    const initial = await create();
    let current = await approved(initial);
    current = (await (await moderate(initial.id, current.version, 'hide', { reason: '공개 본문에 개인정보가 있습니다.' })).json()).review;
    expect(current).toMatchObject({ status: 'hidden', restoreAllowed: false });
    expect((await send(`/reviews/${initial.id}`)).status).toBe(404);
    expect((await moderate(initial.id, current.version, 'restore', { reason: '복원 시도 사유' })).status).toBe(409);
    const owner = await auth(initial.id);
    current = (await (await edit(initial.id, current.version, owner.token, { body: '개인정보를 제거한 후기입니다. 외부 활동의 수업 경험이 유익했고 재미있었습니다.' })).json()).review;
    expect(current.status).toBe('hidden');
    expect(current.pendingVersion).not.toBeNull();
    expect((await send(`/reviews/${initial.id}`)).status).toBe(404);
    current = await approved(current);
    expect(current.status).toBe('published');
    expect((await send(`/reviews/${initial.id}`)).status).toBe(200);
  });

  it('allows a safe temporary hide to be restored with an explicit resolution reason', async () => {
    let current = await approved(await create());
    current = (await (await moderate(current.id, current.version, 'hide', { reason: '일시 운영 확인', allowRestore: true })).json()).review;
    expect(current.restoreAllowed).toBe(true);
    expect((await moderate(current.id, current.version, 'restore')).status).toBe(400);
    current = (await (await moderate(current.id, current.version, 'restore', { reason: '확인을 완료했습니다.' })).json()).review;
    expect(current).toMatchObject({ status: 'published', restoreAllowed: false, moderationReason: null });
    expect(database.sqlite.prepare("SELECT reason FROM review_moderation_log WHERE action='restore'").get().reason).toBe('확인을 완료했습니다.');
  });

  it('blocks restoration with a current version while a hidden replacement is pending', async () => {
    let current = await approved(await create());
    current = (await (await moderate(current.id, current.version, 'hide', { reason: '일시 확인 중입니다.', allowRestore: true })).json()).review;
    const owner = await auth(current.id);
    current = (await (await edit(current.id, current.version, owner.token, { title: '검수 대기 중인 새 제목' })).json()).review;
    expect(current).toMatchObject({ status: 'hidden', restoreAllowed: true });
    expect(current.pendingVersion).not.toBeNull();
    expect((await moderate(current.id, current.version, 'restore', { reason: '확인을 완료했습니다.' })).status).toBe(409);
    expect((await send(`/reviews/${current.id}`)).status).toBe(404);
  });

  it('commits only one competing edit and rejects edit/approval races on the same version', async () => {
    const initial = await create(), owner = await auth(initial.id);
    const edits = await Promise.all([edit(initial.id, 1, owner.token, { title: '첫 번째 수정' }), edit(initial.id, 1, owner.token, { title: '두 번째 수정' })]);
    expect(edits.map(response => response.status).sort()).toEqual([200, 409]);
    const row = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(initial.id);
    expect(row.version).toBe(2);
    const competing = await Promise.all([edit(initial.id, 2, owner.token), moderate(initial.id, 2, 'approve')]);
    expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
    expect(database.sqlite.prepare('SELECT version FROM reviews WHERE id=?').get(initial.id).version).toBe(3);
  });

  it('irreversibly deletes all current/approved text, credentials and audit reasons, denying stale tokens and retries', async () => {
    const initial = await create();
    let current = await approved(initial);
    current = (await (await moderate(initial.id, current.version, 'hide', { reason: '이 사유에도 개인정보가 있을 수 있습니다.', allowRestore: true })).json()).review;
    const owner = await auth(initial.id);
    current = (await (await edit(initial.id, current.version, owner.token)).json()).review;
    const response = await send(`/reviews/${initial.id}`, { method: 'DELETE', token: owner.token, body: { version: current.version } });
    expect(response.status).toBe(200);
    const row = database.sqlite.prepare('SELECT * FROM reviews WHERE id=?').get(initial.id);
    expect(row).toMatchObject({ status: 'deleted', latest_content: null, published_content: null,
      password_salt: null, password_hash: null, password_iterations: null, moderation_reason: null, hidden_reason: null, last_reason: null });
    expect(database.sqlite.prepare('SELECT reason FROM review_moderation_log WHERE review_id=?').all(initial.id).every(log => log.reason === null)).toBe(true);
    expect((await send(`/reviews/${initial.id}`)).status).toBe(404);
    expect((await send(`/reviews/${initial.id}/manage`, { token: owner.token })).status).toBe(404);
    expect((await auth(initial.id)).response.status).toBe(401);
    expect((await edit(initial.id, current.version, owner.token)).status).toBe(404);
    expect((await moderate(initial.id, current.version, 'approve')).status).toBe(404);
    expect((await moderate(initial.id, row.version, 'restore', { reason: '삭제 이후 복원 시도' })).status).toBe(404);
    expect((await send('/reviews', { method: 'POST', body: initial.input })).status).toBe(410);
    expect(() => database.sqlite.prepare("UPDATE reviews SET status='published' WHERE id=?").run(initial.id)).toThrow('review_deleted');
    expect((await (await send('/reviews/admin', { token: teacher, origin: LOCAL })).json()).counts.pending).toBe(0);
  });
});

describe('review query boundaries and storage availability', () => {
  function seedPublished({ rating = null, at = '2026-10-06T00:00:00.000Z', updatedAt = at } = {}) {
    const id = crypto.randomUUID(), { password, idempotencyKey, ...content } = fixture({ rating });
    database.sqlite.prepare(`INSERT INTO reviews (id, latest_content, published_content, status, version, published_version,
      created_at, updated_at, published_at, approved_at, idempotency_key_hash, request_hash, request_expires_at)
      VALUES (?, ?, ?, 'published', 2, 1, ?, ?, ?, ?, ?, 'synthetic', 9999999999)`)
      .run(id, JSON.stringify(content), JSON.stringify(content), at, updatedAt, at, at, idempotencyKey);
    return { id, rating, at };
  }
  it('orders legacy guest reviews by approved rating, publication date and id across every page, with unrated reviews last', async () => {
    const seeded = Array.from({ length: 55 }, (_, index) => seedPublished({
      rating: index < 25 ? 5 - index % 5 : null,
      at: `2026-10-0${6 + index % 3}T00:00:00.000Z`,
    }));
    const expected = seeded.toSorted((a, b) => (b.rating || 0) - (a.rating || 0)
      || b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const listed = [], cursors = [];
    let cursor;
    do {
      const response = await send(`/reviews${cursor ? `?cursor=${cursor}` : ''}`);
      expect(response.status).toBe(200);
      const page = await response.json();
      listed.push(...page.reviews);
      cursor = page.nextCursor;
      if (cursor) cursors.push(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } while (cursor);
    expect(listed.map(review => review.id)).toEqual(expected.map(review => review.id));
    expect(listed.map(review => review.rating)).toEqual(expected.map(review => review.rating));
    expect(new Set(listed.map(review => review.id)).size).toBe(55);
    expect(cursors.at(-1)).toMatchObject({ sort: 'rating', rating: 0 });
    expect(listed.slice(25).every(review => review.rating === null)).toBe(true);
  });
  it('rejects obsolete or invalid public sort cursors with a refresh instruction', async () => {
    const valid = { sort: 'rating', rating: 3, at: '2026-10-06T00:00:00.000Z', id: crypto.randomUUID() };
    const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const value of [
      { at: valid.at, id: valid.id }, { ...valid, sort: 'date' }, { ...valid, rating: undefined },
      { ...valid, rating: null }, { ...valid, rating: '3' }, { ...valid, rating: 2.5 },
      { ...valid, rating: -1 }, { ...valid, rating: 6 }, { ...valid, at: '2026-02-30T00:00:00.000Z' },
      { ...valid, at: '2026-13-06T00:00:00.000Z' }, { ...valid, id: 'not-a-review' },
      { ...valid, extra: 'unsupported' }, null, [],
    ]) {
      const response = await send(`/reviews?cursor=${encodeCursor(value)}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: '후기 목록을 새로고침해주세요.' });
    }
    for (const rating of [0, 1, 5]) expect((await send(`/reviews?cursor=${encodeCursor({ ...valid, rating })}`)).status).toBe(200);
  });
  it('keeps administrator publication lists in update order and accepts their original date cursor', async () => {
    const low = seedPublished({ rating: 1, updatedAt: '2026-10-08T00:00:00.000Z' });
    const high = seedPublished({ rating: 5, updatedAt: '2026-10-07T00:00:00.000Z' });
    const publicPage = await (await send('/reviews')).json();
    expect(publicPage.reviews.map(review => review.id)).toEqual([high.id, low.id]);
    const options = { token: teacher, origin: LOCAL };
    const adminPage = await (await send('/reviews/admin?status=published', options)).json();
    expect(adminPage.reviews.map(review => review.id)).toEqual([low.id, high.id]);
    const cursor = Buffer.from(JSON.stringify({ at: '2026-10-08T00:00:00.000Z', id: low.id })).toString('base64url');
    const nextPage = await (await send(`/reviews/admin?status=published&cursor=${cursor}`, options)).json();
    expect(nextPage.reviews.map(review => review.id)).toEqual([high.id]);
  });
  it('paginates equal timestamps without duplicates and rejects malformed cursors', async () => {
    const timestamp = '2026-10-06T00:00:00.000Z';
    for (let i = 0; i < 23; i++) {
      const { password, idempotencyKey, ...content } = fixture({ title: `공개 후기 ${i}` });
      database.sqlite.prepare(`INSERT INTO reviews (id, latest_content, published_content, status, version, published_version,
        created_at, updated_at, published_at, approved_at, idempotency_key_hash, request_hash, request_expires_at)
        VALUES (?, ?, ?, 'published', 2, 1, ?, ?, ?, ?, ?, 'synthetic', 9999999999)`)
        .run(crypto.randomUUID(), JSON.stringify(content), JSON.stringify(content), timestamp, timestamp, timestamp, timestamp, idempotencyKey);
    }
    const page1 = await (await send('/reviews')).json();
    expect(page1.reviews).toHaveLength(20);
    expect(page1.nextCursor).toBeTypeOf('string');
    const page2 = await (await send(`/reviews?cursor=${page1.nextCursor}`)).json();
    expect(page2.reviews).toHaveLength(3);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.reviews, ...page2.reviews].map(review => review.id)).size).toBe(23);
    expect((await send('/reviews?cursor=invalid')).status).toBe(400);
    expect((await send('/reviews?status=pending')).status).toBe(400);
  });

  it('allows official guest routes on success/errors/preflight, keeps admin and personal origins closed', async () => {
    const initial = await create();
    for (const path of ['/reviews', `/reviews/${initial.id}`, `/reviews/${initial.id}/manage`, `/reviews/${initial.id}/auth`]) {
      for (const method of ['GET', 'OPTIONS']) {
        const response = await send(path, { method });
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(OFFICIAL);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
      }
    }
    for (const path of ['/reviews/admin', `/reviews/admin/${initial.id}/moderate`, '/personal/auth/request', '/personal/ABCDEF123456']) {
      expect((await send(path)).status).toBe(403);
      expect((await send(path, { method: 'OPTIONS' })).headers.get('Access-Control-Allow-Origin')).not.toBe(OFFICIAL);
    }
    expect((await send('/reviews', { origin: 'https://untrusted.invalid' })).status).toBe(403);
    expect((await send('/reviews/admin', { token: teacher, origin: LOCAL })).status).toBe(200);
  });

  it('fails closed with safe, CORS-compatible responses when configuration or migration is unavailable', async () => {
    delete env.REVIEW_PASSWORD_SECRET;
    let response = await send('/reviews');
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(OFFICIAL);
    env.REVIEW_PASSWORD_SECRET = PEPPER;
    database.sqlite.exec('DROP TABLE reviews');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    response = await send('/reviews');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.text()).not.toMatch(/SELECT|sqlite|latest_content/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
