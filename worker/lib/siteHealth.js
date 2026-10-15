// Anonymous readiness probes must never create sessions, rate-limit records or
// provider traffic. LIMIT 0 resolves schema names without reading member rows.
const SCHEMA_PROBES = [
  `SELECT m.id,s.token_hash,a.credential_fingerprint,i.provider_subject
    FROM site_members m,site_sessions s,site_admin_sessions a,site_member_identities i LIMIT 0`,
  `SELECT c.phone_e164,c.delivery_state,p.csrf_hash,d.sends
    FROM site_phone_challenges c,site_phone_proofs p,site_phone_daily_usage d LIMIT 0`,
  `SELECT e.target_student_id,e.student_id,a.allowed,a.revision,h.write_started_at
    FROM site_student_enrollments e,student_app_access a,student_app_homework_sync h LIMIT 0`,
  `SELECT c.slug,c.home_sort_order,r.latest_rating,r.published_rating
    FROM site_content c,reviews r LIMIT 0`,
  `SELECT p.preview_images_json,p.regional_shipping_json,p.free_shipping_threshold,o.payssam_account_hash,i.quantity,
      r.version,r.closed_by,r.closure_reason,r.closed_at,e.action,w.retry_after,w.retry_attempts,w.last_error_code
    FROM site_shop_products p,site_shop_orders o,site_shop_order_items i,site_shop_refunds r,
      site_shop_refund_events e,site_shop_webhook_inbox w LIMIT 0`,
  `SELECT o.active_attempt_id,a.payment_key,n.desired_version,n.next_attempt_at
    FROM site_orders o,site_payment_attempts a,site_notion_outbox n LIMIT 0`,
];
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers } });

export async function handleSiteHealthRoutes(request, env) {
  if (new URL(request.url).pathname !== '/api/site/health') return null;
  if (request.method !== 'GET') return response({ error: '지원하지 않는 요청 방식입니다.' }, 405, { Allow: 'GET' });
  try {
    if (typeof env.GAME_DB?.prepare !== 'function') throw new Error('database_unavailable');
    for (const sql of SCHEMA_PROBES) await env.GAME_DB.prepare(sql).all();
    return response({ ok: true, schema: 'ready' });
  } catch {
    return response({ ok: false, schema: 'unavailable' }, 503);
  }
}
