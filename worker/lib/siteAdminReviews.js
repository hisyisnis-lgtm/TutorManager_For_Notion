import { listAdminReviews, getAdminReview, moderateReview } from './reviews.js';
import { authorizeSiteAdminRequest } from './siteAdminAuth.js';
import { siteJson } from './siteAuth.js';
import { rateLimitCheck } from './securityStore.js';

const REVIEW_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (status, error) => siteJson({ error }, { status });

export async function handleSiteAdminReviewRoutes(request, env, ctx, { authorizeTeacher } = {}) {
  const url = new URL(request.url);
  const root = '/api/site/admin/reviews';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
  if (!env.GAME_DB || !env.JWT_SECRET) return fail(503, '후기 서비스를 준비 중입니다. 잠시 후 다시 시도해주세요.');
  // index.js supplies the existing cookie-or-typed-teacher verifier. Direct
  // handler use still requires an actual website administrator cookie.
  const authorize = authorizeTeacher || authorizeSiteAdminRequest;
  try {
    const denied = await authorize(request, env, {});
    if (denied !== null) return denied instanceof Response ? denied : fail(401, '관리자 로그인이 필요합니다.');
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!await rateLimitCheck(env, `reviews:request:${ip}`, 120, 60)) {
      return siteJson({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, {
        status: 429, headers: { 'Retry-After': '60', 'Access-Control-Expose-Headers': 'Retry-After' },
      });
    }
    if (url.pathname === root) return request.method === 'GET'
      ? await listAdminReviews(env.GAME_DB, env, url) : fail(405, '지원하지 않는 요청 방식입니다.');
    const match = url.pathname.match(/^\/api\/site\/admin\/reviews\/([^/]+)(?:\/(moderate))?$/);
    if (!match || !REVIEW_ID.test(match[1])) return fail(404, '후기를 찾을 수 없습니다.');
    if (!match[2]) return request.method === 'GET'
      ? await getAdminReview(env.GAME_DB, env, match[1]) : fail(405, '지원하지 않는 요청 방식입니다.');
    return request.method === 'POST'
      ? await moderateReview(request, env, env.GAME_DB, match[1], {}, { authorize })
      : fail(405, '지원하지 않는 요청 방식입니다.');
  } catch {
    // Do not disclose SQL errors, review text, credentials or private member IDs.
    console.error('[site-admin-reviews] service unavailable');
    return fail(503, '후기를 잠시 사용할 수 없습니다. 다시 시도해주세요.');
  }
}
