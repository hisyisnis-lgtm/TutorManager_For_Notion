// worker/lib/oauth.js — 게임 계정 소셜 로그인(카카오·구글) OAuth BFF 헬퍼.
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
export function buildAuthorizeUrl({ provider, clientId, redirectUri, state }) {
  const cfg = SOCIAL_PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  if (cfg.scope) q.set('scope', cfg.scope);
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
export function extractGoogleIdentity(idTokenPayload) {
  if (!idTokenPayload || !idTokenPayload.sub) return null;
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

// 복귀(redirect) 대상 검증 — 허용 prefix로 시작하는지. 오픈 리다이렉트·토큰 유출 방지.
export function isAllowedRedirect(target, allowedPrefixes) {
  if (!target || typeof target !== 'string') return false;
  return allowedPrefixes.some((p) => p && target.startsWith(p));
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

// 토큰을 복귀 대상에 프래그먼트로 실어 보낸다(#token=… — 서버 로그·Referer에 안 남음).
export function appendTokenFragment(target, token) {
  const sep = target.includes('#') ? '&' : '#';
  return `${target}${sep}token=${encodeURIComponent(token)}`;
}
