import { WORKER_URL } from '../config.js';
import { fetchWithTimeout } from './fetchTimeout.js';
import { studentBearer, handleStudentAuthExpiry } from './studentAuth.js';
import { getToken, handleTeacherAuthExpiry } from './authUtils.js';
import { getAuthRevision } from './authState.js';

// 동의서 내용은 메모리에서만 사용한다. 공개 JS·로컬 저장소·SW 캐시에 넣지 않는다.
export async function fetchConsentTerms(studentToken, signal) {
  const revision = getAuthRevision();
  const bearer = studentToken ? studentBearer(studentToken) : getToken();
  const path = studentToken ? `/booking/consent/${encodeURIComponent(studentToken)}` : '/booking/consent';
  const response = await fetchWithTimeout(`${WORKER_URL}${path}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, cache: 'no-store', signal,
  });
  if (response.status === 401) {
    if (studentToken) handleStudentAuthExpiry(studentToken, bearer);
    else handleTeacherAuthExpiry(bearer);
  }
  const data = await response.json().catch(() => null);
  if (signal?.aborted || revision !== getAuthRevision()) throw new DOMException('인증 상태가 바뀌었습니다.', 'AbortError');
  if (!response.ok || !data || typeof data.teacherCancellation !== 'string' || typeof data.refundBefore !== 'string'
    || !Array.isArray(data.refundAfter) || data.refundAfter.length !== 2 || !data.refundAfter.every(text => typeof text === 'string')
    || !Array.isArray(data.refundNotes) || data.refundNotes.length !== 4 || !data.refundNotes.every(text => typeof text === 'string')
    || !/^https:\/\/forms\.gle\/[A-Za-z0-9]+$/.test(data.confirmationUrl)) {
    throw new Error('동의서를 불러오지 못했어요.');
  }
  return data;
}
