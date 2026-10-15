import { z } from 'zod';
import { siteJson } from './siteAuth.js';
import { chargedBaseShippingFee } from './siteShopShipping.js';
import { recordSiteAdminAction, siteAdminAuditStatement, siteListParams, siteNextCursor, siteLike } from './siteAdminContent.js';

export const siteShopCouponId = z.string().uuid().refine(value => value === value.toLowerCase());
const money = z.number().int().min(0).max(1_000_000_000);
const timestamp = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullish();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(80).nullish();
const shape = { code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/),
  name: z.string().trim().min(1).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value)),
  discountType: z.enum(['fixed','percent']), discountValue: money.refine(value => value > 0),
  minItemAmount: money.optional().default(0), maxDiscountAmount: money.refine(value => value > 0).nullish(),
  productId: slug, startsAt: timestamp, endsAt: timestamp,
  perMemberOnce: z.boolean().optional().default(true), status: z.enum(['active','inactive','archived']).optional().default('inactive') };
const validateRules = (value, context) => {
  if (value.discountType === 'percent' && value.discountValue > 99) context.addIssue({ code: z.ZodIssueCode.custom, message: '할인율을 확인해주세요.' });
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) context.addIssue({ code: z.ZodIssueCode.custom, message: '사용 기간을 확인해주세요.' });
};
const createSchema = z.object({ ...shape, id: siteShopCouponId.optional() }).strict().superRefine(validateRules);
const updateSchema = z.object({ ...shape, version: z.number().int().positive() }).strict().superRefine(validateRules);
const archiveSchema = z.object({ version: z.number().int().positive() }).strict();
const fail = (status, error, code) => siteJson({ error, ...(code ? { code } : {}) }, { status });
const now = () => new Date().toISOString();

export function couponDto(row, admin = false) {
  const value = { id: row.id, code: row.code, name: row.name, discountType: row.discount_type, discountValue: row.discount_value,
    minItemAmount: row.min_item_amount, maxDiscountAmount: row.max_discount_amount, productId: row.product_slug,
    startsAt: row.starts_at, endsAt: row.ends_at, perMemberOnce: row.per_member_once === 1, version: row.version };
  return admin ? { ...value, status: row.status, usedCount: row.used_count || 0, reservedCount: row.reserved_count || 0,
    createdAt: row.created_at, updatedAt: row.updated_at } : value;
}

export function couponQuote(row, quote, { at = now(), consumed = false, minimumAmount = 100 } = {}) {
  const unavailable = reason => ({ applicable: false, reason, discountAmount: 0, amount: quote.itemAmount + quote.shippingFee });
  if (!row || row.status !== 'active') return unavailable('사용할 수 없는 쿠폰입니다.');
  if (row.product_slug && row.product_slug !== quote.productId) return unavailable('이 상품에 사용할 수 없는 쿠폰입니다.');
  if (row.starts_at && row.starts_at > at) return unavailable('아직 사용 기간이 시작되지 않았습니다.');
  if (row.ends_at && row.ends_at <= at) return unavailable('사용 기간이 지난 쿠폰입니다.');
  if (row.per_member_once && consumed) return unavailable('이미 사용 중이거나 사용한 쿠폰입니다.');
  if (!Number.isSafeInteger(quote.itemAmount) || quote.itemAmount <= 0 || !Number.isSafeInteger(quote.shippingFee)
    || quote.shippingFee < 0 || quote.itemAmount + quote.shippingFee > 1_000_000_000) return unavailable('상품 금액을 확인해주세요.');
  if (quote.itemAmount < row.min_item_amount) return unavailable(`${row.min_item_amount.toLocaleString('ko-KR')}원 이상 구매 시 사용할 수 있습니다.`);
  const raw = row.discount_type === 'percent' ? Math.floor(quote.itemAmount * row.discount_value / 100) : row.discount_value;
  const discountAmount = Math.min(raw, row.max_discount_amount ?? raw, quote.itemAmount);
  const amount = quote.itemAmount + quote.shippingFee - discountAmount;
  // Paid order invariants require positive merchandise and a PG charge of at least 100 won.
  if (!Number.isSafeInteger(discountAmount) || discountAmount <= 0 || discountAmount >= quote.itemAmount || amount < minimumAmount) {
    return unavailable('할인 후 결제금액이 너무 적어 사용할 수 없습니다.');
  }
  return { applicable: true, reason: '', discountAmount, amount };
}

export async function selectedCoupon(env, id, memberId, quote, { minimumAmount = 100 } = {}) {
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_coupons WHERE id=?1').bind(id).first();
  const consumed = row?.per_member_once ? !!await env.GAME_DB.prepare(`SELECT order_id FROM site_shop_coupon_redemptions
    WHERE coupon_id=?1 AND member_id=?2 AND state IN ('reserved','used') LIMIT 1`).bind(id, memberId).first() : false;
  return { row, ...couponQuote(row, quote, { consumed, minimumAmount }) };
}

