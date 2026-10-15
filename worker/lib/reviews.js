import { z } from 'zod';
import { base64url, signTypedToken, verifyTypedToken } from './auth.js';
import { rateLimitCheck } from './securityStore.js';

const encoder = new TextEncoder();
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const REVIEW_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ITERATIONS = 100_000; // Conservative native Worker KDF cost; an independent secret peppers the verifier.
const SESSION_SECONDS = 15 * 60;
const RETRY_SECONDS = 24 * 60 * 60;
const PAGE_SIZE = 20;
const textLength = value => Array.from(segmenter.segment(value)).length;
const textField = (min, max, label, trim = true) => (trim ? z.string().trim() : z.string())
  .refine(value => textLength(value) >= min && textLength(value) <= max, `${label}: ${min}~${max}자로 입력해주세요.`);
const contentShape = {
  nickname: textField(2, 20, '닉네임'),
  experienceType: z.enum(['class', 'special', 'external', 'other']),
  activityName: textField(0, 60, '수업·활동명').optional().default(''),
  title: z.string().trim().refine(value => !value || textLength(value) >= 2 && textLength(value) <= 60,
    '제목: 2~60자로 입력해주세요.').default(''),
  body: textField(20, 2000, '후기'),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  targetId: z.string().uuid().nullable().optional(),
};
const passwordSchema = textField(8, 64, '비밀번호', false);
const versionSchema = z.number().int().positive().safe();
const createSchema = z.object({ ...contentShape, password: passwordSchema,
  idempotencyKey: z.string().uuid() }).strict();
const editSchema = z.object({ ...contentShape, version: versionSchema }).strict();
const deleteSchema = z.object({ version: versionSchema }).strict();
const authSchema = z.object({ password: passwordSchema }).strict();
const moderateSchema = z.object({ action: z.enum(['approve', 'reject', 'hide', 'restore']), version: versionSchema,
  reason: textField(0, 500, '처리 사유').optional().default(''), allowRestore: z.boolean().optional().default(false) }).strict()
  .refine(value => !['reject', 'hide', 'restore'].includes(value.action) || textLength(value.reason) >= 2,
    '반려·숨김·복원 사유를 2자 이상 입력해주세요.');

export function normalizeReviewTitle(content) {
  if (content.title) return content;
  const text = (content.body || '').replace(/\s+/gu, ' ').trim();
  const title = Array.from(segmenter.segment(text), part => part.segment).slice(0, 60).join('').trim();
  return { ...content, title: textLength(title) >= 2 ? title : '수업 후기' };
}

export function isGuestReviewPath(path) {
  if (path === '/reviews') return true;
  const match = path.match(/^\/reviews\/([^/]+)(?:\/(auth|manage))?$/);
  return !!match && REVIEW_ID.test(match[1]);
}

function json(cors, value, status = 200, extraHeaders = {}) {
  return Response.json(value, { status, headers: { ...cors, 'Cache-Control': 'private, no-store', ...extraHeaders } });
}
const fail = (cors, status, error) => json(cors, { error }, status);
const bearer = request => request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1] || '';

async function readBody(request, schema, cors) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  return parsed.success ? { value: parsed.data } : { error: fail(cors, 400, parsed.error.issues[0]?.message || '입력값을 확인해주세요.') };
}

async function secretKey(secret, domain, usages) {
  // Domain separation also keeps this pepper independent of token signatures.
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, encoder.encode(`reviews/v1/${domain}`));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function keyedHash(secret, domain, text) {
  const key = await secretKey(secret, domain, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))));
}
function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(salt), iterations, hash: 'SHA-256' }, key, 256);
}

export async function hashReviewPassword(password, secret, salt = base64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const bits = await derivePassword(password, salt, ITERATIONS);
  const key = await secretKey(secret, 'password-pepper', ['sign']);
  return { salt, iterations: ITERATIONS, hash: base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, bits))) };
}
async function verifyPassword(password, secret, row) {
  // Deleted/nonexistent IDs perform the same KDF, never exposing private existence.
  const salt = row?.password_salt || 'AAAAAAAAAAAAAAAAAAAAAA';
  const iterations = row?.password_iterations || ITERATIONS;
  const bits = await derivePassword(password, salt, iterations);
  const key = await secretKey(secret, 'password-pepper', ['verify']);
  return await crypto.subtle.verify('HMAC', key, decode(row?.password_hash || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), bits)
    && row?.status !== 'deleted' && !!row?.password_hash;
}

