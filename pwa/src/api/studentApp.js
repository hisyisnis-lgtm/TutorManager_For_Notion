import { fetchWithTimeout, UPLOAD_TIMEOUT_MS } from './fetchTimeout.js';
import { clearSensitiveCache, notifyAuthChange } from './authState.js';
import { getStudentAppContext, normalizeStudentAppContext, setStudentAppContext } from './studentAppState.js';
import { clearStudentAppMemory } from './studentAppMemory.js';

export { getStudentAppContext, getStudentAppScope, subscribeStudentAppContext } from './studentAppState.js';
const BASE = '/api/site/student-app';
let contextRequest = 0;
let csrfToken = '';
const pendingReads = new Map();
const readRevisions = new Map();
const changed = () => new globalThis.DOMException('로그인 상태가 바뀌었습니다. 다시 확인해 주세요.', 'AbortError');
const resourceKey = (scope, path) => `${scope}:${path.split(/[/?]/)[1]}`;
function invalidateReads(scope, path) {
  const key = resourceKey(scope, path);
  readRevisions.set(key, (readRevisions.get(key) ?? 0) + 1);
  for (const [requestKey, pending] of pendingReads) {
    if (pending.resource === key) pendingReads.delete(requestKey);
  }
}
function updateContext(next) {
  const previous = getStudentAppContext();
  if (JSON.stringify(previous) === JSON.stringify(next)) return next;
  if (previous?.scope) { clearSensitiveCache(`student:${previous.scope}`); clearStudentAppMemory(previous.scope); }
  csrfToken = '';
  pendingReads.clear();
  readRevisions.clear();
  setStudentAppContext(next);
  notifyAuthChange();
  return next;
}
export function clearStudentAppContext(reason = 'login_required') {
  contextRequest += 1;
  return updateContext({ allowed: false, reason });
}
export function requireStudentAppContext(scope) {
  const current = getStudentAppContext();
  if (!current?.allowed || !scope || current.scope !== scope) {
    throw Object.assign(new Error('학생 앱 이용 상태를 다시 확인해 주세요.'), { status: 403 });
  }
  return current;
}
function currentContext(captured) { return getStudentAppContext() === captured && captured?.allowed === true; }
async function readJson(response) { return response.json().catch(() => null); }
function failure(response, data) {
  return Object.assign(new Error(response.status < 500 && typeof data?.error === 'string' && data.error.length <= 300
    ? data.error : '연결하지 못했어요. 잠시 후 다시 시도해 주세요.'), { status: response.status, data, code: data?.code });
}
export async function fetchStudentAppContext(signal) {
  const request = ++contextRequest;
  const response = await fetchWithTimeout(`${BASE}/context`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  const data = await readJson(response);
  if (signal?.aborted || request !== contextRequest) throw changed();
  if (!response.ok) {
    updateContext({ allowed: false, reason: response.status === 401 ? 'login_required'
      : response.status === 409 && data?.code === 'profile_incomplete' ? 'profile_incomplete'
        : response.status === 403 ? 'not_allowed' : 'connection_error' });
    throw failure(response, data);
  }
  let next;
  try { next = normalizeStudentAppContext(data); }
  catch (error) { updateContext({ allowed: false, reason: 'connection_error' }); throw error; }
  return updateContext(next);
}
export async function studentAppMutationHeaders(scope) {
  const captured = requireStudentAppContext(scope);
  if (!csrfToken) {
    const response = await fetchWithTimeout('/api/site/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    const data = await readJson(response);
    if (!currentContext(captured)) throw changed();
    if (!response.ok || data?.member?.id !== captured.memberId || typeof data?.csrfToken !== 'string' || !data.csrfToken) {
      clearStudentAppContext('login_required');
      throw Object.assign(new Error('다시 로그인해 주세요.'), { status: 401 });
    }
    csrfToken = data.csrfToken;
  }
  if (!currentContext(captured)) throw changed();
  return { 'X-CSRF-Token': csrfToken };
}
export async function studentAppResponse(path, { scope, method = 'GET', body, signal, timeoutMs } = {}) {
  if (!/^\/[a-z][a-z0-9/-]*(?:\?[^#\r\n]*)?$/.test(path) || path.includes('..')) throw new Error('요청 경로를 확인해 주세요.');
  const captured = requireStudentAppContext(scope);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = method === 'GET' ? {} : await studentAppMutationHeaders(scope);
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (!currentContext(captured)) throw changed();
  if (method !== 'GET') invalidateReads(scope, path);
  let response;
  try {
    response = await fetchWithTimeout(`${BASE}${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers,
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
    }, timeoutMs);
  } finally {
    // 저장 전·저장 도중 시작한 목록 요청은 저장 후 최신 조회에 재사용하지 않는다.
    if (method !== 'GET') invalidateReads(scope, path);
  }
  if (!currentContext(captured) || signal?.aborted) throw changed();
  if (!response.ok) {
    const data = await readJson(response);
    if (!currentContext(captured)) throw changed();
    if (response.status === 401 || response.status === 403) clearStudentAppContext(response.status === 401 ? 'login_required' : 'not_allowed');
    throw failure(response, data);
  }
  return response;
}
export async function studentAppJson(path, options) {
  const captured = requireStudentAppContext(options?.scope);
  const resource = resourceKey(options.scope, path);
  const revision = readRevisions.get(resource) ?? 0;
  const isRead = !options.method || options.method === 'GET';
  // 호출자별 취소 신호가 없는 GET만 공유한다. 응답값은 완료 후 남기지 않고 기존
  // 화면 캐시가 수명·재검증을 관리한다.
  const share = isRead && !options.signal;
  const key = JSON.stringify([options.scope, path, options.timeoutMs ?? null]);
  const pending = pendingReads.get(key);
  if (share && pending?.context === captured && pending.revision === revision) return pending.promise;
  const record = { context: captured, resource, revision };
  record.promise = (async () => {
    const response = await studentAppResponse(path, options);
    const data = await readJson(response);
    if (!currentContext(captured) || options.signal?.aborted) throw changed();
    if (isRead && revision !== (readRevisions.get(resource) ?? 0)) {
      throw new globalThis.DOMException('정보가 변경되었습니다. 다시 확인해 주세요.', 'AbortError');
    }
    if (data === null) throw new Error('응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return data;
  })().finally(() => { if (pendingReads.get(key) === record) pendingReads.delete(key); });
  if (share) pendingReads.set(key, record);
  return record.promise;
}
export async function studentAppUpload(scope, form, onProgress) {
  if (typeof onProgress !== 'function' || typeof XMLHttpRequest === 'undefined') {
    return studentAppJson('/homework/upload', { scope, method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  }
  const captured = requireStudentAppContext(scope);
  const headers = await studentAppMutationHeaders(scope);
  if (!currentContext(captured)) throw changed();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/homework/upload`, true);
    xhr.withCredentials = true;
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = event => { if (currentContext(captured) && event.lengthComputable) onProgress(event.loaded, event.total); };
    xhr.onload = () => {
      invalidateReads(scope, '/homework/upload');
      if (!currentContext(captured)) { reject(changed()); return; }
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* 손상된 응답은 성공으로 처리하지 않는다. */ }
      if (xhr.status >= 200 && xhr.status < 300 && data) { resolve(data); return; }
      if (xhr.status === 401 || xhr.status === 403) clearStudentAppContext(xhr.status === 401 ? 'login_required' : 'not_allowed');
      reject(failure({ status: xhr.status }, data));
    };
    xhr.onerror = () => { invalidateReads(scope, '/homework/upload'); reject(new Error('네트워크가 끊겨 업로드하지 못했어요. 연결을 확인해 주세요.')); };
    xhr.ontimeout = () => { invalidateReads(scope, '/homework/upload'); reject(new Error('요청 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.')); };
    invalidateReads(scope, '/homework/upload');
    xhr.send(form);
  });
}
export async function logoutStudentApp(scope) {
  try {
    const headers = await studentAppMutationHeaders(scope);
    const response = await fetchWithTimeout('/api/site/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw failure(response, await readJson(response));
    try { localStorage.setItem('hanul_member_auth_changed', `${Date.now()}-${Math.random()}`); } catch { /* 선택적 탭 간 알림 */ }
  } finally { clearStudentAppContext('login_required'); }
}
