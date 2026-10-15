import { z } from 'zod';
import { authorizeSiteMember, siteJson } from './siteAuth.js';
import { base64url } from './auth.js';
import { rateLimitCheck } from './securityStore.js';
import { reviewContentShape, reviewVersionSchema, privateReviewDto, loadReviewPurchaseFacts, normalizeReviewTitle } from './reviews.js';

const UUID = z.string().uuid();
const REVIEW_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PAGE_SIZE = 20;
const RETRY_SECONDS = 86400;
const MAX_BODY_BYTES = 128 * 1024;
const encoder = new TextEncoder();
// Legacy clients may still send a nickname; only the authenticated member's name is stored.
const contentShape = { ...reviewContentShape, nickname: z.unknown().optional(), rating: z.number().int().min(1).max(5), targetId: UUID.nullable().optional().default(null) };
const createSchema = z.object({ ...contentShape, idempotencyKey: UUID }).strict();
const editSchema = z.object({ ...contentShape, version: reviewVersionSchema }).strict();
const deleteSchema = z.object({ version: reviewVersionSchema }).strict();
const error = (status, message, code) => siteJson({ error: message, ...(code ? { code } : {}) }, { status });
const seconds = () => Math.floor(Date.now() / 1000);
const now = () => new Date().toISOString();
const ip = request => request.headers.get('CF-Connecting-IP') || 'unknown';
const getRow = (db, id, memberId) => db.prepare("SELECT * FROM reviews WHERE id=?1 AND member_id=?2 AND status!='deleted'").bind(id, memberId).first();

async function fingerprint(secret, domain, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`site-member-reviews/v1/${domain}/${value}`))));
}
async function bodyOf(request, schema) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return error(413, '입력 내용이 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) return error(400, '입력값을 확인해주세요.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return error(413, '입력 내용이 너무 큽니다.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error(400, '입력값을 확인해주세요.'); }
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : error(400, parsed.error.issues[0]?.message || '입력값을 확인해주세요.');
}
async function limited(env, key, limit, window) {
  return await rateLimitCheck(env, `site-member-reviews:${key}`, limit, window) ? null
    : siteJson({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(window) } });
}

function cursorValue(raw) {
  if (!raw) return null;
  try {
    if (raw.length > 300 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!REVIEW_ID.test(value.id) || typeof value.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at)) throw new Error();
    return value;
  } catch { return error(400, '목록 조회 위치를 확인해주세요.'); }
}
const reviewDto = async (env, row) => privateReviewDto((await loadReviewPurchaseFacts(env.GAME_DB, env, [row]))[0]);
async function list(env, url, memberId) {
  const db = env.GAME_DB;
  if ([...url.searchParams.keys()].some(key => key !== 'cursor')) return error(400, '조회 조건을 확인해주세요.');
  const cursor = cursorValue(url.searchParams.get('cursor'));
  if (cursor instanceof Response) return cursor;
  const rows = (await db.prepare(`SELECT * FROM reviews WHERE member_id=?1 AND status!='deleted'
    ${cursor ? 'AND (updated_at<?2 OR (updated_at=?2 AND id<?3))' : ''} ORDER BY updated_at DESC,id DESC LIMIT ${PAGE_SIZE + 1}`)
    .bind(memberId, ...(cursor ? [cursor.at, cursor.id] : [])).all()).results;
  const last = rows[PAGE_SIZE - 1];
  const verified = await loadReviewPurchaseFacts(db, env, rows.slice(0, PAGE_SIZE));
  return siteJson({ memberId, reviews: verified.map(privateReviewDto),
    nextCursor: rows.length > PAGE_SIZE ? base64url(encoder.encode(JSON.stringify({ at: last.updated_at, id: last.id }))) : null });
}

async function targetAndPurchase(db, env, memberId, targetId) {
  if (!targetId) return { purchaseId: null, targetName: null };
  const target = await db.prepare('SELECT id,name FROM site_targets WHERE id=?1 AND active=1').bind(targetId).first();
  if (!target) return error(400, '작성할 수업·특강 대상을 확인해주세요.', 'target_unavailable');
  const environment = env.SITE_ENVIRONMENT === 'development' && env.SITE_TOSS_MODE === 'test' ? 'test' : 'live';
  const purchase = await db.prepare(`SELECT oi.id FROM site_order_items oi JOIN site_orders o ON o.id=oi.order_id
    JOIN site_payments p ON p.order_id=o.id WHERE o.member_id=?1 AND oi.target_id=?2
      AND p.approved_at IS NOT NULL AND p.approved_at!='' AND p.pg_environment=?3
    ORDER BY p.approved_at ASC,oi.id ASC LIMIT 1`).bind(memberId, targetId, environment).first();
  return { purchaseId: purchase?.id || null, targetName: target.name };
}
async function conflict(db, id, memberId) {
  return await getRow(db, id, memberId) ? error(409, '후기가 변경되었습니다. 새로 조회한 뒤 다시 시도해주세요.', 'version_conflict')
    : error(404, '본인의 후기를 찾을 수 없습니다.');
}
const targetConflict = (db, memberId, targetId, excludeId = '') => targetId
  ? db.prepare(`SELECT id FROM reviews WHERE member_id=?1 AND id!=?3 AND status!='deleted'
      AND (latest_target_id=?2 OR published_target_id=?2)`).bind(memberId, targetId, excludeId).first()
  : Promise.resolve(null);

