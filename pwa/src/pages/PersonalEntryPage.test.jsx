import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import PersonalEntryPage from './PersonalEntryPage.jsx';
import StudentAuthGate from '../components/StudentAuthGate.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';

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

  it('저장된 잘못된 코드에서도 직접 재입력한 뒤 본인 인증을 완료할 수 있다', async () => {
    localStorage.setItem('personal_student_token', 'WRONG0000000');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '없음' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, phoneTail: '5678' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, session: fixtureSession('student', 'personal:ABCD1234EFGH') })));
    const router = renderEntry();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' })));
    expect(screen.getByText('학생 코드를 확인해 주세요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '학생 코드 다시 입력' }));
    expect(screen.getByLabelText('학생 코드')).toBeTruthy();
    expect(localStorage.getItem('personal_student_token')).toBeNull();
    expect(router.state.location.pathname).toBe('/personal');
    expect(screen.getByRole('link', { name: '선생님께 문의' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('학생 코드'), { target: { value: 'ABCD1234EFGH' } });
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' })));
    await act(async () => fireEvent.change(screen.getByLabelText('인증번호 1번째 자리'), { target: { value: '123456' } }));
    expect(screen.getByText('보호된 학생 정보')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchStudentByToken).not.toHaveBeenCalled();
  });
});
