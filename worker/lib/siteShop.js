import { z } from 'zod';
import { authorizeSiteMember, siteOrigin, siteJson } from './siteAuth.js';
import { rateLimitCheck } from './securityStore.js';
import * as nicepay from './siteNicepay.js';
import * as payssam from './sitePayssam.js';
import { siteAdminAuditStatement, recordSiteAdminAction, siteListParams, siteNextCursor, siteLike } from './siteAdminContent.js';
import { normalizeSmartstoreProductUrl, siteShopSalesMode } from './siteSmartstore.js';
import { rasterImageInfo } from './siteImageValidation.js';
import { couponDto, selectedCoupon, publicCoupons, handleAdminCoupons, siteShopCouponId,
  couponReservationStatement, releaseCouponStatement, markCouponUsed } from './siteShopCoupons.js';
import { regionalShippingSchema, productRegionalShipping, productFreeShippingThreshold, chargedBaseShippingFee, shippingPolicyReady, destinationShipping, orderShippingBreakdown } from './siteShopShipping.js';
import { bundleOrderSchema, cartQuoteSchema, priceBundle, bundleQuoteDto, createBundleOrder } from './siteShopBundle.js';

const UUID = z.string().uuid();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(80);
// Legacy public workbook announcements may render without a database product.
// Only these already-public IDs may declare that their announcement was hidden.
const CURATED_LEGACY_PRODUCT_IDS = ['pronunciation-workbook'];
const text = (max, min = 1) => z.string().trim().min(min).max(max);
const nameText = max => text(max).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const phone = text(24, 8).transform(value => value.replace(/[\s()-]/g, ''))
  .refine(value => /^\+?[0-9]{8,15}$/.test(value));
const money = z.number().int().positive().max(1_000_000_000);
const nonnegative = z.number().int().min(0).max(1_000_000_000);
const shippingSchema = z.object({ recipientName: text(60), phone, postalCode: text(12), address: text(200), addressDetail: text(120, 0) }).strict();
function productSchema(env) { return z.object({ slug, name: nameText(80), description: text(4000, 0).optional().default(''),
  productType: z.enum(['digital', 'physical']), price: money, shippingFee: nonnegative.nullish(), stock: nonnegative.nullish(),
  remoteShippingNote: text(500, 0).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)).optional(),
  regionalShipping: regionalShippingSchema.nullable().optional(), freeShippingThreshold: nonnegative.nullable().optional(),
  active: z.boolean().optional(), status: z.enum(['draft','active','archived']).optional(), version: z.number().int().positive().optional(),
  termsVersion: text(60, 0).optional().default(''),
  refundPolicy: text(2000, 0).optional().default(''), deliveryPolicy: text(2000, 0).optional().default(''),
  fileKey: text(400).refine(value => !value.startsWith('/') && !value.includes('://') && !value.split('/').includes('..')).nullish(),
  fileName: text(160).refine(value => !/[\x00-\x1f\x7f/\\]/.test(value)).nullish(),
  fileContentType: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i).optional().default('application/octet-stream'),
  smartstoreUrl: text(2048, 0).nullish(),
}).strict().superRefine((value, context) => {
  const active = value.status ? value.status === 'active' : !!value.active;
  const direct = siteShopSalesMode(env) === 'direct';
  let smartstoreUrl;
  try { smartstoreUrl = normalizeSmartstoreProductUrl(value.smartstoreUrl); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: '스마트스토어 상품 주소를 확인해주세요.' }); }
  if (smartstoreUrl && value.productType === 'digital') context.addIssue({ code: z.ZodIssueCode.custom, message: '디지털 상품에는 스마트스토어 구매 주소를 등록할 수 없습니다.' });
  if (value.status && value.active != null && value.active !== active) context.addIssue({ code: z.ZodIssueCode.custom, message: '상품 상태를 확인해주세요.' });
  if (direct && active && (!value.termsVersion || !value.refundPolicy || !value.deliveryPolicy
    || (value.productType === 'physical' && (value.stock == null || value.shippingFee == null))
    || (value.productType === 'digital' && (!value.fileKey || !value.fileName)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '판매 전 상품 가격·전달·환불 정책과 재고 또는 파일을 확인해주세요.' });
  }
  // Monetary checks run after merging omitted shipping settings with the stored product.
}); }
const orderSchema = z.object({ productId: slug, idempotencyKey: UUID, customerName: nameText(60), customerPhone: phone,
  termsVersion: text(60), termsAccepted: z.literal(true), shipping: shippingSchema.optional(), quantity: z.number().int().min(1).max(99).optional().default(1),
  couponId: siteShopCouponId.optional(), shippingQuoteVersion: z.number().int().positive().optional() }).strict();
const shippingQuoteSchema = z.object({ productId: slug, quantity: z.number().int().min(1).max(99).optional().default(1),
  postalCode: z.string().trim().regex(/^\d{5}$/), address: nameText(200), couponId: siteShopCouponId.optional() }).strict();
const refundSchema = z.object({ reason: text(500, 2) }).strict();
const refundClosureSchema = z.object({ refundId: UUID, version: z.number().int().positive(), reason: text(500, 2).optional() }).strict();
const adminRefundSchema = z.object({ amount: money, reason: text(500, 2), refundId: UUID.optional(), idempotencyKey: UUID.optional() }).strict()
  .refine(value => !!value.refundId || !!value.idempotencyKey);
const shipmentSchema = z.object({ status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
  carrier: text(60).nullish(), trackingNumber: text(100).nullish(), version: z.number().int().positive() }).strict();
