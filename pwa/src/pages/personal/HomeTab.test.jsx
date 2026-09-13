import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeTab from './HomeTab.jsx';
import { fetchMyClasses } from '../../api/bookingApi.js';
import { setStudentSession } from '../../api/studentAuth.js';
import { fixtureSession } from '../../api/authFixtures.js';
import { notifyAuthChange } from '../../api/authState.js';

vi.mock('../../api/bookingApi.js', () => ({ fetchMyClasses: vi.fn(async () => []) }));
vi.mock('./ClassCard.jsx', () => ({ default: () => null }));
vi.mock('@phosphor-icons/react', () => ({
  CircleNotchIcon: () => null, ChatTeardropTextIcon: () => null, CaretRightIcon: () => null, MusicNotesIcon: () => null,
}));
const token = 'ABCD1234EFGH';
const view = (props = {}) => render(<MemoryRouter><HomeTab studentToken={token} studentLoaded {...props} /></MemoryRouter>);
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
  fetchMyClasses.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('학생 홈 조회 상태', () => {
  it('숙제 로딩·실패·정상 빈 결과를 서로 다른 안내로 표시한다', async () => {
    const retry = vi.fn();
    const props = { studentToken: token, studentLoaded: true, hwAlerts: { pending: [], submitted: [], feedback: [] } };
    const { rerender } = view({ ...props, hwLoading: true });
    expect(screen.getByText('숙제를 불러오는 중이에요…')).toBeTruthy();
    expect(screen.queryByText('아직 받은 숙제가 없어요')).toBeNull();
    rerender(<MemoryRouter><HomeTab {...props} hwError="숙제를 불러오지 못했어요" onRetryHomework={retry} /></MemoryRouter>);
    expect(screen.getByText('숙제를 불러오지 못했어요')).toBeTruthy();
    expect(screen.queryByText('아직 받은 숙제가 없어요')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '숙제 다시 시도' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<MemoryRouter><HomeTab {...props} /></MemoryRouter>);
    expect(screen.getByText('아직 받은 숙제가 없어요')).toBeTruthy();
    await waitFor(() => expect(fetchMyClasses).toHaveBeenCalledTimes(3));
  });

  it('숙제 캐시가 있으면 실패 안내와 이전 숙제 카드를 함께 유지한다', async () => {
    view({ hwError: '숙제를 불러오지 못했어요', hwLastSuccessAt: Date.now() - 60000,
      hwAlerts: { pending: [{ id: 'hw', title: '이전 숙제', status: '미제출' }] } });
    expect(screen.getByText('이전 숙제')).toBeTruthy();
    expect(screen.getByText('숙제를 불러오지 못했어요')).toBeTruthy();
    expect(screen.getByText(/마지막 확인/)).toBeTruthy();
    await waitFor(() => expect(fetchMyClasses).toHaveBeenCalledTimes(3));
  });

  it('수업 캐시가 있는 조회 실패는 이전 일정을 유지하고 재시도를 제공한다', async () => {
    sessionStorage.setItem(`swr_student:upcoming:${token}`, JSON.stringify({ savedAt: Date.now() - 60000, value: [{
      id: 'class', date: '2099-01-01', startTime: '13:00', durationMin: 60, location: '이전 장소',
    }] }));
    fetchMyClasses.mockRejectedValue(new Error('일시적 실패'));
    view();
    expect(await screen.findByText('수업 정보를 불러오지 못했어요')).toBeTruthy();
    expect(screen.getByText('이전 장소')).toBeTruthy();
    fetchMyClasses.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '수업 다시 시도' }));
    expect(await screen.findByText('선생님과 수업 일정을 잡아보세요')).toBeTruthy();
    expect(screen.queryByText('수업 정보를 불러오지 못했어요')).toBeNull();
  });
});
