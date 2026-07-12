import { WORKER_URL } from '../config.js';
import { getToken } from './authUtils.js';
import { studentBearer } from './studentAuth.js';

// 단일 요청이 이보다 오래 매달리면 중단 — 무한 스피너 방지(강사앱 notionClient와 동일 정책).
const REQUEST_TIMEOUT_MS = 25000;

async function bookingFetch(method, path, body, { auth = false, studentToken = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  else if (studentToken) {
    const bearer = studentBearer(studentToken);
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('요청 시간이 초과됐어요. 네트워크를 확인하고 잠시 후 다시 시도해주세요.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 강사용: 날짜별 예약 가능 시간 슬롯 조회 (날짜 제한 없음, excludeId로 자기 자신 제외) → { available, passable } */
export async function fetchTimeSlotsForTeacher(date, excludeId = '') {
  const params = new URLSearchParams({ date, skipMinDate: '1' });
  if (excludeId) params.set('excludeId', excludeId);
  const data = await bookingFetch('GET', `/booking/time-slots?${params}`);
  return Array.isArray(data) ? { available: data, passable: data } : data;
}

/** 학생 예약 코드로 학생 정보 조회 (공개) */
export async function fetchStudentByToken(token) {
  return bookingFetch('GET', `/booking/student/${encodeURIComponent(token)}`, undefined, { studentToken: token });
}

/** 학생 본인 수업 목록 조회 - CLASS_DB 기반 (공개) */
export async function fetchMyClasses(studentToken, month) {
  const params = month ? `?month=${encodeURIComponent(month)}` : '';
  return bookingFetch('GET', `/booking/my-classes/${encodeURIComponent(studentToken)}${params}`, undefined, { studentToken });
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

/** 시간 충돌 여부 확인 (강사용 수업 등록 폼) */
export async function checkConflict(date, startTime, duration, excludeId = '') {
  const params = new URLSearchParams({ date, startTime, duration: String(duration) });
  if (excludeId) params.set('excludeId', excludeId);
  try {
    return await bookingFetch('GET', `/booking/check-conflict?${params}`);
  } catch {
    return { conflict: false };
  }
}
