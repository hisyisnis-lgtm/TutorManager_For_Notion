import { WORKER_URL } from '../config.js';
import { getToken, handleTeacherAuthExpiry } from './authUtils.js';
import { captureAuthScope, isAuthScopeCurrent } from './authState.js';
import { fetchWithTimeout } from './fetchTimeout.js';

async function request(path, { method = 'GET', body, signal } = {}) {
  const auth = captureAuthScope();
  const bearer = getToken();
  if (!bearer) throw new Error('강사 로그인이 필요합니다.');
  const response = await fetchWithTimeout(`${WORKER_URL}/notification-followups${path}`, {
    method, signal, cache: 'no-store', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) handleTeacherAuthExpiry(bearer);
  const data = await response.json().catch(() => null);
  if (!isAuthScopeCurrent(auth)) throw new Error('인증 상태가 바뀌었습니다. 다시 로그인해 주세요.');
  if (!response.ok || !data) throw new Error(data?.error || '발송 후속 기록을 확인하지 못했어요.');
  return data;
}
export function fetchNotificationFollowups(filter, before, signal) {
  const params = new URLSearchParams({ filter });
  if (before) params.set('before', before);
  return request(`?${params}`, { signal });
}
export function resolveNotificationFollowup(id, resolutionKind) {
  return request(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: { resolutionKind } });
}
