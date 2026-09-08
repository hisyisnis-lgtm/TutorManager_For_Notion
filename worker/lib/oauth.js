// worker/lib/oauth.js — 게임 계정 소셜 로그인(카카오·구글) OAuth BFF 헬퍼.
import { base64url, signTypedToken, verifyTypedToken } from './auth.js';
//
// BFF(Backend-For-Frontend) 패턴: redirect_uri = Worker 콜백. Worker가 인가코드를
// client_secret으로 교환하므로 시크릿이 클라이언트에 노출되지 않고, 토큰을 제공자
// 토큰 엔드포인트에서 TLS로 직접 받으므로 Google ID 토큰은 서명 재검증이 불필요하다.
//
// 이 모듈은 **순수 로직만** 담는다(네트워크 fetch는 호출부 index.js에서). → vitest 용이.

export const SOCIAL_PROVIDERS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
  },
  kakao: {
    authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userInfoUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: '',
  },
};

export function isSocialProvider(p) {
  return p === 'google' || p === 'kakao';
}

// 제공자 인가(authorize) URL 생성.
export function buildAuthorizeUrl({ provider, clientId, redirectUri, state, nonce }) {
  const cfg = SOCIAL_PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  if (cfg.scope) q.set('scope', cfg.scope);
  if (provider === 'google' && nonce) q.set('nonce', nonce);
  return `${cfg.authorizeUrl}?${q.toString()}`;
}

// Worker 콜백 URL(redirect_uri) 산출 — 요청 origin 기준. 제공자 콘솔의 등록값과 정확히 일치해야 함.
export function callbackUrl(origin, provider) {
  return `${origin}/game/auth/${provider}/callback`;
}

// JWT(예: Google id_token) payload 디코드 — **서명 검증 없이** claim만 파싱.
// BFF에서 토큰을 Google 토큰 엔드포인트로부터 TLS로 직접 받은 경우에만 안전(중간자 없음).
export function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    // atob는 Latin1 바이트열 → UTF-8로 디코드해야 한글 이름(name)이 안 깨진다.
    const bytes = Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

// 제공자별 사용자 신원 추출 → { socialId, nickname }.
//  - google: id_token(JWT) payload에서 sub·name
//  - kakao : /v2/user/me 응답에서 id·nickname
export function extractGoogleIdentity(idTokenPayload, expected) {
  if (!idTokenPayload || !idTokenPayload.sub) return null;
  if (expected) {
    const p = idTokenPayload;
    const audiences = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(p.iss)
      || !audiences.includes(expected.audience) || (audiences.length > 1 && p.azp !== expected.audience)
      || !Number.isSafeInteger(p.exp) || p.exp <= Math.floor(Date.now() / 1000)
      || p.nonce !== expected.nonce) return null;
  }
  return {
    socialId: String(idTokenPayload.sub),
    nickname: idTokenPayload.name || idTokenPayload.given_name || null,
  };
}

export function extractKakaoIdentity(userMe) {
  if (!userMe || userMe.id == null) return null;
  const nick = userMe.kakao_account?.profile?.nickname || userMe.properties?.nickname || null;
  return { socialId: String(userMe.id), nickname: nick };
}

// GAME_USERS 조회 키 — 제공자 네임스페이스를 박아 서로 다른 제공자의 동일 숫자 id 충돌 방지.
export function socialUserKey(provider, socialId) {
  return `${provider}:${socialId}`;
}

// 복귀(redirect) 대상 검증 — 오픈 리다이렉트·토큰 유출 방지.
// ★startsWith(prefix)는 경계가 없어 `https://허용도메인.evil.com` 같은 접미사 부착 도메인이 통과(토큰 탈취).
//   프로토콜+호스트를 '정확히' 일치시킨다(포트·경로는 허용 — 로컬 dev 포트, capacitor 등 기존 동작 유지).
export function isAllowedRedirect(target, allowedPrefixes) {
  if (!target || typeof target !== 'string') return false;
  let url;
  try { url = new URL(target); } catch { return false; } // 절대 URL만 허용(상대·형식오류 거부)
  return allowedPrefixes.some((p) => {
    if (!p) return false;
    let pu;
    try { pu = new URL(p); } catch { return false; }
    return url.protocol === pu.protocol && url.hostname === pu.hostname;
  });
}

// 기본 허용 복귀 prefix. env.GAME_AUTH_REDIRECTS(콤마 구분)로 덮어쓸 수 있음.
export const DEFAULT_REDIRECT_PREFIXES = [
  'https://tiantian-chinese.pages.dev',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
];

export function redirectPrefixes(env) {
  const raw = (env && env.GAME_AUTH_REDIRECTS) || '';
  const extra = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_REDIRECT_PREFIXES, ...extra];
}

// 장기 세션 대신 90초 일회 교환 코드만 프래그먼트에 전달한다.
export function appendCodeFragment(target, code, transaction) {
  const sep = target.includes('#') ? '&' : '#';
  return `${target}${sep}login_code=${encodeURIComponent(code)}&login_tx=${encodeURIComponent(transaction)}`;
}

// OAuth state는 전용 서명 문맥·브라우저 challenge·거래 ID를 담고, 콜백에서 D1로 일회 소비한다.
export const isPkceChallenge = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isLoginTransaction = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);

export async function pkceChallenge(verifier) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// The browser keeps the verifier; signed state contains only its S256 challenge.
export async function signAuthState(secret, { provider, redirect, challenge, transaction }, ttlSeconds = 600) {
  if (!isSocialProvider(provider) || !isPkceChallenge(challenge) || !isLoginTransaction(transaction)) throw new Error('invalid login transaction');
  return signTypedToken(secret, 'oauth-state', transaction, ttlSeconds, { p: provider, r: redirect, challenge });
}

export async function verifyAuthState(secret, state) {
  const claim = await verifyTypedToken(secret, state, 'oauth-state');
  if (!claim || !isSocialProvider(claim.p) || typeof claim.r !== 'string' || !isPkceChallenge(claim.challenge) || !isLoginTransaction(claim.sub)) return null;
  return { provider: claim.p, redirect: claim.r, challenge: claim.challenge, transaction: claim.sub };
}
