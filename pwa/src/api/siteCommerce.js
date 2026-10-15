import { WORKER_URL } from '../config.js';
import { fetchWithTimeout } from './fetchTimeout.js';
import { getToken, handleTeacherAuthExpiry } from './authUtils.js';

export async function siteAdmin(path, { method = 'GET', body, signal } = {}) {
  const bearer = getToken();
  const response = await fetchWithTimeout(`${WORKER_URL}/api/site/admin${path}`, {
    method, signal, cache: 'no-store',
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) handleTeacherAuthExpiry(bearer);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '요청을 처리하지 못했어요.');
    error.status = response.status;
    error.code = data.code;
    error.canChangeSelection = data.canChangeSelection === true;
    error.access = data.access;
    error.sync = data.sync;
    throw error;
  }
  return data;
}
