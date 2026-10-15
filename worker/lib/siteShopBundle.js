import { z } from 'zod';
import { siteJson } from './siteAuth.js';
import { couponDto, selectedCoupon, siteShopCouponId } from './siteShopCoupons.js';
import { productRegionalShipping, productFreeShippingThreshold, chargedBaseShippingFee, shippingPolicyReady, destinationShipping } from './siteShopShipping.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(80);
const text = (max, min = 1) => z.string().trim().min(min).max(max).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const phone = text(24, 8).transform(value => value.replace(/[\s()-]/g, '')).refine(value => /^\+?[0-9]{8,15}$/.test(value));
const items = z.array(z.object({ productId: slug, quantity: z.number().int().min(1).max(99), couponId: siteShopCouponId.optional() }).strict()).min(1).max(30);
export const cartQuoteSchema = z.object({ items, postalCode: z.string().trim().regex(/^\d{5}$/).optional(), address: text(200).optional() }).strict();
export const bundleOrderSchema = z.object({ items, idempotencyKey: z.string().uuid(), customerName: text(60), customerPhone: phone,
  termsAccepted: z.literal(true), cartQuoteVersions: z.record(slug, z.number().int().positive()),
  shipping: z.object({ recipientName: text(60), phone, postalCode: z.string().trim().regex(/^\d{5}$/), address: text(200), addressDetail: text(120, 0) }).strict().optional(),
}).strict();
const fail = (status, error, code) => siteJson({ error, ...(code ? { code } : {}) }, { status });
const maxAmount = 1_000_000_000;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const atNow = () => new Date().toISOString();