const now = () => new Date().toISOString();
const unix = () => Math.floor(Date.now() / 1000);
const encoder = new TextEncoder();
const opaque = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fail = (status, message, code) => siteJson({ error: message, ...(code ? { code } : {}) }, { status });
const preparing = () => fail(503, '상품 구매를 준비하고 있어요. 잠시 후 다시 확인해주세요.', 'shop_preparing');
async function bodyOf(request, schema, maximum = 16_384) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maximum) return { response: fail(413, '입력 내용이 너무 큽니다.') };
  const raw = await boundedText(request, maximum);
  let json;
  try { json = raw == null ? null : JSON.parse(raw); } catch { json = null; }
  const result = schema.safeParse(json);
  return result.success ? { value: result.data } : { response: fail(400, '입력값을 확인해주세요.') };
}
async function hash(env, label, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SITE_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`site-shop/v1/${label}/${value}`))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function siteShopReady(env) {
  return env.SITE_SHOP_ENABLED === 'true' && !!env.GAME_DB && typeof env.SITE_SESSION_SECRET === 'string'
    && env.SITE_SESSION_SECRET.length >= 32 && payssam.payssamReady(env) && !!payssamCallbackOrigin(env);
}
export function siteShopDirectSalesReady(env) { return siteShopSalesMode(env) === 'direct' && siteShopReady(env); }
const externalCheckout = () => fail(409, '상품 구매는 스마트스토어에서 진행해주세요.', 'external_shop_checkout');
// Publication is independent of direct-sale eligibility. Existing introductions
// remain readable when the sales mode changes, but their direct active flag is 0.
function productActive(row, env, admin = false) {
  return admin && siteShopSalesMode(env) === 'direct' ? !!row.active : !!(row.smartstore_active ?? row.active);
}
function productActiveSql(env, admin = false) {
  return admin && siteShopSalesMode(env) === 'direct' ? 'active' : 'COALESCE(smartstore_active,active)';
}
function directProductStatus(row) {
  const total = row.price + (chargedBaseShippingFee(row, row.price) || 0);
  if (!row.active || row.archived_at || !Number.isSafeInteger(total) || total < 100 || total > 1_000_000_000
    || !row.terms_version || !row.refund_policy || !row.delivery_policy) return 'preparing';
  if (row.product_type === 'physical') {
    if (!Number.isInteger(row.stock) || row.stock < 0 || !Number.isInteger(row.shipping_fee) || row.shipping_fee < 0) return 'preparing';
    return row.stock === 0 ? 'sold_out' : 'ready';
  }
  return row.file_key && row.file_name ? 'ready' : 'preparing';
}
function directProductEligible(row) { return directProductStatus(row) === 'ready'; }
function maximumProductQuantity(row) {
  if (row.product_type === 'digital') return 1;
  if (!directProductEligible(row)) return 0;
  if (!Number.isSafeInteger(row.stock) || row.stock <= 0 || !Number.isSafeInteger(row.price) || row.price <= 0
    || !Number.isSafeInteger(row.shipping_fee) || row.shipping_fee < 0) return 0;
  const candidate = Math.max(0, Math.min(99, row.stock, Math.floor(1_000_000_000 / row.price)));
  return row.price * candidate + chargedBaseShippingFee(row, row.price * candidate) <= 1_000_000_000 ? candidate
    : Math.max(0, Math.min(candidate, Math.floor((1_000_000_000 - row.shipping_fee) / row.price)));
}
function payssamCallbackOrigin(env) {
  try {
    const url = new URL(env.SITE_PAYSSAM_CALLBACK_ORIGIN);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && local && env.SITE_PAYSSAM_MODE === 'test'
        && env.SITE_ENVIRONMENT === 'development')) ? url.origin : null;
  } catch { return null; }
}
async function payssamAccountHash(env) {
  // This identifies a provider account, not a login session or payment proof.
  const tuple = JSON.stringify([env.SITE_PAYSSAM_MODE, env.SITE_PAYSSAM_MEMBER_CODE,
    env.SITE_PAYSSAM_MERCHANT_CODE, env.SITE_PAYSSAM_API_BASE_URL || null]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`site-shop/payssam-account/v1/${tuple}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function matchesPayssamEnvironment(env, row) {
  return row.payment_provider === 'payssam' && payssam.payssamReady(env) && row.pg_environment === env.SITE_PAYSSAM_MODE
    && row.payssam_account_hash === await payssamAccountHash(env);
}
function hasFiles(env) { return typeof env.SITE_SHOP_FILES?.head === 'function' && typeof env.SITE_SHOP_FILES?.get === 'function'; }
const THUMBNAIL_LIMIT = 2 * 1024 * 1024;
const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PREVIEW_LIMIT = 9;
const previewSchema = z.array(z.object({ id: UUID, key: z.string().max(200), mime: z.enum(THUMBNAIL_TYPES),
  size: z.number().int().positive().max(THUMBNAIL_LIMIT) }).strict()).max(PREVIEW_LIMIT);
function productPreviews(row) {
  // Missing data on older product rows means no additional previews. Invalid
  // descriptors fail closed rather than exposing another product or paid file.
  if (row.preview_images_json == null) return [];
  if (typeof row.preview_images_json !== 'string' || row.preview_images_json.length > 4096) return null;
  let value; try { value = JSON.parse(row.preview_images_json); } catch { return null; }
  const parsed = previewSchema.safeParse(value); if (!parsed.success) return null;
  const images = parsed.data, extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  return new Set(images.map(image => image.id)).size === images.length && images.every(image =>
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(image.id)
      && image.key === `shop-previews/${row.slug}/${image.id}.${extensions[image.mime]}`) ? images : null;
}
function hasThumbnail(row) {
  return typeof row.thumbnail_key === 'string' && row.thumbnail_key.startsWith(`shop-thumbnails/${row.slug}/`)
    && /^shop-thumbnails\/[a-z0-9]+(?:-[a-z0-9]+)*\/v[1-9]\d*-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:png|jpg|webp)$/.test(row.thumbnail_key)
    && THUMBNAIL_TYPES.includes(row.thumbnail_content_type);
}
function productDto(row, env, admin = false) {
  const purchaseChannel = siteShopSalesMode(env), active = productActive(row, env, admin);
  let smartstoreUrl = null;
  if (row.product_type === 'physical') { try { smartstoreUrl = normalizeSmartstoreProductUrl(row.smartstore_url); } catch { /* Stored links must be revalidated before display. */ } }
  let purchaseStatus = purchaseChannel === 'smartstore' ? active && !row.archived_at && smartstoreUrl ? 'ready' : 'preparing' : directProductStatus(row);
  if (purchaseChannel === 'direct' && row.product_type === 'digital' && !hasFiles(env)) purchaseStatus = 'preparing';
  const available = active && !row.archived_at && (purchaseChannel === 'smartstore' ? !!smartstoreUrl
    : siteShopDirectSalesReady(env) && directProductEligible(row) && (row.product_type === 'physical' || hasFiles(env)));
  const value = { id: row.slug, slug: row.slug, name: row.name, description: row.description, productType: row.product_type,
    price: row.price, shippingFee: row.product_type === 'physical' ? row.shipping_fee : 0,
    remoteShippingNote: row.product_type === 'physical' && typeof row.remote_shipping_note === 'string' ? row.remote_shipping_note : '',
    regionalShipping: productRegionalShipping(row), freeShippingThreshold: productFreeShippingThreshold(row), shippingPolicyReady: shippingPolicyReady(row),
    available, purchaseChannel, smartstoreUrl, purchaseStatus,
    maxQuantity: maximumProductQuantity(row),
    thumbnailUrl: hasThumbnail(row) ? `/api/site/${admin ? 'admin/' : ''}products/${row.slug}/thumbnail?v=${row.version}` : null,
    previewImages: (productPreviews(row) || []).map(image => ({ id: image.id,
      url: `/api/site/${admin ? 'admin/' : ''}products/${row.slug}/images/${image.id}?v=${row.version}` })),
    termsVersion: row.terms_version, refundPolicy: row.refund_policy, deliveryPolicy: row.delivery_policy };
  return admin ? { ...value, active, status: row.archived_at ? 'archived' : active ? 'active' : 'draft', archivedAt: row.archived_at,
    stock: row.stock, fileKey: row.file_key, fileName: row.file_name,
    fileContentType: row.file_content_type, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at } : value;
}
async function orderById(db, id, memberId) {
  return db.prepare(`SELECT * FROM site_shop_orders WHERE id=?1${memberId ? ' AND member_id=?2' : ''}`)
    .bind(...(memberId ? [id, memberId] : [id])).first();
}
async function orderDto(env, row, { detail = false, admin = false } = {}) {
  const snapshot = JSON.parse(row.snapshot);
  const quantity = Number.isSafeInteger(snapshot.quantity) && snapshot.quantity >= 1 && snapshot.quantity <= 99 ? snapshot.quantity : 1;
  const discountAmount = Number.isSafeInteger(snapshot.discountAmount) && snapshot.discountAmount >= 0 ? snapshot.discountAmount : 0;
  const itemAmount = row.amount - row.shipping_fee + discountAmount;
  const unitPrice = Number.isSafeInteger(snapshot.unitPrice) && snapshot.unitPrice > 0 ? snapshot.unitPrice
    : Number.isSafeInteger(snapshot.price) && snapshot.price > 0 ? snapshot.price : itemAmount / quantity;
  const currentProduct = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(row.product_slug).first();
  const thumbnailUrl = currentProduct && !currentProduct.archived_at && productActive(currentProduct, env) ? productDto(currentProduct, env).thumbnailUrl : null;
  const refunds = (await env.GAME_DB.prepare('SELECT * FROM site_shop_refunds WHERE order_id=?1 ORDER BY created_at DESC').bind(row.id).all()).results;
  const unsettled = refunds.some(refund => ['pending', 'approving', 'unknown'].includes(refund.state));
  const uncertainRefund = refunds.some(refund => ['approving', 'unknown'].includes(refund.state));
  const refundable = !!row.approved_at && ['paid', 'partially_refunded'].includes(row.status) && row.refunded_amount < row.amount;
  const adminCanRefund = refundable && !uncertainRefund;
  const checkout = await checkoutDto(env, row);
  const canResume = !!checkout && ['not_created', 'ready'].includes(checkout.status);
  const canDownload = row.product_type === 'digital' && !!row.approved_at && ['paid', 'partially_refunded'].includes(row.status)
    && row.refunded_amount < row.amount && !uncertainRefund && hasFiles(env);
  const value = { id: row.id, kind: 'shop', paymentProvider: row.payment_provider, productId: row.product_slug, productType: row.product_type, orderName: snapshot.name,
    amount: row.amount, shippingFee: row.shipping_fee, quantity, unitPrice, itemAmount, discountAmount, coupon: snapshot.coupon || null,
    remoteShippingNote: row.product_type === 'physical' && typeof snapshot.remoteShippingNote === 'string' ? snapshot.remoteShippingNote : '',
    shippingBreakdown: orderShippingBreakdown(snapshot, row),
    freeShippingThreshold: row.product_type === 'physical' && Number.isSafeInteger(snapshot.freeShippingThreshold)
      && snapshot.freeShippingThreshold >= 0 && snapshot.freeShippingThreshold <= 1_000_000_000 ? snapshot.freeShippingThreshold : null,
    status: row.status, paymentMethod: row.payment_method, thumbnailUrl,
    paidAt: row.approved_at, refundedAmount: row.refunded_amount, canResume, canDownload,
    canRefund: admin ? adminCanRefund : refundable && !unsettled,
    shipping: { status: row.shipping_status, carrier: row.carrier, trackingNumber: row.tracking_number },
    refunds: refunds.map(refund => ({ id: refund.id, amount: refund.approved_amount ?? refund.requested_amount,
      reason: refund.approved_reason ?? refund.reason, status: refund.state === 'rejected' && refund.closed_by === 'member' ? 'withdrawn' : refund.state,
      version: refund.version, closureReason: refund.closure_reason, closedBy: refund.closed_by, closedAt: refund.closed_at,
      canWithdraw: !admin && refund.state === 'pending', canReject: admin && refund.state === 'pending',
      requestedAt: refund.created_at, approvedAt: refund.approved_at })),
    refundReason: refunds[0]?.approved_reason || refunds[0]?.reason || null, createdAt: row.created_at };
  if (snapshot.purchaseType === 'bundle') {
    if (!Array.isArray(snapshot.items) || !snapshot.items.length || snapshot.items.length > 30) throw new Error('bundle_snapshot_invalid');
    const downloadable = !!row.approved_at && ['paid','partially_refunded'].includes(row.status) && row.refunded_amount < row.amount && !uncertainRefund && hasFiles(env);
    const counts = admin ? new Map((await env.GAME_DB.prepare('SELECT id,download_count FROM site_shop_order_items WHERE order_id=?1').bind(row.id).all()).results.map(item => [item.id,item.download_count])) : new Map();
    Object.assign(value, { purchaseType: 'bundle', unitPrice: null, quantity: snapshot.items.reduce((sum,item) => sum + item.quantity,0), coupon: null, freeShippingThreshold: null, canDownload: false,
      items: snapshot.items.map(item => ({ id: item.id, productId: item.productId, productType: item.productType, name: item.name, quantity: item.quantity,
        unitPrice: item.unitPrice, itemAmount: item.itemAmount, discountAmount: item.discountAmount, coupon: item.coupon || null, amount: item.amount,
        baseShippingFee: item.baseShippingFee, shippingBreakdown: item.shippingBreakdown, freeShippingThreshold: item.freeShippingThreshold ?? null,
        regionalShipping: item.regionalShipping, remoteShippingNote: item.remoteShippingNote || '', thumbnailUrl: item.thumbnailUrl || null,
        fileName: item.productType === 'digital' ? item.fileName : null, canDownload: item.productType === 'digital' && downloadable,
        termsVersion: item.termsVersion, refundPolicy: item.refundPolicy, deliveryPolicy: item.deliveryPolicy,
        ...(admin ? { downloadCount: counts.get(item.id) || 0 } : {}) })) });
  }
  return detail || admin ? { ...value, customerName: snapshot.customerName, customerPhone: snapshot.customerPhone,
    shippingAddress: snapshot.shipping || null, termsVersion: snapshot.termsVersion, refundPolicy: snapshot.refundPolicy,
    deliveryPolicy: snapshot.deliveryPolicy, ...(admin ? { memberId: row.member_id, downloadCount: value.purchaseType === 'bundle' ? value.items.reduce((sum,item) => sum + item.downloadCount,0) : row.download_count, version: row.admin_version } : {}) } : value;
}
async function checkoutDto(env, row) {
  // Legacy NICEPAY credentials and callback proofs are never returned to the browser.
  if (row.payment_provider !== 'payssam') return null;
  if (siteShopSalesMode(env) !== 'direct') return { provider: 'payssam', paymentUrl: null, paymentOrigin: null, status: 'unavailable' };
  let status = row.status;
  if (row.status === 'pending') status = row.payssam_bill_state === 'not_created' ? 'not_created'
    : row.payssam_bill_state === 'ready' ? 'ready' : row.payssam_bill_state === 'creating' && row.lease_token ? 'creating' : 'confirming';
  if (row.expires_at <= now() && ['not_created', 'ready'].includes(status)) status = 'confirming';
  const configured = siteShopDirectSalesReady(env) && await matchesPayssamEnvironment(env, row);
  let paymentUrl = null;
  if (status === 'ready' && configured) {
    try { paymentUrl = payssam.validPayssamPaymentUrl(env, row.payssam_payment_url); } catch { /* Never expose an unverified stored URL. */ }
  }
  if (status === 'ready' && !paymentUrl) status = 'confirming';
  if (status === 'not_created' && !configured) status = 'confirming';
  return { provider: 'payssam', paymentUrl, paymentOrigin: paymentUrl ? new URL(paymentUrl).origin : null, status };
}
async function saveProduct(request, env, pathSlug) {
  const parsed = await bodyOf(request, productSchema(env), 64 * 1024); if (parsed.response) return parsed.response;
  const value = parsed.value;
  const active = value.status ? value.status === 'active' : !!value.active;
  if (request.method === 'PUT' && !value.version) return fail(400, '상품 버전을 확인해주세요.', 'version_required');
  if (pathSlug && pathSlug !== value.slug) return fail(400, '상품 경로와 식별자를 확인해주세요.');
  const direct = siteShopSalesMode(env) === 'direct';
  if (direct && active && value.productType === 'digital') {
    if (!hasFiles(env)) return preparing();
    if (!await env.SITE_SHOP_FILES.head(value.fileKey)) return fail(409, '전달할 상품 파일을 확인해주세요.');
  }
  const previous = request.method === 'PUT' ? await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(value.slug).first() : null;
  const retain = key => value[key] === undefined && previous && previous.product_type === value.productType;
  const at = now(), fields = [value.slug, value.name, value.description, value.productType, value.price,
    value.productType === 'physical' ? retain('shippingFee') ? previous.shipping_fee : value.shippingFee ?? null : 0,
    value.productType === 'physical' ? retain('stock') ? previous.stock : value.stock ?? null : null,
    direct && active ? 1 : 0, value.termsVersion, value.refundPolicy, value.deliveryPolicy,
    value.productType === 'digital' ? retain('fileKey') ? previous.file_key : value.fileKey ?? null : null,
    value.productType === 'digital' ? retain('fileName') ? previous.file_name : value.fileName ?? null : null,
    value.fileContentType, at, value.status === 'archived' ? at : null,
    value.productType === 'digital' ? null : value.smartstoreUrl === undefined && previous ? previous.smartstore_url : normalizeSmartstoreProductUrl(value.smartstoreUrl),
    direct ? null : active ? 1 : 0,
    value.productType === 'physical' ? retain('remoteShippingNote') ? previous.remote_shipping_note || '' : value.remoteShippingNote ?? '' : '',
    value.productType === 'physical' ? retain('regionalShipping') ? previous.regional_shipping_json ?? null
      : value.regionalShipping ? JSON.stringify(value.regionalShipping) : null : null,
    value.productType === 'physical' ? retain('freeShippingThreshold') ? previous.free_shipping_threshold ?? null : value.freeShippingThreshold ?? null : null];
  const effectiveProduct = { product_type: value.productType, shipping_fee: fields[5], free_shipping_threshold: fields[20] };
  const baseFee = chargedBaseShippingFee(effectiveProduct, value.price) || 0;
  if (value.price + baseFee > 1_000_000_000 || direct && active && value.price + baseFee < 100) {
    return fail(400, '최종 상품 결제금액을 확인해주세요.');
  }
  if (value.productType === 'physical' && fields[19] != null) {
    const effectivePolicy = productRegionalShipping({ product_type: 'physical', regional_shipping_json: fields[19] });
    if (!effectivePolicy || value.price + baseFee + Math.max(effectivePolicy.jejuExtraFee || 0, effectivePolicy.remoteExtraFee || 0) > 1_000_000_000) {
      return fail(400, '지역별 최종 배송금액과 설정값을 확인해주세요.');
    }
  }
  if (request.method === 'POST') {
    const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`INSERT INTO site_shop_products(slug,name,description,product_type,price,shipping_fee,stock,active,
      terms_version,refund_policy,delivery_policy,file_key,file_name,file_content_type,created_at,updated_at,archived_at,smartstore_url,smartstore_active,remote_shipping_note,regional_shipping_json,free_shipping_threshold)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16,?17,?18,?19,?20,?21) ON CONFLICT(slug) DO NOTHING RETURNING *`).bind(...fields),
      siteAdminAuditStatement(env.GAME_DB, 'product.create', `product:${value.slug}`, 'success', { conditional: true, at })]);
    const row = results[0].results[0];
    return row ? siteJson({ product: productDto(row, env, true) }, { status: 201 }) : fail(409, '이미 등록된 상품 식별자입니다.');
  }
  if (!previous) return fail(404, '상품을 찾을 수 없습니다.');
  if (previous.version !== value.version) return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
  if (previous && previous.product_type !== value.productType
    && await env.GAME_DB.prepare('SELECT id FROM site_shop_orders WHERE product_slug=?1 UNION ALL SELECT order_id AS id FROM site_shop_order_items WHERE product_slug=?1 LIMIT 1').bind(value.slug).first()) {
    return fail(409, '구매내역이 있는 상품의 전달 유형은 변경할 수 없습니다. 새 상품으로 등록해주세요.');
  }
  const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_products SET name=?2,description=?3,product_type=?4,price=?5,shipping_fee=?6,
    stock=?7,active=?8,terms_version=?9,refund_policy=?10,delivery_policy=?11,file_key=?12,file_name=?13,file_content_type=?14,
    version=version+1,updated_at=?15,archived_at=?16,smartstore_url=?17,smartstore_active=?18,remote_shipping_note=?19,regional_shipping_json=?20,free_shipping_threshold=?21 WHERE slug=?1 AND version=?22 RETURNING *`).bind(...fields, value.version),
    siteAdminAuditStatement(env.GAME_DB, 'product.update', `product:${value.slug}`, 'success', { conditional: true, at })]);
  const row = results[0].results[0];
  return row ? siteJson({ product: productDto(row, env, true) }) : fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
}
async function archiveProduct(request, env, productSlug) {
  const parsed = await bodyOf(request, z.object({ version: z.number().int().positive() }).strict()); if (parsed.response) return parsed.response;
  const at = now();
  const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_products SET active=0,smartstore_active=0,archived_at=COALESCE(archived_at,?3),
    version=version+1,updated_at=?3 WHERE slug=?1 AND version=?2 RETURNING *`).bind(productSlug, parsed.value.version, at),
    siteAdminAuditStatement(env.GAME_DB, 'product.archive', `product:${productSlug}`, 'success', { conditional: true, at })]);
  const row = results[0].results[0];
  if (!row) { await recordSiteAdminAction(env, 'product.archive', `product:${productSlug}`, 'conflict'); return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
  return siteJson({ product: productDto(row, env, true) });
}
async function removeUnpublishedThumbnail(env, key) {
  if (typeof env.SITE_SHOP_FILES?.delete === 'function') { try { await env.SITE_SHOP_FILES.delete(key); } catch { /* An unreferenced object is never exposed by the thumbnail route. */ } }
}
async function readProductImageUpload(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('multipart/form-data')) return { response: fail(400, '이미지 업로드 형식을 확인해주세요.') };
  const raw = await boundedBytes(request, THUMBNAIL_LIMIT + 64 * 1024);
  if (!raw) return { response: fail(413, '상품 이미지는 2MiB 이하로 등록해주세요.') };
  let form; try { form = await new Response(raw, { headers: { 'Content-Type': type } }).formData(); } catch { return { response: fail(400, '이미지 업로드 형식을 확인해주세요.') }; }
  if ([...form.keys()].some(key => !['file','version'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('version').length !== 1) return { response: fail(400, '업로드 필드를 확인해주세요.') };
  const file = form.get('file'), rawVersion = form.get('version');
  if (!(file instanceof File) || typeof rawVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(rawVersion)
    || file.size < 1 || file.name.length > 160 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return { response: fail(400, '이미지와 상품 버전을 확인해주세요.') };
  if (file.size > THUMBNAIL_LIMIT) return { response: fail(413, '상품 이미지는 2MiB 이하로 등록해주세요.') };
  const bytes = new Uint8Array(await file.arrayBuffer()), image = rasterImageInfo(bytes);
  const extension = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  if (!image || !extension || (extension === 'jpeg' ? 'jpg' : extension) !== image.extension || file.type && file.type !== image.type) return { response: fail(400, '4096px 이하의 PNG, JPEG 또는 WebP 이미지를 등록해주세요.') };
  return { file, bytes, image, version: Number(rawVersion) };
}
async function uploadProductThumbnail(request, env, productSlug) {
  if (typeof env.SITE_SHOP_FILES?.put !== 'function' || typeof env.SITE_SHOP_FILES?.get !== 'function') return preparing();
  const parsed = await readProductImageUpload(request); if (parsed.response) return parsed.response;
  const { bytes, image, version } = parsed;
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  if (!row) return fail(404, '상품을 찾을 수 없습니다.');
  if (row.version !== version) return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
  if (row.archived_at) return fail(409, '보관한 상품에는 이미지를 등록할 수 없어요.');
  const key = `shop-thumbnails/${productSlug}/v${version + 1}-${crypto.randomUUID()}.${image.extension}`, at = now();
  try { await env.SITE_SHOP_FILES.put(key, bytes, { httpMetadata: { contentType: image.type }, customMetadata: { productSlug, version: String(version + 1) } }); }
  catch { await removeUnpublishedThumbnail(env, key); return fail(503, '이미지를 저장하지 못했어요. 다시 확인해주세요.'); }
  let results;
  try { results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_products SET thumbnail_key=?2,thumbnail_content_type=?3,
    version=version+1,updated_at=?4 WHERE slug=?1 AND version=?5 AND archived_at IS NULL RETURNING *`).bind(productSlug, key, image.type, at, version),
    siteAdminAuditStatement(env.GAME_DB, 'product.thumbnail', `product:${productSlug}`, 'success', { conditional: true, at })]); }
  catch {
    // A database response can fail after commit. Remove only a proven orphan.
    try { const current = await env.GAME_DB.prepare('SELECT thumbnail_key FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
      if (current?.thumbnail_key !== key) await removeUnpublishedThumbnail(env, key); } catch { /* Keep an ambiguous object until the saved product is checked. */ }
    return fail(503, '이미지 등록 결과를 확인하지 못했어요. 상품을 다시 확인해주세요.');
  }
  const saved = results[0].results[0];
  if (!saved) { await removeUnpublishedThumbnail(env, key); return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
  // Previously published thumbnail objects remain safe for reads already in flight.
  return siteJson({ product: productDto(saved, env, true) });
}
async function productThumbnail(env, productSlug, admin = false) {
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  const visible = value => value && hasThumbnail(value) && !value.archived_at && (admin || productActive(value, env));
  if (!visible(row)) return fail(404, '공개된 상품 이미지를 찾을 수 없습니다.');
  if (typeof env.SITE_SHOP_FILES?.get !== 'function') return preparing();
  const object = await env.SITE_SHOP_FILES.get(row.thumbnail_key);
  if (!object?.body) return fail(404, '상품 이미지를 찾을 수 없습니다.');
  const current = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  if (!visible(current) || current.thumbnail_key !== row.thumbnail_key || current.thumbnail_content_type !== row.thumbnail_content_type) {
    await object.body.cancel().catch(() => {}); return fail(404, '공개된 상품 이미지를 찾을 수 없습니다.');
  }
  return new Response(object.body, { headers: { 'Content-Type': current.thumbnail_content_type, 'Cache-Control': 'no-store',
    'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Robots-Tag': 'noindex, nofollow' } });
}
async function editableProductPreviews(env, productSlug, version) {
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  if (!row) return { response: fail(404, '상품을 찾을 수 없습니다.') };
  if (row.version !== version) return { response: fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict') };
  if (row.archived_at) return { response: fail(409, '보관한 상품의 미리보기는 변경할 수 없어요.') };
  const images = productPreviews(row);
  return images ? { row, images } : { response: fail(409, '상품 이미지 정보를 확인할 수 없어요. 상품을 다시 확인해주세요.', 'preview_metadata_invalid') };
}
async function saveProductPreviews(env, row, images, action) {
  const at = now();
  const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_products SET preview_images_json=?2,
    version=version+1,updated_at=?3 WHERE slug=?1 AND version=?4 AND archived_at IS NULL RETURNING *`)
    .bind(row.slug, JSON.stringify(images), at, row.version),
    siteAdminAuditStatement(env.GAME_DB, action, `product:${row.slug}`, 'success', { conditional: true, at })]);
  return results[0].results[0] || null;
}
async function uploadProductPreview(request, env, productSlug) {
  if (typeof env.SITE_SHOP_FILES?.put !== 'function' || typeof env.SITE_SHOP_FILES?.get !== 'function') return preparing();
  const parsed = await readProductImageUpload(request); if (parsed.response) return parsed.response;
  const { file, bytes, image, version } = parsed;
  const previous = await editableProductPreviews(env, productSlug, version); if (previous.response) return previous.response;
  if (previous.images.length >= PREVIEW_LIMIT) return fail(409, '미리보기 이미지는 최대 9장까지 등록할 수 있어요.', 'preview_limit');
  const id = crypto.randomUUID(), key = `shop-previews/${productSlug}/${id}.${image.extension}`;
  try {
    const stored = await env.SITE_SHOP_FILES.put(key, bytes, { httpMetadata: { contentType: image.type }, customMetadata: { productSlug, imageId: id } });
    if (stored === null) throw new Error('preview_not_stored');
  } catch { await removeUnpublishedThumbnail(env, key); return fail(503, '이미지를 저장하지 못했어요. 다시 확인해주세요.'); }
  let saved;
  try { saved = await saveProductPreviews(env, previous.row, [...previous.images, { id, key, mime: image.type, size: file.size }], 'product.preview.add'); }
  catch {
    // A lost database response may follow a successful commit. Only a valid,
    // confirmed current descriptor set can establish that this object is orphaned.
    try {
      const current = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
      const images = current ? productPreviews(current) : [];
      if (images && !images.some(value => value.key === key)) await removeUnpublishedThumbnail(env, key);
    } catch { /* Preserve ambiguous objects until their product can be checked. */ }
    return fail(503, '이미지 등록 결과를 확인하지 못했어요. 상품을 다시 확인해주세요.');
  }
  if (!saved) { await removeUnpublishedThumbnail(env, key); return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
  return siteJson({ product: productDto(saved, env, true) });
}
async function reorderProductPreviews(request, env, productSlug) {
  const parsed = await bodyOf(request, z.object({ version: z.number().int().positive(), imageIds: z.array(UUID).max(PREVIEW_LIMIT) }).strict());
  if (parsed.response) return parsed.response;
  const previous = await editableProductPreviews(env, productSlug, parsed.value.version); if (previous.response) return previous.response;
  const ids = parsed.value.imageIds, byId = new Map(previous.images.map(image => [image.id, image]));
  if (ids.length !== previous.images.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
    return fail(400, '등록된 미리보기 이미지의 전체 순서를 확인해주세요.');
  }
  const saved = await saveProductPreviews(env, previous.row, ids.map(id => byId.get(id)), 'product.preview.reorder');
  return saved ? siteJson({ product: productDto(saved, env, true) }) : fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
}
async function deleteProductPreview(request, env, productSlug, imageId) {
  const parsed = await bodyOf(request, z.object({ version: z.number().int().positive() }).strict()); if (parsed.response) return parsed.response;
  const previous = await editableProductPreviews(env, productSlug, parsed.value.version); if (previous.response) return previous.response;
  if (!previous.images.some(image => image.id === imageId)) return fail(404, '상품 미리보기를 찾을 수 없습니다.');
  const saved = await saveProductPreviews(env, previous.row, previous.images.filter(image => image.id !== imageId), 'product.preview.delete');
  // Retain formerly published unique objects for reads already in flight; the
  // descriptor removal immediately denies all new public and admin image reads.
  return saved ? siteJson({ product: productDto(saved, env, true) }) : fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
}
async function productPreview(env, productSlug, imageId, admin = false) {
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  const visible = value => value && !value.archived_at && (admin || productActive(value, env));
  const find = value => visible(value) ? productPreviews(value)?.find(image => image.id === imageId) : null;
  const image = find(row); if (!image) return fail(404, '공개된 상품 미리보기를 찾을 수 없습니다.');
  if (typeof env.SITE_SHOP_FILES?.get !== 'function') return preparing();
  const object = await env.SITE_SHOP_FILES.get(image.key); if (!object?.body) return fail(404, '상품 미리보기를 찾을 수 없습니다.');
  const current = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first(), latest = find(current);
  if (!latest || latest.key !== image.key || latest.mime !== image.mime || latest.size !== image.size) {
    await object.body.cancel().catch(() => {}); return fail(404, '공개된 상품 미리보기를 찾을 수 없습니다.');
  }
  return new Response(object.body, { headers: { 'Content-Type': latest.mime, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Robots-Tag': 'noindex, nofollow' } });
}
async function uploadProductFile(request, env, productSlug) {
  if (typeof env.SITE_SHOP_FILES?.put !== 'function') return preparing();
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('multipart/form-data')) return fail(400, '파일 업로드 형식을 확인해주세요.');
  const raw = await boundedBytes(request, 20 * 1024 * 1024 + 64 * 1024);
  if (!raw) return fail(413, '파일은 20MiB 이하로 등록해주세요.');
  let form; try { form = await new Response(raw, { headers: { 'Content-Type': type } }).formData(); } catch { return fail(400, '파일 업로드 형식을 확인해주세요.'); }
  if ([...form.keys()].some(key => !['file','version'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('version').length !== 1) return fail(400, '업로드 필드를 확인해주세요.');
  const file = form.get('file'), rawVersion = form.get('version');
  if (typeof rawVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(rawVersion) || !(file instanceof File)
    || file.size < 1 || file.size > 20 * 1024 * 1024 || file.name.length > 160 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return fail(400, '파일과 상품 버전을 확인해주세요.');
  const extension = file.name.toLowerCase().match(/\.(pdf|zip)$/)?.[1];
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pdf = extension === 'pdf' && new TextDecoder().decode(header.slice(0, 5)) === '%PDF-';
  const zip = extension === 'zip' && header[0] === 0x50 && header[1] === 0x4b && [[3,4],[5,6],[7,8]].some(pair => header[2] === pair[0] && header[3] === pair[1]);
  if ((!pdf && !zip) || file.type && !['application/pdf','application/zip','application/x-zip-compressed','application/octet-stream'].includes(file.type)) return fail(400, 'PDF 또는 ZIP 파일만 등록할 수 있어요.');
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(productSlug).first();
  if (!row) return fail(404, '상품을 찾을 수 없습니다.');
  const version = Number(rawVersion);
  if (row.version !== version) return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
  if (row.product_type !== 'digital' || productActive(row, env, true) || row.archived_at) return fail(409, '판매 전 디지털 상품의 초안에서 파일을 등록해주세요.');
  const key = `shop/${productSlug}/v${version + 1}-${crypto.randomUUID()}.${extension}`, contentType = pdf ? 'application/pdf' : 'application/zip', at = now();
  try { await env.SITE_SHOP_FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType }, customMetadata: { productSlug, version: String(version + 1) } }); }
  catch { return fail(503, '파일을 저장하지 못했어요. 다시 확인해주세요.'); }
  const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_products SET file_key=?2,file_name=?3,file_content_type=?4,
    version=version+1,updated_at=?5 WHERE slug=?1 AND version=?6 AND ${productActiveSql(env, true)}=0 AND archived_at IS NULL AND product_type='digital' RETURNING *`)
    .bind(productSlug, key, file.name, contentType, at, version),
    siteAdminAuditStatement(env.GAME_DB, 'product.file', `product:${productSlug}`, 'success', { conditional: true, at })]);
  const saved = results[0].results[0];
  if (!saved) {
    // Only this never-published unique object may be removed. Old purchase files remain intact.
    if (typeof env.SITE_SHOP_FILES.delete === 'function') { try { await env.SITE_SHOP_FILES.delete(key); } catch { /* An unreferenced private object is harmless to purchase access. */ } }
    return fail(409, '상품이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
  }
  return siteJson({ product: productDto(saved, env, true) });
}
async function listProducts(env, url, admin) {
  let params; try { params = siteListParams(url, admin ? 'admin-products' : 'public-products',
    { productType: ['digital','physical'], ...(admin ? { status: ['draft','active','archived'] } : {}) }); }
  catch { return fail(400, '상품 목록 조건을 확인해주세요.'); }
  const values = [], conditions = [], bind = value => { values.push(value); return `?${values.length}`; };
  const activeColumn = productActiveSql(env, admin);
  if (!admin) conditions.push(`${activeColumn}=1 AND archived_at IS NULL`);
  if (params.filters.status === 'archived') conditions.push('archived_at IS NOT NULL');
  if (params.filters.status === 'active') conditions.push(`${activeColumn}=1 AND archived_at IS NULL`);
  if (params.filters.status === 'draft') conditions.push(`${activeColumn}=0 AND archived_at IS NULL`);
  if (params.filters.productType) conditions.push(`product_type=${bind(params.filters.productType)}`);
  if (params.q) { const q = bind(siteLike(params.q)); conditions.push(`(name LIKE ${q} ESCAPE '\\' OR slug LIKE ${q} ESCAPE '\\')`); }
  if (params.cursor) { const time = bind(params.cursor.time), id = bind(params.cursor.id); conditions.push(`(created_at<${time} OR (created_at=${time} AND slug<${id}))`); }
  const rows = (await env.GAME_DB.prepare(`SELECT * FROM site_shop_products ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY created_at DESC,slug DESC LIMIT ${bind(params.limit + 1)}`).bind(...values).all()).results;
  const page = rows.slice(0, params.limit);
  const suppressedCuratedProducts = admin ? null : (await env.GAME_DB.prepare(`SELECT slug FROM site_shop_products
    WHERE slug IN (${CURATED_LEGACY_PRODUCT_IDS.map((_, index) => `?${index + 1}`).join(',')}) AND archived_at IS NOT NULL`)
    .bind(...CURATED_LEGACY_PRODUCT_IDS).all()).results.map(row => row.slug);
  return siteJson({ products: page.map(row => productDto(row, env, admin)), nextCursor: rows.length > params.limit ? siteNextCursor(params, page.at(-1)) : null,
    ...(!admin ? { status: 'ready', purchaseChannel: siteShopSalesMode(env), purchaseReady: siteShopDirectSalesReady(env), suppressedCuratedProducts } : {}) });
}
export function siteShopAttentionConditions(alias = 'o') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('invalid_shop_alias');
  return {
    payment_attention: `(${alias}.status='confirming' OR (${alias}.status='pending' AND ${alias}.payssam_bill_state IN ('creating','unknown','destroying')) OR EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=${alias}.id AND r.state IN ('approving','unknown')))`,
    shipping_pending: `(${alias}.approved_at IS NOT NULL AND ${alias}.status IN ('paid','partially_refunded') AND ${alias}.shipping_status IN ('pending','processing') AND (${alias}.product_type='physical' OR EXISTS(SELECT 1 FROM site_shop_order_items i WHERE i.order_id=${alias}.id AND i.product_type='physical')) AND NOT EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=${alias}.id AND r.state IN ('pending','approving','unknown')))`,
    refund_pending: `EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=${alias}.id AND r.state='pending')`,
  };
}
async function listShopOrders(env, url, { memberId } = {}) {
  let params; try { params = siteListParams(url, memberId ? 'member-shop-orders' : 'admin-shop-orders',
    { status: ['pending','confirming','paid','partially_refunded','refunded','failed','expired'], productType: ['digital','physical'],
      ...(!memberId ? { refundStatus: ['pending','approving','unknown','completed','failed','rejected','withdrawn'], hasRefund: ['true','false'],
        filter: ['payment_attention','shipping_pending','refund_pending'] } : {}) }); }
  catch { return fail(400, '주문 목록 조건을 확인해주세요.'); }
  const values = [], conditions = [], bind = value => { values.push(value); return `?${values.length}`; };
  if (memberId) conditions.push(`o.member_id=${bind(memberId)}`);
  if (params.filters.status) conditions.push(`o.status=${bind(params.filters.status)}`);
  if (params.filters.productType) { const selectedType = bind(params.filters.productType); conditions.push(`(o.product_type=${selectedType} OR EXISTS(SELECT 1 FROM site_shop_order_items i WHERE i.order_id=o.id AND i.product_type=${selectedType}))`); }
  if (params.filters.refundStatus) {
    const selected = params.filters.refundStatus;
    conditions.push(`EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=o.id AND r.state=${bind(selected === 'withdrawn' ? 'rejected' : selected)}${selected === 'withdrawn' ? " AND r.closed_by='member'" : selected === 'rejected' ? " AND (r.closed_by IS NULL OR r.closed_by='admin')" : ''})`);
  }
  if (params.filters.filter) conditions.push(siteShopAttentionConditions()[params.filters.filter]);
  if (params.filters.hasRefund) conditions.push(`${params.filters.hasRefund === 'false' ? 'NOT ' : ''}EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=o.id)`);
  if (params.q) {
    const q = bind(siteLike(params.q));
    conditions.push(`(o.id LIKE ${q} ESCAPE '\\' OR o.product_slug LIKE ${q} ESCAPE '\\' OR json_extract(o.snapshot,'$.name') LIKE ${q} ESCAPE '\\'
      OR EXISTS(SELECT 1 FROM site_shop_order_items i WHERE i.order_id=o.id AND (i.product_slug LIKE ${q} ESCAPE '\\' OR json_extract(i.snapshot,'$.name') LIKE ${q} ESCAPE '\\'))
      ${memberId ? '' : `OR json_extract(o.snapshot,'$.customerName') LIKE ${q} ESCAPE '\\' OR m.email LIKE ${q} ESCAPE '\\'`})`);
  }
  if (params.cursor) { const time = bind(params.cursor.time), id = bind(params.cursor.id); conditions.push(`(o.created_at<${time} OR (o.created_at=${time} AND o.id<${id}))`); }
  const rows = (await env.GAME_DB.prepare(`SELECT o.* FROM site_shop_orders o JOIN site_members m ON m.id=o.member_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY o.created_at DESC,o.id DESC LIMIT ${bind(params.limit + 1)}`).bind(...values).all()).results;
  const page = rows.slice(0, params.limit);
  return siteJson({ orders: await Promise.all(page.map(row => orderDto(env, row, { admin: !memberId }))),
    nextCursor: rows.length > params.limit ? siteNextCursor(params, page.at(-1)) : null });
}
function shippingFailure(code) {
  return code === 'shipping_configuration_pending' ? fail(409, '지역 배송비 설정을 확인한 뒤 구매할 수 있습니다.', code)
    : fail(400, code === 'shipping_address_mismatch' ? '우편번호와 배송 주소의 지역이 일치하는지 확인해주세요.' : '배송 우편번호와 주소를 확인해주세요.', code);
}
async function destinationQuote(env, product, quantity, destination, memberId) {
  const itemAmount = product.price * quantity;
  const delivery = destinationShipping(product, destination, itemAmount);
  if (delivery.error) return { response: shippingFailure(delivery.error) };
  const shippingFee = delivery.shipping.fee;
  let amount = itemAmount + shippingFee, discountAmount = 0, chosenCoupon = null;
  if (!Number.isSafeInteger(amount) || amount > 1_000_000_000) return { response: fail(400, '최종 상품 결제금액을 확인해주세요.', 'payment_amount') };
  if (amount < 100) return { response: fail(400, '최종 상품 결제금액을 확인해주세요.', 'payment_minimum') };
  if (destination.couponId) {
    const selected = await selectedCoupon(env, destination.couponId, memberId, { productId: product.slug, itemAmount, shippingFee });
    if (!selected.applicable) return { response: fail(409, selected.reason, 'coupon_unavailable') };
    chosenCoupon = selected.row; discountAmount = selected.discountAmount; amount = selected.amount;
  }
  return { quote: { quantity, unitPrice: product.price, itemAmount, shippingFee, discountAmount, amount,
    coupon: chosenCoupon ? couponDto(chosenCoupon) : null, freeShippingThreshold: productFreeShippingThreshold(product) }, shipping: delivery.shipping, policy: delivery.policy, chosenCoupon };
}
async function shippingQuote(request, env, member) {
  if (new URL(request.url).search) return fail(400,'배송지 정보는 요청 본문으로 전달해주세요.');
  if (siteShopSalesMode(env) !== 'direct') return externalCheckout();
  const parsed = await bodyOf(request, shippingQuoteSchema); if (parsed.response) return parsed.response;
  if (!siteShopDirectSalesReady(env)) return preparing();
  const input = parsed.value;
  const product = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1 AND active=1 AND archived_at IS NULL').bind(input.productId).first();
  if (!product) return fail(404, '판매 중인 상품을 찾을 수 없습니다.');
  if (!directProductEligible(product) || input.quantity > maximumProductQuantity(product)) return fail(409, '상품 수량과 구매 조건을 확인해주세요.', 'product_not_ready');
  const result = await destinationQuote(env, product, input.quantity, input, member.id);
  return result.response || siteJson({ quote: result.quote, shipping: result.shipping, productVersion: product.version });
}
function bundleHelpers(env) {
  return { eligible: directProductEligible, maximumQuantity: maximumProductQuantity, filesReady: () => hasFiles(env),
    productDto: product => productDto(product,env), directReady: () => siteShopDirectSalesReady(env),
    expireReadyOrders: () => expireReadyOrders(env), orderDto: (row,options) => orderDto(env,row,options), checkoutDto: row => checkoutDto(env,row),
    accountHash: () => payssamAccountHash(env), opaque };
}
async function cartQuote(request,env,member) {
  if (new URL(request.url).search) return fail(400,'배송지 정보는 요청 본문으로 전달해주세요.');
  if (siteShopSalesMode(env) !== 'direct') return externalCheckout();
  const parsed = await bodyOf(request,cartQuoteSchema); if (parsed.response) return parsed.response;
  if (!siteShopDirectSalesReady(env)) return preparing();
  const result = await priceBundle(env,member.id,parsed.value,bundleHelpers(env));
  return result.response || siteJson(bundleQuoteDto(result));
}
async function createOrder(request, env, member) {
  if (siteShopSalesMode(env) !== 'direct') return externalCheckout();
  const parsed = await bodyOf(request, z.union([orderSchema,bundleOrderSchema])); if (parsed.response) return parsed.response;
  if (parsed.value.items) return createBundleOrder(env,member,parsed.value,bundleHelpers(env));
  const input = parsed.value, db = env.GAME_DB;
  const quantity = input.quantity;
  // Quantity one uses the original canonical JSON, including legacy HMAC retries.
  if (quantity === 1) delete input.quantity;
  const keyTuple = `${member.id}:${input.idempotencyKey}`, payload = JSON.stringify(input);
  const [keyDigest, payloadDigest, legacyKey, legacyPayload] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(`site-shop/order-key/v2/${keyTuple}`)),
    crypto.subtle.digest('SHA-256', encoder.encode(`site-shop/order-payload/v2/${payload}`)),
    hash(env, 'order-key', keyTuple), hash(env, 'order-payload', payload),
  ]);
  const retryHash = Array.from(new Uint8Array(keyDigest), byte => byte.toString(16).padStart(2, '0')).join('');
  const payloadHash = Array.from(new Uint8Array(payloadDigest), byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = await db.prepare('SELECT * FROM site_shop_orders WHERE idempotency_hash IN (?1,?2)').bind(retryHash, legacyKey).first();
  if (existing) return existing.member_id === member.id && [payloadHash, legacyPayload].includes(existing.payload_hash)
    ? siteJson({ order: await orderDto(env, existing, { detail: true }), checkout: await checkoutDto(env, existing) })
    : fail(409, '기존 주문과 입력 내용이 다릅니다. 구매내역을 확인해주세요.');
  if (!siteShopDirectSalesReady(env)) return preparing();
  await expireReadyOrders(env);
  const product = await db.prepare('SELECT * FROM site_shop_products WHERE slug=?1 AND active=1 AND archived_at IS NULL').bind(input.productId).first();
  if (!product) return fail(404, '판매 중인 상품을 찾을 수 없습니다.');
  if (input.shippingQuoteVersion && input.shippingQuoteVersion !== product.version) return fail(409, '상품과 배송비가 변경됐어요. 최신 금액을 확인해주세요.', 'shipping_quote_changed');
  if (!directProductEligible(product)) return fail(409, '상품 판매 준비와 재고를 확인해주세요.', 'product_not_ready');
  if (!nameText(80).safeParse(product.name).success) return fail(409, '상품 구매 정보를 확인해주세요.');
  const baseAmount = product.price * quantity + chargedBaseShippingFee(product, product.price * quantity);
  if (!Number.isSafeInteger(baseAmount) || baseAmount > 1_000_000_000) return fail(400, '최종 상품 결제금액을 확인해주세요.', 'payment_amount');
  if (baseAmount < 100) return fail(400, '최종 상품 결제금액을 확인해주세요.', 'payment_minimum');
  if (product.terms_version !== input.termsVersion) return fail(409, '상품 구매 조건이 바뀌었어요. 최신 안내를 확인해주세요.');
  if (product.product_type === 'physical' && (!input.shipping || product.stock < quantity || quantity > maximumProductQuantity(product))) return fail(409, '배송 정보와 상품 수량·재고를 확인해주세요.');
  if (product.product_type === 'digital') {
    if (input.shipping || quantity !== 1) return fail(400, '디지털 상품은 수량 1개로 주문해주세요.');
    if (!hasFiles(env) || !await env.SITE_SHOP_FILES.head(product.file_key)) return preparing();
  }
  const priced = await destinationQuote(env, product, quantity, { ...input.shipping, couponId: input.couponId }, member.id);
  if (priced.response) return priced.response;
  const { itemAmount, shippingFee, amount, discountAmount } = priced.quote, chosenCoupon = priced.chosenCoupon;
  const id = crypto.randomUUID(), pgId = `shop_${id.replace(/-/g, '')}`, at = now();
  const billId = crypto.randomUUID().replace(/-/g, '').slice(0, 20), accountHash = await payssamAccountHash(env);
  const snapshot = { name: product.name, productVersion: product.version, price: product.price, quantity, unitPrice: product.price, itemAmount,
    termsVersion: product.terms_version, refundPolicy: product.refund_policy, deliveryPolicy: product.delivery_policy,
    remoteShippingNote: product.product_type === 'physical' ? product.remote_shipping_note || '' : '',
    regionalShipping: priced.policy, shippingBreakdown: priced.shipping, freeShippingThreshold: productFreeShippingThreshold(product),
    customerName: input.customerName, customerPhone: input.customerPhone, shipping: input.shipping || null,
    fileKey: product.file_key, fileName: product.file_name, fileContentType: product.file_content_type, termsAcceptedAt: at,
    ...(chosenCoupon ? { coupon: couponDto(chosenCoupon), discountAmount } : {}) };
  await db.batch([
    db.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,
      pg_order_id,pg_environment,pg_client_id,callback_nonce,approval_key,stock_state,shipping_status,expires_at,created_at,updated_at,
      payment_provider,payssam_bill_id,payssam_account_hash)
      SELECT ?1,?2,slug,product_type,?3,?4,?5,price*?17+?19-?18,
      ?19,?6,?7,?8,?9,?10,
      CASE WHEN product_type='physical' THEN 'reserved' ELSE 'none' END,CASE WHEN product_type='physical' THEN 'pending' ELSE 'not_applicable' END,?11,?12,?12,
      'payssam',?15,?16
      FROM site_shop_products WHERE slug=?13 AND active=1 AND archived_at IS NULL AND version=?14 AND (product_type='digital' OR stock>=?17)
        AND price*?17+?19<=1000000000
        ${chosenCoupon ? `AND EXISTS(SELECT 1 FROM site_shop_coupons c WHERE c.id=?20 AND c.version=?21 AND c.status='active'
          AND (c.product_slug IS NULL OR c.product_slug=site_shop_products.slug)
          AND (c.starts_at IS NULL OR c.starts_at<=?12) AND (c.ends_at IS NULL OR c.ends_at>?12)
          AND c.min_item_amount<=price*?17 AND (c.per_member_once=0 OR NOT EXISTS(SELECT 1 FROM site_shop_coupon_redemptions r
            WHERE r.coupon_id=c.id AND r.member_id=?2 AND r.state IN ('reserved','used'))))` : ''}
      ON CONFLICT(idempotency_hash) DO NOTHING`).bind(id, member.id, retryHash, payloadHash, JSON.stringify(snapshot), pgId,
      env.SITE_PAYSSAM_MODE, '', opaque(), crypto.randomUUID(), new Date(Date.now() + 30 * 60_000).toISOString(), at, product.slug, product.version, billId, accountHash, quantity, discountAmount, shippingFee,
      ...(chosenCoupon ? [chosenCoupon.id, chosenCoupon.version] : [])),
    ...(chosenCoupon ? [couponReservationStatement(db, { id, coupon: chosenCoupon, memberId: member.id, at })] : []),
    db.prepare(`UPDATE site_shop_products SET stock=stock-?4,version=version+1,updated_at=?2 WHERE slug=?1 AND product_type='physical' AND stock>=?4
      AND EXISTS(SELECT 1 FROM site_shop_orders WHERE id=?3 AND stock_state='reserved')`).bind(product.slug, at, id, quantity),
  ]);
  const saved = await db.prepare('SELECT * FROM site_shop_orders WHERE idempotency_hash=?1').bind(retryHash).first();
  if (!saved) return input.shippingQuoteVersion
    ? fail(409, '상품과 배송비가 변경됐어요. 최신 금액을 확인해주세요.', 'shipping_quote_changed')
    : fail(409, '상품 재고나 구매 조건이 바뀌었어요. 최신 안내를 확인해주세요.');
  if (saved.payload_hash !== payloadHash) return fail(409, '기존 주문과 입력 내용이 다릅니다.');
  return siteJson({ order: await orderDto(env, saved, { detail: true }), checkout: await checkoutDto(env, saved) }, { status: saved.id === id ? 201 : 200 });
}
async function expireReadyOrders(env, id = null) {
  const at = now(), db = env.GAME_DB;
  await db.batch([
    db.prepare(`UPDATE site_shop_orders SET status='expired',lease_token=NULL,lease_until=NULL,updated_at=?1
      WHERE status IN ('pending','confirming') AND tid IS NULL AND expires_at<=?1
      AND (payment_provider='nicepay' OR (payment_provider='payssam' AND payssam_bill_state='not_created' AND payssam_create_started_at IS NULL))
      AND (?2 IS NULL OR id=?2)`).bind(at, id),
    db.prepare(`UPDATE site_shop_products SET stock=stock+(SELECT SUM(CASE WHEN json_type(o.snapshot,'$.quantity')='integer'
      AND json_extract(o.snapshot,'$.quantity') BETWEEN 1 AND 99 THEN json_extract(o.snapshot,'$.quantity') ELSE 1 END) FROM site_shop_orders o WHERE o.product_slug=site_shop_products.slug
      AND o.stock_state='reserved' AND o.status IN ('expired','failed') AND COALESCE(json_extract(o.snapshot,'$.purchaseType'),'single')!='bundle' AND (?2 IS NULL OR o.id=?2)),version=version+1,updated_at=?1
      WHERE EXISTS(SELECT 1 FROM site_shop_orders o WHERE o.product_slug=site_shop_products.slug AND o.stock_state='reserved'
        AND o.status IN ('expired','failed') AND COALESCE(json_extract(o.snapshot,'$.purchaseType'),'single')!='bundle' AND (?2 IS NULL OR o.id=?2))`).bind(at, id),
    db.prepare(`UPDATE site_shop_products SET stock=stock+(SELECT SUM(i.quantity) FROM site_shop_order_items i JOIN site_shop_orders o ON o.id=i.order_id
      WHERE i.product_slug=site_shop_products.slug AND i.product_type='physical' AND o.stock_state='reserved' AND o.status IN ('expired','failed') AND (?2 IS NULL OR o.id=?2)),
      version=version+1,updated_at=?1 WHERE EXISTS(SELECT 1 FROM site_shop_order_items i JOIN site_shop_orders o ON o.id=i.order_id
      WHERE i.product_slug=site_shop_products.slug AND i.product_type='physical' AND o.stock_state='reserved' AND o.status IN ('expired','failed') AND (?2 IS NULL OR o.id=?2))`).bind(at,id),
    db.prepare(`UPDATE site_shop_orders SET stock_state='released',updated_at=?1 WHERE stock_state='reserved'
      AND status IN ('expired','failed') AND (?2 IS NULL OR id=?2)`).bind(at, id),
    releaseCouponStatement(db, at, id),
  ]);
}
async function memberRefund(request, env, member, id) {
  const parsed = await bodyOf(request, refundSchema); if (parsed.response) return parsed.response;
  const row = await orderById(env.GAME_DB, id, member.id);
  if (!row) return fail(404, '본인의 상품 주문을 찾을 수 없습니다.');
  if (!row.approved_at || row.refunded_amount >= row.amount) return fail(409, '환불 요청 가능한 주문을 확인해주세요.');
  const at = now(), refundId = crypto.randomUUID();
  const refund = await env.GAME_DB.prepare(`INSERT INTO site_shop_refunds(id,order_id,reason,requested_amount,cancel_order_id,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT DO NOTHING RETURNING *`)
    .bind(refundId, row.id, parsed.value.reason, row.amount - row.refunded_amount, `refund_${refundId.replace(/-/g, '')}`, at).first();
  return refund ? siteJson({ refundRequest: { id: refund.id, version: refund.version, amount: refund.requested_amount, reason: refund.reason, status: refund.state } }, { status: 201 })
    : fail(409, '이미 접수된 환불 요청을 확인해주세요.');
}
async function closeRefundRequest(request, env, id, member = null) {
  const parsed = await bodyOf(request, refundClosureSchema); if (parsed.response) return parsed.response;
  const input = parsed.value, db = env.GAME_DB, row = await orderById(db, id, member?.id);
  if (!row) return fail(404, member ? '본인의 상품 주문을 찾을 수 없습니다.' : '상품 주문을 찾을 수 없습니다.');
  if (!member && !input.reason) return fail(400, '환불 요청을 거절하는 이유를 입력해주세요.');
  if (member && input.reason != null) return fail(400, '입력값을 확인해주세요.');
  const refund = await db.prepare('SELECT * FROM site_shop_refunds WHERE id=?1 AND order_id=?2').bind(input.refundId, id).first();
  if (!refund) return fail(404, '환불 요청을 찾을 수 없습니다.');
  const actor = member ? 'member' : 'admin', action = member ? 'withdrawn' : 'rejected';
  const reason = member ? '구매자가 환불 요청을 철회했습니다.' : input.reason, at = now();
  // Claiming an approval and closing a request both compare the same pending state.
  // The winning transaction alone can proceed; no provider cancellation happens here.
  const statements = [db.prepare(`UPDATE site_shop_refunds SET state='rejected',version=version+1,
    closure_reason=?4,closed_by=?5,closed_at=?6,updated_at=?6
    WHERE id=?1 AND order_id=?2 AND state='pending' AND version=?3 RETURNING *`)
    .bind(refund.id, id, input.version, reason, actor, at),
  db.prepare(`INSERT INTO site_shop_refund_events(id,refund_id,actor,actor_id,action,version,reason,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE changes()>0`)
    .bind(crypto.randomUUID(), refund.id, actor, member?.id || 'teacher', action, input.version + 1, reason, at)];
  if (!member) statements.push(siteAdminAuditStatement(db, 'order.refund.reject', `order:${id}`, 'success', { conditional: true, at }));
  const result = await db.batch(statements);
  if (!result[0].results.length) return fail(409, '환불 요청 상태가 바뀌었어요. 최신 주문 내용을 확인해주세요.', 'refund_state_changed');
  return siteJson({ order: await orderDto(env, await orderById(db, id), { admin: !member, detail: !!member }) });
}
async function download(env, member, id, itemId = null) {
  let row = await orderById(env.GAME_DB, id, member.id);
  if (!row) return fail(404, '본인의 상품 주문을 찾을 수 없습니다.');
  const uncertainRefund = await env.GAME_DB.prepare("SELECT id FROM site_shop_refunds WHERE order_id=?1 AND state IN ('approving','unknown') LIMIT 1").bind(row.id).first();
  if (uncertainRefund || (row.payment_provider === 'payssam' && row.approved_at)) {
    if (row.payment_provider === 'payssam' && !await matchesPayssamEnvironment(env, row)) return preparing();
    try { row = await reconcileOrder(env, row); } catch { return fail(503, '환불 결과를 확인 중입니다. 잠시 후 다시 확인해주세요.'); }
  }
  const headerSnapshot = JSON.parse(row.snapshot);
  const bundle = headerSnapshot.purchaseType === 'bundle';
  if (bundle) return downloadBundleItem(env,member,row,itemId);
  if (itemId != null) return fail(400,'이 주문의 자료 연결을 확인해주세요.');
  if (!(await orderDto(env, row)).canDownload) return fail(403, '파일을 내려받을 수 있는 구매 권한을 확인해주세요.');
  const snapshot = headerSnapshot, object = await env.SITE_SHOP_FILES.get(snapshot.fileKey);
  if (!object) return fail(503, '상품 파일을 준비 중입니다. 잠시 후 다시 확인해주세요.');
  const owned = await env.GAME_DB.prepare(`UPDATE site_shop_orders SET download_count=download_count+1 WHERE id=?1 AND member_id=?2
    AND approved_at IS NOT NULL AND status IN ('paid','partially_refunded') AND refunded_amount<amount
    AND NOT EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=site_shop_orders.id AND r.state IN ('approving','unknown'))
    RETURNING id`).bind(id, member.id).first();
  if (!owned) { await object.body?.cancel(); return fail(403, '구매 권한이 바뀌었어요. 최신 주문 상태를 확인해주세요.'); }
  return new Response(object.body, { headers: { 'Content-Type': snapshot.fileContentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(snapshot.fileName).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}

async function downloadBundleItem(env,member,row,itemId) {
  if (!UUID.safeParse(itemId).success) return fail(400,'받을 자료를 선택해주세요.');
  const item = await env.GAME_DB.prepare('SELECT * FROM site_shop_order_items WHERE order_id=?1 AND id=?2').bind(row.id,itemId).first();
  if (!item) return fail(404,'본인의 구매 자료를 찾을 수 없습니다.');
  const view = await orderDto(env,row), capability = view.items?.find(value => value.id === itemId);
  if (!capability?.canDownload) return fail(403,'파일을 내려받을 수 있는 구매 권한을 확인해주세요.');
  const snapshot = JSON.parse(item.snapshot), object = await env.SITE_SHOP_FILES.get(snapshot.fileKey);
  if (!object) return fail(503,'상품 파일을 준비 중입니다. 잠시 후 다시 확인해주세요.');
  const owned = await env.GAME_DB.prepare(`UPDATE site_shop_order_items SET download_count=download_count+1 WHERE order_id=?1 AND id=?2
    AND EXISTS(SELECT 1 FROM site_shop_orders o WHERE o.id=order_id AND o.member_id=?3 AND o.approved_at IS NOT NULL
      AND o.status IN ('paid','partially_refunded') AND o.refunded_amount<o.amount
      AND NOT EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=o.id AND r.state IN ('approving','unknown'))) RETURNING id`).bind(row.id,itemId,member.id).first();
  if (!owned) { await object.body?.cancel(); return fail(403,'구매 권한이 변경됐어요. 주문 상태를 확인해주세요.'); }
  return new Response(object.body,{headers:{'Content-Type':snapshot.fileContentType || 'application/octet-stream',
    'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(snapshot.fileName).replace(/['()*]/g,value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    'Cache-Control':'private, no-store',Pragma:'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
async function shipment(request, env, id) {
  const parsed = await bodyOf(request, shipmentSchema); if (parsed.response) return parsed.response;
  const row = await orderById(env.GAME_DB, id);
  if (!row) return fail(404, '상품 주문을 찾을 수 없습니다.');
  if (row.product_type !== 'physical' || !['paid', 'partially_refunded'].includes(row.status)) return fail(409, '배송 처리 가능한 주문을 확인해주세요.');
  const activeRefund = () => env.GAME_DB.prepare("SELECT id FROM site_shop_refunds WHERE order_id=?1 AND state IN ('pending','approving','unknown') LIMIT 1").bind(id).first();
  const refundFirst = () => fail(409, '취소·반품 요청을 먼저 확인해주세요. 요청이 종료된 뒤 배송 정보를 변경할 수 있습니다.', 'refund_review_required');
  if (await activeRefund()) return refundFirst();
  const value = parsed.value, states = ['pending', 'processing', 'shipped', 'delivered'];
  if (states.indexOf(value.status) < states.indexOf(row.shipping_status)
    || (value.status === 'delivered' && !['shipped', 'delivered'].includes(row.shipping_status))
    || (['shipped', 'delivered'].includes(value.status) && (!value.carrier || !value.trackingNumber))) {
    return fail(409, '배송 상태와 운송장 정보를 확인해주세요.');
  }
  const results = await env.GAME_DB.batch([env.GAME_DB.prepare(`UPDATE site_shop_orders SET shipping_status=?2,carrier=?3,tracking_number=?4,
    shipped_at=CASE WHEN ?2 IN ('shipped','delivered') THEN COALESCE(shipped_at,?5) ELSE shipped_at END,updated_at=?5,
    admin_version=admin_version+1 WHERE id=?1 AND status IN ('paid','partially_refunded') AND shipping_status=?6 AND admin_version=?7
    AND NOT EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=site_shop_orders.id AND r.state IN ('pending','approving','unknown')) RETURNING *`)
    .bind(id, value.status, value.carrier || null, value.trackingNumber || null, now(), row.shipping_status, value.version),
    siteAdminAuditStatement(env.GAME_DB, 'order.shipment', `order:${id}`, 'success', { conditional: true })]);
  const saved = results[0].results[0];
  if (!saved && await activeRefund()) return refundFirst();
  return saved ? siteJson({ order: await orderDto(env, saved, { admin: true }) }) : fail(409, '주문 상태가 바뀌었어요. 다시 확인해주세요.');
}

function matchesEnvironment(env, row) {
  return row.payment_provider === 'nicepay' && nicepay.nicepayReady(env) && row.pg_environment === env.SITE_NICEPAY_MODE && row.pg_client_id === env.SITE_NICEPAY_CLIENT_ID;
}
function paymentExpected(row) {
  return { orderId: row.pg_order_id, amount: row.amount, tid: row.tid || row.auth_tid, mode: row.pg_environment, mallReserved: row.callback_nonce };
}

async function verifiedEvidence(env, row, data) {
  if (!matchesEnvironment(env, row)) throw new Error('shop_payment_environment_mismatch');
  const proof = await nicepay.verifyNicepayPayment(env, data, paymentExpected(row));
  if (!proof || proof.orderId !== row.pg_order_id || proof.amount !== row.amount || proof.currency !== 'KRW' || !proof.tid
    || (row.tid && proof.tid !== row.tid) || !Number.isInteger(proof.refundedAmount)
    || proof.refundedAmount < row.refunded_amount || proof.refundedAmount > row.amount) throw new Error('shop_evidence_mismatch');
  return proof;
}

// Only authoritative server-to-server evidence reaches this function.
async function recordEvidence(env, row, data) {
  const proof = await verifiedEvidence(env, row, data);
  const db = env.GAME_DB, at = now();
  if (!['paid', 'partially_refunded', 'refunded'].includes(proof.status)) {
    if (proof.status !== 'failed' || row.approved_at || proof.refundedAmount !== 0) return row;
    await db.prepare(`UPDATE site_shop_orders SET status='failed',tid=COALESCE(tid,?2),lease_token=NULL,lease_until=NULL,updated_at=?3
      WHERE id=?1 AND approved_at IS NULL AND status IN ('pending','confirming')`).bind(row.id, proof.tid, at).run();
    await expireReadyOrders(env, row.id);
    return orderById(db, row.id);
  }
  if (!proof.approvedAt || !Number.isFinite(Date.parse(proof.approvedAt))) throw new Error('shop_approval_date_missing');
  const evidenceHash = await hash(env, 'payment-evidence', JSON.stringify(proof));
  const saved = await db.prepare(`UPDATE site_shop_orders SET status=CASE WHEN ?3=amount THEN 'refunded' WHEN ?3>0 THEN 'partially_refunded' ELSE 'paid' END,
    tid=COALESCE(tid,?2),approved_at=COALESCE(approved_at,?4),refunded_amount=?3,payment_method=?5,last_evidence_hash=?6,
    stock_state=CASE WHEN stock_state='reserved' THEN 'committed' ELSE stock_state END,
    shipping_status=CASE WHEN ?3=amount AND shipping_status IN ('pending','processing') THEN 'cancelled' ELSE shipping_status END,
    lease_token=NULL,lease_until=NULL,updated_at=?7 WHERE id=?1 AND refunded_amount<=?3 AND (tid IS NULL OR tid=?2) RETURNING *`)
    .bind(row.id, proof.tid, proof.refundedAmount, new Date(proof.approvedAt).toISOString(), proof.method || 'card', evidenceHash, at).first();
  if (!saved) throw new Error('shop_evidence_regression');
  await markCouponUsed(db, saved.id, at);
  await db.prepare(`UPDATE site_shop_refunds SET state='completed',version=version+1,approved_at=COALESCE(approved_at,?2),lease_token=NULL,lease_until=NULL,updated_at=?2
    WHERE order_id=?1 AND state IN ('approving','unknown') AND expected_refunded_amount=?3`)
    .bind(row.id, at, proof.refundedAmount).run();
  return saved;
}

async function reconcileOrder(env, row) {
  if (row.payment_provider === 'payssam') return reconcilePayssamOrder(env, row);
  if (!(row.tid || row.auth_tid) || !matchesEnvironment(env, row)) return row;
  const evidence = await nicepay.getNicepayPayment(env, row.tid || row.auth_tid);
  return recordEvidence(env, row, evidence);
}

async function recordPayssamEvidence(env, row, data) {
  if (!await matchesPayssamEnvironment(env, row)) throw new Error('shop_payssam_environment_mismatch');
  const proof = await payssam.verifyPayssamPayment(env, data, { billId: row.payssam_bill_id, amount: row.amount, mode: row.pg_environment,
    approvedAt: row.approved_at || undefined, approvalNumber: row.payssam_approval_number || undefined });
  if (!proof || proof.billId !== row.payssam_bill_id || proof.amount !== row.amount || proof.currency !== 'KRW'
    || !Number.isInteger(proof.refundedAmount) || proof.refundedAmount < row.refunded_amount
    || ![0, row.amount].includes(proof.refundedAmount)) throw new Error('shop_payssam_evidence_mismatch');
  const db = env.GAME_DB, at = now();
  if (proof.status === 'pending') {
    if (row.approved_at || row.payssam_bill_state === 'destroyed') throw new Error('shop_payssam_state_regression');
    await db.prepare(`UPDATE site_shop_orders SET payssam_bill_state=CASE
      WHEN payssam_bill_state IN ('creating','destroying') AND lease_token IS NOT NULL AND lease_until>?3 THEN payssam_bill_state
      WHEN payssam_payment_url IS NOT NULL THEN 'ready' ELSE 'unknown' END,updated_at=?2
      WHERE id=?1 AND approved_at IS NULL AND status NOT IN ('expired','failed')`).bind(row.id, at, unix()).run();
    return orderById(db, row.id);
  }
  if (proof.status === 'destroyed') {
    if (row.approved_at || proof.refundedAmount !== 0) throw new Error('shop_payssam_destroyed_paid_order');
    await db.prepare(`UPDATE site_shop_orders SET status='expired',payssam_bill_state='destroyed',payssam_payment_url=NULL,
      lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND approved_at IS NULL`).bind(row.id, at).run();
    await expireReadyOrders(env, row.id);
    return orderById(db, row.id);
  }
  if (!['paid', 'refunded'].includes(proof.status) || !proof.approvedAt || !Number.isFinite(Date.parse(proof.approvedAt))
    || (proof.status === 'paid' && proof.refundedAmount !== 0) || (proof.status === 'refunded' && proof.refundedAmount !== row.amount)) {
    throw new Error('shop_payssam_approval_unproven');
  }
  const evidenceHash = await hash(env, 'payssam-evidence', JSON.stringify(proof));
  const saved = await db.prepare(`UPDATE site_shop_orders SET status=CASE WHEN ?2=amount THEN 'refunded' ELSE 'paid' END,
    approved_at=COALESCE(approved_at,?3),refunded_amount=?2,payment_method=?4,last_evidence_hash=?5,
    stock_state=CASE WHEN stock_state='reserved' THEN 'committed' ELSE stock_state END,
    shipping_status=CASE WHEN ?2=amount AND shipping_status IN ('pending','processing') THEN 'cancelled' ELSE shipping_status END,
    payssam_payment_url=NULL,payssam_approval_number=COALESCE(payssam_approval_number,?7),lease_token=NULL,lease_until=NULL,updated_at=?6
    WHERE id=?1 AND refunded_amount<=?2 AND stock_state!='released' RETURNING *`)
    .bind(row.id, proof.refundedAmount, new Date(proof.approvedAt).toISOString(), proof.method || null, evidenceHash, at, proof.approvalNumber).first();
  if (!saved) throw new Error('shop_payssam_evidence_regression');
  await markCouponUsed(db, saved.id, at);
  await db.prepare(`UPDATE site_shop_refunds SET state='completed',version=version+1,approved_at=COALESCE(approved_at,?2),lease_token=NULL,lease_until=NULL,updated_at=?2
    WHERE order_id=?1 AND state IN ('approving','unknown') AND expected_refunded_amount=?3`).bind(row.id, at, proof.refundedAmount).run();
  return saved;
}

async function reconcilePayssamOrder(env, row) {
  if (!row.payssam_create_started_at || !await matchesPayssamEnvironment(env, row)) return row;
  const data = await payssam.getPayssamBill(env, row.payssam_bill_id);
  const proof = await payssam.verifyPayssamPayment(env, data, { billId: row.payssam_bill_id, amount: row.amount, mode: row.pg_environment });
  row = await recordPayssamEvidence(env, row, data);
  if (proof.status === 'pending' && row.expires_at <= now()
    && row.payssam_bill_state !== 'creating') {
    // A W invoice may still be payable after our reservation deadline. Keep stock
    // until an authenticated read proves that destruction really reached D.
    const lease = crypto.randomUUID();
    const claim = await env.GAME_DB.prepare(`UPDATE site_shop_orders SET payssam_bill_state='destroying',payssam_destroy_started_at=?2,
      lease_token=?3,lease_until=?4,updated_at=?2 WHERE id=?1 AND approved_at IS NULL
      AND (lease_token IS NULL OR lease_until<=?5) AND (payssam_destroy_started_at IS NULL OR payssam_destroy_started_at<=?6) RETURNING *`)
      .bind(row.id, now(), lease, unix() + 60, unix(), new Date(Date.now() - 60_000).toISOString()).first();
    if (claim) {
      try {
        await payssam.destroyPayssamBill(env, claim.payssam_bill_id, claim.amount);
        const finalData = await payssam.getPayssamBill(env, claim.payssam_bill_id);
        row = await recordPayssamEvidence(env, claim, finalData);
      } catch {
        await env.GAME_DB.prepare("UPDATE site_shop_orders SET payssam_bill_state='unknown',lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND approved_at IS NULL AND payssam_bill_state='destroying' AND lease_token=?3")
          .bind(claim.id, now(), lease).run();
      }
    }
  }
  return await orderById(env.GAME_DB, row.id);
}

async function createPayssamPayment(request, env, member, id) {
  if (siteShopSalesMode(env) !== 'direct') return externalCheckout();
  const parsed = await bodyOf(request, z.object({}).strict()); if (parsed.response) return parsed.response;
  let row = await orderById(env.GAME_DB, id, member.id);
  if (!row) return fail(404, '본인의 상품 주문을 찾을 수 없습니다.');
  if (row.payment_provider !== 'payssam') return fail(409, '기존 결제 내역에서 처리 결과를 확인해주세요.', 'legacy_payment');
  if (!siteShopDirectSalesReady(env) || !await matchesPayssamEnvironment(env, row)) return preparing();
  await expireReadyOrders(env, row.id); row = await orderById(env.GAME_DB, row.id, member.id);
  if (row.payssam_create_started_at) {
    if (row.payssam_bill_state !== 'creating' || !row.lease_token || row.lease_until <= unix()) {
      try { row = await reconcilePayssamOrder(env, row); } catch { /* Never create a second invoice after an uncertain submission. */ }
    }
    return siteJson({ order: await orderDto(env, row, { detail: true }), checkout: await checkoutDto(env, row) });
  }
  if (row.status !== 'pending') return siteJson({ order: await orderDto(env, row, { detail: true }), checkout: await checkoutDto(env, row) });
  const minimum = env.SITE_PAYSSAM_MODE === 'test' ? 20_000 : 100;
  if (row.amount < minimum) return fail(400, '결제 연결의 최소 금액 조건을 확인해주세요.', 'payment_minimum');
  const lease = crypto.randomUUID(), at = now();
  const claim = await env.GAME_DB.prepare(`UPDATE site_shop_orders SET payssam_bill_state='creating',payssam_create_started_at=?2,
    lease_token=?3,lease_until=?4,updated_at=?2 WHERE id=?1 AND status='pending' AND payssam_bill_state='not_created'
    AND payssam_create_started_at IS NULL AND expires_at>?2 RETURNING *`).bind(row.id, at, lease, unix() + 45).first();
  if (!claim) return siteJson({ order: await orderDto(env, await orderById(env.GAME_DB, row.id), { detail: true }), checkout: await checkoutDto(env, await orderById(env.GAME_DB, row.id)) });
  const snapshot = JSON.parse(claim.snapshot);
  const callbackUrl = `${payssamCallbackOrigin(env)}/api/site/webhooks/payssam?${new URLSearchParams({ order: claim.id, token: claim.callback_nonce })}`;
  try {
    const created = await payssam.createPayssamBill(env, { billId: claim.payssam_bill_id, amount: claim.amount, goodsName: snapshot.name,
      customerName: snapshot.customerName, phone: `web_${claim.member_id.replace(/-/g, '')}`, callbackUrl,
      returnUrl: `${siteOrigin(env)}/checkout/?order=${encodeURIComponent(claim.id)}` });
    const paymentUrl = payssam.validPayssamPaymentUrl(env, created.paymentUrl);
    if (created.billId !== claim.payssam_bill_id || !paymentUrl || created.paymentOrigin !== new URL(paymentUrl).origin) throw new Error('shop_payssam_create_unproven');
    await env.GAME_DB.prepare(`UPDATE site_shop_orders SET payssam_bill_state='ready',payssam_payment_url=?2,lease_token=NULL,
      lease_until=NULL,updated_at=?3 WHERE id=?1 AND payssam_bill_state='creating' AND lease_token=?4`)
      .bind(claim.id, paymentUrl, now(), lease).run();
  } catch (error) {
    // A success response can be lost, and BILL_001 means a bill already exists.
    // Neither a timeout nor a duplicate is proof that creating again is safe.
    const localRejected = error instanceof payssam.PayssamError && error.definitive === true
      && ['payssam_invalid_input', 'payssam_test_amount_too_small'].includes(error.code);
    await env.GAME_DB.prepare(`UPDATE site_shop_orders SET payssam_bill_state=?4,status=CASE WHEN ?5=1 THEN 'failed' ELSE status END,
      lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND payssam_bill_state='creating' AND lease_token=?3`)
      .bind(claim.id, now(), lease, localRejected ? 'failed' : 'unknown', localRejected ? 1 : 0).run();
    if (localRejected) await expireReadyOrders(env, claim.id);
  }
  row = await orderById(env.GAME_DB, claim.id);
  if (row.expires_at <= now()) { try { row = await reconcilePayssamOrder(env, row); } catch { /* Payable or unknown bills keep stock. */ } }
  return siteJson({ order: await orderDto(env, row, { detail: true }), checkout: await checkoutDto(env, row) });
}

async function callbackTokenMatches(env, expected, supplied) {
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SITE_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`payssam-callback/${expected}`));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`payssam-callback/${supplied}`));
}
async function payssamWebhook(request, env) {
  if (!payssam.payssamReady(env)) return preparing();
  const url = new URL(request.url), orderId = url.searchParams.get('order'), token = url.searchParams.get('token');
  if (url.searchParams.getAll('order').length !== 1 || url.searchParams.getAll('token').length !== 1 || !UUID.safeParse(orderId).success) return fail(400, '결제 알림 연결을 확인해주세요.');
  const row = await orderById(env.GAME_DB, orderId);
  if (!row || !await matchesPayssamEnvironment(env, row) || !await callbackTokenMatches(env, row.callback_nonce, token)) return fail(403, '결제 알림을 확인할 수 없습니다.');
  const fields = await callbackFields(request);
  let signal;
  try { signal = await payssam.verifyPayssamCallback(env, fields); } catch { return fail(403, '결제 알림을 확인할 수 없습니다.'); }
  if (signal.billId !== row.payssam_bill_id) return fail(403, '결제 알림 연결을 확인해주세요.');
  const id = await hash(env, 'payssam-webhook', JSON.stringify([row.id, row.payssam_bill_id])), at = now();
  await env.GAME_DB.prepare(`INSERT INTO site_shop_webhook_inbox(id,order_id,tid,payment_provider,created_at,updated_at)
    VALUES(?1,?2,?3,'payssam',?4,?4) ON CONFLICT(id) DO UPDATE SET state='pending',updated_at=excluded.updated_at`)
    .bind(id, row.id, row.payssam_bill_id, at).run();
  try {
    await reconcilePayssamOrder(env, row);
    await env.GAME_DB.prepare("UPDATE site_shop_webhook_inbox SET state='processed',updated_at=?2 WHERE id=?1").bind(id, now()).run();
    return siteJson({ code: '0000' });
  } catch { return fail(503, '결제 결과를 다시 확인해야 합니다.'); }
}

async function boundedBytes(request, maximum = 16_384) {
  const reader = request.body?.getReader(); if (!reader) return null;
  let size = 0; const chunks = [];
  try { while (true) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > maximum) { await reader.cancel(); return null; } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
async function boundedText(request, maximum) { const bytes = await boundedBytes(request, maximum); return bytes == null ? null : new TextDecoder().decode(bytes); }
async function callbackFields(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('application/json')) return null;
  const raw = await boundedText(request); if (raw == null) return null;
  if (type.startsWith('application/json')) { try { return JSON.parse(raw); } catch { return null; } }
  const params = new URLSearchParams(raw), data = Object.create(null);
  for (const [key, value] of params) { if (Object.hasOwn(data, key)) return null; data[key] = value; }
  return data;
}
function checkoutRedirect(env, row) {
  return new Response(null, { status: 303, headers: { Location: `${siteOrigin(env)}/checkout/?order=${encodeURIComponent(row.id)}`,
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
}
async function paymentReturn(request, env) {
  if (!nicepay.nicepayReady(env)) return preparing();
  if (!(request.headers.get('Content-Type') || '').startsWith('application/x-www-form-urlencoded')) return fail(400, '결제 결과 형식을 확인해주세요.');
  const fields = await callbackFields(request);
  if (!fields || typeof fields.orderId !== 'string') return fail(400, '결제 결과 형식을 확인해주세요.');
  let row = await env.GAME_DB.prepare('SELECT * FROM site_shop_orders WHERE pg_order_id=?1').bind(fields.orderId).first();
  if (!row || !matchesEnvironment(env, row)) return fail(400, '연결된 상품 주문을 확인해주세요.');
  let authentication;
  try { authentication = await nicepay.verifyNicepayAuth(env, fields, paymentExpected(row)); }
  catch { return fail(400, '결제 인증 정보를 확인할 수 없습니다.'); }
  if (authentication.mallReserved !== row.callback_nonce || authentication.orderId !== row.pg_order_id
    || authentication.amount !== row.amount
    || !authentication.tid || (row.tid && row.tid !== authentication.tid)) return fail(400, '결제 인증 연결을 확인해주세요.');
  if (['pending', 'confirming'].includes(row.status) && !row.tid && row.expires_at <= now()) {
    await expireReadyOrders(env, row.id); return checkoutRedirect(env, row);
  }
  if (['failed', 'expired'].includes(row.status)) return checkoutRedirect(env, row);
  if (row.status !== 'pending' && !(row.status === 'confirming' && !row.tid)) {
    try { row = await reconcileOrder(env, row); } catch { /* Durable uncertainty remains visible on the member's order. */ }
    return checkoutRedirect(env, row);
  }
  const lease = crypto.randomUUID();
  const claim = await env.GAME_DB.prepare(`UPDATE site_shop_orders SET status='confirming',auth_tid=?2,lease_token=?3,lease_until=?4,updated_at=?5
    WHERE id=?1 AND status IN ('pending','confirming') AND tid IS NULL AND expires_at>?5
    AND (lease_token IS NULL OR lease_until<=?6) RETURNING *`)
    .bind(row.id, authentication.tid, lease, unix() + 30, now(), unix()).first();
  if (!claim) return checkoutRedirect(env, row);
  try {
    // Auth signatures do not bind orderId/tid/nonce. Verify the original PG
    // transaction before capturing it; an unavailable preflight must fail closed.
    const lookup = await nicepay.getNicepayPayment(env, claim.auth_tid);
    const preflight = await verifiedEvidence(env, claim, lookup);
    if (preflight.status === 'pending') {
      const bound = await env.GAME_DB.prepare(`UPDATE site_shop_orders SET tid=?2 WHERE id=?1 AND status='confirming'
        AND lease_token=?3 AND auth_tid=?2 AND tid IS NULL AND expires_at>?4 RETURNING *`).bind(claim.id, preflight.tid, lease, now()).first();
      if (bound) {
        const evidence = await nicepay.approveNicepay(env, bound.tid, bound.amount);
        row = await recordEvidence(env, bound, evidence);
      } else await expireReadyOrders(env, claim.id);
    } else {
      row = await recordEvidence(env, claim, lookup);
    }
  } catch {
    // The approval might have succeeded. Keep its tid and stock; never capture again here.
    await env.GAME_DB.prepare('UPDATE site_shop_orders SET lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND lease_token=?3')
      .bind(claim.id, now(), lease).run();
  }
  return checkoutRedirect(env, row);
}

async function webhook(request, env) {
  if (!nicepay.nicepayReady(env)) return preparing();
  const fields = await callbackFields(request);
  if (!fields || typeof fields.orderId !== 'string' || typeof fields.tid !== 'string' || fields.tid.length > 200) return fail(400, '결제 알림 형식을 확인해주세요.');
  const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_orders WHERE pg_order_id=?1').bind(fields.orderId).first();
  if (!row) return webhookAck();
  if (!matchesEnvironment(env, row) || (row.tid && row.tid !== fields.tid)) return fail(400, '결제 알림 연결을 확인해주세요.');
  const id = await hash(env, 'webhook', JSON.stringify({ orderId: row.pg_order_id, tid: fields.tid })), at = now();
  await env.GAME_DB.prepare(`INSERT INTO site_shop_webhook_inbox(id,order_id,tid,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)
    ON CONFLICT(id) DO UPDATE SET state='pending',updated_at=excluded.updated_at`).bind(id, row.id, fields.tid, at).run();
  try {
    const evidence = await nicepay.getNicepayPayment(env, fields.tid);
    await recordEvidence(env, { ...row, auth_tid: fields.tid }, evidence);
    await env.GAME_DB.prepare("UPDATE site_shop_webhook_inbox SET state='processed',updated_at=?2 WHERE id=?1").bind(id, now()).run();
    return webhookAck();
  } catch { return fail(503, '결제 결과를 다시 확인해야 합니다.'); }
}
function webhookAck() {
  return new Response('OK', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}

async function adminRefund(request, env, id) {
  const parsed = await bodyOf(request, adminRefundSchema); if (parsed.response) return parsed.response;
  const input = parsed.value, db = env.GAME_DB;
  let row = await orderById(db, id);
  if (!row) return fail(404, '상품 주문을 찾을 수 없습니다.');
  const isPayssam = row.payment_provider === 'payssam';
  if (isPayssam ? !await matchesPayssamEnvironment(env, row) : !matchesEnvironment(env, row)) {
    return fail(409, '이 주문에 연결된 결제 서비스 설정을 확인해주세요. 확인 전에는 환불을 실행하지 않습니다.', 'payment_configuration_required');
  }
  if (isPayssam && input.amount !== row.amount) return fail(400, '결제선생 상품 결제는 전체 취소 금액으로 검토해주세요.', 'partial_refund_unsupported');
  const retryHash = input.idempotencyKey ? await hash(env, 'refund-key', `${id}:${input.idempotencyKey}`) : null;
  let refund = input.refundId ? await db.prepare('SELECT * FROM site_shop_refunds WHERE id=?1 AND order_id=?2').bind(input.refundId, id).first()
    : await db.prepare('SELECT * FROM site_shop_refunds WHERE admin_idempotency_hash=?1 AND order_id=?2').bind(retryHash, id).first();
  if (!refund && !input.refundId) refund = await db.prepare("SELECT * FROM site_shop_refunds WHERE order_id=?1 AND state IN ('pending','approving','unknown') ORDER BY created_at LIMIT 1").bind(id).first();
  if (input.refundId && !refund) return fail(404, '환불 요청을 찾을 수 없습니다.');
  if (refund?.admin_idempotency_hash && retryHash && refund.admin_idempotency_hash !== retryHash) return fail(409, '다른 환불 작업이 이미 연결되어 있습니다.');
  if (refund?.state !== 'pending' && refund && (refund.approved_amount !== input.amount || refund.approved_reason !== input.reason)) return fail(409, '이미 확정된 환불 내용과 다릅니다.');
  if (refund?.state === 'completed') return siteJson({ order: await orderDto(env, row, { admin: true }) });
  if (refund && ['failed', 'rejected'].includes(refund.state)) return fail(409, '종료된 환불 요청입니다.');
  if (refund && ['approving', 'unknown'].includes(refund.state)) {
    try { row = await reconcileOrder(env, row); } catch { /* Never issue another cancellation for an uncertain refund. */ }
    return siteJson({ order: await orderDto(env, row, { admin: true }) });
  }
  try { row = await reconcileOrder(env, row); } catch (error) {
    const problem = reconciliationProblem(error);
    return fail(503, problem.message, problem.code);
  }
  if (!row.approved_at || input.amount > row.amount - row.refunded_amount) return fail(409, '환불 가능한 결제 잔액을 확인해주세요.');
  if (!refund) {
    const refundId = crypto.randomUUID(), at = now();
    refund = await db.prepare(`INSERT INTO site_shop_refunds(id,order_id,reason,requested_amount,cancel_order_id,admin_idempotency_hash,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT DO NOTHING RETURNING *`)
      .bind(refundId, id, input.reason, input.amount, `refund_${refundId.replace(/-/g, '')}`, retryHash, at).first();
    if (!refund) return fail(409, '다른 환불 요청을 먼저 확인해주세요.');
  }
  const lease = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE site_shop_refunds SET state='approving',version=version+1,approved_amount=?2,approved_reason=?3,
    expected_refunded_amount=?4,lease_token=?5,lease_until=?6,updated_at=?7,admin_idempotency_hash=COALESCE(admin_idempotency_hash,?8)
    WHERE id=?1 AND state='pending' RETURNING *`)
    .bind(refund.id, input.amount, input.reason, row.refunded_amount + input.amount, lease, unix() + 30, now(), retryHash).first();
  if (!claim) return fail(409, '환불 결과를 확인 중입니다.');
  let cancelAccepted = false;
  try {
    if (isPayssam) await payssam.cancelPayssamBill(env, row.payssam_bill_id,
      { amount: claim.approved_amount, originalAmount: row.amount, reason: claim.approved_reason.slice(0, 20) });
    else await nicepay.cancelNicepay(env, row.tid, { amount: claim.approved_amount, reason: claim.approved_reason, orderId: claim.cancel_order_id });
    cancelAccepted = true;
    row = await reconcileOrder(env, row);
    if (row.refunded_amount !== claim.expected_refunded_amount) throw new Error('shop_refund_result_unknown');
  } catch (error) {
    // A definitive rejection of the cancellation itself means no refund happened.
    // A lookup failure after cancellation acceptance can never prove that.
    const ErrorType = isPayssam ? payssam.PayssamError : nicepay.NicepayError;
    const rejected = !cancelAccepted && error instanceof ErrorType && error.definitive === true;
    await db.prepare("UPDATE site_shop_refunds SET state=?4,version=version+1,lease_token=NULL,lease_until=NULL,updated_at=?2 WHERE id=?1 AND state='approving' AND lease_token=?3")
      .bind(claim.id, now(), lease, rejected ? 'failed' : 'unknown').run();
  }
  return siteJson({ order: await orderDto(env, await orderById(db, id), { admin: true }) });
}

