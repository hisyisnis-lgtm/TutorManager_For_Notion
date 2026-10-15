import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PendingStudentMembers from './PendingStudentMembers.jsx';
import StudentsPage from '../../pages/StudentsPage.jsx';
import { approveSiteStudentMember, getSiteStudentMembers } from '../../api/siteStudentMembers.js';
import { toast } from 'sonner';

const session = vi.hoisted(() => ({ token: 'teacher-one' }));
const refresh = vi.hoisted(() => vi.fn());
const studentData = vi.hoisted(() => ({ students: [] }));
vi.mock('../../api/siteStudentMembers.js', () => ({ approveSiteStudentMember: vi.fn(), getSiteStudentMembers: vi.fn() }));
vi.mock('../../api/authUtils.js', () => ({ getToken: () => session.token }));
vi.mock('../../api/authState.js', () => ({
  subscribeAuthChanges: () => () => {}, getAuthRevision: () => 0,
  captureAuthScope: () => ({ credential: session.token, revision: 0 }),
  isAuthScopeCurrent: scope => !!scope?.credential && scope.credential === session.token,
}));
vi.mock('../../context/DataContext.jsx', () => ({ useData: () => ({ students: studentData.students, remainingByStudent: {}, loading: false, error: null, refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const MEMBER = '10000000-0000-4000-8000-000000000001';
const STUDENT = '20000000-0000-4000-8000-000000000002';
const member = { id: MEMBER, name: '김학생', email: 'student@example.invalid', phone: '010-1234-5678', createdAt: '2026-10-15T01:00:00Z', enrollment: null };
const students = [{ id: STUDENT, name: '김학생', phone: '010-1234-5678' }];
const success = { studentId: STUDENT, access: { allowed: true, revision: 1 }, sync: { state: 'synced', ready: true, homeworkEnabled: true } };
beforeEach(() => {
  vi.resetAllMocks(); session.token = 'teacher-one';
  studentData.students = [];
  getSiteStudentMembers.mockResolvedValue({ members: [member], nextCursor: '' });
  approveSiteStudentMember.mockResolvedValue(success);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Non-mocked network denied'); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderPending(props = {}) { return render(<PendingStudentMembers students={students} onApproved={refresh} {...props} />); }
async function openApproval() {
  fireEvent.click(await screen.findByRole('button', { name: '학생앱 사용 허용' }));
  return within(screen.getByRole('dialog'));
}

describe('학생 관리의 홈페이지 가입 학생 승인', () => {
  it('수강생을 기본으로 보여 주고 가입한 학생 승인은 별도 탭에서 확인한다', async () => {
    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: '수강생' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: '학생앱 사용 허용' })).toBeNull();
    expect(screen.getByText('등록된 수강 학생이 없어요')).toBeTruthy();
    const pendingTab = await screen.findByRole('tab', { name: /승인 대기\s*1\s*명/ });
    fireEvent.click(pendingTab);
    expect(screen.getByRole('tabpanel').id).toBe('students-panel-pending');
    expect(screen.getByRole('button', { name: '학생앱 사용 허용' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '학생 추가' })).toBeNull();
    expect(approveSiteStudentMember).not.toHaveBeenCalled();
  });
  it('두 목록의 검색어를 따로 유지하고 키보드로 탭을 이동한다', async () => {
    studentData.students = [{ id: STUDENT, name: '기존학생', status: '🟢 수강중' }];
    render(<MemoryRouter><StudentsPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('학생 이름으로 검색'), { target: { value: '기존' } });
    fireEvent.keyDown(screen.getByRole('tab', { name: '수강생' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').id).toBe('students-panel-pending');
    expect(screen.getByPlaceholderText('이름 또는 가입 연락처로 검색').value).toBe('');
    fireEvent.change(screen.getByPlaceholderText('이름 또는 가입 연락처로 검색'), { target: { value: '김' } });
    fireEvent.keyDown(screen.getByRole('tab', { name: /승인 대기/ }), { key: 'Home' });
    expect(screen.getByPlaceholderText('학생 이름으로 검색').value).toBe('기존');
    expect(screen.getByRole('tabpanel').id).toBe('students-panel-students');
    expect(screen.getByRole('button', { name: '학생 추가' })).toBeTruthy();
    expect(approveSiteStudentMember).not.toHaveBeenCalled();
  });
  it('기본 새 학생 등록은 강사가 사용 허용을 누른 뒤에만 승인하고 두 목록을 갱신한다', async () => {
    renderPending(); const dialog = await openApproval();
    expect(dialog.getByRole('radio', { name: '새 학생으로 등록' }).checked).toBe(true);
    expect(approveSiteStudentMember).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '사용 허용' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(approveSiteStudentMember).toHaveBeenCalledWith(MEMBER, { mode: 'new', idempotencyKey: expect.any(String) }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getSiteStudentMembers).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('김학생 학생의 학생앱 사용을 허용했어요.');
  });
  it('같은 이름과 전화번호라도 기존 학생은 직접 선택하고 동일인 확인을 해야 한다', async () => {
    renderPending(); const dialog = await openApproval();
    fireEvent.click(dialog.getByRole('radio', { name: '기존 학생과 연결' }));
    expect(dialog.getByRole('button', { name: '사용 허용' }).disabled).toBe(true);
    fireEvent.keyDown(dialog.getByRole('combobox', { name: '연결할 기존 학생' }), { key: ' ' });
    fireEvent.click(await screen.findByRole('option', { name: '김학생 · 010-1234-5678' }));
    expect(dialog.getByRole('button', { name: '사용 허용' }).disabled).toBe(true);
    fireEvent.click(dialog.getByRole('checkbox', { name: '회원과 기존 학생이 같은 사람임을 확인했어요' }));
    fireEvent.click(dialog.getByRole('button', { name: '사용 허용' }));
    await waitFor(() => expect(approveSiteStudentMember).toHaveBeenCalledTimes(1));
    expect(approveSiteStudentMember.mock.calls[0][1]).toMatchObject({ mode: 'existing', studentId: STUDENT });
  });
  it('처리 중 중복 클릭을 막고 결과 불명확 시 같은 key와 등록 방법으로 다시 확인한다', async () => {
    let reject;
    approveSiteStudentMember.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    renderPending(); const dialog = await openApproval();
    const button = dialog.getByRole('button', { name: '사용 허용' });
    fireEvent.click(button); fireEvent.click(button);
    expect(approveSiteStudentMember).toHaveBeenCalledTimes(1);
    const original = approveSiteStudentMember.mock.calls[0][1];
    await act(async () => reject(Object.assign(new Error('unknown'), { code: 'enrollment_unknown' })));
    expect(dialog.getByRole('radio', { name: '기존 학생과 연결' }).closest('fieldset').disabled).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: '등록 상태 확인' }));
    await waitFor(() => expect(approveSiteStudentMember).toHaveBeenCalledTimes(2));
    expect(approveSiteStudentMember.mock.calls[1][1]).toEqual(original);
  });
  it('새로 고침 전 서버가 보관한 승인 key로만 등록 상태를 회복한다', async () => {
    const stored = { mode: 'new', idempotencyKey: '30000000-0000-4000-8000-000000000003' };
    getSiteStudentMembers.mockResolvedValue({ members: [{ ...member, enrollment: { ...stored, state: 'unknown', studentId: null } }], nextCursor: '' });
    renderPending();
    fireEvent.click(await screen.findByRole('button', { name: '학생 등록 상태 확인' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('radio', { name: '새 학생으로 등록' }).closest('fieldset').disabled).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: '등록 상태 확인' }));
    await waitFor(() => expect(approveSiteStudentMember).toHaveBeenCalledWith(MEMBER, stored, expect.any(Object)));
  });
  it('기존 학생 조회가 실패한 뒤 새로 고침해도 저장된 대상과 key로 재확인한다', async () => {
    const stored = { mode: 'existing', studentId: STUDENT, idempotencyKey: '30000000-0000-4000-8000-000000000003' };
    getSiteStudentMembers.mockResolvedValue({ members: [{ ...member, enrollment: { ...stored, state: 'pending' } }], nextCursor: '' });
    renderPending(); const dialog = await openApproval();
    expect(dialog.getByRole('radio', { name: '기존 학생과 연결' }).checked).toBe(true);
    expect(dialog.getByRole('radio', { name: '새 학생으로 등록' }).closest('fieldset').disabled).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: '등록 상태 확인' }));
    await waitFor(() => expect(approveSiteStudentMember).toHaveBeenCalledWith(MEMBER, stored, expect.any(Object)));
  });
  it('서버가 등록 작업이 없다고 확인한 확정 거절 뒤에만 등록 방법을 다시 고를 수 있다', async () => {
    approveSiteStudentMember.mockRejectedValueOnce(Object.assign(new Error('기존 학생을 다시 선택해 주세요.'), { code: 'student_already_linked', canChangeSelection: true }));
    renderPending(); const dialog = await openApproval();
    fireEvent.click(dialog.getByRole('button', { name: '사용 허용' }));
    await screen.findByText('기존 학생을 다시 선택해 주세요.');
    expect(dialog.getByRole('radio', { name: '기존 학생과 연결' }).closest('fieldset').disabled).toBe(false);
    fireEvent.click(dialog.getByRole('radio', { name: '기존 학생과 연결' }));
    expect(dialog.getByRole('button', { name: '사용 허용' }).disabled).toBe(true);
    expect(approveSiteStudentMember).toHaveBeenCalledTimes(1);
  });
  it('조회 실패와 빈 목록을 구분하고 재시도로 다시 확인할 수 있다', async () => {
    getSiteStudentMembers.mockRejectedValueOnce(new Error('가입 목록 조회 실패')).mockResolvedValue({ members: [], nextCursor: '' });
    renderPending(); await screen.findByRole('alert');
    expect(screen.queryByText('승인을 기다리는 학생이 없어요.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('승인을 기다리는 학생이 없어요.');
  });
  it('페이지 커서로 더 보기를 처리하고 중복 회원을 추가하지 않는다', async () => {
    getSiteStudentMembers.mockResolvedValueOnce({ members: [member], nextCursor: 'page-two' })
      .mockResolvedValueOnce({ members: [member, { ...member, id: '40000000-0000-4000-8000-000000000004', name: '이학생' }], nextCursor: '' });
    renderPending(); fireEvent.click(await screen.findByRole('button', { name: '더 보기' }));
    await screen.findByText('이학생');
    expect(screen.getAllByText('김학생')).toHaveLength(1);
    expect(getSiteStudentMembers.mock.calls[1][0].cursor).toBe('page-two');
  });
  it('강사 계정이 바뀐 뒤 도착한 가입 회원 응답을 표시하지 않는다', async () => {
    let finish;
    getSiteStudentMembers.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderPending();
    session.token = 'different-teacher';
    await act(async () => finish({ members: [member], nextCursor: '' }));
    expect(screen.queryByText(member.name)).toBeNull();
    expect(screen.queryByRole('button', { name: '학생앱 사용 허용' })).toBeNull();
  });
  it('승인 요청 뒤 로그아웃하면 성공 알림이나 목록 갱신을 수행하지 않는다', async () => {
    let finish;
    approveSiteStudentMember.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderPending(); const dialog = await openApproval();
    fireEvent.click(dialog.getByRole('button', { name: '사용 허용' }));
    session.token = '';
    await act(async () => finish(success));
    expect(refresh).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });
  it('포커스가 돌아오면 가입 목록을 다시 확인한다', async () => {
    renderPending(); await screen.findByText(member.name);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(getSiteStudentMembers).toHaveBeenCalledTimes(2));
  });
});