function contentDto(row, published = false) {
  const content = JSON.parse(published ? row.published_content : row.latest_content);
  return { id: row.id, ...content, ...reviewFacts(row, content, published) };
}
function reviewFacts(row, content, published = false) {
  const prefix = published ? 'published' : 'latest';
  return {
    rating: row[`${prefix}_rating`] === undefined ? content.rating ?? null : row[`${prefix}_rating`],
    targetId: row[`${prefix}_target_id`] === undefined ? content.targetId ?? null : row[`${prefix}_target_id`],
    targetName: typeof content.targetName === 'string' ? content.targetName : null,
    // Neither submitted text nor client-supplied metadata can assert a purchase.
    purchaseConfirmed: row[`${prefix}_purchase_verified`] === true,
  };
}
export function maskReviewAuthorName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, '') : '';
  const parts = Array.from(segmenter.segment(name), part => part.segment);
  if (!parts.length) return '작성자';
  if (parts.length === 1) return '*';
  if (parts.length === 2) return `${parts[0]}*`;
  return `${parts[0]}${'*'.repeat(parts.length - 2)}${parts.at(-1)}`;
}
function publicDto(row) {
  const content = contentDto(row, true);
  const nickname = row.member_id
    ? row.public_author_name?.trim() ? maskReviewAuthorName(row.public_author_name) : '회원'
    : maskReviewAuthorName(content.nickname);
  return { ...content, nickname, publishedAt: row.published_at, updatedAt: row.approved_at };
}

async function loadPublicReviewAuthorNames(db, rows) {
  const ids = [...new Set(rows.map(row => row.member_id).filter(Boolean))];
  // The legacy guest-only schema has neither member_id nor site_members.
  if (!ids.length) return rows;
  const result = await db.prepare(`SELECT id,name FROM site_members WHERE id IN (${ids.map((_, index) => `?${index + 1}`).join(',')})`)
    .bind(...ids).all();
  const names = new Map((result.results || []).map(row => [row.id, row.name]));
  return rows.map(row => ({ ...row, public_author_name: names.get(row.member_id) || '' }));
}
function privateDto(row) {
  return { ...contentDto(row), status: row.status, version: row.version,
    authorType: row.member_id ? 'member' : 'guest',
    pendingVersion: row.pending_version, publishedVersion: row.published_version,
    moderationReason: row.status === 'hidden' ? row.hidden_reason : row.moderation_reason,
    hiddenReason: row.hidden_reason, restoreAllowed: !!row.restore_allowed,
    createdAt: row.created_at, publishedAt: row.published_at, updatedAt: row.updated_at,
    publishedContent: row.published_content
      ? { ...JSON.parse(row.published_content), ...reviewFacts(row, JSON.parse(row.published_content), true) } : null,
  };
}
const receiptDto = row => ({ id: row.id, status: row.status, version: row.version,
  pendingVersion: row.pending_version, publishedVersion: row.published_version, updatedAt: row.updated_at });
const getRow = (db, id) => db.prepare('SELECT * FROM reviews WHERE id=?1').bind(id).first();

