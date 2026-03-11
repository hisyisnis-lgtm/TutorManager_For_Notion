const WORKER_URL = import.meta.env.VITE_WORKER_URL;

function getToken() {
  return sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
}

async function bookingFetch(method, path, body, { auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;

  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 예약 가능 슬롯 조회 (공개) */
export async function fetchAvailableSlots(from, to) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return bookingFetch('GET', `/booking/slots?${params}`);
}

/** 날짜별 예약 가능 시간 슬롯 조회 (공개, 30분 단위) */
export async function fetchTimeSlots(date) {
  return bookingFetch('GET', `/booking/time-slots?date=${date}`);
}

/** 학생 예약 코드로 학생 정보 조회 (공개) */
export async function fetchStudentByToken(token) {
  return bookingFetch('GET', `/booking/student/${encodeURIComponent(token)}`);
}

/** 예약 신청 (공개) → 즉시 확정 */
export async function reserveSlot({ studentToken, date, startTime, endTime, location }) {
  return bookingFetch('POST', '/booking/reserve', { studentToken, date, startTime, endTime, mode: location });
}

/** 학생 본인 수업 목록 조회 - CLASS_DB 기반 (공개) */
export async function fetchMyClasses(studentToken) {
  return bookingFetch('GET', `/booking/my-classes/${encodeURIComponent(studentToken)}`);
}

/** 학생 본인 수업 취소 - CLASS_DB ID 기반 (공개, 당일 취소 불가) */
export async function cancelMyClass(classId, studentToken) {
  return bookingFetch('DELETE', `/booking/my-class/${classId}?token=${encodeURIComponent(studentToken)}`);
}

/** 학생 본인 취소 수업 복구 (공개, 과거 수업 불가) */
export async function restoreMyClass(classId, studentToken) {
  return bookingFetch('POST', `/booking/my-class/${classId}/restore?token=${encodeURIComponent(studentToken)}`);
}

/** 예약 상태 조회 (공개, 토큰 기반) */
export async function fetchBookingStatus(token) {
  return bookingFetch('GET', `/booking/status/${encodeURIComponent(token)}`);
}

/** 예약 불가 날짜 목록 조회 (강사 인증 필요) */
export async function fetchBlockedDates() {
  return bookingFetch('GET', '/booking/blocked', undefined, { auth: true });
}

/** 예약 불가 날짜 추가 (강사 인증 필요) */
export async function createBlockedDate({ type, days, start, end, memo, blockedTimes }) {
  return bookingFetch('POST', '/booking/blocked', { type, days, start, end, memo, blockedTimes }, { auth: true });
}

/** 예약 불가 날짜 삭제 (강사 인증 필요) */
export async function deleteBlockedDate(id) {
  return bookingFetch('DELETE', `/booking/blocked/${id}`, undefined, { auth: true });
}
