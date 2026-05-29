/** 인증 토큰 키 — 단일 출처 정의 */
const TOKEN_KEY = 'auth_token';

/** 저장된 JWT 토큰 반환 (없으면 빈 문자열) */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

/** 로그인 상태 여부 확인 — 토큰 존재 + 만료(exp) 미경과까지 확인.
 *  JWT payload는 `btoa(JSON.stringify({ exp }))` (암호화 아님)이라 클라이언트가 직접 디코드 가능.
 *  만료된 토큰은 미인증으로 처리해 LoginPage가 즉시 뜨게 한다 (만료 후 강사 화면 진입 →
 *  첫 Notion 호출 401 → 흰 화면 되는 것을 사전 차단). 파싱 실패(빈/구형 토큰)도 미인증 처리. */
export function isAuthed() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split('.')[0]));
    return typeof exp === 'number' && exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** 토큰 삭제 (로그아웃 / 401 응답 시) */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}
