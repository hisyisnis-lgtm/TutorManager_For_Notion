import { captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges } from './authState.js';

// JWT 학생 요청의 진행 중 GET만 공유한다. 완료 값은 화면 SWR 캐시가 관리한다.
const pendingReads = new Map();
let generation = 0;
const changed = () => new globalThis.DOMException('인증 또는 정보가 변경되었습니다. 다시 확인해 주세요.', 'AbortError');

export function invalidateStudentReads() {
  generation += 1;
  pendingReads.clear();
}
subscribeAuthChanges(invalidateStudentReads);

export function studentRequest(studentToken, method, path, operation) {
  const auth = captureAuthScope(`student:${studentToken}`);
  const isRead = method === 'GET';
  if (!isRead) invalidateStudentReads();
  const capturedGeneration = generation;
  const key = JSON.stringify([auth.scope, auth.revision, auth.credential, capturedGeneration, path]);
  if (isRead && auth.credential && pendingReads.has(key)) return pendingReads.get(key);
  const request = (async () => {
    try {
      const data = await operation(auth.credential || undefined);
      if (auth.credential && !isAuthScopeCurrent(auth)) throw changed();
      if (isRead && capturedGeneration !== generation) throw changed();
      return data;
    } finally {
      if (!isRead) invalidateStudentReads();
    }
  })().finally(() => { if (pendingReads.get(key) === request) pendingReads.delete(key); });
  // 인증 전 GET은 공유하지 않는다. 서버가 기존 401·권한 검증을 수행한다.
  if (isRead && auth.credential) pendingReads.set(key, request);
  return request;
}
