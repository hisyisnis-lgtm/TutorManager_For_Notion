import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PersonalPage from './PersonalPage.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { setStudentSession } from '../api/studentAuth.js';
import { fixtureSession } from '../api/authFixtures.js';
import { notifyAuthChange } from '../api/authState.js';

vi.mock('../api/bookingApi.js', () => ({ fetchStudentByToken: vi.fn() }));
vi.mock('../api/homework.js', () => ({ fetchMyHomework: vi.fn(async () => []), parseHomework: h => h }));
vi.mock('../api/notices.js', () => ({ fetchStudentNotices: vi.fn(async () => []) }));
vi.mock('./personal/HomeTab.jsx', () => ({ default: () => <p>학생 홈 콘텐츠</p> }));
vi.mock('./personal/MyClassesTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/ArchiveTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/NoticeTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/HanulTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/MyTab.jsx', () => ({ default: () => null }));
vi.mock('../components/ui/PandaWidget.jsx', () => ({ PANDA_FEED_KEY: 'panda_fed_total' }));
vi.mock('../components/ui/OnboardingCarousel.jsx', () => ({ default: () => null, ONBOARDING_KEY: 'test:onboarding' }));
vi.mock('../components/ui/InstallBanner.jsx', () => ({ default: () => null }));
vi.mock('../components/ui/CoachMarkOverlay.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useInstallPrompt.js', () => ({ useInstallPrompt: () => ({ isInstalled: true }) }));
vi.mock('../hooks/useTabTip.js', () => ({ useTabTip: () => ({ visible: false }), resetAllTabTips: vi.fn() }));

const token = 'ABCD1234EFGH';
const recovered = { name: '테스트 학생', homeworkEnabled: false };
const renderPage = () => render(<MemoryRouter initialEntries={[`/personal/${token}`]}>
  <Routes><Route path="/personal/:studentToken" element={<PersonalPage />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
  vi.mocked(fetchStudentByToken).mockReset();
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.restoreAllMocks(); });

describe('학생 조회 오류에서 복구', () => {
  it('재시도가 성공하면 오류가 사라지고 학생 홈을 표시한다', async () => {
    let resolveRetry;
    vi.mocked(fetchStudentByToken).mockRejectedValueOnce(new Error('네트워크 연결 실패'))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRetry = resolve; }));
    renderPage();
    expect(await screen.findByText('네트워크 연결 실패')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(screen.getByRole('button', { name: /다시 시도/ }).disabled).toBe(true);
    await act(async () => resolveRetry(recovered));
    expect(screen.queryByText('네트워크 연결 실패')).toBeNull();
    expect(screen.getByText('학생 홈 콘텐츠')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /테스트 학생님/ })).toBeTruthy();
    expect(fetchStudentByToken).toHaveBeenCalledTimes(2);
  });

  it('실제 당겨서 새로고침이 성공해도 같은 오류 화면을 유지하지 않는다', async () => {
    vi.mocked(fetchStudentByToken).mockRejectedValueOnce(new Error('일시적 조회 실패')).mockResolvedValueOnce(recovered);
    renderPage();
    expect(await screen.findByText('일시적 조회 실패')).toBeTruthy();
    fireEvent.touchStart(window, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(window, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(window);
    expect(await screen.findByText('학생 홈 콘텐츠')).toBeTruthy();
    expect(screen.queryByText('일시적 조회 실패')).toBeNull();
    expect(fetchStudentByToken).toHaveBeenCalledTimes(2);
  });

  it('재시도도 실패하면 오류를 유지하고 다음 재시도를 허용한다', async () => {
    vi.mocked(fetchStudentByToken).mockRejectedValueOnce(new Error('첫 실패')).mockRejectedValueOnce(new Error('두 번째 실패'));
    renderPage();
    await screen.findByText('첫 실패');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('두 번째 실패')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다시 시도' }).disabled).toBe(false);
    expect(screen.queryByText('학생 홈 콘텐츠')).toBeNull();
  });
});