import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeworkManagePage from './HomeworkManagePage.jsx';
import { useData } from '../context/DataContext.jsx';
import { queryAll } from '../api/notionClient.js';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';
import { captureAuthScope } from '../api/authState.js';
import { writeCacheValue } from '../hooks/useCachedResource.js';

vi.mock('../context/DataContext.jsx', () => ({ useData: vi.fn() }));
vi.mock('../api/notionClient.js', () => ({ queryAll: vi.fn() }));
vi.mock('../api/homework.js', () => ({ HOMEWORK_DB: 'fixture-homework-db', parseHomework: page => page }));

const student = { id: 'student-a', name: '검수 학생', status: '🟢 수강중' };
const refreshStudents = vi.fn();
const renderPage = () => render(<MemoryRouter initialEntries={['/homework']}><HomeworkManagePage /></MemoryRouter>);
const cacheCounts = counts => writeCacheValue('homework:counts', counts, captureAuthScope());

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession());
  vi.clearAllMocks();
  queryAll.mockReset();
  useData.mockReturnValue({ students: [student], remainingByStudent: {}, studentsLoading: false, studentsReady: true, loading: false, error: null, refresh: refreshStudents });
});
afterEach(() => { cleanup(); clearAuth(); localStorage.clear(); sessionStorage.clear(); });

describe('숙제 관리 집계의 확인 전·오류·캐시 상태', () => {
  it('학생 조회가 완료되기 전에는 학생이 없다고 표시하지 않는다', async () => {
    useData.mockReturnValue({ students: [], remainingByStudent: {}, studentsLoading: true, studentsReady: false, loading: true, error: null, refresh: refreshStudents });
    queryAll.mockResolvedValueOnce([]);
    renderPage();
    expect(screen.getByRole('status').textContent).toBe('불러오는 중...');
    expect(screen.queryByText('학생이 없습니다')).toBeNull();
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('불러오는 중...');
  });

  it('확인한 빈 학생 목록은 다른 리소스나 숙제 집계가 조회 중이어도 바로 표시한다', async () => {
    useData.mockReturnValue({ students: [], remainingByStudent: {}, studentsLoading: false, studentsReady: true, loading: true, error: null, refresh: refreshStudents });
    let finish;
    queryAll.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    expect(screen.getByText('학생이 없습니다')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => finish([]));
  });

  it('학생 목록을 받지 못한 경우 학생 조회 재시도로 복구한다', async () => {
    useData.mockReturnValue({ students: [], remainingByStudent: {}, studentsLoading: false, studentsReady: false, loading: false, error: '학생 조회 실패', refresh: refreshStudents });
    queryAll.mockResolvedValueOnce([]);
    renderPage();
    expect(screen.getByText('학생 조회 실패')).toBeTruthy();
    expect(screen.queryByText('학생이 없습니다')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(refreshStudents).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(queryAll).toHaveBeenCalledTimes(1);
  });

  it('학생 정보가 먼저 있어도 집계가 끝나기 전에는 진행 중 없음으로 분류하지 않는다', async () => {
    let finish;
    queryAll.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    expect(screen.getByRole('status').textContent).toBe('숙제 현황을 확인하고 있어요');
    expect(screen.queryByText('진행 중 없음')).toBeNull();
    expect(screen.queryByText('진행 중 숙제 없음')).toBeNull();
    await act(async () => finish([{ id: 'hw', studentIds: [student.id], status: '미제출', createdTime: new Date().toISOString() }]));
    expect(screen.getByRole('link', { name: /검수 학생/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '미제출' })).toBeTruthy();
    expect(screen.getByText('1건')).toBeTruthy();
    expect(screen.queryByText('숙제 현황을 확인하고 있어요')).toBeNull();
  });

  it('집계 실패는 오류로 표시하고 재시도에서 확인한 빈 결과만 진행 중 없음으로 보여준다', async () => {
    queryAll.mockRejectedValueOnce(new Error('숙제 집계 조회 실패')).mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByText('숙제 집계 조회 실패')).toBeTruthy();
    expect(screen.queryByText('진행 중 없음')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    const emptySection = await screen.findByRole('button', { name: '진행 중 없음' });
    fireEvent.click(emptySection);
    expect(screen.getByText('진행 중 숙제 없음')).toBeTruthy();
    expect(screen.queryByText('숙제 집계 조회 실패')).toBeNull();
    expect(queryAll).toHaveBeenCalledTimes(2);
    expect(refreshStudents).not.toHaveBeenCalled();
  });

  it('집계 캐시가 있으면 즉시 표시하고 갱신 실패에도 이전 내용과 재시도를 유지한다', async () => {
    cacheCounts({ [student.id]: { pending: 0, submitted: 1, oldestSubmitted: new Date().toISOString() } });
    let fail;
    queryAll.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValueOnce([]);
    renderPage();
    expect(screen.getByRole('link', { name: /검수 학생/ })).toBeTruthy();
    expect(screen.getByText('1건')).toBeTruthy();
    expect(screen.queryByText('숙제 현황을 확인하고 있어요')).toBeNull();
    await act(async () => fail(new Error('최신 집계 확인 실패')));
    expect(screen.getByText('최신 집계 확인 실패')).toBeTruthy();
    expect(screen.getByRole('link', { name: /검수 학생/ })).toBeTruthy();
    expect(screen.queryByText('진행 중 없음')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('button', { name: '진행 중 없음' })).toBeTruthy();
    expect(screen.queryByText('최신 집계 확인 실패')).toBeNull();
  });

  it('확인한 빈 집계 캐시는 백그라운드 조회 중에도 즉시 재사용한다', async () => {
    cacheCounts({});
    let finish;
    queryAll.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    expect(screen.getByRole('button', { name: '진행 중 없음' })).toBeTruthy();
    expect(screen.queryByText('숙제 현황을 확인하고 있어요')).toBeNull();
    await act(async () => finish([]));
  });
});
