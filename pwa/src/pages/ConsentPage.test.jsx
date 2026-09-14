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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('공개 안내와 인증 동의서', () => {
  it('예전 공개 공유 주소는 공식 동의서로 이동하고 인증 원문을 요청하지 않는다', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { replace });
    render(<MemoryRouter><ConsentPage /></MemoryRouter>);
    expect(replace).toHaveBeenCalledWith('https://tiantianchinese.com/consent/');
    expect(screen.getByRole('link', { name: '수업 동의서 열기' }).getAttribute('href')).toBe('https://tiantianchinese.com/consent/');
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
