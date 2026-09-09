import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuth, getToken, isAuthed, setAuth, handleTeacherAuthExpiry } from './authUtils.js';
import {
  clearStudentSession, getStudentSession, handleStudentAuthExpiry,
  hasStudentAccess, setStudentSession, verifyStudentOtp,
} from './studentAuth.js';
import {
  captureAuthScope, checkSessionExpiry, isAuthScopeCurrent, notifyAuthChange, subscribeAuthChanges,
} from './authState.js';
import { fixtureSession } from './authFixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });
afterEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('인증 용도와 개인정보 수명', () => {
  it('구토큰·게임토큰·잘못된 역할·만료 강사토큰을 로컬 강사 권한으로 쓰지 않는다', () => {
    for (const token of [
      `${btoa(JSON.stringify({ exp: Date.now() / 1000 + 1000 }))}.legacy`,
      fixtureSession('game', 'game-user'), fixtureSession('teacher', undefined, { role: 'student' }),
      fixtureSession('teacher', undefined, { exp: Date.now() / 1000 - 1 }),
    ]) {
      localStorage.setItem('auth_token', token);
      expect(isAuthed()).toBe(false);
      expect(getToken()).toBe('');
    }
    setAuth(fixtureSession());
    expect(isAuthed()).toBe(true);
  });

  it('teacher_device 힌트와 다른 학생의 세션은 학생 인증을 통과시키지 않는다', () => {
    localStorage.setItem('teacher_device', '1');
    localStorage.setItem('student_session_STUDENT_B', fixtureSession('student'));
    expect(hasStudentAccess('STUDENT_A')).toBe(false);
    expect(hasStudentAccess('STUDENT_B')).toBe(false);
    setStudentSession('STUDENT_A', fixtureSession('student'));
    expect(hasStudentAccess('STUDENT_A')).toBe(true);
  });

  it('강사 로그아웃은 양 저장소 개인정보·토픽을 제거하고 게임 기록은 보존한다', () => {
    setAuth(fixtureSession());
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of ['swr_home:today', 'swr_student:info:STUDENT_A', 'tutor_master_cache_v2', 'ntfy_topic', 'ntfy_notifications', 'ntfy_last_read']) storage.setItem(key, 'private');
      storage.setItem('tone_game_progress', 'keep');
    }
    const auth = captureAuthScope();
    clearAuth();
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem('swr_home:today')).toBeNull();
      expect(storage.getItem('swr_student:info:STUDENT_A')).toBeNull();
      expect(storage.getItem('tutor_master_cache_v2')).toBeNull();
      expect(storage.getItem('ntfy_topic')).toBeNull();
      expect(storage.getItem('ntfy_notifications')).toBeNull();
      expect(storage.getItem('tone_game_progress')).toBe('keep');
    }
    expect(isAuthScopeCurrent(auth)).toBe(false);
  });

  it('학생 로그아웃은 해당 학생 캐시만 지우고 타 학생과 게임 기록을 보존한다', () => {
    setStudentSession('STUDENT_A', fixtureSession('student'));
    setStudentSession('STUDENT_B', fixtureSession('student', 'personal:STUDENT_B'));
    localStorage.setItem('personal_student_token', 'STUDENT_A');
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem('swr_student:classes:STUDENT_A:2026-09', 'private');
      storage.setItem('swr_student:info:STUDENT_B', 'keep-b');
      storage.setItem('tone_game_progress', 'keep-game');
    }
    clearStudentSession('STUDENT_A');
    expect(getStudentSession('STUDENT_A')).toBe('');
    expect(getStudentSession('STUDENT_B')).not.toBe('');
    expect(localStorage.getItem('personal_student_token')).toBeNull();
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem('swr_student:classes:STUDENT_A:2026-09')).toBeNull();
      expect(storage.getItem('swr_student:info:STUDENT_B')).toBe('keep-b');
      expect(storage.getItem('tone_game_progress')).toBe('keep-game');
    }
  });

  it('다른 탭 로그아웃도 현재 탭의 개인정보와 진행 중 요청을 무효화한다', () => {
    setAuth(fixtureSession());
    const captured = captureAuthScope();
    sessionStorage.setItem('tutor_master_cache_v3', 'private');
    const changed = vi.fn();
    const unsubscribe = subscribeAuthChanges(changed);
    localStorage.removeItem('auth_token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: null }));
    expect(changed).toHaveBeenCalled();
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
    expect(isAuthScopeCurrent(captured)).toBe(false);
    unsubscribe();
  });

  it('만료 점검과 401도 개인정보를 정리한다', () => {
    setStudentSession('STUDENT_A', fixtureSession('student'));
    sessionStorage.setItem('swr_student:info:STUDENT_A', 'private');
    expect(handleStudentAuthExpiry('STUDENT_A', getStudentSession('STUDENT_A'))).toBe(true);
    expect(sessionStorage.getItem('swr_student:info:STUDENT_A')).toBeNull();
    localStorage.setItem('auth_token', fixtureSession('teacher', undefined, { exp: 1 }));
    sessionStorage.setItem('tutor_master_cache_v3', 'private');
    checkSessionExpiry();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
  });

  it('로그아웃 뒤 재로그인한 세션을 이전 요청의 401로 지우지 않는다', () => {
    const before = fixtureSession();
    setAuth(before);
    clearAuth();
    const after = fixtureSession('teacher', undefined, { exp: Math.floor(Date.now() / 1000) + 7200 });
    setAuth(after);
    handleTeacherAuthExpiry(before);
    expect(getToken()).toBe(after);
  });

  it('취소된 OTP 검증 응답은 늦게 도착해도 세션을 생성하지 않는다', async () => {
    let respond;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    const controller = new AbortController();
    const result = verifyStudentOtp('STUDENT_A', '123456', controller.signal);
    controller.abort();
    respond(new Response(JSON.stringify({ session: fixtureSession('student') })));
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(getStudentSession('STUDENT_A')).toBe('');
  });
});
