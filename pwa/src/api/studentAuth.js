// 학생앱 휴대폰 인증(step-up) — 세션 저장 + OTP API + 데이터 호출용 인증 헤더.
//
// 유출된 학생 링크를 받은 제3자가 새 기기에서 접근 못 하게: 새 기기는 OTP 인증 후
// "출입 세션"(JWT)을 받아 localStorage에 보관하고, 모든 학생 데이터 호출에 첨부한다.
// 강사 기기(강사앱 로그인 흔적)는 OTP 없이 강사 JWT로 우회 — 학생 페이지 미리보기/공유용.
import { WORKER_URL } from '../config.js';
import { getToken } from './authUtils.js';

const sessionKey = (token) => `student_session_${token}`;

export function getStudentSession(token) {
  try { return localStorage.getItem(sessionKey(token)) || ''; } catch { return ''; }
}
export function setStudentSession(token, session) {
  try { localStorage.setItem(sessionKey(token), session); } catch { /* noop */ }
}
export function clearStudentSession(token) {
  try { localStorage.removeItem(sessionKey(token)); } catch { /* noop */ }
}

// 강사 기기 여부 — 강사앱 로그인 흔적이 있으면 학생 페이지를 보는 강사로 간주(OTP 면제).
export function isTeacherDevice() {
  try {
    return !!localStorage.getItem('auth_token') || !!localStorage.getItem('teacher_device');
  } catch { return false; }
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

async function authFetch(method, path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
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
export function requestStudentOtp(token) {
  return authFetch('POST', '/personal/auth/request-otp', { token });
}

/** 인증번호 검증 → 성공 시 세션 저장. → {ok:true, session} */
export async function verifyStudentOtp(token, code) {
  const data = await authFetch('POST', '/personal/auth/verify-otp', { token, code });
  if (data.session) setStudentSession(token, data.session);
  return data;
}