export async function priceBundle(env, memberId, input, helpers) {
  const ids = input.items.map(item => item.productId), couponIds = input.items.filter(item => item.couponId).map(item => item.couponId);
  if (new Set(ids).size !== ids.length) return { response: fail(400, '같은 상품은 수량으로 묶어 선택해주세요.', 'product_duplicate') };
  if (new Set(couponIds).size !== couponIds.length) return { response: fail(400, '같은 쿠폰은 한 상품에만 적용할 수 있어요.', 'coupon_duplicate') };
  const products = (await env.GAME_DB.prepare(`SELECT * FROM site_shop_products WHERE slug IN (${ids.map((_, index) => `?${index + 1}`).join(',')})`).bind(...ids).all()).results;
  const productMap = new Map(products.map(product => [product.slug, product]));
  const lines = [];
  let itemAmount = 0;
  for (const wanted of input.items) {
    const product = productMap.get(wanted.productId);
    if (!product || !product.active || product.archived_at) return { response: fail(404, '판매 중인 선택 상품을 찾을 수 없습니다.', 'product_missing') };
    if (!text(80).safeParse(product.name).success || !helpers.eligible(product) || wanted.quantity > helpers.maximumQuantity(product) || product.product_type === 'digital' && wanted.quantity !== 1) {
      return { response: fail(409, '선택 상품의 수량과 구매 조건을 확인해주세요.', 'product_not_ready') };
    }
    if (product.product_type === 'digital' && (!helpers.filesReady() || !await env.SITE_SHOP_FILES.head(product.file_key))) {
      return { response: fail(409, '선택 상품의 구매 파일을 준비 중입니다.', 'product_not_ready') };
    }
    if (product.product_type === 'physical' && !shippingPolicyReady(product)) return { response: fail(409, '선택 상품의 지역 배송비 설정을 확인해주세요.', 'shipping_configuration_pending') };
    const gross = product.price * wanted.quantity;
    itemAmount += gross;
    if (!Number.isSafeInteger(itemAmount) || itemAmount > maxAmount) return { response: fail(400, '선택 상품의 전체 금액을 확인해주세요.', 'payment_amount') };
    lines.push({ wanted, product, itemAmount: gross });
  }
  const requiresShipping = lines.some(line => line.product.product_type === 'physical');
  if (!!input.postalCode !== !!input.address) return { response: fail(400, '배송 우편번호와 주소를 함께 입력해주세요.', 'shipping_address_invalid') };
  const shippingPending = requiresShipping && !input.postalCode;
  let baseFee = 0, extraFee = 0, zone = requiresShipping ? 'general' : 'not_applicable';
  for (const line of lines) {
    let delivery = { shipping: { zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 }, policy: null };
    if (line.product.product_type === 'physical') {
      if (shippingPending) delivery = { shipping: null, policy: productRegionalShipping(line.product) };
      else delivery = destinationShipping(line.product, input, itemAmount);
      if (delivery.error) return { response: fail(delivery.error === 'shipping_configuration_pending' ? 409 : 400,
        delivery.error === 'shipping_configuration_pending' ? '지역 배송비 설정을 확인해주세요.' : '배송 우편번호와 주소의 지역을 확인해주세요.', delivery.error) };
      baseFee = Math.max(baseFee, delivery.shipping?.baseFee ?? chargedBaseShippingFee(line.product, itemAmount));
      extraFee = Math.max(extraFee, delivery.shipping?.extraFee || 0);
      if (delivery.shipping?.zone === 'remote' || delivery.shipping?.zone === 'jeju' && zone !== 'remote') zone = delivery.shipping.zone;
    }
    line.shipping = delivery.shipping;
  }
  const shippingFee = baseFee + extraFee;
  if (!Number.isSafeInteger(itemAmount + shippingFee) || itemAmount + shippingFee > maxAmount) return { response: fail(400, '최종 상품 결제금액을 확인해주세요.', 'payment_amount') };
  let discountAmount = 0;
  const publicItems = [], productVersions = {};
  for (const line of lines) {
    const selected = line.wanted.couponId ? await selectedCoupon(env, line.wanted.couponId, memberId,
      { productId: line.product.slug, itemAmount: line.itemAmount, shippingFee: 0 }, { minimumAmount: 0 }) : null;
    if (selected && !selected.applicable) return { response: fail(409, selected.reason, 'coupon_unavailable') };
    const discount = selected?.discountAmount || 0;
    discountAmount += discount; line.coupon = selected?.row || null;
    productVersions[line.product.slug] = line.product.version;
    const value = { productId: line.product.slug, productType: line.product.product_type, name: line.product.name,
      quantity: line.wanted.quantity, unitPrice: line.product.price, itemAmount: line.itemAmount, discountAmount: discount,
      coupon: line.coupon ? couponDto(line.coupon) : null, amount: line.itemAmount - discount,
      baseShippingFee: line.product.product_type === 'physical' ? line.product.shipping_fee : 0,
      shippingBreakdown: line.shipping, freeShippingThreshold: productFreeShippingThreshold(line.product),
      regionalShipping: productRegionalShipping(line.product), remoteShippingNote: line.product.product_type === 'physical' ? line.product.remote_shipping_note || '' : '',
      thumbnailUrl: helpers.productDto(line.product).thumbnailUrl, termsVersion: line.product.terms_version,
      refundPolicy: line.product.refund_policy, deliveryPolicy: line.product.delivery_policy };
    line.value = value; publicItems.push(value);
  }
  const amount = itemAmount + shippingFee - discountAmount;
  if (!Number.isSafeInteger(amount) || amount < 100) return { response: fail(400, '최종 상품 결제금액은 100원 이상이어야 합니다.', 'payment_minimum') };
  return { quote: { itemAmount, discountAmount, shippingFee, amount }, items: publicItems,
    shipping: shippingPending ? null : { zone, baseFee, extraFee, fee: shippingFee }, productVersions, requiresShipping, shippingPending, lines };
}

export function bundleQuoteDto(result) {
  const { quote, items, shipping, productVersions, requiresShipping, shippingPending } = result;
  return { quote, items, shipping, productVersions, requiresShipping, shippingPending };
}

