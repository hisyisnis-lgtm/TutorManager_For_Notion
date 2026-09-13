import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setAuth, clearAuth } from '../../api/authUtils.js';
import { fixtureSession } from '../../api/authFixtures.js';
import { notifyAuthChange } from '../../api/authState.js';
import { fetchNotificationFollowups, resolveNotificationFollowup } from '../../api/notificationFollowups.js';
import NotificationFollowups from './NotificationFollowups.jsx';

vi.mock('../../api/notificationFollowups.js', () => ({ fetchNotificationFollowups: vi.fn(), resolveNotificationFollowup: vi.fn() }));
// State transitions are tested here; the real Radix selector is covered by browser QA.
vi.mock('../shadcn/select', () => ({
  Select: ({ children, value, onValueChange, disabled }) => <select aria-label={children[0].props['aria-label']} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    <option value="">선택</option>{children[1].props.children.map(child => <option key={child.props.value} value={child.props.value}>{child.props.children}</option>)}
  </select>, SelectContent: () => null, SelectItem: () => null, SelectTrigger: () => null, SelectValue: () => null,
}));
const item = { id: 'fixture-id', kind: 'homework-assign', state: 'unknown', createdAt: 1788998400, resolvedAt: null, resolutionKind: null };
const renderComponent = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><NotificationFollowups /></MemoryRouter>);
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.resetAllMocks(); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('발송 후속 확인', () => {
  it('조회 실패를 빈 기록과 구분하고 명시적인 재시도로 복구한다', async () => {
    fetchNotificationFollowups.mockRejectedValueOnce(new Error('기록 조회 실패')).mockResolvedValue({ items: [item], nextCursor: null });
    renderComponent();
    expect((await screen.findByRole('alert')).textContent).toContain('기록 조회 실패');
    expect(screen.queryByText('확인할 발송 기록이 없어요.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '발송 기록 다시 시도' }));
    expect(await screen.findByText('숙제 안내')).not.toBeNull();
  });
  it('처리 저장 실패는 항목을 보존하고 확정 성공만 제거한다', async () => {
    fetchNotificationFollowups.mockResolvedValue({ items: [item] });
    resolveNotificationFollowup.mockRejectedValueOnce(new Error('처리 저장 실패')).mockResolvedValue({ item: { ...item, resolvedAt: 1788998500, resolutionKind: 'contacted' } });
    renderComponent(); await screen.findByText('숙제 안내');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'contacted' } });
    fireEvent.click(screen.getByRole('button', { name: '처리 완료로 기록' }));
    await screen.findByText('처리 저장 실패');
    expect(screen.getByText('숙제 안내')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '처리 완료로 기록' }));
    await screen.findByText('확인할 발송 기록이 없어요.');
    expect(resolveNotificationFollowup).toHaveBeenCalledTimes(2);
    expect(resolveNotificationFollowup).toHaveBeenLastCalledWith('fixture-id', 'contacted');
  });
  it('처리 완료를 발송 성공과 구분하며 늦은 릴레이는 확인 대상으로 보인다', async () => {
    fetchNotificationFollowups.mockResolvedValue({ items: [{ ...item, resolvedAt: 1788998500, resolutionKind: 'provider_checked' },
      { ...item, id: 'relay', kind: 'consult-relay', state: 'queued', needsAttention: true }] });
    renderComponent();
    expect(await screen.findByText(/운영자 처리 완료 · 발송 내역 확인/)).not.toBeNull();
    expect(screen.getAllByText('확인 필요')).toHaveLength(2);
    expect(screen.getByText(/릴레이 접수 후 15분/)).not.toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
  it('로그아웃한 뒤 오는 결과는 표시하지 않는다', async () => {
    let respond;
    fetchNotificationFollowups.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    renderComponent(); act(() => clearAuth());
    await act(async () => respond({ items: [item] }));
    expect(screen.queryByText('숙제 안내')).toBeNull();
  });
  it('이전 필터의 늦은 조회 결과가 현재 목록을 덮지 않는다', async () => {
    let oldReply;
    fetchNotificationFollowups.mockImplementationOnce(() => new Promise(resolve => { oldReply = resolve; })).mockResolvedValue({ items: [] });
    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: '처리 완료', exact: true }));
    await screen.findByText('해당 발송 기록이 없어요.');
    await act(async () => oldReply({ items: [item] }));
    expect(screen.queryByText('숙제 안내')).toBeNull();
    await waitFor(() => expect(fetchNotificationFollowups).toHaveBeenCalledTimes(2));
  });
});
