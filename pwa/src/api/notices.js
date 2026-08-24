import { WORKER_URL } from '../config.js';
import { fetchWithTimeout } from './fetchTimeout.js';
import { studentBearer, handleStudentAuthExpiry } from './studentAuth.js';

// 공지 API — 전체 학생 공통 게시판.
//  · 학생: GET /notice/student/:token (학생 세션 필요)
//  · 강사: GET·POST·PATCH·DELETE /notice (강사 JWT)
// 알림톡·푸시는 붙어 있지 않다. 급한 공지는 카톡으로 따로 보내는 게 전제(2026-08-25 결정).

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function teacherHeaders() {
  const token = localStorage.getItem('auth_token') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** 학생용 공지 목록 — 노출된 것만, 중요 공지가 위. */
export async function fetchStudentNotices(studentToken) {
  const bearer = studentBearer(studentToken);
  const res = await fetchWithTimeout(`${WORKER_URL}/notice/student/${encodeURIComponent(studentToken)}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    cache: 'no-store',
  });
  // 세션 만료 → 정리 후 리로드, 인증 게이트가 다시 받아준다(숙제·예약 API와 같은 규약).
  if (res.status === 401) handleStudentAuthExpiry(studentToken);
  // 라우트가 아직 없는 워커(공지 배포 전)에서는 빈 목록으로 취급한다 — 학생에게
  // "허용되지 않은 경로입니다" 같은 문구를 보이느니 "아직 공지가 없어요"가 사실에 가깝다.
  // 덕분에 PWA를 워커보다 먼저 배포해도 안전하다. 워커가 올라가면 자동으로 채워진다.
  // ⚠️ 404/403만 이렇게 넘긴다 — 네트워크·5xx는 그대로 에러로 띄워야 조용한 실패가 안 된다.
  if (res.status === 404 || res.status === 403) return [];
  return parse(res);
}

/** 강사용 공지 목록 — 숨긴 공지까지 전부. */
export async function fetchNotices() {
  return parse(await fetchWithTimeout(`${WORKER_URL}/notice`, { headers: teacherHeaders(), cache: 'no-store' }));
}

export async function createNotice(notice) {
  return parse(await fetchWithTimeout(`${WORKER_URL}/notice`, {
    method: 'POST',
    headers: teacherHeaders(),
    body: JSON.stringify(notice),
  }));
}

export async function updateNotice(id, notice) {
  return parse(await fetchWithTimeout(`${WORKER_URL}/notice/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: teacherHeaders(),
    body: JSON.stringify(notice),
  }));
}

/** Notion 휴지통으로 보낸다(복구 가능). */
export async function deleteNotice(id) {
  return parse(await fetchWithTimeout(`${WORKER_URL}/notice/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: teacherHeaders(),
  }));
}
