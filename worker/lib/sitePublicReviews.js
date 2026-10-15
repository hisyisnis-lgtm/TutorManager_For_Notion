import { handleReviewRoutes, isGuestReviewPath } from './reviews.js';
import { checkSiteOrigin, siteJson } from './siteAuth.js';

export async function handleSitePublicReviewRoutes(request, env) {
  const url = new URL(request.url), root = '/api/site/public-reviews';
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
  const reviewPath = `/reviews${url.pathname.slice(root.length)}`;
  // Only the public/author routes are aliased. In particular, /admin must never
  // become reachable through this namespace or through the site's public proxy.
  if (!isGuestReviewPath(reviewPath)) return siteJson({ error: '후기를 찾을 수 없습니다.' }, { status: 404 });
  if (request.method !== 'GET') {
    const denial = checkSiteOrigin(request, env);
    if (denial) return denial;
  }
  url.pathname = reviewPath;
  return handleReviewRoutes(new Request(url, request), env, {}, {
    authorizeTeacher: async () => siteJson({ error: '관리자 권한이 필요합니다.' }, { status: 403 }),
  });
}
