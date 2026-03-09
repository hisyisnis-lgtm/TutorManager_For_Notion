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

/** 예약 신청 (공개) → 즉시 확정 */
export async function reserveSlot({ date, startTime, durationMin, studentName, phone }) {
  return bookingFetch('POST', '/booking/reserve', { date, startTime, durationMin, studentName, phone });
}

/** 예약 상태 조회 (공개, 토큰 기반) */
export async function fetchBookingStatus(token) {
  return bookingFetch('GET', `/booking/status/${encodeURIComponent(token)}`);
}

/** 예약 목록 조회 (강사 인증 필요) */
export async function fetchBookingList() {
  return bookingFetch('GET', '/booking/list', undefined, { auth: true });
}

/** 예약 취소 (강사 인증 필요) */
export async function cancelBooking(bookingId) {
  return bookingFetch('DELETE', `/booking/${bookingId}`, undefined, { auth: true });
}
