// 학생앱 휴대폰 인증(step-up) — 세션 저장 + OTP API + 데이터 호출용 인증 헤더.
//
// 유출된 학생 링크를 받은 제3자가 새 기기에서 접근 못 하게: 새 기기는 OTP 인증 후
// "출입 세션"(JWT)을 받아 localStorage에 보관하고, 모든 학생 데이터 호출에 첨부한다.
// 유효한 강사 세션은 학생 페이지 미리보기에도 사용할 수 있다.
import { WORKER_URL } from '../config.js';
import { getToken, clearAuth } from './authUtils.js';
import {
  studentSession, sessionClaims, readStoredSession, clearSensitiveCache,
  notifyAuthChange, getAuthRevision,
} from './authState.js';
import { fetchWithTimeout } from './fetchTimeout.js';

const sessionKey = (token) => `student_session_${token}`;

export function getStudentSession(token) {
  return studentSession(token);
}
export function setStudentSession(token, session) {
  if (!sessionClaims(session, 'student', `personal:${token}`)) throw new Error('유효한 학생 인증이 아닙니다.');
  clearSensitiveCache(`student:${token}`);
  try { localStorage.setItem(sessionKey(token), session); } catch { /* noop */ }
  notifyAuthChange();
}
export function clearStudentSession(token) {
  try { localStorage.removeItem(sessionKey(token)); } catch { /* noop */ }
  try {
    if (localStorage.getItem('personal_student_token') === token) localStorage.removeItem('personal_student_token');
  } catch {}
  clearSensitiveCache(`student:${token}`);
  notifyAuthChange();
}

// teacher_device 라우팅 힌트는 접근 권한이 아니다. 유효한 강사 세션만 인정한다.
export function isTeacherDevice() {
  return !!getToken();
}

// 학생 페이지에 접근 권한이 있는가 (강사 기기이거나 유효 세션 보유).
export function hasStudentAccess(token) {
  return isTeacherDevice() || !!getStudentSession(token);
}

// 학생 데이터 호출에 붙일 Bearer 토큰 문자열. 강사 기기면 강사 JWT, 아니면 학생 세션, 없으면 ''.
export function studentBearer(token) {
  if (isTeacherDevice()) {
    const t = getToken();
    if (t) return t;
  }
  return getStudentSession(token);
}

// 401은 같은 탭 이벤트로 즉시 보호 화면을 닫는다. 리로드에 의존하지 않는다.
export function handleStudentAuthExpiry(token, bearer) {
  const teacher = readStoredSession('auth_token');
  const session = readStoredSession(sessionKey(token));
  if (bearer && bearer !== teacher && bearer !== session) return false;
  if ((bearer && bearer === teacher) || (!bearer && isTeacherDevice())) { clearAuth(); return true; }
  if (!token) return false;
  const hadSession = !!session;
  clearStudentSession(token);
  return hadSession;
}

async function authFetch(method, path, body, signal) {
  // OTP 발송/검증은 사용자가 화면에서 기다리는 경로 — 타임아웃 없으면 무한 스피너
  const res = await fetchWithTimeout(`${WORKER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 인증번호(알림톡) 발송 요청. → {ok:true, phoneTail} | {ok:false, reason:'no_phone'} */
export function requestStudentOtp(token, signal) {
  return authFetch('POST', '/personal/auth/request-otp', { token }, signal);
}

/** 인증번호 검증 → 성공 시 세션 저장. → {ok:true, session} */
export async function verifyStudentOtp(token, code, signal) {
  const revision = getAuthRevision();
  const data = await authFetch('POST', '/personal/auth/verify-otp', { token, code }, signal);
  if (signal?.aborted) throw new globalThis.DOMException('인증 요청이 취소되었습니다.', 'AbortError');
  if (revision !== getAuthRevision()) throw new Error('인증 상태가 바뀌었습니다. 다시 확인해 주세요.');
  if (!data.session) throw new Error('인증 세션을 받지 못했습니다.');
  setStudentSession(token, data.session);
  return data;
}
