import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import StudentAuthGate from './StudentAuthGate.jsx';
import { clearStudentSession, setStudentSession } from '../api/studentAuth.js';
import { clearAuth, setAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.useRealTimers();
});

describe('학생 인증 게이트 재검증', () => {
  it('같은 탭에서 학생 로그아웃하면 보호 컴포넌트를 즉시 언마운트한다', () => {
    const unmounted = vi.fn();
    function Protected() { useEffect(() => unmounted, []); return <p>학생 개인정보</p>; }
    setStudentSession('STUDENT_A', fixtureSession('student'));
    render(<StudentAuthGate token="STUDENT_A"><Protected /></StudentAuthGate>);
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
    act(() => clearStudentSession('STUDENT_A'));
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    expect(screen.getByText('본인 확인')).toBeTruthy();
    expect(unmounted).toHaveBeenCalledOnce();
  });

  it('라우트의 학생이 바뀌면 이전 granted 상태를 재사용하지 않는다', () => {
    setStudentSession('STUDENT_A', fixtureSession('student'));
    const view = render(<StudentAuthGate token="STUDENT_A"><p>보호 화면</p></StudentAuthGate>);
    view.rerender(<StudentAuthGate token="STUDENT_B"><p>보호 화면</p></StudentAuthGate>);
    expect(screen.queryByText('보호 화면')).toBeNull();
    expect(screen.getByText('본인 확인')).toBeTruthy();
  });

  it('다른 탭의 세션 변경 뒤에도 보호 화면의 진행 중 요청과 메모리 수명을 새로 시작한다', () => {
    const unmounted = vi.fn();
    function Protected() { useEffect(() => unmounted, []); return <p>보호 화면</p>; }
    setStudentSession('STUDENT_A', fixtureSession('student'));
    render(<StudentAuthGate token="STUDENT_A"><Protected /></StudentAuthGate>);
    act(() => setStudentSession('STUDENT_B', fixtureSession('student', 'personal:STUDENT_B')));
    expect(unmounted).toHaveBeenCalledOnce();
    expect(screen.getByText('보호 화면')).toBeTruthy();
  });

  it('강사 로그아웃 뒤 학생 미리보기에도 본인 확인을 표시한다', () => {
    setAuth(fixtureSession());
    render(<StudentAuthGate token="STUDENT_A"><p>보호 화면</p></StudentAuthGate>);
    act(() => clearAuth());
    expect(screen.queryByText('보호 화면')).toBeNull();
    expect(screen.getByText('본인 확인')).toBeTruthy();
  });

  it('화면을 열어 둔 채 세션이 만료되어도 보호 화면을 닫는다', () => {
    vi.useFakeTimers();
    setStudentSession('STUDENT_A', fixtureSession('student', undefined, { exp: Math.floor(Date.now() / 1000) + 1 }));
    render(<StudentAuthGate token="STUDENT_A"><p>보호 화면</p></StudentAuthGate>);
    act(() => vi.advanceTimersByTime(1001));
    expect(screen.queryByText('보호 화면')).toBeNull();
    expect(screen.getByText('본인 확인')).toBeTruthy();
  });

  it('게스트 게임 면제를 해제하면 같은 컴포넌트에서도 학생 인증을 요구한다', () => {
    const view = render(<StudentAuthGate token="STUDENT_A" disabled><p>게임</p></StudentAuthGate>);
    expect(screen.getByText('게임')).toBeTruthy();
    view.rerender(<StudentAuthGate token="STUDENT_A"><p>게임</p></StudentAuthGate>);
    expect(screen.queryByText('게임')).toBeNull();
  });
});