export async function publicCoupons(env, product, quantity, memberId = null) {
  const quote = { quantity, unitPrice: product.price, itemAmount: product.price * quantity,
    shippingFee: chargedBaseShippingFee(product, product.price * quantity), discountAmount: 0 };
  quote.amount = quote.itemAmount + quote.shippingFee;
  const rows = (await env.GAME_DB.prepare(`SELECT c.*,${memberId ? `EXISTS(SELECT 1 FROM site_shop_coupon_redemptions r
    WHERE r.coupon_id=c.id AND r.member_id=?2 AND r.state IN ('reserved','used'))` : '0'} AS consumed
    FROM site_shop_coupons c WHERE c.status='active' AND (c.product_slug IS NULL OR c.product_slug=?1)
    ORDER BY c.created_at DESC,c.id DESC LIMIT 100`).bind(...(memberId ? [product.slug, memberId] : [product.slug])).all()).results;
  return siteJson({ quote, coupons: rows.map(row => ({ ...couponDto(row),
    ...couponQuote(row, { ...quote, productId: product.slug }, { consumed: !!row.consumed }) })) });
}

const couponStats = `SELECT c.*,
  (SELECT COUNT(*) FROM site_shop_coupon_redemptions r WHERE r.coupon_id=c.id AND r.state='used') AS used_count,
  (SELECT COUNT(*) FROM site_shop_coupon_redemptions r WHERE r.coupon_id=c.id AND r.state='reserved') AS reserved_count
  FROM site_shop_coupons c`;
async function adminCoupon(env, id) { return env.GAME_DB.prepare(`${couponStats} WHERE c.id=?1`).bind(id).first(); }
async function listCoupons(env, url) {
  let params;
  try { params = siteListParams(url, 'admin-coupons', { status: ['active','inactive','archived'] }); }
  catch { return fail(400, '목록 조건을 확인해주세요.'); }
  const conditions = [], values = [], bind = value => { values.push(value); return `?${values.length}`; };
  if (params.filters.status) conditions.push(`c.status=${bind(params.filters.status)}`);
  if (params.q) { const q = bind(siteLike(params.q)); conditions.push(`(c.code LIKE ${q} ESCAPE '\\' OR c.name LIKE ${q} ESCAPE '\\')`); }
  if (params.cursor) { const time = bind(params.cursor.time), id = bind(params.cursor.id); conditions.push(`(c.created_at<${time} OR (c.created_at=${time} AND c.id<${id}))`); }
  const rows = (await env.GAME_DB.prepare(`${couponStats} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY c.created_at DESC,c.id DESC LIMIT ${bind(params.limit + 1)}`).bind(...values).all()).results;
  const page = rows.slice(0, params.limit);
  return siteJson({ coupons: page.map(row => couponDto(row, true)), nextCursor: rows.length > params.limit ? siteNextCursor(params, page.at(-1)) : null });
}

async function readBody(request, schema) {
  const reader = request.body?.getReader(); if (!reader) return { response: fail(400, '입력값을 확인해주세요.') };
  const chunks = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
    if (length > 16384) { await reader.cancel(); return { response: fail(413, '입력 내용이 너무 큽니다.') }; } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { value = null; }
  const parsed = schema.safeParse(value);
  return parsed.success ? { value: parsed.data } : { response: fail(400, '입력값을 확인해주세요.') };
}

