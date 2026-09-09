import { useSyncExternalStore } from 'react';
import {
  teacherSession, sessionClaims, clearSensitiveCache, notifyAuthChange, subscribeAuthChanges,
  readStoredSession,
} from './authState.js';

/** 저장된 JWT 토큰 반환 (없으면 빈 문자열) */
export function getToken() {
  return teacherSession();
}

/** 강사용 v2 용도·역할·만료 확인. 실제 권한은 서버가 서명까지 검증한다. */
export function isAuthed() {
  return !!getToken();
}

export function useTeacherAuth() {
  return useSyncExternalStore(subscribeAuthChanges, isAuthed, () => false);
}

export function setAuth(token) {
  if (!sessionClaims(token, 'teacher', 'teacher')) throw new Error('유효한 강사 인증이 아닙니다.');
  clearSensitiveCache();
  localStorage.setItem('auth_token', token);
  // 라우팅 선호일 뿐 권한으로 사용하지 않는다.
  localStorage.setItem('teacher_device', '1');
  notifyAuthChange();
}

/** 토큰 삭제 (로그아웃 / 401 응답 시) */
export function clearAuth() {
  const bearer = readStoredSession('auth_token');
  // 동적 import로 인증 모듈의 순환 의존을 피한다. 로컬 PushSubscription도 즉시 해제된다.
  void import('./revokePushSubscription.js').then(({ revokePushSubscription }) => revokePushSubscription(bearer)).catch(() => {});
  try { localStorage.removeItem('auth_token'); } catch {}
  try { sessionStorage.removeItem('auth_token'); } catch {}
  clearSensitiveCache();
  notifyAuthChange();
}

export function handleTeacherAuthExpiry(bearer) {
  if (bearer && bearer === readStoredSession('auth_token')) clearAuth();
}
