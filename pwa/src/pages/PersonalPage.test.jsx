import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import PersonalPage from './PersonalPage.jsx';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { fetchMyHomework } from '../api/homework.js';
import { setStudentSession } from '../api/studentAuth.js';
import { fixtureSession } from '../api/authFixtures.js';
import { notifyAuthChange } from '../api/authState.js';
import { pandaUpdateNoticeKey } from '../utils/pandaUpdateNotice.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { useTabTip } from '../hooks/useTabTip.js';

vi.mock('../api/bookingApi.js', () => ({ fetchStudentByToken: vi.fn() }));
vi.mock('../api/homework.js', () => ({ fetchMyHomework: vi.fn(async () => []), parseHomework: h => h }));
vi.mock('../api/notices.js', () => ({ fetchStudentNotices: vi.fn(async () => []) }));
vi.mock('./personal/HomeTab.jsx', () => ({ default: ({ hwLoading, hwError, hwAlerts, onRetryHomework }) => <>
  <p>학생 홈 콘텐츠</p>
  {hwLoading && <p>숙제 로딩</p>}
  {hwError && <><p>{hwError}</p><button onClick={onRetryHomework}>숙제 재시도</button></>}
  {hwAlerts?.pending?.map(hw => <p key={hw.id}>{hw.title}</p>)}
</> }));
vi.mock('@phosphor-icons/react', () => ({
  HouseIcon: () => null, BookOpenIcon: () => null, BellIcon: () => null, GearSixIcon: () => null,
  ArchiveIcon: () => null, UserIcon: () => null, WarningCircleIcon: () => null,
  CircleNotchIcon: () => null, CaretLeftIcon: () => null, CaretRightIcon: () => null, XIcon: () => null,
}));
vi.mock('./personal/MyClassesTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/ArchiveTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/NoticeTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/HanulTab.jsx', () => ({ default: () => null }));
vi.mock('./personal/MyTab.jsx', () => ({ default: () => null }));
vi.mock('../components/ui/PandaWidget.jsx', () => ({ PANDA_FEED_KEY: 'panda_fed_total' }));
vi.mock('../components/ui/OnboardingCarousel.jsx', () => ({ default: ({ onDone }) => <button onClick={onDone}>기본 온보딩 완료</button>, ONBOARDING_KEY: 'test:onboarding' }));
vi.mock('../components/ui/PandaFigure.jsx', () => ({ default: () => <span aria-hidden="true" /> }));
vi.mock('../components/ui/InstallBanner.jsx', () => ({ default: ({ showIOSGuide }) => showIOSGuide ? <p>iOS 설치 안내</p> : null }));
vi.mock('../components/ui/CoachMarkOverlay.jsx', () => ({ default: ({ visible }) => visible ? <p>탭 코치마크</p> : null }));
vi.mock('../hooks/useInstallPrompt.js', () => ({ useInstallPrompt: vi.fn() }));
vi.mock('../hooks/useTabTip.js', () => ({ useTabTip: vi.fn(), resetAllTabTips: vi.fn() }));

const token = 'ABCD1234EFGH';
const recovered = { name: '테스트 학생', homeworkEnabled: false };
const renderPage = () => render(<MemoryRouter initialEntries={[`/personal/${token}`]}>
  <Routes>
    <Route path="/personal/:studentToken" element={<PersonalPage />} />
    <Route path="/personal/:studentToken/panda" element={<p>랴오랴오 화면</p>} />
  </Routes>
</MemoryRouter>);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
  vi.mocked(useInstallPrompt).mockReturnValue({ isInstalled: true });
  vi.mocked(useTabTip).mockImplementation((_tab, enabled) => ({ visible: enabled, dismiss: vi.fn() }));
  vi.mocked(fetchStudentByToken).mockReset();
  vi.mocked(fetchMyHomework).mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.restoreAllMocks(); });

