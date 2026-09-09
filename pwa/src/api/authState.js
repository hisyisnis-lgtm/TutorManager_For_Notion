// 인증 변경을 같은 탭과 다른 탭에 전파한다. 서버의 서명 검증을 대체하지 않으며,
// 클라이언트에서는 만료/용도 확인과 개인정보 화면·캐시의 수명 관리에만 사용한다.
export const AUTH_CHANGE_EVENT = 'tutor-auth-changed';
export const SENSITIVE_CACHE_TTL = 15 * 60 * 1000;
const listeners = new Set();
let revision = 0;
let expiryTimer;

export function readStoredSession(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export function sessionClaims(value, purpose, subject) {
  try {
    const parts = value.split('.');
    if (parts.length !== 2 || !parts[1]) return null;
    const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new globalThis.TextDecoder().decode(bytes));
    if (claims.v !== 2 || claims.iss !== 'tutor-manager' || claims.purpose !== purpose
      || claims.aud !== `tutor-manager:${purpose}` || claims.sub !== subject
      || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)
      || claims.exp * 1000 <= Date.now() || claims.iat > claims.exp
      || (purpose === 'teacher' && claims.role !== 'teacher')) return null;
    return claims;
  } catch { return null; }
}

export function teacherSession() {
  const value = readStoredSession('auth_token');
  return sessionClaims(value, 'teacher', 'teacher') ? value : '';
}

export function studentSession(token) {
  const value = readStoredSession(`student_session_${token}`);
  return sessionClaims(value, 'student', `personal:${token}`) ? value : '';
}

export function cacheScope(key) {
  const match = key.match(/^student:(?:info|homework|notices|classes|upcoming):([^:]+)/);
  return match ? `student:${match[1]}` : 'teacher';
}

function credentialFor(scope) {
  return scope.startsWith('student:')
    ? teacherSession() || studentSession(scope.slice(8))
    : teacherSession();
}

/** 비동기 요청 시작 시 캡처하고 반환·저장 직전에 확인한다. */
export function captureAuthScope(scope = 'teacher') {
  return { scope, revision, credential: credentialFor(scope) };
}

export function isAuthScopeCurrent(captured) {
  return !!captured?.credential && captured.revision === revision
    && captured.credential === credentialFor(captured.scope);
}

function removeMatching(storage, matches) {
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && matches(key)) storage.removeItem(key);
    }
  } catch { /* 저장소 차단 환경 */ }
}

export function clearSensitiveCache(scope = 'teacher') {
  const matches = (key) => {
    if (key.startsWith('swr_')) {
      return scope === 'teacher' || cacheScope(key.slice(4)) === scope;
    }
    return scope === 'teacher' && (key.startsWith('tutor_master_cache_')
      || key.startsWith('ntfy_') || key.startsWith('teacher_push_') || key === 'instructor_name');
  };
  try { removeMatching(localStorage, matches); } catch {}
  try { removeMatching(sessionStorage, matches); } catch {}
}

function sessionKeys() {
  const keys = ['auth_token'];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('student_session_')) keys.push(key);
    }
  } catch {}
  return keys;
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  let nextExpiry = Infinity;
  for (const key of sessionKeys()) {
    const raw = readStoredSession(key);
    if (!raw) continue;
    const token = key.slice('student_session_'.length);
    const claims = key === 'auth_token'
      ? sessionClaims(raw, 'teacher', 'teacher')
      : sessionClaims(raw, 'student', `personal:${token}`);
    nextExpiry = Math.min(nextExpiry, claims ? claims.exp * 1000 : Date.now());
  }
  if (Number.isFinite(nextExpiry)) {
    expiryTimer = setTimeout(checkSessionExpiry, Math.min(Math.max(0, nextExpiry - Date.now()), 2 ** 31 - 1));
  }
}

export function notifyAuthChange() {
  revision += 1;
  listeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(AUTH_CHANGE_EVENT));
  scheduleExpiry();
}

export function subscribeAuthChanges(listener) {
  listeners.add(listener);
  scheduleExpiry();
  return () => listeners.delete(listener);
}

export function getAuthRevision() { return revision; }

export function checkSessionExpiry() {
  let changed = false;
  for (const key of sessionKeys()) {
    if (!readStoredSession(key)) continue;
    const token = key.slice('student_session_'.length);
    if (key === 'auth_token' ? teacherSession() : studentSession(token)) continue;
    try { localStorage.removeItem(key); } catch {}
    clearSensitiveCache(key === 'auth_token' ? 'teacher' : `student:${token}`);
    changed = true;
  }
  if (changed) notifyAuthChange();
  else scheduleExpiry();
}

if (typeof window !== 'undefined') {
  // 과거 버전에서 장기간 남긴 개인정보·알림 접근정보는 새 캐시로 이관하지 않는다.
  try {
    removeMatching(localStorage, (key) => key.startsWith('swr_')
      || key.startsWith('tutor_master_cache_') || key.startsWith('ntfy_'));
  } catch {}
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === 'auth_token' || event.key?.startsWith('student_session_')) {
      clearSensitiveCache(event.key?.startsWith('student_session_')
        ? `student:${event.key.slice('student_session_'.length)}` : 'teacher');
      notifyAuthChange();
    }
  });
  window.addEventListener('focus', checkSessionExpiry);
  window.addEventListener('pageshow', checkSessionExpiry);
  document.addEventListener('visibilitychange', checkSessionExpiry);
  checkSessionExpiry();
}
