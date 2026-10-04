// UI 소개 확인 기록이다. 서버의 성장·먹이·전환 상태와는 별개로 관리한다.
export const PANDA_UPDATE_NOTICE_VERSION = 'liaoliao-v1';

export function pandaUpdateNoticeKey(studentToken) {
  return `panda_update_notice:${PANDA_UPDATE_NOTICE_VERSION}:${studentToken}`;
}

export function hasSeenPandaUpdate(studentToken) {
  if (!studentToken) return false;
  try { return localStorage.getItem(pandaUpdateNoticeKey(studentToken)) === '1'; }
  catch { return false; }
}

export function markPandaUpdateSeen(studentToken) {
  if (!studentToken) return;
  try { localStorage.setItem(pandaUpdateNoticeKey(studentToken), '1'); }
  catch { /* 저장을 사용할 수 없어도 안내를 닫고 앱을 계속 이용한다. */ }
}
