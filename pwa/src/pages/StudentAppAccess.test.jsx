import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import StudentDetailPage from './StudentDetailPage.jsx';
import StudentFormPage from './StudentFormPage.jsx';
import { getStudentAppAccess, updateStudentAppAccess } from '../api/studentAppAccess.js';
import { getPage } from '../api/notionClient.js';
import { markStudentSharedIfEmpty, updateStudent } from '../api/students.js';
import { toast } from 'sonner';
import { getToken } from '../api/authUtils.js';

const refreshAll = vi.hoisted(() => vi.fn());

vi.mock('../api/studentAppAccess.js', () => ({ getStudentAppAccess: vi.fn(), updateStudentAppAccess: vi.fn() }));
vi.mock('../api/authUtils.js', () => ({ getToken: vi.fn() }));
vi.mock('../api/notionClient.js', () => ({ getPage: vi.fn(), deletePage: vi.fn() }));
vi.mock('../api/students.js', () => ({
  createStudent: vi.fn(), updateStudent: vi.fn(), markStudentSharedIfEmpty: vi.fn(), parseStudent: page => page,
  STATUS_ACTIVE: '🟢 수강중', STATUS_OPTIONS: ['🟢 수강중', '🟡 일시중단'], statusColor: () => ({ bg: 'white', text: 'black' }),
}));
vi.mock('../api/classes.js', () => ({ fetchUpcomingClasses: async () => [], parseClass: page => page, bookedHoursOf: () => 0 }));
vi.mock('../api/payments.js', () => ({ fetchAllPayments: async () => [], parsePayment: page => page, paymentStatusColor: () => ({}),
  refundSessions: () => 0, formatSessions: value => String(value), remainingSessionsOf: () => 0 }));
vi.mock('../api/consults.js', () => ({ fetchUnlinkedConsults: async () => [], matchConsults: () => ({ byPhone: null, byName: [] }), linkConsultToStudent: vi.fn() }));
vi.mock('../hooks/useCachedResource.js', () => ({ swrLoad: async (_key, fetcher, apply) => apply(await fetcher()), invalidateCache: vi.fn() }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ refresh: refreshAll }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const ID = 'student-one';
const PRIVATE_CODE = 'INTERNAL-BOOKING-CODE';
const accessState = (allowed, revision = 0) => ({ studentId: ID, allowed, revision,
  sync: { state: 'synced', ready: true, homeworkEnabled: allowed, pendingAllowed: null, expectedRevision: null } });
let router, copy;
function renderPage(edit = false) {
  router = createMemoryRouter([
    { path: '/students', element: <p>학생 목록</p> },
    { path: '/students/:id', element: <StudentDetailPage /> },
    { path: '/students/:id/edit', element: <StudentFormPage /> },
  ], { initialEntries: ['/students', `/students/${ID}${edit ? '/edit' : ''}`] });
  render(<RouterProvider router={router} />);
}
beforeEach(() => {
  vi.resetAllMocks();
  getToken.mockReturnValue('teacher-fixture');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Non-mocked network denied'); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  getPage.mockResolvedValue({ id: ID, name: '등록 학생', vip: true, bookingCode: PRIVATE_CODE, phone: '', email: '', status: '🟢 수강중' });
  getStudentAppAccess.mockResolvedValue(accessState(false));
  updateStudentAppAccess.mockResolvedValue(accessState(true, 1));
  markStudentSharedIfEmpty.mockResolvedValue({});
  copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); });

