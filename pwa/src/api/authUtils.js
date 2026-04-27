/** 인증 토큰 키 — 단일 출처 정의 */
const TOKEN_KEY = 'auth_token';

// XSS 방어: localStorage 영구 저장은 제거하고 sessionStorage만 사용 (브라우저 닫으면 자동 삭제).
// 과거 localStorage에 남아있던 토큰은 다음 호출에서 정리해 잔존물을 청소한다.
try { localStorage.removeItem(TOKEN_KEY); } catch {}

/** 저장된 JWT 토큰 반환 (없으면 빈 문자열) */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

/** 로그인 상태 여부 확인 */
export function isAuthed() {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

/** 토큰 삭제 (로그아웃 / 401 응답 시) */
export function clearAuth() {
  sessionStorage.removeItem(TOKEN_KEY);
  // 과거 잔존물 청소
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
