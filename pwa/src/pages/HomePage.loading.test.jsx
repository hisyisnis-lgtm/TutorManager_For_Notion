import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';
import { notifyAuthChange } from '../api/authState.js';
import { queryAll, queryPage } from '../api/notionClient.js';
import { attachLogInfo } from '../api/lessonLogs.js';
import HomePage from './HomePage.jsx';

const fixture = vi.hoisted(() => ({ remaining: {} }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({
  students: [{ id: 'student', name: '가상 학생', status: '🟢 수강중' }], studentsReady: true,
  studentNameMap: { student: '가상 학생' }, remainingByStudent: fixture.remaining, refresh: vi.fn(),
}) }));
vi.mock('../api/notionClient.js', () => ({ queryPage: vi.fn(), queryAll: vi.fn(async () => []) }));
vi.mock('../api/classes.js', () => ({ CLASSES_DB: 'classes', parseClass: value => value }));
vi.mock('../api/lessonLogs.js', () => ({ attachLogInfo: vi.fn() }));
vi.mock('./SettingsPage.jsx', () => ({ getInstructorName: () => '' }));
vi.mock('embla-carousel-react', () => ({ default: () => [vi.fn()] }));
vi.mock('../components/home/PendingClassCard.jsx', () => ({ default: () => <div>확인된 마무리 카드</div> }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.clearAllMocks();
  fixture.remaining = {};
  queryAll.mockImplementation(async () => []);
  queryPage.mockImplementation(async (database, _filter, _sorts, _cursor, pageSize) => ({
    results: database === 'classes' && pageSize === 20 ? [{
      id: 'class', studentIds: ['student'], duration: '60', datetime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(), homeworkIds: [],
    }] : [],
  }));
});
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  window.history.replaceState(null, '', window.location.pathname);
});

describe('강사 홈 단계별 로딩', () => {
  it('잔여 시간만 먼저 도착해도 예정 수업을 확인하기 전에 결제 경고를 만들지 않는다', async () => {
    let respondUpcoming;
    fixture.remaining = { student: 0 };
    queryAll.mockImplementation(() => new Promise(resolve => { respondUpcoming = resolve; }));
    attachLogInfo.mockImplementation(async classes => classes);
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    await screen.findByText('가상 학생');
    expect(screen.queryByText('결제 안내 필요')).toBeNull();
    await act(async () => respondUpcoming([]));
    expect(screen.getByText('결제 안내 필요')).toBeTruthy();
  });

  it('일지 조회 중에도 오늘 일정을 보여주고 마무리 카드는 일지 확인 후에 공개한다', async () => {
    let respondLogs;
    attachLogInfo.mockImplementation(() => new Promise(resolve => { respondLogs = resolve; }));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText('가상 학생')).toBeTruthy();
    expect(screen.getByText('1개')).toBeTruthy();
    expect(screen.queryByText('확인된 마무리 카드')).toBeNull();
    expect(screen.queryByText('결제 안내 필요')).toBeNull();
    expect(queryPage.mock.calls[0][0]).toBe('classes');
    await act(async () => respondLogs([{ id: 'class', studentIds: ['student'], endTime: new Date(Date.now() - 3600000).toISOString(), homeworkIds: [] }]));
    expect(screen.getByText('확인된 마무리 카드')).toBeTruthy();
  });

  it('페이지를 떠난 뒤 도착한 일정 응답으로 이전 홈 상태를 갱신하지 않는다', async () => {
    let respondClasses;
    queryPage.mockImplementation(async (database, _filter, _sorts, _cursor, pageSize) => {
      if (database === 'classes' && pageSize === 20) return new Promise(resolve => { respondClasses = resolve; });
      return { results: [] };
    });
    attachLogInfo.mockImplementation(async classes => classes);
    const { unmount } = render(<MemoryRouter><HomePage /></MemoryRouter>);
    window.history.replaceState(null, '', '#/students');
    unmount();
    await act(async () => respondClasses({ results: [{ id: 'late', studentIds: [], duration: '60' }] }));
    expect(sessionStorage.getItem(`swr_home:today:v2:${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })}`)).toBeNull();
  });
});
