import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';
import { notifyAuthChange } from '../api/authState.js';
import { getPage, queryPage } from '../api/notionClient.js';
import { fetchLogsByClassIds } from '../api/lessonLogs.js';
import ClassDetailPage from './ClassDetailPage.jsx';

vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({
  studentNameMap: { student: '가상 학생' }, classTypeMap: {},
}) }));
vi.mock('../api/notionClient.js', () => ({ getPage: vi.fn(), queryPage: vi.fn(), queryAll: vi.fn(), createPage: vi.fn(), updatePage: vi.fn() }));
vi.mock('../api/classes.js', async importOriginal => ({ ...(await importOriginal()), parseClass: value => value }));
vi.mock('../api/lessonLogs.js', async importOriginal => ({ ...(await importOriginal()), fetchLogsByClassIds: vi.fn() }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.clearAllMocks();
  getPage.mockResolvedValue({ id: 'class', studentIds: ['student'], datetime: '2026-10-10T10:00:00+09:00', duration: '60', lessonLogIds: [] });
  queryPage.mockResolvedValue({ results: [] });
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('수업 상세 병렬 조회', () => {
  it('수업의 일지 응답을 기다리지 않고 학생별 준비 자료 조회를 시작한다', async () => {
    let respondLogs;
    fetchLogsByClassIds.mockImplementation(() => new Promise(resolve => { respondLogs = resolve; }));
    render(<MemoryRouter initialEntries={['/classes/class']}><Routes>
      <Route path="/classes/:id" element={<ClassDetailPage />} />
    </Routes></MemoryRouter>);
    await waitFor(() => expect(queryPage).toHaveBeenCalledOnce());
    expect(fetchLogsByClassIds).toHaveBeenCalledWith(['class']);
    expect(screen.queryByText('가상 학생')).toBeNull();
    await act(async () => respondLogs({}));
    expect(await screen.findByText('가상 학생', { selector: 'p' })).toBeTruthy();
  });
});