export async function loadReviewPurchaseFacts(db, env, rows) {
  const memberRows = rows.filter(row => row.member_id && (row.latest_purchase_item_id || row.published_purchase_item_id));
  if (!memberRows.length) return rows; // Legacy 0007-only guest rows never query website commerce tables.
  const ids = [...new Set(memberRows.flatMap(row => [row.latest_purchase_item_id, row.published_purchase_item_id]).filter(Boolean))];
  const environment = env.SITE_ENVIRONMENT === 'development' && env.SITE_TOSS_MODE === 'test' ? 'test' : 'live';
  const result = await db.prepare(`SELECT oi.id,oi.target_id,o.member_id,p.pg_environment,p.approved_at
    FROM site_order_items oi JOIN site_orders o ON o.id=oi.order_id JOIN site_payments p ON p.order_id=o.id
    WHERE oi.id IN (${ids.map((_, index) => `?${index + 1}`).join(',')})`).bind(...ids).all();
  const proofs = new Map(result.results.map(row => [row.id, row]));
  return rows.map(row => {
    const verified = prefix => {
      const proof = proofs.get(row[`${prefix}_purchase_item_id`]);
      return !!proof && proof.member_id === row.member_id && proof.target_id === row[`${prefix}_target_id`]
        && proof.pg_environment === environment && !!proof.approved_at && Number.isFinite(Date.parse(proof.approved_at));
    };
    return { ...row, latest_purchase_verified: verified('latest'), published_purchase_verified: verified('published') };
  });
}
const verifiedPrivateDto = async (db, env, row) => privateDto((await loadReviewPurchaseFacts(db, env, [row]))[0]);

function cursorValue(raw, cors, ratingSort = false) {
  if (!raw) return { value: null };
  try {
    if (raw.length > 300 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value = JSON.parse(new TextDecoder().decode(decode(raw)));
    if (typeof value.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at) || !REVIEW_ID.test(value.id)) throw new Error();
    if (ratingSort && (value.sort !== 'rating' || !Number.isInteger(value.rating) || value.rating < 0 || value.rating > 5
      || new Date(value.at).toISOString() !== value.at
      || Object.keys(value).some(key => !['sort', 'rating', 'at', 'id'].includes(key)))) throw new Error();
    return { value };
  } catch { return { error: fail(cors, 400, ratingSort ? '후기 목록을 새로고침해주세요.' : '목록 조회 위치를 확인해주세요.') }; }
}
function nextCursor(rows, dateColumn, ratingSort = false) {
  if (rows.length <= PAGE_SIZE) return null;
  const last = rows[PAGE_SIZE - 1];
  return base64url(encoder.encode(JSON.stringify({ at: last[dateColumn], id: last.id,
    ...(ratingSort ? { sort: 'rating', rating: last.public_sort_rating } : {}) })));
}
async function enforceRate(request, env, cors, key, limit, window) {
  if (await rateLimitCheck(env, key, limit, window)) return null;
  return json(cors, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, 429,
    { 'Retry-After': String(window), 'Access-Control-Expose-Headers': 'Retry-After' });
}
async function ownerAccess(request, env, id, cors) {
  const claim = await verifyTypedToken(env.JWT_SECRET, bearer(request), 'review');
  if (!claim) return fail(cors, 401, '후기 관리 권한이 만료되었거나 없습니다. 비밀번호를 다시 확인해주세요.');
  if (claim.sub !== `review:${id}`) return fail(cors, 403, '해당 후기를 관리할 권한이 없습니다.');
  return null;
}
async function conflict(db, id, cors) {
  const current = await getRow(db, id);
  return fail(cors, current && current.status !== 'deleted' ? 409 : 404,
    current && current.status !== 'deleted' ? '후기가 변경되었습니다. 새로 조회한 뒤 다시 시도해주세요.' : '후기를 찾을 수 없습니다.');
}

