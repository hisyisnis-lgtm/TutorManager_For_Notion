import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import PersonalEntryPage from './PersonalEntryPage.jsx';
import StudentAuthGate from '../components/StudentAuthGate.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { notifyAuthChange } from '../api/authState.js';

vi.mock('../api/bookingApi.js', () => ({ fetchStudentByToken: vi.fn() }));
vi.mock('../components/public/PublicHeader.jsx', () => ({ default: () => null }));
vi.mock('../components/public/PublicFooter.jsx', () => ({ default: () => null }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  vi.mocked(fetchStudentByToken).mockReset();
  vi.mocked(fetchStudentByToken).mockRejectedValue(Object.assign(new Error('본인 확인이 필요합니다'), { status: 401 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

function GatedPage() {
  const { studentToken } = useParams();
  return <StudentAuthGate token={studentToken}><p>보호된 학생 정보</p></StudentAuthGate>;
}
function renderEntry() {
  const router = createMemoryRouter([
    { path: '/personal', element: <PersonalEntryPage /> },
    { path: '/personal/:studentToken', element: <GatedPage /> },
  ], { initialEntries: ['/personal'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('학생 코드로 새 기기 인증 진입', () => {
  it('보호 API를 선조회하지 않고 기존 본인 확인 게이트로 이동한다', () => {
    renderEntry();
    fireEvent.change(screen.getByLabelText('학생 코드'), { target: { value: '  abcd1234efgh  ' } });
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(screen.getByText('본인 확인')).toBeTruthy();
    expect(screen.queryByText('보호된 학생 정보')).toBeNull();
    expect(fetchStudentByToken).not.toHaveBeenCalled();
    expect(localStorage.getItem('personal_student_token')).toBeNull();
  });

  it.each(['ABCD', 'ABCD1234EFG!', 'ABCD 234EFGH'])('잘못된 코드 %s는 이동하지 않고 형식을 안내한다', (code) => {
    renderEntry();
    fireEvent.change(screen.getByLabelText('학생 코드'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(screen.getByRole('alert').textContent).toContain('영문과 숫자 12자리');
    expect(screen.queryByText('본인 확인')).toBeNull();
    expect(fetchStudentByToken).not.toHaveBeenCalled();
    expect(localStorage.getItem('personal_student_token')).toBeNull();
  });

  it('인증 전 뒤로 돌아오면 학생 코드를 다시 입력할 수 있다', async () => {
    const router = renderEntry();
    fireEvent.change(screen.getByLabelText('학생 코드'), { target: { value: 'ABCD1234EFGH' } });
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(await screen.findByText('본인 확인')).toBeTruthy();
    await act(async () => router.navigate(-1));
    expect(screen.getByLabelText('학생 코드')).toBeTruthy();
    expect(screen.queryByText('본인 확인')).toBeNull();
  });
});