async function create(request, env, member) {
  const data = await bodyOf(request, createSchema);
  if (data instanceof Response) return data;
  const { idempotencyKey, ...submitted } = data, db = env.GAME_DB;
  const content = normalizeReviewTitle(submitted);
  // Preserve the old nickname schema's trim normalization for pre-change submission retries.
  if (typeof content.nickname === 'string') content.nickname = content.nickname.trim();
  const keyHash = await fingerprint(env.SITE_SESSION_SECRET, 'submission-key', `${member.id}:${idempotencyKey}`);
  const requestHash = await fingerprint(env.SITE_SESSION_SECRET, 'submission-payload', `${member.id}:${JSON.stringify(content)}`);
  const retry = async row => {
    if (!row || row.request_hash !== requestHash) return error(409, '같은 제출 식별값에 다른 내용이 있습니다. 새 작성으로 제출해주세요.', 'retry_conflict');
    if (row.status === 'deleted') return error(410, '삭제한 후기의 제출 요청은 다시 사용할 수 없습니다.');
    if (row.member_id !== member.id || row.request_expires_at <= seconds()) return error(409, '제출 재시도 기간이 지났습니다. 새 작성으로 제출해주세요.');
    const denial = await limited(env, `retry:${member.id}:${row.id}`, 10, 600);
    if (denial) return denial;
    const current = await getRow(db, row.id, member.id);
    return current ? siteJson({ review: await reviewDto(env, current) }) : error(404, '본인의 후기를 찾을 수 없습니다.');
  };
  const existing = await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first();
  if (existing) return retry(existing);
  content.nickname = member.name?.trim() || '회원';
  const target = await targetAndPurchase(db, env, member.id, content.targetId);
  if (target instanceof Response) return target;
  if (await targetConflict(db, member.id, content.targetId)) {
    const raced = await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first();
    return raced ? retry(raced) : error(409, '이 수업·특강에 이미 작성한 후기가 있습니다.', 'review_exists');
  }
  content.targetName = target.targetName;
  const denial = await limited(env, `create:${member.id}`, 30, 3600);
  if (denial) return denial;
  const id = crypto.randomUUID(), at = now();
  let row;
  try {
    row = await db.prepare(`INSERT INTO reviews(id,member_id,latest_content,latest_target_id,latest_rating,latest_purchase_item_id,
      pending_version,created_at,updated_at,idempotency_key_hash,request_hash,request_expires_at)
      SELECT ?1,?2,?3,?4,?5,?6,1,?7,?7,?8,?9,?10
      WHERE EXISTS(SELECT 1 FROM site_members WHERE id=?2 AND status='active')
        AND (?4 IS NULL OR EXISTS(SELECT 1 FROM site_targets WHERE id=?4 AND active=1))
      ON CONFLICT DO NOTHING RETURNING *`)
      .bind(id, member.id, JSON.stringify(content), content.targetId, content.rating, target.purchaseId, at, keyHash, requestHash, seconds() + RETRY_SECONDS).first();
  } catch (failure) {
    const raced = await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first();
    if (raced) return retry(raced);
    if (String(failure?.message).includes('site_review_target_conflict') || await targetConflict(db, member.id, content.targetId)) {
      return error(409, '이 수업·특강에 이미 작성한 후기가 있습니다.', 'review_exists');
    }
    throw failure;
  }
  if (row) return siteJson({ review: await reviewDto(env, row) }, { status: 201 });
  const raced = await db.prepare('SELECT * FROM reviews WHERE idempotency_key_hash=?1').bind(keyHash).first();
  if (raced) return retry(raced);
  return error(409, '이 수업·특강에 이미 작성한 후기가 있거나 작성 정보가 변경되었습니다. 내 후기를 확인해주세요.', 'review_exists');
}

