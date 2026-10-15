import { authorizeSiteAdminRequest } from './siteAdminAuth.js';
import { siteJson } from './siteAuth.js';
import { siteShopAttentionConditions } from './siteShop.js';
import { rateLimitCheck } from './securityStore.js';

const fail = (status, error, code) => siteJson({ error, code }, { status });
const countQuery = (db, table, condition, oldest = 'created_at') => db.prepare(
  `SELECT COUNT(*) AS count, MIN(${oldest}) AS oldest_at FROM ${table} WHERE ${condition}`,
);
function queue(result) {
  const row = result?.results?.[0];
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0
    || (row.count > 0 && !Number.isFinite(Date.parse(row.oldest_at)))) throw new Error('invalid_overview');
  return { count: row.count, oldestAt: row.count ? row.oldest_at : null };
}

// Aggregate only. Personal data, free-text reasons and provider credentials never
// leave the existing authenticated administration boundary through this endpoint.
export async function handleSiteAdminOverviewRoutes(request, env, ctx, { authorizeTeacher } = {}) {
  if (new URL(request.url).pathname !== '/api/site/admin/overview') return null;
  try {
    const denied = await (authorizeTeacher || authorizeSiteAdminRequest)(request, env, {});
    if (denied !== null) return denied instanceof Response ? denied : fail(401, '관리자 로그인이 필요합니다.', 'admin_login_required');
    if (request.method !== 'GET') return fail(405, '지원하지 않는 요청 방식입니다.', 'admin_method_denied');
    if (!env.GAME_DB || !env.JWT_SECRET) return fail(503, '업무 현황을 불러오지 못했어요. 다시 불러와 주세요.', 'admin_overview_unavailable');
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!await rateLimitCheck(env, `site-admin:overview:${ip}`, 120, 60)) return siteJson(
      { error: '조회 요청이 많아요. 잠시 후 다시 불러와 주세요.', code: 'admin_overview_rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
    const conditions = siteShopAttentionConditions('o'), now = new Date(), delayedBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
    const results = await env.GAME_DB.batch([
      countQuery(env.GAME_DB, 'site_shop_orders o', conditions.payment_attention, 'o.created_at'),
      countQuery(env.GAME_DB, 'site_shop_refunds', "state='pending'"),
      countQuery(env.GAME_DB, 'site_shop_orders o', conditions.shipping_pending, 'o.approved_at'),
      countQuery(env.GAME_DB, 'reviews', "pending_version IS NOT NULL AND status!='deleted'", 'updated_at'),
      env.GAME_DB.prepare("SELECT COUNT(*) AS count, MIN(created_at) AS oldest_at FROM site_shop_webhook_inbox WHERE state='pending' AND created_at<=?1").bind(delayedBefore),
      env.GAME_DB.prepare("SELECT COUNT(*) AS count, MIN(created_at) AS oldest_at FROM site_notion_outbox WHERE state IN ('needs_setup','unknown','failed') OR (state IN ('pending','processing') AND created_at<=?1)").bind(delayedBefore),
    ]);
    return siteJson({ generatedAt: now.toISOString(), tasks: {
      paymentAttention: queue(results[0]), refundPending: queue(results[1]), shippingPending: queue(results[2]), reviewsPending: queue(results[3]),
    }, operations: { webhookBacklog: queue(results[4]), notionSync: queue(results[5]) } });
  } catch {
    console.error('[site-admin-overview] service unavailable');
    return fail(503, '업무 현황을 불러오지 못했어요. 다시 불러와 주세요.', 'admin_overview_unavailable');
  }
}