describe('강사의 학생앱 제공과 코드 없는 로그인 안내', () => {
  it('기존 VIP 정보만으로 제공을 추정하지 않고 검증된 토글과 숙제 관리를 함께 반영한다', async () => {
    renderPage();
    await screen.findByText('제공 안 함');
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
    expect(updateStudentAppAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    await screen.findByText('제공 중');
    expect(screen.getByRole('button', { name: '숙제 관리' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).getAttribute('aria-checked')).toBe('true');
    expect(updateStudentAppAccess).toHaveBeenCalledWith(ID, { allowed: true, expectedRevision: 0 }, expect.objectContaining({ signal: expect.any(globalThis.AbortSignal) }));
    expect(updateStudent).not.toHaveBeenCalled();
    expect(refreshAll).toHaveBeenCalledOnce();
  });

  it('현재 제공 중인 권한을 중지할 때도 확인한 revision으로 요청한다', async () => {
    getStudentAppAccess.mockResolvedValue(accessState(true, 4));
    updateStudentAppAccess.mockResolvedValue(accessState(false, 5));
    renderPage();
    await screen.findByText('제공 중');
    const stop = screen.getByRole('switch', { name: '학생앱 제공' });
    fireEvent.click(stop);
    await screen.findByText('제공 안 함');
    expect(updateStudentAppAccess).toHaveBeenCalledWith(ID, { allowed: false, expectedRevision: 4 }, expect.any(Object));
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
  });

  it('조회 실패를 VIP 기반 제공으로 바꾸지 않고 재조회 뒤에만 변경할 수 있다', async () => {
    getStudentAppAccess.mockRejectedValueOnce(new Error('학생앱 권한 조회 실패'));
    renderPage();
    await screen.findByText('학생앱 권한 조회 실패');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).disabled).toBe(true);
    expect(updateStudentAppAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('제공 안 함');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).disabled).toBe(false);
  });

  it('동시 변경 충돌 뒤에는 최신 revision을 확인하기 전까지 변경을 잠근다', async () => {
    updateStudentAppAccess.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    renderPage();
    await screen.findByText('제공 안 함');
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    await screen.findByText('제공 상태를 다시 확인해야 해요. 최신 상태를 확인한 뒤 변경해 주세요.');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).disabled).toBe(true);
    getStudentAppAccess.mockResolvedValue(accessState(true, 2));
    updateStudentAppAccess.mockResolvedValue(accessState(false, 3));
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('제공 중');
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    await screen.findByText('제공 안 함');
    expect(updateStudentAppAccess).toHaveBeenLastCalledWith(ID, { allowed: false, expectedRevision: 2 }, expect.any(Object));
  });

  it('학생 정보 수정에는 별도 VIP 토글이 없고 기존 숙제·제공 설정을 덮어쓰지 않는다', async () => {
    updateStudent.mockResolvedValue({});
    renderPage(true);
    const name = await screen.findByDisplayValue('등록 학생');
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.change(name, { target: { value: '수정 학생' } });
    fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    await screen.findByText('학생 목록');
    expect(updateStudent).toHaveBeenCalledWith(ID, expect.objectContaining({ name: '수정 학생', bookingCode: PRIVATE_CODE }));
    expect(Object.hasOwn(updateStudent.mock.calls[0][1], 'vip')).toBe(false);
    expect(getStudentAppAccess).not.toHaveBeenCalled();
    expect(updateStudentAppAccess).not.toHaveBeenCalled();
  });

  it('공유 문구에는 고정 공식 로그인 링크만 담고 학생·회원 코드를 전달하지 않는다', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: '홈페이지 학생앱 안내 복사' }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    const text = copy.mock.calls[0][0];
    expect(text.split('\n')[0]).toBe('https://tiantianchinese.com/personal/');
    expect(text).toContain('홈페이지 계정으로 로그인');
    expect(text).not.toContain(PRIVATE_CODE);
    expect(text).not.toMatch(/학생코드|회원코드|[?&]token=|#\/personal/);
    expect(updateStudent).not.toHaveBeenCalled();
    expect(markStudentSharedIfEmpty).toHaveBeenCalledWith(ID);
  });


  it('기존 접속 링크는 저장된 코드와 공식 legacy 주소로만 복사하고 권한을 바꾸지 않는다', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: '기존 접속 링크 복사' }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
    expect(copy.mock.calls[0][0].split('\n')[0]).toBe('https://tiantian-chinese.pages.dev/personal/' + PRIVATE_CODE);
    expect(copy.mock.calls[0][0]).toContain('학생코드 - ' + PRIVATE_CODE);
    expect(updateStudentAppAccess).not.toHaveBeenCalled();
    expect(updateStudent).not.toHaveBeenCalled();
    expect(markStudentSharedIfEmpty).toHaveBeenCalledWith(ID);
  });
  it('저장된 기존 코드가 없으면 자동 생성한 미저장 코드를 공유하지 않는다', async () => {
    getPage.mockResolvedValue({ id: ID, name: '등록 학생', vip: true, bookingCode: '', phone: '', email: '', status: '🟢 수강중' });
    renderPage(true);
    await screen.findByRole('button', { name: '홈페이지 학생앱 안내 복사' });
    expect(screen.queryByRole('button', { name: '기존 접속 링크 복사' })).toBeNull();
  });

  it('복사 실패 시 공유일을 기록하지 않는다', async () => {
    copy.mockRejectedValue(new Error('clipboard denied'));
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: '홈페이지 학생앱 안내 복사' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('로그인 안내를 복사하지 못했어요.'));
    expect(markStudentSharedIfEmpty).not.toHaveBeenCalled();
  });

  it('화면을 나간 뒤 도착한 권한 변경 응답을 현재 화면에 반영하지 않는다', async () => {
    let finish;
    updateStudentAppAccess.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    await screen.findByText('제공 안 함');
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    await act(async () => router.navigate('/students'));
    await act(async () => finish(accessState(true, 1)));
    expect(screen.getByText('학생 목록')).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('저장 중에는 토글을 미리 켜지 않고 실패 시 마지막 확정값을 유지한 채 재확인을 요구한다', async () => {
    let fail;
    updateStudentAppAccess.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderPage(); await screen.findByText('제공 안 함');
    const toggle = screen.getByRole('switch', { name: '학생앱 제공' });
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false'); expect(toggle.disabled).toBe(true);
    expect(updateStudentAppAccess).toHaveBeenCalledOnce();
    await act(async () => fail(new Error('동기화 결과를 확인하지 못했어요.')));
    expect(toggle.getAttribute('aria-checked')).toBe('false'); expect(toggle.disabled).toBe(true);
    expect(screen.getByText('최신 상태 확인 필요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
    expect(refreshAll).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('권한 변경 중 강사 인증이 바뀌면 이전 성공 응답을 숙제 관리나 토글에 반영하지 않는다', async () => {
    let finish;
    updateStudentAppAccess.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderPage(); await screen.findByText('제공 안 함');
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    getToken.mockReturnValue('different-teacher-fixture');
    await act(async () => finish(accessState(true, 1)));
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
    expect(refreshAll).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });

  it('동기화 불명확 상태에서는 숙제를 열지 않고 원래 요청의 결과만 명시적으로 확인한다', async () => {
    getStudentAppAccess.mockResolvedValue({ ...accessState(false, 1),
      sync: { state: 'unknown', ready: false, homeworkEnabled: null, pendingAllowed: true, expectedRevision: 0 } });
    updateStudentAppAccess.mockResolvedValue(accessState(true, 2));
    renderPage(); await screen.findByText('숙제 관리 설정 확인 필요');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
    expect(updateStudentAppAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '변경 결과 확인' }));
    await screen.findByText('제공 중');
    expect(updateStudentAppAccess).toHaveBeenCalledWith(ID, { allowed: true, expectedRevision: 0 }, expect.any(Object));
    expect(screen.getByRole('button', { name: '숙제 관리' })).toBeTruthy();
  });

  it('회수 오류의 실제 권한이 false면 토글을 다시 켜지 않고 숙제도 숨긴다', async () => {
    getStudentAppAccess.mockResolvedValue(accessState(true, 3));
    updateStudentAppAccess.mockRejectedValue(Object.assign(new Error('숙제 설정 확인 필요'), { status: 503,
      currentAccess: { ...accessState(false, 4), sync: { state: 'unknown', ready: false, homeworkEnabled: null, pendingAllowed: false, expectedRevision: 3 } } }));
    renderPage(); await screen.findByText('제공 중');
    fireEvent.click(screen.getByRole('switch', { name: '학생앱 제공' }));
    await screen.findByText('숙제 설정 확인 필요');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: '학생앱 제공' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '숙제 관리' })).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('제공 권한이 true인 미확정 동기화 중에도 학생앱을 끄는 요청은 보낼 수 있다', async () => {
    getStudentAppAccess.mockResolvedValue({ ...accessState(true, 3),
      sync: { state: 'unknown', ready: false, homeworkEnabled: null, pendingAllowed: true, expectedRevision: 2 } });
    updateStudentAppAccess.mockResolvedValue(accessState(false, 4));
    renderPage(); await screen.findByText('숙제 관리 설정 확인 필요');
    const toggle = screen.getByRole('switch', { name: '학생앱 제공' });
    expect(toggle.getAttribute('aria-checked')).toBe('true'); expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle); await screen.findByText('제공 안 함');
    expect(updateStudentAppAccess).toHaveBeenCalledWith(ID, { allowed: false, expectedRevision: 3 }, expect.any(Object));
  });
});