async function listReviews(db, env, url, cors, admin = false) {
  const cursor = cursorValue(url.searchParams.get('cursor'), cors, !admin);
  if (cursor.error) return cursor.error;
  const status = url.searchParams.get('status') || 'pending';
  if (admin && !['pending', 'published', 'rejected', 'hidden'].includes(status)) return fail(cors, 400, '검수 상태를 확인해주세요.');
  if ([...url.searchParams.keys()].some(key => !['cursor', ...(admin ? ['status'] : [])].includes(key))) return fail(cors, 400, '조회 조건을 확인해주세요.');
  const dateColumn = admin ? 'updated_at' : 'published_at';
  const conditions = admin ? (status === 'pending' ? "pending_version IS NOT NULL AND status != 'deleted'" : 'status=?1')
    : "status='published' AND published_content IS NOT NULL";
  const params = admin && status !== 'pending' ? [status] : [];
  let ratingExpression;
  if (!admin) {
    // Guest-only installations can still have the original 0007 schema.
    const columns = await db.prepare('PRAGMA table_info(reviews)').all();
    const ratingColumn = columns.results.some(column => column.name === 'published_rating')
      ? 'published_rating' : "json_extract(published_content, '$.rating')";
    ratingExpression = `COALESCE(${ratingColumn}, 0)`;
  }
  let position = '';
  if (cursor.value) {
    const at = params.push(cursor.value.at), id = params.push(cursor.value.id);
    const datePosition = `(${dateColumn} < ?${at} OR (${dateColumn} = ?${at} AND id < ?${id}))`;
    if (admin) position = ` AND ${datePosition}`;
    else {
      const rating = params.push(cursor.value.rating);
      position = ` AND (${ratingExpression} < ?${rating} OR (${ratingExpression} = ?${rating} AND ${datePosition}))`;
    }
  }
  const select = admin ? '*' : `*, ${ratingExpression} AS public_sort_rating`;
  const order = `${admin ? '' : 'public_sort_rating DESC, '}${dateColumn} DESC, id DESC`;
  const result = await db.prepare(`SELECT ${select} FROM reviews WHERE ${conditions}${position} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1}`).bind(...params).all();
  const verifiedRows = await loadReviewPurchaseFacts(db, env, result.results || []);
  const rows = admin ? verifiedRows : await loadPublicReviewAuthorNames(db, verifiedRows);
  const value = { reviews: rows.slice(0, PAGE_SIZE).map(admin ? privateDto : publicDto), nextCursor: nextCursor(rows, dateColumn, !admin) };
  if (admin) {
    value.counts = await db.prepare(`SELECT
      SUM(CASE WHEN pending_version IS NOT NULL THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status='hidden' THEN 1 ELSE 0 END) AS hidden
      FROM reviews WHERE status != 'deleted'`).first();
    for (const key of Object.keys(value.counts)) value.counts[key] = Number(value.counts[key] || 0);
    if (value.reviews.length) {
      const ids = value.reviews.map(review => review.id);
      const logs = await db.prepare(`SELECT review_id, version, content_version AS contentVersion, action, reason, actor, created_at AS createdAt
        FROM review_moderation_log WHERE review_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')}) ORDER BY id DESC LIMIT 400`).bind(...ids).all();
      for (const review of value.reviews) review.moderationHistory = logs.results.filter(log => log.review_id === review.id).slice(0, 20)
        .map(({ review_id, ...log }) => log);
    }
  }
  return json(cors, value);
}