async function saveCoupon(request, env, pathId) {
  const parsed = await readBody(request, pathId ? updateSchema : createSchema); if (parsed.response) return parsed.response;
  const input = parsed.value, db = env.GAME_DB, at = now(), id = pathId || input.id || crypto.randomUUID();
  const normalized = JSON.stringify(Object.keys(shape).map(key => [key, input[key] ?? null]));
  const createHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))),
    value => value.toString(16).padStart(2, '0')).join('');
  if (!pathId) {
    const existing = await adminCoupon(env, id);
    if (existing) return existing.create_hash === createHash ? siteJson({ coupon: couponDto(existing, true) })
      : fail(409, '이미 등록한 쿠폰과 입력 내용이 다릅니다.', 'coupon_create_conflict');
  }
  if (input.productId && !await db.prepare('SELECT slug FROM site_shop_products WHERE slug=?1 AND archived_at IS NULL').bind(input.productId).first()) {
    return fail(400, '쿠폰을 적용할 상품을 확인해주세요.');
  }
  const collision = await db.prepare('SELECT id FROM site_shop_coupons WHERE code=?1 AND id!=?2').bind(input.code, id).first();
  if (collision) return fail(409, '이미 등록한 쿠폰 코드입니다.', 'coupon_code_conflict');
  const values = [id, input.code, input.name, input.discountType, input.discountValue, input.minItemAmount,
    input.maxDiscountAmount ?? null, input.productId || null, input.startsAt || null, input.endsAt || null,
    input.perMemberOnce ? 1 : 0, input.status, at];
  const mutation = pathId ? db.prepare(`UPDATE site_shop_coupons SET code=?2,name=?3,discount_type=?4,discount_value=?5,
    min_item_amount=?6,max_discount_amount=?7,product_slug=?8,starts_at=?9,ends_at=?10,per_member_once=?11,status=?12,
    version=version+1,updated_at=?13 WHERE id=?1 AND version=?14
    AND NOT EXISTS(SELECT 1 FROM site_shop_coupons WHERE code=?2 AND id!=?1) RETURNING *`).bind(...values, input.version)
    : db.prepare(`INSERT INTO site_shop_coupons(id,code,name,discount_type,discount_value,min_item_amount,max_discount_amount,
      product_slug,starts_at,ends_at,per_member_once,status,created_at,updated_at,create_hash)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14) ON CONFLICT DO NOTHING RETURNING *`).bind(...values, createHash);
  const action = pathId ? 'coupon.update' : 'coupon.create';
  const results = await db.batch([mutation, siteAdminAuditStatement(db, action, `coupon:${id}`, 'success', { conditional: true, at })]);
  if (!results[0].results[0]) {
    if (!pathId) {
      const existing = await adminCoupon(env, id);
      if (existing?.create_hash === createHash) return siteJson({ coupon: couponDto(existing, true) });
    }
    await recordSiteAdminAction(env, action, `coupon:${id}`, 'conflict');
    if (pathId && !await adminCoupon(env, id)) return fail(404, '쿠폰을 찾을 수 없습니다.');
    return fail(409, '쿠폰이 다른 화면에서 변경됐거나 코드가 중복됩니다. 최신 내용을 확인해주세요.', 'version_conflict');
  }
  return siteJson({ coupon: couponDto(await adminCoupon(env, id), true) }, { status: pathId ? 200 : 201 });
}

export async function handleAdminCoupons(request, env, pathId) {
  if (pathId && !siteShopCouponId.safeParse(pathId).success) return fail(400, '쿠폰 식별자를 확인해주세요.');
  if (request.method === 'GET') {
    if (!pathId) return listCoupons(env, new URL(request.url));
    const row = await adminCoupon(env, pathId); return row ? siteJson({ coupon: couponDto(row, true) }) : fail(404, '쿠폰을 찾을 수 없습니다.');
  }
  if ((!pathId && request.method === 'POST') || (pathId && request.method === 'PUT')) return saveCoupon(request, env, pathId);
  if (pathId && request.method === 'DELETE') {
    const parsed = await readBody(request, archiveSchema); if (parsed.response) return parsed.response;
    const at = now(), db = env.GAME_DB;
    const results = await db.batch([db.prepare(`UPDATE site_shop_coupons SET status='archived',version=version+1,updated_at=?3
      WHERE id=?1 AND version=?2 RETURNING *`).bind(pathId, parsed.value.version, at),
    siteAdminAuditStatement(db, 'coupon.archive', `coupon:${pathId}`, 'success', { conditional: true, at })]);
    if (!results[0].results[0]) { await recordSiteAdminAction(env, 'coupon.archive', `coupon:${pathId}`, 'conflict');
      return fail(409, '쿠폰이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
    return siteJson({ coupon: couponDto(await adminCoupon(env, pathId), true) });
  }
  return fail(405, '지원하지 않는 요청 방식입니다.');
}

export function couponReservationStatement(db, { id, coupon, memberId, at }) {
  return db.prepare(`INSERT INTO site_shop_coupon_redemptions(order_id,coupon_id,member_id,per_member_once,state,created_at,updated_at)
    SELECT o.id,?2,?3,?4,'reserved',?5,?5 FROM site_shop_orders o WHERE o.id=?1
    AND json_extract(o.snapshot,'$.coupon.id')=?2 ON CONFLICT(order_id,coupon_id) DO NOTHING`)
    .bind(id, coupon.id, memberId, coupon.per_member_once, at);
}
export function releaseCouponStatement(db, at, id = null) {
  return db.prepare(`UPDATE site_shop_coupon_redemptions SET state='released',updated_at=?1 WHERE state='reserved'
    AND EXISTS(SELECT 1 FROM site_shop_orders o WHERE o.id=order_id AND o.approved_at IS NULL AND o.status IN ('expired','failed'))
    AND (?2 IS NULL OR order_id=?2)`).bind(at, id);
}
export async function markCouponUsed(db, orderId, at) {
  await db.prepare(`UPDATE site_shop_coupon_redemptions SET state='used',updated_at=?2 WHERE order_id=?1 AND state='reserved'
    AND EXISTS(SELECT 1 FROM site_shop_orders o WHERE o.id=order_id AND o.approved_at IS NOT NULL)`).bind(orderId, at).run();
}
