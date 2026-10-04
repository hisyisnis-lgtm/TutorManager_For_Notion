import { WORKER_URL } from '../config.js';
import { fetchWithTimeout } from './fetchTimeout.js';
import { studentBearer, handleStudentAuthExpiry } from './studentAuth.js';
import { getAuthRevision } from './authState.js';
import { isValidPandaSnapshot } from '../constants/pandaServerState.js';

async function pandaRequest(studentCode, action, signal) {
  if (!/^[A-Z0-9]{12}$/.test(studentCode)) throw new Error('학생 코드를 확인해 주세요.');
  const authRevision = getAuthRevision();
  const bearer = studentBearer(studentCode);
  if (!bearer) throw Object.assign(new Error('학생 로그인이 필요합니다.'), { status: 401 });
  const response = await fetchWithTimeout(`${WORKER_URL}/personal/student/${encodeURIComponent(studentCode)}/panda${action ? '/action' : ''}`, {
    method: action ? 'POST' : 'GET', cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${bearer}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (signal?.aborted || authRevision !== getAuthRevision()) throw new DOMException('인증 상태가 바뀌었습니다.', 'AbortError');
  if (response.status === 401) handleStudentAuthExpiry(studentCode, bearer);
  if (!response.ok) {
    const error = Object.assign(new Error(data?.error || '판다 기록을 확인하지 못했어요.'), { status: response.status, code: data?.code });
    if (isValidPandaSnapshot(data)) {
      error.snapshot = { profile: data.profile, earnedTotal: data.earnedTotal, availableFood: data.availableFood, transition: data.transition };
      Object.assign(error, error.snapshot);
    }
    throw error;
  }
  if (!isValidPandaSnapshot(data) || (action && (data.ok !== true || data.action?.requestId !== action.requestId || data.action?.type !== action.type))) {
    throw new Error('판다 기록 응답을 확인하지 못했어요. 기존 기록은 유지됩니다.');
  }
  return data;
}

export const fetchPandaProfile = (studentCode, signal) => pandaRequest(studentCode, null, signal);
// Keep requestId on retries. A network error never means that a purchase or feed failed to reach the server.
export const performPandaAction = (studentCode, action, signal) => pandaRequest(studentCode, action, signal);
