/** 인증 토큰 키 — 단일 출처 정의 */
const TOKEN_KEY = 'auth_token';

/** 저장된 JWT 토큰 반환 (없으면 빈 문자열) */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

/** 로그인 상태 여부 확인 */
export function isAuthed() {
  return !!localStorage.getItem(TOKEN_KEY);
}

/** 토큰 삭제 (로그아웃 / 401 응답 시) */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
}