export async function createBundleOrder(env, member, input, helpers) {
  const db = env.GAME_DB;
  const normalized = { ...input, items: [...input.items].sort((left, right) => left.productId.localeCompare(right.productId)),
    cartQuoteVersions: Object.fromEntries(Object.entries(input.cartQuoteVersions).sort(([left], [right]) => left.localeCompare(right))) };
  const retryHash = await digest(`site-shop/order-key/v2/${member.id}:${input.idempotencyKey}`);
  const payloadHash = await digest(`site-shop/order-payload/v2/${JSON.stringify(normalized)}`);
  const existing = await db.prepare('SELECT * FROM site_shop_orders WHERE idempotency_hash=?1').bind(retryHash).first();
  if (existing) return existing.member_id === member.id && existing.payload_hash === payloadHash
    ? siteJson({ order: await helpers.orderDto(existing, { detail: true }), checkout: await helpers.checkoutDto(existing) })
    : fail(409, '기존 주문과 선택 내용이 다릅니다. 구매내역을 확인해주세요.');
  if (!helpers.directReady()) return fail(503, '상품 구매를 준비 중입니다.', 'shop_preparing');
  await helpers.expireReadyOrders();
  const result = await priceBundle(env, member.id, { items: normalized.items, ...input.shipping }, helpers);
  if (result.response) return result.response;
  if (result.requiresShipping !== !!input.shipping || result.shippingPending) return fail(400, '선택 상품의 배송 정보를 확인해주세요.', 'shipping_address_invalid');
  if (Object.keys(input.cartQuoteVersions).length !== result.lines.length
    || result.lines.some(line => input.cartQuoteVersions[line.product.slug] !== line.product.version)) return fail(409, '선택 상품과 배송비가 변경됐어요. 최신 금액을 확인해주세요.', 'shipping_quote_changed');
  const id = crypto.randomUUID(), at = atNow(), first = result.lines[0], hasPhysical = result.requiresShipping;
  const privateItems = result.lines.map(line => ({ ...line.value, id: crypto.randomUUID(), productVersion: line.product.version,
    termsVersion: line.product.terms_version, refundPolicy: line.product.refund_policy, deliveryPolicy: line.product.delivery_policy,
    fileKey: line.product.file_key, fileName: line.product.file_name, fileContentType: line.product.file_content_type,
    couponVersion: line.coupon?.version || null, perMemberOnce: line.coupon?.per_member_once || 0 }));
  const snapshot = { purchaseType: 'bundle', name: privateItems.length > 1 ? `${first.product.name} 외 ${privateItems.length - 1}건` : first.product.name,
    quantity: privateItems.reduce((sum, item) => sum + item.quantity, 0), itemAmount: result.quote.itemAmount,
    discountAmount: result.quote.discountAmount, shippingBreakdown: result.shipping, items: privateItems,
    customerName: input.customerName, customerPhone: input.customerPhone, shipping: input.shipping || null,
    termsAcceptedAt: at, termsVersion: 'bundle-v1', refundPolicy: '상품별 구매 당시 환불 정책을 적용합니다.', deliveryPolicy: '상품별 구매 당시 제공·배송 정책을 적용합니다.' };
  const guard = privateItems.map(item => ({ productId: item.productId, productType: item.productType, version: item.productVersion, quantity: item.quantity,
    couponId: item.coupon?.id || null, couponVersion: item.couponVersion }));
  const accountHash = await helpers.accountHash(), billId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const guardJson = JSON.stringify(guard), itemsJson = JSON.stringify(privateItems);
  await db.batch([
    db.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,
      pg_order_id,pg_environment,pg_client_id,callback_nonce,approval_key,stock_state,shipping_status,expires_at,created_at,updated_at,
      payment_provider,payssam_bill_id,payssam_account_hash)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'',?12,?13,?14,?15,?16,?17,?17,'payssam',?18,?19
      WHERE NOT EXISTS(SELECT 1 FROM json_each(?20) j LEFT JOIN site_shop_products p ON p.slug=json_extract(j.value,'$.productId')
        WHERE p.slug IS NULL OR p.active!=1 OR p.archived_at IS NOT NULL OR p.version!=json_extract(j.value,'$.version')
        OR p.product_type!=json_extract(j.value,'$.productType') OR (p.product_type='physical' AND p.stock<json_extract(j.value,'$.quantity'))
        OR (json_extract(j.value,'$.couponId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM site_shop_coupons c
          WHERE c.id=json_extract(j.value,'$.couponId') AND c.version=json_extract(j.value,'$.couponVersion') AND c.status='active'
          AND (c.starts_at IS NULL OR c.starts_at<=?17) AND (c.ends_at IS NULL OR c.ends_at>?17)
          AND (c.product_slug IS NULL OR c.product_slug=p.slug)
          AND (c.per_member_once=0 OR NOT EXISTS(SELECT 1 FROM site_shop_coupon_redemptions r WHERE r.coupon_id=c.id AND r.member_id=?2 AND r.state IN ('reserved','used'))))))
      ON CONFLICT(idempotency_hash) DO NOTHING`).bind(id, member.id, first.product.slug, hasPhysical ? 'physical' : 'digital', retryHash, payloadHash,
      JSON.stringify(snapshot), result.quote.amount, result.quote.shippingFee, `shop_${id.replace(/-/g, '')}`, env.SITE_PAYSSAM_MODE,
      helpers.opaque(), crypto.randomUUID(), hasPhysical ? 'reserved' : 'none', hasPhysical ? 'pending' : 'not_applicable',
      new Date(Date.now() + 30 * 60_000).toISOString(), at, billId, accountHash, guardJson),
    db.prepare(`INSERT INTO site_shop_order_items(id,order_id,product_slug,product_type,quantity,snapshot)
      SELECT json_extract(j.value,'$.id'),?1,json_extract(j.value,'$.productId'),json_extract(j.value,'$.productType'),json_extract(j.value,'$.quantity'),j.value
      FROM json_each(?2) j WHERE EXISTS(SELECT 1 FROM site_shop_orders WHERE id=?1)`).bind(id, itemsJson),
    db.prepare(`INSERT INTO site_shop_coupon_redemptions(order_id,coupon_id,member_id,per_member_once,state,created_at,updated_at)
      SELECT ?1,json_extract(j.value,'$.coupon.id'),?2,json_extract(j.value,'$.perMemberOnce'),'reserved',?3,?3 FROM json_each(?4) j
      WHERE json_extract(j.value,'$.coupon.id') IS NOT NULL AND EXISTS(SELECT 1 FROM site_shop_orders WHERE id=?1)
      ON CONFLICT(order_id,coupon_id) DO NOTHING`).bind(id, member.id, at, itemsJson),
    db.prepare(`UPDATE site_shop_products SET stock=stock-(SELECT i.quantity FROM site_shop_order_items i WHERE i.order_id=?1 AND i.product_slug=site_shop_products.slug),
      version=version+1,updated_at=?2 WHERE product_type='physical' AND EXISTS(SELECT 1 FROM site_shop_order_items i JOIN site_shop_orders o ON o.id=i.order_id
        WHERE i.order_id=?1 AND i.product_slug=site_shop_products.slug AND o.stock_state='reserved')`).bind(id, at),
  ]);
  const saved = await db.prepare('SELECT * FROM site_shop_orders WHERE idempotency_hash=?1').bind(retryHash).first();
  if (!saved) return fail(409, '선택 상품과 배송비가 변경됐어요. 최신 금액을 확인해주세요.', 'shipping_quote_changed');
  if (saved.payload_hash !== payloadHash) return fail(409, '기존 주문과 선택 내용이 다릅니다.');
  return siteJson({ order: await helpers.orderDto(saved, { detail: true }), checkout: await helpers.checkoutDto(saved) }, { status: saved.id === id ? 201 : 200 });
}
