import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MyTab from './MyTab.jsx';
vi.mock('../../components/ui/PandaWidget.jsx', () => ({ getPandaStorageKey: token => `fixture-${token}`,
  getStageInfo: () => ({ stage: { img: '/fixture.png', label: '아기 판다' } }) }));
afterEach(() => { cleanup(); localStorage.clear(); });
describe('학생 MY 시간·판다·동의서', () => {
  it('유효 결제 시간과 예정 포함 남은 시간만 보여주고 판다·동의서 진입은 유지한다', () => {
    const openPanda = vi.fn();
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: 4, remainingHours: 3, remainingSessions: 1, completedMinutes: 60,
      timeLedger: { status: 'needs_review', issues: ['usage_mismatch', 'missing_dates'],
        summary: { creditedHours: 4, availableHours: 1, scheduledHours: 2, remainingHours: 3, differenceHours: 2 },
        rows: [{ id: 'refund', kind: 'payment', hours: 10, effectiveHours: 4, reductionHours: 6, reductionKind: 'refund', date: null }] } }}
      foodSources={[]} onOpenPanda={openPanda} />);
    expect(screen.getAllByRole('term').map(node => node.textContent)).toEqual(['결제한 시간', '남은 수업 시간']);
    expect(within(screen.getByText('결제한 시간').parentElement).getByText('4시간')).toBeTruthy();
    expect(within(screen.getByText('남은 수업 시간').parentElement).getByText('3시간')).toBeTruthy();
    expect(screen.getByText('남은 시간에는 예정된 수업이 포함돼요.')).toBeTruthy();
    expect(screen.queryByText('10시간')).toBeNull();
    expect(screen.queryByText('1시간')).toBeNull();
    expect(screen.queryByRole('region', { name: '수업 시간 내역' })).toBeNull();
    expect(screen.queryByText('기록 확인이 필요해요')).toBeNull();
    expect(screen.queryByText(/예약 가능|충전 기록|날짜 미등록/)).toBeNull();
    expect(screen.queryByText('판다와 함께한 수업')).toBeNull();
    expect(screen.getByRole('link', { name: '수업 동의서' }).getAttribute('href')).toBe('/personal/QAABCD123456/consent');
    fireEvent.click(screen.getByRole('button', { name: /내 팬더/ }));
    expect(openPanda).toHaveBeenCalledOnce();
  });
  it.each([null, undefined, NaN, Infinity])('결제·잔여가 %s이면 0시간이라고 표시하지 않는다', value => {
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: value, remainingHours: value, completedMinutes: 60 }} foodSources={[]} />);
    expect(screen.getAllByText('확인 필요')).toHaveLength(2);
    expect(screen.queryByText('0시간')).toBeNull();
  });
  it('확인된 0시간과 음수 잔여는 원래 값을 표시한다', () => {
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: 0, remainingHours: -0.5 }} foodSources={[]} />);
    expect(screen.getByText('0시간')).toBeTruthy();
    expect(screen.getByText('-0.5시간')).toBeTruthy();
    expect(screen.queryByText('확인 필요')).toBeNull();
  });
});
