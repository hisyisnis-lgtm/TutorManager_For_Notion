import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConsultManagePage from './ConsultManagePage.jsx';
import { queryAll } from '../api/notionClient.js';
import { setAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';

vi.mock('../api/notionClient.js', () => ({ queryAll: vi.fn(), updatePage: vi.fn() }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ studentNameMap: {} }) }));
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('상담 조회 실패와 빈 결과 구분', () => {
  it('첫 조회 실패·재시도 중에는 신청 없음으로 표시하지 않고 재시도 성공 후에만 빈 상태를 표시한다', async () => {
    let resolveRetry;
    queryAll.mockRejectedValueOnce(new Error('상담 조회 실패'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    render(<MemoryRouter><ConsultManagePage /></MemoryRouter>);
    await screen.findByText('상담 조회 실패');
    expect(screen.queryByText('아직 무료상담 신청이 없습니다')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(screen.queryByText('아직 무료상담 신청이 없습니다')).toBeNull();
    await act(async () => resolveRetry([]));
    expect(screen.getByText('아직 무료상담 신청이 없습니다')).toBeTruthy();
    expect(screen.queryByText('상담 조회 실패')).toBeNull();
    expect(queryAll).toHaveBeenCalledTimes(2);
  });
});