function reconciliationProblem(error) {
  // Only these fixed, operator-safe categories cross the API boundary. Never
  // expose provider payloads, credentials, merchant IDs or raw exception text.
  const code = typeof error?.code === 'string' ? error.code : typeof error?.message === 'string' ? error.message : '';
  if (/(?:not_configured|environment_mismatch|account_mismatch)/.test(code)) return {
    status: 'configuration_required', code: 'payment_configuration_required', nextAction: 'check_configuration',
    message: '이 주문과 결제 서비스 설정이 일치하지 않습니다. 연결한 결제 계정과 운영 환경을 확인해주세요.',
  };
  if (/(?:evidence|mismatch|regression|unproven|unverified|approval_date)/.test(code)) return {
    status: 'review_required', code: 'payment_evidence_review_required', nextAction: 'contact_provider',
    message: '결제 서비스의 응답을 주문 정보와 대조할 수 없습니다. 결제사 내역을 확인한 뒤 담당자에게 문의해주세요.',
  };
  return { status: 'temporarily_unavailable', code: 'payment_lookup_temporarily_unavailable', nextAction: 'retry',
    message: '결제 서비스에서 결과를 가져오지 못했습니다. 잠시 후 다시 확인해주세요. 확인 전에는 결제·환불을 반복 실행하지 마세요.' };
}
async function matchingPaymentEnvironment(env, row) {
  return row.payment_provider === 'payssam' ? matchesPayssamEnvironment(env, row) : matchesEnvironment(env, row);
}
export async function reconcileSiteShopPayments(env, { includeRecentPaid = false } = {}) {
  if (!env.GAME_DB || !env.SITE_SESSION_SECRET) return { processed: 0 };
  await expireReadyOrders(env);
  if (!nicepay.nicepayReady(env) && !payssam.payssamReady(env)) return { processed: 0 };
  const db = env.GAME_DB;
  const orders = (await db.prepare(`SELECT o.* FROM site_shop_orders o WHERE
    ((o.payment_provider='nicepay' AND (o.tid IS NOT NULL OR o.auth_tid IS NOT NULL) AND o.status='confirming')
      OR (o.payment_provider='payssam' AND o.payssam_create_started_at IS NOT NULL AND o.status IN ('pending','confirming'))
      OR EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=o.id AND r.state IN ('approving','unknown')))
    ORDER BY o.updated_at,o.id LIMIT 10`).all()).results;
  // Older settled orders are covered by authenticated webhooks and explicit
  // order queries. A small, finite recent-paid sweep cannot delay an unresolved
  // payment or refund and does not grow with lifetime sales volume.
  if (includeRecentPaid) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const recent = (await db.prepare(`SELECT o.* FROM site_shop_orders o WHERE o.payment_provider='payssam'
      AND o.payssam_create_started_at IS NOT NULL AND o.status='paid' AND o.approved_at>=?1
      AND NOT EXISTS(SELECT 1 FROM site_shop_refunds r WHERE r.order_id=o.id AND r.state IN ('approving','unknown'))
      ORDER BY o.updated_at,o.id LIMIT 2`).bind(cutoff).all()).results;
    orders.push(...recent);
  }
  let processed = 0, failed = 0, configurationRequired = 0;
  for (const row of orders) {
    try {
      if (!await matchingPaymentEnvironment(env, row)) { configurationRequired++; continue; }
      await reconcileOrder(env, row); processed++;
    }
    catch { failed++; console.error('[site-shop] payment reconciliation pending'); }
    finally {
      // Rotate every selected attempt, including lookup failures and account no-ops.
      // This timestamp is not payment evidence and never changes financial state.
      await db.prepare('UPDATE site_shop_orders SET updated_at=?2 WHERE id=?1').bind(row.id, now()).run();
    }
  }
  const events = (await db.prepare("SELECT * FROM site_shop_webhook_inbox WHERE state='pending' AND retry_after<=?1 ORDER BY updated_at,id LIMIT 10").bind(unix()).all()).results;
  for (const event of events) {
    try {
      const row = await orderById(db, event.order_id);
      if (event.payment_provider === 'payssam') {
        if (!row || !await matchesPayssamEnvironment(env, row)) throw new Error('shop_payment_environment_mismatch');
        await reconcilePayssamOrder(env, row);
        await db.prepare("UPDATE site_shop_webhook_inbox SET state='processed',last_error_code=NULL,retry_after=0,updated_at=?2 WHERE id=?1").bind(event.id, now()).run(); processed++;
        continue;
      }
      if (!row || !matchesEnvironment(env, row)) throw new Error('shop_payment_environment_mismatch');
      if (row.tid && row.tid !== event.tid) throw new Error('shop_evidence_mismatch');
      const evidence = await nicepay.getNicepayPayment(env, event.tid);
      await recordEvidence(env, { ...row, auth_tid: event.tid }, evidence);
      await db.prepare("UPDATE site_shop_webhook_inbox SET state='processed',last_error_code=NULL,retry_after=0,updated_at=?2 WHERE id=?1").bind(event.id, now()).run(); processed++;
    } catch (error) {
      const problem = reconciliationProblem(error);
      const delay = problem.status === 'configuration_required' || problem.status === 'review_required' ? 3600
        : Math.min(3600, 60 * 2 ** Math.min(event.retry_attempts, 6));
      await db.prepare(`UPDATE site_shop_webhook_inbox SET retry_attempts=retry_attempts+1,retry_after=?2,last_error_code=?3,updated_at=?4
        WHERE id=?1 AND state='pending'`).bind(event.id, unix() + delay, problem.code, now()).run();
      if (problem.status === 'configuration_required') configurationRequired++; else failed++;
      console.error('[site-shop] webhook reconciliation pending');
    }
  }
  return { processed, failed, configurationRequired };
}