async function edit(request, env, member, id) {
  const db = env.GAME_DB, current = await getRow(db, id, member.id);
  if (!current) return error(404, '본인의 후기를 찾을 수 없습니다.');
  const data = await bodyOf(request, editSchema);
  if (data instanceof Response) return data;
  const { version, ...submitted } = data;
  const content = normalizeReviewTitle(submitted);
  if (version !== current.version) return conflict(db, id, member.id);
  content.nickname = member.name?.trim() || '회원';
  const target = await targetAndPurchase(db, env, member.id, content.targetId);
  if (target instanceof Response) return target;
  if (await targetConflict(db, member.id, content.targetId, id)) return error(409, '이 수업·특강에 이미 작성한 후기가 있습니다.', 'review_exists');
  content.targetName = target.targetName;
  const denial = await limited(env, `edit:${member.id}:${id}`, 20, 3600);
  if (denial) return denial;
  let row;
  try {
    row = await db.prepare(`UPDATE reviews SET latest_content=?4,latest_target_id=?5,latest_rating=?6,latest_purchase_item_id=?7,
      version=version+1,pending_version=version+1,
      status=CASE WHEN status='hidden' THEN 'hidden' WHEN published_content IS NOT NULL THEN 'published' ELSE 'pending' END,
      moderation_reason=CASE WHEN status='hidden' THEN moderation_reason ELSE NULL END,updated_at=?8,
      last_action='edit',last_actor='author',last_reason=NULL WHERE id=?1 AND member_id=?2 AND version=?3 AND status!='deleted'
      AND (?5 IS NULL OR EXISTS(SELECT 1 FROM site_targets WHERE id=?5 AND active=1)) RETURNING *`)
      .bind(id, member.id, version, JSON.stringify(content), content.targetId, content.rating, target.purchaseId, now()).first();
  } catch (failure) {
    // A target conflict is safe to report only after querying this member's own existing review.
    if (String(failure?.message).includes('site_review_target_conflict') || await targetConflict(db, member.id, content.targetId, id)) {
      return error(409, '이 수업·특강에 이미 작성한 후기가 있습니다.', 'review_exists');
    }
    throw failure;
  }
  return row ? siteJson({ review: await reviewDto(env, row) }) : conflict(db, id, member.id);
}
async function remove(request, env, member, id) {
  const db = env.GAME_DB, current = await getRow(db, id, member.id);
  if (!current) return error(404, '본인의 후기를 찾을 수 없습니다.');
  const data = await bodyOf(request, deleteSchema);
  if (data instanceof Response) return data;
  const row = await db.prepare(`UPDATE reviews SET status='deleted',version=version+1,latest_content=NULL,published_content=NULL,
    password_hash=NULL,password_salt=NULL,password_iterations=NULL,pending_version=NULL,published_version=NULL,
    moderation_reason=NULL,hidden_reason=NULL,restore_allowed=0,last_reason=NULL,member_id=NULL,
    latest_rating=NULL,published_rating=NULL,latest_target_id=NULL,published_target_id=NULL,
    latest_purchase_item_id=NULL,published_purchase_item_id=NULL,updated_at=?4,deleted_at=?4,last_action='delete',last_actor='author'
    WHERE id=?1 AND member_id=?2 AND version=?3 AND status!='deleted' RETURNING id`).bind(id, member.id, data.version, now()).first();
  return row ? siteJson({ ok: true }) : conflict(db, id, member.id);
}

export async function handleSiteMemberReviewRoutes(request, env) {
  const url = new URL(request.url), path = url.pathname;
  const detail = path.match(/^\/api\/site\/reviews\/([^/]+)$/);
  if (path !== '/api/site/reviews' && !detail) return null;
  try {
    const allowed = path === '/api/site/reviews' ? ['GET', 'POST'] : ['GET', 'PUT', 'DELETE'];
    if (!allowed.includes(request.method)) return siteJson({ error: '지원하지 않는 요청 방식입니다.' }, { status: 405, headers: { Allow: allowed.join(', ') } });
    const access = await authorizeSiteMember(request, env, { requireCsrf: request.method !== 'GET' });
    if (access instanceof Response) return access;
    const denial = await limited(env, `request:${access.member.id}:${ip(request)}`, 120, 60);
    if (denial) return denial;
    if (path === '/api/site/reviews') return request.method === 'GET' ? await list(env, url, access.member.id) : await create(request, env, access.member);
    if (!REVIEW_ID.test(detail[1])) return error(404, '본인의 후기를 찾을 수 없습니다.');
    if (request.method === 'GET') {
      const row = await getRow(env.GAME_DB, detail[1], access.member.id);
      return row ? siteJson({ memberId: access.member.id, review: await reviewDto(env, row) }) : error(404, '본인의 후기를 찾을 수 없습니다.');
    }
    return request.method === 'PUT' ? await edit(request, env, access.member, detail[1]) : await remove(request, env, access.member, detail[1]);
  } catch {
    return error(503, '후기 서비스를 잠시 사용할 수 없습니다. 다시 시도해주세요.');
  }
}
