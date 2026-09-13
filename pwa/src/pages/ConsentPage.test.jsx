import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsentPage, { AuthenticatedConsentPage } from './ConsentPage.jsx';
import StudentAuthGate from '../components/StudentAuthGate.jsx';
import { fetchConsentTerms } from '../api/consent.js';
import { fixtureSession } from '../api/authFixtures.js';
import { setStudentSession, clearStudentSession } from '../api/studentAuth.js';

vi.mock('../api/consent.js', () => ({ fetchConsentTerms: vi.fn() }));
const code = 'ABCDEF123456';
const terms = { teacherCancellation: '서버의 보강 원문', refundBefore: '서버의 시작 전 원문', refundAfter: ['서버 원문 A', '서버 원문 B'], refundNotes: ['서버 원문 C', '서버 원문 D'], confirmationUrl: 'https://forms.gle/fixture' };
const renderStudent = () => render(<MemoryRouter initialEntries={[`/personal/${code}/consent`]}><Routes>
  <Route path="/personal/:studentToken/consent" element={<StudentAuthGate token={code}><AuthenticatedConsentPage /></StudentAuthGate>} />
</Routes></MemoryRouter>);
beforeEach(() => { localStorage.clear(); fetchConsentTerms.mockReset(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('공개 안내와 인증 동의서', () => {
  it('공개 주소에는 원문·금액·확인 폼 없이 학생앱과 문의를 안내한다', () => {
    render(<MemoryRouter><ConsentPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '학생앱에서 확인하기' }).getAttribute('href')).toBe('/personal');
    expect(screen.getByRole('link', { name: '선생님께 문의' }).getAttribute('href')).toMatch(/\/chat$/);
    expect(document.body.textContent).toContain('09:00~23:00');
    expect(document.body.textContent).not.toMatch(/환불|할인|원문|50,000/);
    expect(fetchConsentTerms).not.toHaveBeenCalled();
    expect(document.querySelector('a[href*="forms.gle"]')).toBeNull();
  });
  it('학생 세션이 없으면 본인 확인을 먼저 보여주고 원문을 요청하지 않는다', () => {
    renderStudent();
    expect(screen.getByText('본인 확인')).toBeTruthy();
    expect(fetchConsentTerms).not.toHaveBeenCalled();
  });
  it('실패 후 재시도하고 서버 원문을 그대로 표시하며 로그아웃 즉시 닫는다', async () => {
    setStudentSession(code, fixtureSession('student', `personal:${code}`));
    fetchConsentTerms.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(terms);
    renderStudent();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '동의 확인 완료하기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('서버의 보강 원문')).toBeTruthy();
    expect(screen.getByText('서버 원문 A')).toBeTruthy();
    expect(screen.getByRole('link', { name: '동의 확인 완료하기' }).getAttribute('href')).toBe(terms.confirmationUrl);
    act(() => clearStudentSession(code));
    expect(screen.getByText('본인 확인')).toBeTruthy();
    expect(screen.queryByText('서버의 보강 원문')).toBeNull();
  });
  it('원문 요청 중 이탈하면 요청을 중단하고 늦은 응답을 표시하지 않는다', async () => {
    setStudentSession(code, fixtureSession('student', `personal:${code}`));
    let resolve;
    fetchConsentTerms.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = renderStudent();
    const signal = fetchConsentTerms.mock.calls[0][1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(terms));
    expect(screen.queryByText('서버의 보강 원문')).toBeNull();
  });
});