async function createReview(request, env, db, cors, ip) {
  const body = await readBody(request, createSchema, cors);
  if (body.error) return body.error;
  const { password, idempotencyKey, ...submitted } = body.value;
  const content = normalizeReviewTitle(submitted);
  if (env.SITE_SESSION_SECRET && content.rating == null) return fail(cors, 400, '별점을 선택해주세요.');
  const hasFacts = content.rating !== undefined || content.targetId !== undefined;
  const keyHash = await keyedHash(env.REVIEW_PASSWORD_SECRET, 'idempotency-key', idempotencyKey);
  // Never create a fast password verifier inside the retry fingerprint.
  const requestHash = await keyedHash(env.REVIEW_PASSWORD_SECRET, 'submission-payload', JSON.stringify(content));
  const existing = await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first();
  const retryResult = async row => {
    if (row.request_hash !== requestHash) return fail(cors, 409, '같은 제출 식별값에 다른 내용이 있습니다. 새 작성으로 제출해주세요.');
    if (row.status === 'deleted') return fail(cors, 410, '삭제한 후기의 제출 요청은 다시 사용할 수 없습니다.');
    if (row.request_expires_at <= Math.floor(Date.now() / 1000)) return fail(cors, 409, '제출 재시도 기간이 지났습니다. 새 작성으로 제출해주세요.');
    const retryLimit = await enforceRate(request, env, cors, `reviews:retry:${row.id}:${ip}`, 5, 600);
    if (retryLimit) return retryLimit;
    const reviewLimit = await enforceRate(request, env, cors, `reviews:auth-review:${row.id}`, 30, 600);
    if (reviewLimit) return reviewLimit;
    if (!(await verifyPassword(password, env.REVIEW_PASSWORD_SECRET, row))) return fail(cors, 409, '같은 제출 식별값에 다른 내용이 있습니다. 새 작성으로 제출해주세요.');
    const current = await getRow(db, row.id);
    if (!current || current.status === 'deleted') return fail(cors, 410, '삭제한 후기의 제출 요청은 다시 사용할 수 없습니다.');
    return json(cors, { review: receiptDto(current) });
  };
  if (existing) return await retryResult(existing);
  if (content.targetId) {
    const target = await db.prepare('SELECT id,name FROM site_targets WHERE id=?1 AND active=1').bind(content.targetId).first();
    if (!target) return fail(cors, 400, '작성할 수업·특강 대상을 확인해주세요.');
    content.targetName = target.name;
  } else if (hasFacts) content.targetName = null;
  const limited = await enforceRate(request, env, cors, `reviews:create:${ip}`, 30, 3600);
  if (limited) return limited;
  const credential = await hashReviewPassword(password, env.REVIEW_PASSWORD_SECRET);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = await db.prepare(`INSERT INTO reviews (id, password_salt, password_hash, password_iterations, latest_content,
    pending_version, created_at, updated_at, idempotency_key_hash, request_hash, request_expires_at
    ${hasFacts ? ',latest_rating,latest_target_id,latest_purchase_item_id' : ''})
    VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, ?9${hasFacts ? ',?10,?11,NULL' : ''})
    ON CONFLICT(idempotency_key_hash) DO NOTHING RETURNING *`).bind(id, credential.salt, credential.hash,
      credential.iterations, JSON.stringify(content), now, keyHash, requestHash, Math.floor(Date.now() / 1000) + RETRY_SECONDS,
      ...(hasFacts ? [content.rating ?? null, content.targetId ?? null] : [])).first();
  return row ? json(cors, { review: receiptDto(row) }, 201) : await retryResult(await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first());
}

export const listAdminReviews = (db, env, url, cors = {}) => listReviews(db, env, url, cors, true);

export async function getAdminReview(db, env, id, cors = {}) {
  const row = await getRow(db, id);
  if (!row || row.status === 'deleted') return fail(cors, 404, '후기를 찾을 수 없습니다.');
  const review = await verifiedPrivateDto(db, env, row);
  const logs = await db.prepare(`SELECT version,content_version AS contentVersion,action,reason,actor,created_at AS createdAt
    FROM review_moderation_log WHERE review_id=?1 ORDER BY id DESC LIMIT 20`).bind(id).all();
  review.moderationHistory = logs.results || [];
  return json(cors, { review });
}

export async function moderateReview(request, env, db, id, cors = {}, { authorize } = {}) {
  const body = await readBody(request, moderateSchema, cors);
  if (body.error) return body.error;
  // Website sessions may be revoked while a streamed body is being read.
  if (authorize) {
    const denied = await authorize(request, env, cors);
    if (denied !== null) return denied instanceof Response ? denied : fail(cors, 401, '관리자 로그인이 필요합니다.');
  }
  const { action, version, reason, allowRestore } = body.value;
  const now = new Date().toISOString();
  const common = "version=version+1, updated_at=?3, last_action=?4, last_actor='teacher', last_reason=?5";
  const updates = {
    approve: "status='published', published_content=latest_content, published_version=pending_version, pending_version=NULL, moderation_reason=NULL, hidden_reason=NULL, restore_allowed=0, published_at=COALESCE(published_at, ?3), approved_at=?3",
    reject: "status=CASE WHEN status='hidden' THEN 'hidden' WHEN published_content IS NOT NULL THEN 'published' ELSE 'rejected' END, pending_version=NULL, moderation_reason=?5",
    hide: "status='hidden', moderation_reason=?5, hidden_reason=?5, restore_allowed=?6",
    restore: "status='published', moderation_reason=NULL, hidden_reason=NULL, restore_allowed=0",
  };
  const gates = {
    approve: 'pending_version IS NOT NULL', reject: 'pending_version IS NOT NULL',
    hide: "status='published' AND published_content IS NOT NULL",
    restore: "status='hidden' AND published_content IS NOT NULL AND restore_allowed=1 AND pending_version IS NULL",
  };
  const params = [id, version, now, action, reason];
  if (action === 'hide') params.push(allowRestore ? 1 : 0);
  const row = await db.prepare(`UPDATE reviews SET ${updates[action]}, ${common}
    WHERE id=?1 AND version=?2 AND status != 'deleted' AND ${gates[action]} RETURNING *`).bind(...params).first();
  // SQLite/D1 RETURNING precedes AFTER-trigger copies of approved metadata.
  return row ? await getAdminReview(db, env, id, cors) : conflict(db, id, cors);
}