describe('랴오랴오 업데이트 소개', () => {
  beforeEach(() => {
    localStorage.setItem('test:onboarding', '1');
    vi.mocked(fetchStudentByToken).mockResolvedValue(recovered);
  });

  it('접속 시 표시하고 나중에를 누르면 다음 방문에는 표시하지 않는다', async () => {
    const page = renderPage();
    expect(await screen.findByRole('dialog', { name: /랴오랴오 키우기가/ })).toBeTruthy();
    expect(screen.queryByText('탭 코치마크')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(pandaUpdateNoticeKey(token))).toBe('1');
    expect(screen.getByText('탭 코치마크')).toBeTruthy();
    page.unmount();
    renderPage();
    await screen.findByText('학생 홈 콘텐츠');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('기본 온보딩, 업데이트 소개, 탭 코치마크를 순서대로 표시한다', async () => {
    localStorage.removeItem('test:onboarding');
    renderPage();
    await screen.findByRole('button', { name: '기본 온보딩 완료' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('탭 코치마크')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '기본 온보딩 완료' }));
    expect(screen.getByRole('dialog', { name: /랴오랴오 키우기가/ })).toBeTruthy();
    expect(screen.queryByText('탭 코치마크')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('탭 코치마크')).toBeTruthy();
  });

  it('초기 안내와 숙제 마이그레이션 기록을 읽지 못해도 온보딩을 마치고 소개를 연다', async () => {
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === 'test:onboarding' || key.startsWith('hw_viewed_migrated_v2_')) throw new Error('읽기 제한');
      return getItem.call(this, key);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '기본 온보딩 완료' }));
    expect(screen.getByRole('dialog', { name: /랴오랴오 키우기가/ })).toBeTruthy();
    expect(screen.queryByText('탭 코치마크')).toBeNull();
  });

  it('설치 안내가 열린 채 학생이 바뀌면 이를 닫고 새 학생의 업데이트 소개를 연다', async () => {
    const nextToken = 'IJKL5678MNOP';
    localStorage.setItem(pandaUpdateNoticeKey(token), '1');
    vi.mocked(useInstallPrompt).mockReturnValue({ isInstalled: false, canPrompt: false });
    vi.mocked(useTabTip).mockReturnValue({ visible: false, dismiss: vi.fn() });
    let switchPage;
    function RoutedPage() {
      switchPage = useNavigate();
      return <Routes><Route path="/personal/:studentToken" element={<PersonalPage />} /></Routes>;
    }
    render(<MemoryRouter initialEntries={[`/personal/${token}`]}><RoutedPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '설정' }));
    fireEvent.click(screen.getByRole('button', { name: '홈 화면에 추가' }));
    expect(screen.getByText('iOS 설치 안내')).toBeTruthy();
    await act(async () => {
      setStudentSession(nextToken, fixtureSession('student', `personal:${nextToken}`));
      switchPage(`/personal/${nextToken}`);
    });
    expect(screen.queryByText('iOS 설치 안내')).toBeNull();
    expect(screen.getByRole('dialog', { name: /랴오랴오 키우기가/ })).toBeTruthy();
    expect(localStorage.getItem(pandaUpdateNoticeKey(nextToken))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(localStorage.getItem(pandaUpdateNoticeKey(nextToken))).toBe('1');
    expect(localStorage.getItem(pandaUpdateNoticeKey(token))).toBe('1');
  });

  it('만나러 가기는 안내를 확인하고 현재 학생의 랴오랴오 화면으로 이동한다', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '랴오랴오 만나러 가기' }));
    expect(await screen.findByText('랴오랴오 화면')).toBeTruthy();
    expect(localStorage.getItem(pandaUpdateNoticeKey(token))).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['닫기', 'Escape'])('%s로 닫아도 안내 확인을 기록한다', async action => {
    renderPage();
    const dialog = await screen.findByRole('dialog', { name: /랴오랴오 키우기가/ });
    if (action === '닫기') fireEvent.click(screen.getByRole('button', { name: '업데이트 안내 닫기' }));
    else fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(pandaUpdateNoticeKey(token))).toBe('1');
  });

  it('안내 기록의 읽기·쓰기가 실패해도 학생 홈 이용과 이동을 막지 않는다', async () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key.startsWith('panda_update_notice:')) throw new Error('읽기 제한');
      return getItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.startsWith('panda_update_notice:')) throw new Error('저장 제한');
      return setItem.call(this, key, value);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '랴오랴오 만나러 가기' }));
    expect(await screen.findByText('랴오랴오 화면')).toBeTruthy();
  });
});

describe('학생 조회 오류에서 복구', () => {
  it('숙제 실패 상태를 홈에 전달하고 재시도 성공 시 제거한다', async () => {
    vi.mocked(fetchStudentByToken).mockResolvedValue({ ...recovered, homeworkEnabled: true });
    vi.mocked(fetchMyHomework).mockRejectedValueOnce(new Error('숙제 조회 실패'))
      .mockResolvedValueOnce([{ id: 'hw', title: '복구된 숙제', status: '미제출' }]);
    renderPage();
    expect(await screen.findByText('숙제를 불러오지 못했어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '숙제 재시도' }));
    expect(await screen.findByText('복구된 숙제')).toBeTruthy();
    expect(screen.queryByText('숙제를 불러오지 못했어요')).toBeNull();
  });

  it('캐시가 있는 학생 정보 조회 실패는 기존 홈을 유지한다', async () => {
    sessionStorage.setItem(`swr_student:info:${token}`, JSON.stringify({ savedAt: Date.now() - 60000, value: recovered }));
    vi.mocked(fetchStudentByToken).mockRejectedValue(new Error('최신 정보 조회 실패'));
    renderPage();
    expect(await screen.findByText('학생 홈 콘텐츠')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /테스트 학생님/ })).toBeTruthy();
  });

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
