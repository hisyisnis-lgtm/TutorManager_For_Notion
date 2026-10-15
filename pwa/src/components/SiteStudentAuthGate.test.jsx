import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import SiteStudentAuthGate from './SiteStudentAuthGate.jsx';
import { useStudentAppContext } from '../context/StudentAppContext.jsx';
import { clearStudentAppContext, getStudentAppContext, studentAppJson } from '../api/studentApp.js';
import { normalizeStudentAppContext, setStudentAppContext } from '../api/studentAppState.js';
import { clearStudentAppMemory, studentAppMemoryStorage } from '../api/studentAppMemory.js';
import { captureAuthScope } from '../api/authState.js';
import { peekCache, writeCacheValue } from '../hooks/useCachedResource.js';
import { fixtureSession } from '../api/authFixtures.js';

const allowed = { allowed: true, memberId: 'member-a', studentId: 'student-a', revision: 1, studentScope: 'opaque-a' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const mount = (children = <p>학생 개인정보</p>) => render(<SiteStudentAuthGate>{children}</SiteStudentAuthGate>);
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); clearStudentAppMemory(); clearStudentAppContext();
});
afterEach(() => {
  cleanup(); clearStudentAppContext(); clearStudentAppMemory(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('회원 세션 기반 학생 인증 게이트', () => {
  it('강사와 옛 학생 인증이 있어도 회원 세션 확인 없이 보호 화면을 열지 않는다', async () => {
    localStorage.setItem('auth_token', fixtureSession());
    localStorage.setItem('student_session_STUDENT_A', fixtureSession('student'));
    localStorage.setItem('personal_student_token', 'ABCD1234EFGH');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ code: 'session_expired' }, 401));
    mount();
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    const login = await screen.findByRole('link', { name: '회원 로그인' });
    expect(login.getAttribute('href')).toBe('/login/?next=%2Fpersonal%2F');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('학생 코드')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/site/student-app/context');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it('서버가 허용한 회원 범위만 Provider에 연결하고 디스크에 저장하지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(allowed));
    function Protected() { const context = useStudentAppContext(); return <p>{context.memberId}:{context.studentId}</p>; }
    mount(<Protected />);
    expect(await screen.findByText('member-a:student-a')).toBeTruthy();
    expect(getStudentAppContext().scope).toMatch(/^app-/);
    expect(Object.values(localStorage).join('')).not.toContain('opaque-a');
    expect(Object.values(sessionStorage).join('')).not.toContain('opaque-a');
  });

  it('이전 탭 메모리에 허용 context가 남아도 최초 서버 응답 전에 노출하지 않는다', async () => {
    setStudentAppContext(normalizeStudentAppContext(allowed));
    let resolve;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    mount();
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    await act(async () => resolve(json({ allowed: false, reason: 'not_provided' })));
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    expect(screen.getByText('학생앱 사용 승인이 필요해요')).toBeTruthy();
  });

  it('탭 복귀 이벤트가 겹쳐도 최초 서버 검증을 취소하거나 반복하지 않는다', async () => {
    let resolve;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    mount();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    await act(async () => resolve(json(allowed)));
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
  });

  it('허용된 화면의 재검증도 복귀 이벤트 한 묶음에 요청 하나를 사용한다', async () => {
    let resolve;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(allowed))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mount();
    await screen.findByText('학생 개인정보');
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
    await act(async () => resolve(json({ allowed: false, reason: 'not_provided' })));
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    expect(screen.getByText('학생앱 사용 승인이 필요해요')).toBeTruthy();
  });

  it.each([
    ['not_linked', '강사 승인을 기다리고 있어요'],
    ['not_provided', '학생앱 사용 승인이 필요해요'],
  ])('%s이면 회원 권한을 확대하지 않고 문의와 마이페이지를 제공한다', async (reason, title) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ allowed: false, reason }));
    mount();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByRole('link', { name: '마이페이지' }).getAttribute('href')).toBe('/account/');
    expect(screen.getByRole('link', { name: '선생님께 문의' }).getAttribute('href')).toContain('pf.kakao.com');
    expect(screen.queryByText('학생 개인정보')).toBeNull();
  });

  it('필수 회원 정보가 미완료이면 마이페이지로 안내한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ code: 'profile_incomplete' }, 409));
    mount();
    expect(await screen.findByText('회원 정보를 먼저 완성해 주세요')).toBeTruthy();
    expect(screen.queryByText('학생 개인정보')).toBeNull();
  });

  it('보호 API에서 권한 회수가 확인되면 즉시 언마운트하고 개인 캐시를 지운다', async () => {
    const unmounted = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(allowed));
    function Protected() { useEffect(() => unmounted, []); return <p>학생 개인정보</p>; }
    mount(<Protected />);
    await screen.findByText('학생 개인정보');
    const scope = getStudentAppContext().scope;
    writeCacheValue(`student:info:${scope}`, { name: '개인정보' }, captureAuthScope(`student:${scope}`));
    studentAppMemoryStorage.setItem(`panda:${scope}`, '개인기록');
    fetchMock.mockResolvedValueOnce(json({ code: 'student_app_access_changed' }, 403));
    await act(async () => { await studentAppJson('/me', { scope }).catch(() => {}); });
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    expect(unmounted).toHaveBeenCalledOnce();
    expect(peekCache(`student:info:${scope}`)).toBeUndefined();
    expect(studentAppMemoryStorage.length).toBe(0);
  });

  it('다른 탭의 회원 변경은 기존 데이터를 먼저 제거하고 새 회원을 확인한다', async () => {
    let resolveNext;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(allowed))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }));
    function Protected() { return <p>개인정보:{useStudentAppContext().memberId}</p>; }
    mount(<Protected />);
    await screen.findByText('개인정보:member-a');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'hanul_member_auth_changed', newValue: 'changed' })));
    expect(screen.queryByText('개인정보:member-a')).toBeNull();
    await act(async () => resolveNext(json({ ...allowed, memberId: 'member-b', revision: 2 })));
    expect(screen.getByText('개인정보:member-b')).toBeTruthy();
  });

  it('회원 변경은 진행 중 재검증을 대체하고 이전 응답을 무시한다', async () => {
    let resolvePrevious;
    let resolveNext;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(allowed))
      .mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }));
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Protected() {
      const context = useStudentAppContext();
      useEffect(() => { mounted(context.memberId); return () => unmounted(context.memberId); }, []);
      return <p>개인정보:{context.memberId}</p>;
    }
    mount(<Protected />);
    await screen.findByText('개인정보:member-a');
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'hanul_member_auth_changed', newValue: 'changed' })));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(false);
    expect(screen.queryByText('개인정보:member-a')).toBeNull();
    await act(async () => resolvePrevious(json(allowed)));
    expect(screen.queryByText('개인정보:member-a')).toBeNull();
    await act(async () => resolveNext(json({ ...allowed, memberId: 'member-b', revision: 2 })));
    expect(screen.getByText('개인정보:member-b')).toBeTruthy();
    expect(mounted.mock.calls).toEqual([['member-a'], ['member-b']]);
    expect(unmounted).toHaveBeenCalledWith('member-a');
  });

  it('열린 탭도 60초마다 권한을 재확인해 회수된 보호 화면을 닫는다', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(allowed))
      .mockResolvedValueOnce(json({ allowed: false, reason: 'not_provided' }));
    await act(async () => mount());
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.queryByText('학생 개인정보')).toBeNull();
    expect(screen.getByText('학생앱 사용 승인이 필요해요')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('네트워크 오류를 로그인 상태로 오인하지 않고 재시도한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(allowed));
    mount();
    expect(await screen.findByText('연결을 확인하지 못했어요')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: '다시 확인' }).click());
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('실패한 검증이 끝나면 다음 탭 복귀에서 다시 서버를 확인한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json(allowed));
    mount();
    expect(await screen.findByText('연결을 확인하지 못했어요')).toBeTruthy();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByText('학생 개인정보')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('해제 뒤 도착한 확인 응답이 context를 다시 허용하지 않는다', async () => {
    let resolve;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = mount();
    view.unmount();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(json(allowed)));
    expect(getStudentAppContext().allowed).toBe(false);
  });
});
