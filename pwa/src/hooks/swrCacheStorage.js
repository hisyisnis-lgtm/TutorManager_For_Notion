import { studentAppMemoryStorage } from '../api/studentAppMemory.js';
import { cacheScope, captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges, SENSITIVE_CACHE_TTL } from '../api/authState.js';

const PREFIX = 'swr_';
// 저장소별 상한. UTF-16 문자열의 보수적인 크기이며 실제 JS heap 사용량은 아니다.
export const SWR_CACHE_LIMITS = { entries: 80, bytes: 2 * 1024 * 1024, entryBytes: 512 * 1024 };
const states = [
  { student: false, fallback: new Map(), parsed: new Map(), parsedBytes: 0 },
  { student: true, fallback: new Map(), parsed: new Map(), parsedBytes: 0 },
];
const stateFor = key => states[key.includes(':app-') ? 1 : 0];
const bytesOf = (key, raw) => (key.length + raw.length) * 2;
function storageOf(state) {
  try { return state.student ? studentAppMemoryStorage : sessionStorage; } catch { return null; }
}
function forgetParsed(state, key) {
  const previous = state.parsed.get(key);
  if (previous) state.parsedBytes -= previous.bytes;
  state.parsed.delete(key);
}
function removeEntry(state, key) {
  state.fallback.delete(key);
  forgetParsed(state, key);
  try { storageOf(state)?.removeItem(key); } catch { /* 저장소 차단 시 메모리만 정리 */ }
}
function keysOf(state) {
  const keys = new Set(state.fallback.keys());
  const storage = storageOf(state);
  try {
    for (let i = 0; i < storage?.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) keys.add(key);
    }
  } catch { /* 저장소가 막혀도 제한된 메모리 캐시는 사용한다. */ }
  return keys;
}
function rememberParsed(state, key, record) {
  forgetParsed(state, key);
  while (state.parsed.size >= SWR_CACHE_LIMITS.entries
    || state.parsedBytes + record.bytes > SWR_CACHE_LIMITS.bytes) {
    forgetParsed(state, state.parsed.keys().next().value);
  }
  state.parsed.set(key, record);
  state.parsedBytes += record.bytes;
}
function readRecord(state, key, authChecks = new Map()) {
  const scope = cacheScope(key.slice(PREFIX.length));
  if (!authChecks.has(scope)) authChecks.set(scope, isAuthScopeCurrent(captureAuthScope(scope)));
  if (!authChecks.get(scope)) { removeEntry(state, key); return undefined; }
  let raw = state.fallback.get(key);
  if (raw === undefined) {
    try { raw = storageOf(state)?.getItem(key); } catch { return undefined; }
  }
  if (!raw) { forgetParsed(state, key); return undefined; }
  const bytes = bytesOf(key, raw);
  if (bytes > SWR_CACHE_LIMITS.entryBytes) { removeEntry(state, key); return undefined; }
  let record = state.parsed.get(key);
  if (record?.raw !== raw) {
    try { record = { raw, entry: JSON.parse(raw), bytes }; }
    catch { removeEntry(state, key); return undefined; }
  }
  const now = Date.now();
  if (!Number.isFinite(record.entry?.savedAt) || now - record.entry.savedAt > SENSITIVE_CACHE_TTL
    || record.entry.savedAt > now) {
    removeEntry(state, key);
    return undefined;
  }
  if (state.parsed.get(key) !== record) rememberParsed(state, key, record);
  return record;
}
function trimStorage(state, incomingKey, incomingBytes = 0) {
  const authChecks = new Map();
  const entries = [];
  let total = incomingBytes;
  for (const key of keysOf(state)) {
    if (key === incomingKey) continue;
    const record = readRecord(state, key, authChecks);
    if (record) {
      entries.push({ key, savedAt: record.entry.savedAt, bytes: record.bytes });
      total += record.bytes;
    }
  }
  entries.sort((a, b) => a.savedAt - b.savedAt);
  while (entries.length + (incomingBytes ? 1 : 0) > SWR_CACHE_LIMITS.entries
    || total > SWR_CACHE_LIMITS.bytes) {
    const oldest = entries.shift();
    total -= oldest.bytes;
    removeEntry(state, oldest.key);
  }
}

export function readSWRCacheEntry(key) {
  return readRecord(stateFor(key), key)?.entry;
}
export function writeSWRCacheEntry(key, value, auth) {
  if (!isAuthScopeCurrent(auth) || auth.scope !== cacheScope(key.slice(PREFIX.length))) return;
  const state = stateFor(key);
  let raw;
  try { raw = JSON.stringify({ savedAt: Date.now(), value }); }
  catch { removeEntry(state, key); return; }
  const bytes = bytesOf(key, raw);
  if (bytes > SWR_CACHE_LIMITS.entryBytes) {
    removeEntry(state, key);
    trimStorage(state);
    return;
  }
  trimStorage(state, key, bytes);
  // 새 값은 첫 읽기 때만 파싱한다. 호출자가 원본을 변경해도 저장된 스냅샷은 유지된다.
  forgetParsed(state, key);
  try {
    const storage = storageOf(state);
    if (!storage) throw new Error('Storage unavailable');
    storage.setItem(key, raw);
    state.fallback.delete(key);
  } catch {
    // QuotaExceeded/SecurityError에서도 조회 성공과 재방문 캐시를 유지한다.
    try { storageOf(state)?.removeItem(key); } catch { /* noop */ }
    state.fallback.set(key, raw);
  }
}
export function invalidateSWRCache(prefix) {
  const full = PREFIX + prefix;
  for (const state of states) {
    const keys = new Set([...keysOf(state), ...state.parsed.keys()]);
    for (const key of keys) if (key.startsWith(full)) removeEntry(state, key);
  }
}

subscribeAuthChanges(() => {
  for (const state of states) {
    state.fallback.clear();
    state.parsed.clear();
    state.parsedBytes = 0;
  }
});
// 이전 버전의 무제한 캐시도 앱 시작과 다음 쓰기 때 한도 안으로 정리한다.
for (const state of states) trimStorage(state);