export async function handleReviewRoutes(request, env, cors, { authorizeTeacher }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!env.GAME_DB || !env.JWT_SECRET || !env.REVIEW_PASSWORD_SECRET) return fail(cors, 503, '후기 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요.');
  const db = env.GAME_DB;
  try {
    const limited = await enforceRate(request, env, cors, `reviews:request:${ip}`, 120, 60);
    if (limited) return limited;
    if (path === '/reviews/admin' || path.startsWith('/reviews/admin/')) {
      const denied = await authorizeTeacher(request, env, cors);
      if (denied) return denied;
      if (path === '/reviews/admin') return request.method === 'GET' ? await listAdminReviews(db, env, url, cors) : fail(cors, 405, '지원하지 않는 요청입니다.');
      const match = path.match(/^\/reviews\/admin\/([^/]+)\/moderate$/);
      if (!match || !REVIEW_ID.test(match[1])) return fail(cors, 404, '후기를 찾을 수 없습니다.');
      return request.method === 'POST' ? await moderateReview(request, env, db, match[1], cors) : fail(cors, 405, '지원하지 않는 요청입니다.');
    }
    if (path === '/reviews') {
      if (request.method === 'GET') return await listReviews(db, env, url, cors);
      if (request.method === 'POST') return await createReview(request, env, db, cors, ip);
      return fail(cors, 405, '지원하지 않는 요청입니다.');
    }
    const match = path.match(/^\/reviews\/([^/]+)(?:\/(auth|manage))?$/);
    if (!match || !REVIEW_ID.test(match[1])) return fail(cors, 404, '후기를 찾을 수 없습니다.');
    const [, id, operation] = match;
    if (operation === 'auth') {
      if (request.method !== 'POST') return fail(cors, 405, '지원하지 않는 요청입니다.');
      const body = await readBody(request, authSchema, cors);
      if (body.error) return body.error;
      const limitedIp = await enforceRate(request, env, cors, `reviews:auth-ip:${ip}`, 30, 600);
      if (limitedIp) return limitedIp;
      const limitedId = await enforceRate(request, env, cors, `reviews:auth:${id}:${ip}`, 5, 600);
      if (limitedId) return limitedId;
      const limitedReview = await enforceRate(request, env, cors, `reviews:auth-review:${id}`, 30, 600);
      if (limitedReview) return limitedReview;
      const row = await getRow(db, id);
      if (!(await verifyPassword(body.value.password, env.REVIEW_PASSWORD_SECRET, row))) return fail(cors, 401, '후기 ID 또는 비밀번호를 확인해주세요.');
      const token = await signTypedToken(env.JWT_SECRET, 'review', `review:${id}`, SESSION_SECONDS);
      const current = await getRow(db, id);
      if (!current || current.status === 'deleted') return fail(cors, 401, '후기 ID 또는 비밀번호를 확인해주세요.');
      return json(cors, { token, expiresIn: SESSION_SECONDS, review: await verifiedPrivateDto(db, env, current) });
    }
    if (!operation && request.method === 'GET') {
      const row = await db.prepare("SELECT * FROM reviews WHERE id=?1 AND status='published' AND published_content IS NOT NULL").bind(id).first();
      if (!row) return fail(cors, 404, '현재 공개된 후기를 찾을 수 없습니다.');
      const verifiedRows = await loadReviewPurchaseFacts(db, env, [row]);
      return json(cors, { review: publicDto((await loadPublicReviewAuthorNames(db, verifiedRows))[0]) });
    }
    if ((operation === 'manage' && request.method !== 'GET') || (!operation && !['PUT', 'DELETE'].includes(request.method))) return fail(cors, 405, '지원하지 않는 요청입니다.');
    const denied = await ownerAccess(request, env, id, cors);
    if (denied) return denied;
    const current = await getRow(db, id);
    if (current?.member_id) return fail(cors, 401, '회원으로 로그인한 후 후기를 관리해주세요.');
    if (operation === 'manage') {
      const row = await getRow(db, id);
      return row && row.status !== 'deleted' ? json(cors, { review: await verifiedPrivateDto(db, env, row) }) : fail(cors, 404, '후기를 찾을 수 없습니다.');
    }
    if (request.method === 'PUT') {
      const body = await readBody(request, editSchema, cors);
      if (body.error) return body.error;
      const { version, ...input } = body.value;
      const submitted = normalizeReviewTitle(input);
      const hasFacts = current && 'latest_rating' in current;
      const currentContent = current?.latest_content ? JSON.parse(current.latest_content) : {};
      if (submitted.rating === null && (current?.latest_rating ?? currentContent.rating) != null) {
        return fail(cors, 400, '이미 등록한 별점은 삭제할 수 없습니다. 1~5점으로 선택해주세요.');
      }
      const content = hasFacts ? { ...submitted,
        rating: submitted.rating ?? current.latest_rating, targetId: submitted.targetId === undefined ? current.latest_target_id : submitted.targetId,
      } : submitted;
      if (content.targetId) {
        const target = await db.prepare('SELECT id,name FROM site_targets WHERE id=?1 AND active=1').bind(content.targetId).first();
        if (!target) return fail(cors, 400, '작성할 수업·특강 대상을 확인해주세요.');
        content.targetName = target.name;
      } else if (hasFacts) content.targetName = null;
      const limitedEdit = await enforceRate(request, env, cors, `reviews:edit:${id}`, 20, 3600);
      if (limitedEdit) return limitedEdit;
      const row = await db.prepare(`UPDATE reviews SET latest_content=?3, version=version+1, pending_version=version+1,
        status=CASE WHEN status='hidden' THEN 'hidden' WHEN published_content IS NOT NULL THEN 'published' ELSE 'pending' END,
        moderation_reason=CASE WHEN status='hidden' THEN moderation_reason ELSE NULL END, updated_at=?4,
        last_action='edit', last_actor='author', last_reason=NULL
        ${hasFacts ? ',latest_rating=?5,latest_target_id=?6,latest_purchase_item_id=NULL' : ''}
        WHERE id=?1 AND version=?2 AND status != 'deleted' RETURNING *`).bind(id, version, JSON.stringify(content), new Date().toISOString(),
          ...(hasFacts ? [content.rating ?? null, content.targetId ?? null] : [])).first();
      return row ? json(cors, { review: await verifiedPrivateDto(db, env, row) }) : await conflict(db, id, cors);
    }
    const body = await readBody(request, deleteSchema, cors);
    if (body.error) return body.error;
    const row = await db.prepare(`UPDATE reviews SET status='deleted', version=version+1, latest_content=NULL, published_content=NULL,
      password_hash=NULL, password_salt=NULL, password_iterations=NULL, pending_version=NULL, published_version=NULL,
      moderation_reason=NULL, hidden_reason=NULL, restore_allowed=0, last_reason=NULL,
      updated_at=?3, deleted_at=?3, last_action='delete', last_actor='author'
      ${current && 'member_id' in current ? ',member_id=NULL,latest_rating=NULL,published_rating=NULL,latest_target_id=NULL,published_target_id=NULL,latest_purchase_item_id=NULL,published_purchase_item_id=NULL' : ''}
      WHERE id=?1 AND version=?2 AND status != 'deleted' RETURNING id`).bind(id, body.value.version, new Date().toISOString()).first();
    return row ? json(cors, { ok: true }) : await conflict(db, id, cors);
  } catch {
    // SQL errors can contain source text: never relay or log exception details.
    console.error('[reviews] service unavailable');
    return fail(cors, 503, '후기 서비스를 잠시 사용할 수 없습니다. 다시 시도해주세요.');
  }
}

export { contentShape as reviewContentShape, versionSchema as reviewVersionSchema,
  publicDto as publicReviewDto, privateDto as privateReviewDto };