async function auditAdminResult(env, action, target, callback, { always = false } = {}) {
  const response = await callback();
  if (always || response.status >= 400) {
    let outcome = response.status >= 400 ? response.status === 409 ? 'conflict' : 'failed' : 'success';
    if (action === 'order.refund' && response.ok) {
      const result = await response.clone().json().catch(() => null), state = result?.order?.refunds?.[0]?.status;
      if (['pending','approving','unknown','failed','completed'].includes(state)) outcome = state;
    }
    await recordSiteAdminAction(env, action, target, outcome);
  }
  return response;
}
export async function handleSiteShopRoutes(request, env, ctx, { authorizeTeacher } = {}) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const productPath = path.match(/^\/api\/site\/products(?:\/([^/]+)(?:\/(thumbnail|images)(?:\/([^/]+))?)?)?$/);
  const memberPath = path.match(/^\/api\/site\/shop-orders(?:\/([^/]+)(?:\/(refund-request|refund-withdraw|download|payment))?)?$/);
  const adminProduct = path.match(/^\/api\/site\/admin\/products(?:\/([^/]+)(?:\/(file|thumbnail|images)(?:\/([^/]+))?)?)?$/);
  const adminOrder = path.match(/^\/api\/site\/admin\/shop-orders(?:\/([^/]+)(?:\/(shipment|refund|refund-reject))?)?$/);
  const adminCoupon = path.match(/^\/api\/site\/admin\/coupons(?:\/([^/]+))?$/);
  const couponPath = path === '/api/site/coupons', shippingQuotePath = path === '/api/site/shipping-quote', cartQuotePath = path === '/api/site/cart-quote';
  const isReturn = path === '/api/site/payments/nicepay/return', isWebhook = path === '/api/site/webhooks/nicepay';
  const isPayssamWebhook = path === '/api/site/webhooks/payssam';
  const settings = path === '/api/site/admin/shop-settings';
  if (!productPath && !memberPath && !adminProduct && !adminOrder && !adminCoupon && !couponPath && !shippingQuotePath && !cartQuotePath && !settings && !isReturn && !isWebhook && !isPayssamWebhook) return null;
  const smartstoreMode = siteShopSalesMode(env) === 'smartstore';
  const publicCatalog = (!!productPath || couponPath) && method === 'GET';
  if (smartstoreMode && method === 'POST' && memberPath && (!memberPath[1] || memberPath[2] === 'payment')) return externalCheckout();
  if (!env.GAME_DB || (!publicCatalog && !env.SITE_SESSION_SECRET)) return preparing();
  try {
    if ((!publicCatalog || env.JWT_SECRET) && !await rateLimitCheck(env, `site-shop:${request.headers.get('CF-Connecting-IP') || '0.0.0.0'}`, 120, 60)) return fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
    if (isReturn || isWebhook || isPayssamWebhook) {
      if (method !== 'POST') return fail(405, '지원하지 않는 요청 방식입니다.');
      if (isPayssamWebhook) return await payssamWebhook(request, env);
      return isReturn ? await paymentReturn(request, env) : await webhook(request, env);
    }
    if (adminProduct || adminOrder || adminCoupon || settings) {
      if (!authorizeTeacher) return fail(403, '관리자 권한이 필요합니다.');
      const denial = await authorizeTeacher(request, env, {}); if (denial) return denial;
      if (adminCoupon) return method === 'GET' ? await handleAdminCoupons(request, env, adminCoupon[1])
        : await auditAdminResult(env, `coupon.${method === 'POST' ? 'create' : method === 'DELETE' ? 'archive' : 'update'}`,
          `coupon:${adminCoupon[1] || 'new'}`, () => handleAdminCoupons(request, env, adminCoupon[1]));
      if (settings) return method === 'GET' ? siteJson({ commerceReady: siteShopReady(env), filesReady: hasFiles(env) && typeof env.SITE_SHOP_FILES.put === 'function',
        payssamReady: payssam.payssamReady(env), legacyNicepayReady: nicepay.nicepayReady(env),
        mode: payssam.payssamReady(env) ? env.SITE_PAYSSAM_MODE : 'preparing', salesMode: siteShopSalesMode(env),
        status: siteShopReady(env) ? 'ready' : 'preparing' }) : fail(405, '지원하지 않는 요청 방식입니다.');
      if (adminProduct) {
        if (adminProduct[1] && !slug.safeParse(adminProduct[1]).success) return fail(400, '상품 식별자를 확인해주세요.');
        if (adminProduct[3] && (adminProduct[2] !== 'images' || !UUID.safeParse(adminProduct[3]).success)) return fail(400, '상품 이미지 식별자를 확인해주세요.');
        if (adminProduct[2] === 'images') {
          if (adminProduct[3] && method === 'GET') return await productPreview(env, adminProduct[1], adminProduct[3], true);
          if (adminProduct[3] && method === 'DELETE') return await auditAdminResult(env, 'product.preview.delete', `product:${adminProduct[1]}`, () => deleteProductPreview(request, env, adminProduct[1], adminProduct[3]));
          if (!adminProduct[3] && method === 'POST') return await auditAdminResult(env, 'product.preview.add', `product:${adminProduct[1]}`, () => uploadProductPreview(request, env, adminProduct[1]));
          if (!adminProduct[3] && method === 'PATCH') return await auditAdminResult(env, 'product.preview.reorder', `product:${adminProduct[1]}`, () => reorderProductPreviews(request, env, adminProduct[1]));
          return fail(405, '지원하지 않는 요청 방식입니다.');
        }
        if (adminProduct[2] === 'thumbnail' && method === 'GET') return await productThumbnail(env, adminProduct[1], true);
        if (adminProduct[2] === 'thumbnail' && method === 'POST') return await auditAdminResult(env, 'product.thumbnail', `product:${adminProduct[1]}`, () => uploadProductThumbnail(request, env, adminProduct[1]));
        if (adminProduct[2] === 'file' && method === 'POST') return await auditAdminResult(env, 'product.file', `product:${adminProduct[1]}`, () => uploadProductFile(request, env, adminProduct[1]));
        if (adminProduct[2]) return fail(405, '지원하지 않는 요청 방식입니다.');
        if (method === 'GET') {
          if (!adminProduct[1]) return await listProducts(env, url, true);
          const row = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1').bind(adminProduct[1]).first();
          return row ? siteJson({ product: productDto(row, env, true) }) : fail(404, '상품을 찾을 수 없습니다.');
        }
        if (['POST', 'PUT'].includes(method)) return await auditAdminResult(env, method === 'POST' ? 'product.create' : 'product.update',
          `product:${adminProduct[1] || 'new'}`, () => saveProduct(request, env, adminProduct[1]));
        if (method === 'DELETE' && adminProduct[1]) return await archiveProduct(request, env, adminProduct[1]);
      }
      if (adminOrder) {
        if (method === 'GET' && !adminOrder[1]) {
          return await listShopOrders(env, url);
        }
        if (!UUID.safeParse(adminOrder[1]).success) return fail(400, '주문 식별자를 확인해주세요.');
        if (!adminOrder[2] && method === 'GET') {
          let row = await orderById(env.GAME_DB, adminOrder[1]); if (!row) return fail(404, '주문을 찾을 수 없습니다.');
          let reconciliationStatus = 'not_required', reconciliation = { code: null, message: null, nextAction: null };
          if (row.payssam_create_started_at || row.tid || row.auth_tid) {
            try {
              if (!await matchingPaymentEnvironment(env, row)) throw new Error('shop_payment_environment_mismatch');
              row = await reconcileOrder(env, row); reconciliationStatus = 'confirmed';
            } catch (error) { reconciliation = reconciliationProblem(error); reconciliationStatus = reconciliation.status; }
          }
          return siteJson({ order: await orderDto(env, row, { admin: true }), reconciliationStatus, reconciliation });
        }
        if (adminOrder[2] === 'shipment' && method === 'PUT') return await auditAdminResult(env, 'order.shipment', `order:${adminOrder[1]}`, () => shipment(request, env, adminOrder[1]));
        if (adminOrder[2] === 'refund' && method === 'POST') return await auditAdminResult(env, 'order.refund', `order:${adminOrder[1]}`, () => adminRefund(request, env, adminOrder[1]), { always: true });
        if (adminOrder[2] === 'refund-reject' && method === 'POST') return await auditAdminResult(env, 'order.refund.reject', `order:${adminOrder[1]}`, () => closeRefundRequest(request, env, adminOrder[1]));
      }
      return fail(405, '지원하지 않는 요청 방식입니다.');
    }
    if (couponPath) {
      if (method !== 'GET') return fail(405, '지원하지 않는 요청 방식입니다.');
      if (smartstoreMode) return externalCheckout();
      const productId = url.searchParams.get('product'), quantityText = url.searchParams.get('quantity') || '1';
      if (!slug.safeParse(productId).success || !/^[1-9]\d?$/.test(quantityText)
        || url.searchParams.getAll('product').length !== 1 || url.searchParams.getAll('quantity').length > 1
        || [...url.searchParams.keys()].some(key => !['product','quantity'].includes(key))) return fail(400, '쿠폰 적용 상품과 수량을 확인해주세요.');
      const product = await env.GAME_DB.prepare('SELECT * FROM site_shop_products WHERE slug=?1 AND active=1 AND archived_at IS NULL').bind(productId).first();
      if (!product) return fail(404, '공개된 상품을 찾을 수 없습니다.');
      const quantity = Number(quantityText);
      if (!directProductEligible(product) || quantity > maximumProductQuantity(product)) return fail(409, '상품 수량과 구매 조건을 확인해주세요.');
      let memberId = null;
      if (request.headers.has('Cookie') && env.SITE_SESSION_SECRET) {
        const access = await authorizeSiteMember(request, env);
        if (!(access instanceof Response)) { memberId = access.member.id; await expireReadyOrders(env); }
      }
      return await publicCoupons(env, product, quantity, memberId);
    }
    if (productPath) {
      if (method !== 'GET') return fail(405, '지원하지 않는 요청 방식입니다.');
      if (productPath[3] && (productPath[2] !== 'images' || !UUID.safeParse(productPath[3]).success)) return fail(400, '상품 이미지 식별자를 확인해주세요.');
      if (productPath[2] === 'images') {
        if (!slug.safeParse(productPath[1]).success) return fail(400, '상품 식별자를 확인해주세요.');
        return productPath[3] ? await productPreview(env, productPath[1], productPath[3]) : fail(405, '지원하지 않는 요청 방식입니다.');
      }
      if (productPath[2] === 'thumbnail') return slug.safeParse(productPath[1]).success ? await productThumbnail(env, productPath[1]) : fail(400, '상품 식별자를 확인해주세요.');
      if (productPath[1]) {
        const row = await env.GAME_DB.prepare(`SELECT * FROM site_shop_products WHERE slug=?1 AND ${productActiveSql(env)}=1 AND archived_at IS NULL`).bind(productPath[1]).first();
        if (!row && CURATED_LEGACY_PRODUCT_IDS.includes(productPath[1])) {
          const curated = await env.GAME_DB.prepare('SELECT archived_at FROM site_shop_products WHERE slug=?1').bind(productPath[1]).first();
          if (curated?.archived_at != null) return fail(404, '공개된 상품을 찾을 수 없습니다.', 'curated_product_hidden');
        }
        return row ? siteJson({ product: productDto(row, env), purchaseChannel: siteShopSalesMode(env), purchaseReady: siteShopDirectSalesReady(env) }) : fail(404, '공개된 상품을 찾을 수 없습니다.');
      }
      return await listProducts(env, url, false);
    }
    const access = await authorizeSiteMember(request, env, { requireCsrf: !['GET', 'HEAD'].includes(method) });
    if (access instanceof Response) return access;
    const member = access.member;
    if (shippingQuotePath) return method === 'POST' ? await shippingQuote(request, env, member) : fail(405, '지원하지 않는 요청 방식입니다.');
    if (cartQuotePath) return method === 'POST' ? await cartQuote(request,env,member) : fail(405,'지원하지 않는 요청 방식입니다.');
    if (!memberPath[1]) {
      if (method === 'POST') return await createOrder(request, env, member);
      if (method === 'GET') {
        await expireReadyOrders(env);
        return await listShopOrders(env, url, { memberId: member.id });
      }
    }
    if (!UUID.safeParse(memberPath[1]).success) return fail(400, '주문 식별자를 확인해주세요.');
    if (memberPath[2] === 'payment' && method === 'POST') return await createPayssamPayment(request, env, member, memberPath[1]);
    if (memberPath[2] === 'refund-request' && method === 'POST') return await memberRefund(request, env, member, memberPath[1]);
    if (memberPath[2] === 'refund-withdraw' && method === 'POST') return await closeRefundRequest(request, env, memberPath[1], member);
    if (memberPath[2] === 'download' && method === 'GET') {
      if (url.searchParams.getAll('item').length>1 || [...url.searchParams.keys()].some(key => key !== 'item')) return fail(400,'자료 연결을 확인해주세요.');
      return await download(env, member, memberPath[1],url.searchParams.get('item'));
    }
    if (!memberPath[2] && method === 'GET') {
      let row = await orderById(env.GAME_DB, memberPath[1], member.id);
      if (!row) return fail(404, '본인의 상품 주문을 찾을 수 없습니다.');
      await expireReadyOrders(env, row.id); row = await orderById(env.GAME_DB, row.id, member.id);
      const uncertainRefund = await env.GAME_DB.prepare("SELECT id FROM site_shop_refunds WHERE order_id=?1 AND state IN ('approving','unknown') LIMIT 1").bind(row.id).first();
      if (row.status === 'confirming' || uncertainRefund || (row.payment_provider === 'payssam' && row.payssam_create_started_at && ['pending','paid'].includes(row.status))) {
        try { row = await reconcileOrder(env, row); } catch { /* The stored uncertain result remains visible. */ }
      }
      return siteJson({ order: await orderDto(env, row, { detail: true }), checkout: await checkoutDto(env, row) });
    }
    return fail(405, '지원하지 않는 요청 방식입니다.');
  } catch {
    console.error('[site-shop] service unavailable');
    return fail(503, '상품 서비스를 잠시 사용할 수 없습니다. 다시 시도해주세요.');
  }
}
