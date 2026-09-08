import { base64url, signTypedToken, verifyTypedToken } from './auth.js';

const COOKIE = '__Secure-game_dashboard';
const SESSION_SECONDS = 600;
const PATH = '/game/dashboard';

export function dashboardHeaders(nonce) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`,
  };
}

const page = (message) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>성조게임 통계 로그인</title></head><body style="font-family:system-ui;background:#0d1117;color:#e7edf4;padding:32px;max-width:420px;margin:auto"><h1 style="font-size:24px">성조게임 통계</h1><p>${message}</p><form method="post" action="${PATH}"><label for="key">접근 키</label><input id="key" name="key" type="password" maxlength="1024" required autocomplete="current-password" style="display:block;box-sizing:border-box;width:100%;min-height:44px;margin:12px 0"><button type="submit" style="min-height:44px">로그인</button></form></body></html>`;

// GET URL의 기존 영구 키는 읽거나 검증하지 않는다. 새 로그인은 같은 출처의 POST만
// 허용하고 키가 아닌 용도 분리된 10분 세션을 HttpOnly cookie에 저장한다.
export async function dashboardAccess(request, env, { compareSecret, limit, readText }) {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const headers = dashboardHeaders(nonce);
  const response = (status, message) => ({ nonce, headers, response: new Response(page(message), { status, headers }) });
  const url = new URL(request.url);
  if (url.search) return { nonce, headers, response: new Response(null, { status: 303, headers: { ...headers, Location: PATH } }) };
  if (!env.GAME_DASH_KEY || !env.JWT_SECRET) return response(503, '대시보드 설정을 확인해주세요.');
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return response(403, '이 페이지에서 다시 로그인해주세요.');
    if (!(await limit())) return response(429, '요청이 너무 많아요. 잠시 후 다시 시도해주세요.');
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return response(415, '로그인 양식을 사용해주세요.');
    let form;
    try { form = new URLSearchParams(await readText(request, 4096)); }
    catch { return response(400, '로그인 요청을 확인해주세요.'); }
    const key = form.get('key');
    if (form.getAll('key').length !== 1 || !key || key.length > 1024 || !compareSecret(key, env.GAME_DASH_KEY)) return response(401, '접근 키가 올바르지 않아요.');
    const token = await signTypedToken(env.JWT_SECRET, 'dashboard', 'dashboard', SESSION_SECONDS);
    return { nonce, headers, response: new Response(null, { status: 303, headers: {
      ...headers, Location: PATH,
      'Set-Cookie': `${COOKIE}=${token}; Path=${PATH}; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    } }) };
  }
  const cookies = (request.headers.get('Cookie') || '').split(';').map((v) => v.trim()).filter((v) => v.startsWith(`${COOKIE}=`));
  const token = cookies.length === 1 ? cookies[0].slice(COOKIE.length + 1) : '';
  if (!(await verifyTypedToken(env.JWT_SECRET, token, 'dashboard'))) return response(401, '접근 키를 입력해주세요. 로그인은 10분 동안 유지돼요.');
  return { nonce, headers, response: null };
}
