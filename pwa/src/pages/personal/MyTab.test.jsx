import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MyTab from './MyTab.jsx';
import PandaMascot from '../../components/ui/PandaMascot.jsx';
import { getPandaStorageKey } from '../../components/ui/PandaWidget.jsx';
import { normalizePandaGameProfile, persistPandaGameProfile } from '../../constants/pandaGameState.js';
import { persistPandaServerCache } from '../../constants/pandaServerState.js';
import { fetchPandaProfile, performPandaAction } from '../../api/pandaApi.js';
vi.mock('../../api/pandaApi.js', () => ({ fetchPandaProfile: vi.fn(), performPandaAction: vi.fn() }));
vi.mock('../../components/ui/PandaMascot.jsx', () => ({
  default: vi.fn(() => <span data-testid="my-panda-avatar" aria-hidden="true" />),
}));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); fetchPandaProfile.mockReset(); });

const mascotProps = () => PandaMascot.mock.calls.at(-1)?.[0];
const snapshot = profile => ({
  profile, earnedTotal: 400, availableFood: 400 - profile.fedTotal - profile.spentFood + profile.refundFood,
  transition: { version: 1, initializedAt: '2026-09-30T00:00:00.000Z', startingFood: 400, noticeSeen: false },
});

describe('학생 MY 시간·판다·동의서', () => {
  it('학생별 성장·착장과 ambient 캐릭터를 표시하되 이름·레벨 문구 없이 게임에 진입한다', () => {
    persistPandaGameProfile(getPandaStorageKey('dressed-student'), normalizePandaGameProfile({
      fedTotal: 192, nickname: '초코', spentFood: 20,
      owned: ['reader:hat', 'strawberry:costume', 'gardener:hand'],
      equipped: { hat: 'reader:hat', costume: 'strawberry:costume', hand: 'gardener:hand' },
    }));
    persistPandaGameProfile(getPandaStorageKey('baby-student'), normalizePandaGameProfile({ fedTotal: 20 }));
    const openPanda = vi.fn();
    const student = { paidHours: 0, remainingHours: 0 };
    const { rerender } = render(<MyTab studentToken="dressed-student" student={student} onOpenPanda={openPanda} serverEnabled={false} />);
    const banner = screen.getByRole('button', { name: '랴오랴오 키우기 만나러 가기' });
    expect(banner.getAttribute('data-coach')).toBe('panda');
    expect(banner.querySelector('img').getAttribute('src')).toBe('/panda/ui/liaoliao-my-forest-background.webp');
    expect(mascotProps()).toMatchObject({ stage: 5, size: 116, decorative: true, ambient: true,
      wardrobe: { hat: 'reader', costume: 'strawberry', neck: null, hand: 'gardener' } });
    expect(within(banner).getByTestId('my-panda-avatar')).toBeTruthy();
    expect(screen.queryByText('초코')).toBeNull();
    expect(screen.queryByText(/^Lv\./)).toBeNull();
    expect(screen.queryByText(/기록을 불러오는|기록을 확인하지 못|돌려받은 먹이/)).toBeNull();
    fireEvent.click(banner);
    expect(openPanda).toHaveBeenCalledOnce();

    rerender(<MyTab studentToken="baby-student" student={student} onOpenPanda={openPanda} serverEnabled={false} />);
    expect(mascotProps()).toMatchObject({ stage: 2, decorative: true, ambient: true,
      wardrobe: { hat: null, costume: null, neck: null, hand: null } });
    fireEvent.click(screen.getByRole('button', { name: '랴오랴오 키우기 만나러 가기' }));
    expect(openPanda).toHaveBeenCalledTimes(2);
    expect(fetchPandaProfile).not.toHaveBeenCalled();
    expect(performPandaAction).not.toHaveBeenCalled();
  });

  it('서버 기록 대기 중에는 로컬 성장이나 임의의 알을 표시하지 않고 확인한 캐릭터만 표시한다', async () => {
    persistPandaGameProfile(getPandaStorageKey('remote-student'), normalizePandaGameProfile({ fedTotal: 192 }));
    let finish;
    fetchPandaProfile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const openPanda = vi.fn();
    render(<MyTab studentToken="remote-student" student={{ paidHours: 0, remainingHours: 0 }} serverEnabled onOpenPanda={openPanda} />);
    const banner = screen.getByRole('button', { name: '랴오랴오 키우기 만나러 가기' });
    expect(banner.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('my-panda-avatar')).toBeNull();
    expect(PandaMascot).not.toHaveBeenCalled();
    expect(screen.queryByText(/기록을 불러오는|^Lv\./)).toBeNull();
    expect(fetchPandaProfile).toHaveBeenCalledWith('remote-student');
    fireEvent.click(banner);
    expect(openPanda).toHaveBeenCalledOnce();

    await act(async () => finish(snapshot(normalizePandaGameProfile({ fedTotal: 80, revision: 3 }))));
    expect(screen.getByTestId('my-panda-avatar')).toBeTruthy();
    expect(mascotProps()).toMatchObject({ stage: 4, size: 116, decorative: true, ambient: true });
    expect(banner.getAttribute('aria-busy')).not.toBe('true');
    expect(screen.queryByText(/^Lv\./)).toBeNull();
    expect(performPandaAction).not.toHaveBeenCalled();
  });

  it('서버 조회에 실패해도 마지막 확인 캐릭터·착장과 진입을 유지하고 상태 안내 문구는 표시하지 않는다', async () => {
    persistPandaServerCache(getPandaStorageKey('cached-student'), snapshot(normalizePandaGameProfile({
      fedTotal: 192, spentFood: 12, nickname: '초코', revision: 4,
      owned: ['reader:hat', 'gardener:hand'], equipped: { hat: 'reader:hat', hand: 'gardener:hand' },
    })));
    fetchPandaProfile.mockRejectedValueOnce(new Error('offline'));
    const openPanda = vi.fn();
    render(<MyTab studentToken="cached-student" student={{ paidHours: 0, remainingHours: 0 }} serverEnabled onOpenPanda={openPanda} />);
    const banner = screen.getByRole('button', { name: '랴오랴오 키우기 만나러 가기' });
    expect(screen.getByTestId('my-panda-avatar')).toBeTruthy();
    expect(mascotProps()).toMatchObject({ stage: 5, wardrobe: { hat: 'reader', hand: 'gardener' } });
    await waitFor(() => expect(banner.getAttribute('aria-busy')).not.toBe('true'));
    expect(mascotProps()).toMatchObject({ stage: 5, size: 116, decorative: true, ambient: true,
      wardrobe: { hat: 'reader', costume: null, neck: null, hand: 'gardener' } });
    expect(screen.queryByText(/초코|^Lv\.|마지막 확인|기록을 확인하지 못|돌려받은 먹이/)).toBeNull();
    fireEvent.click(banner);
    expect(openPanda).toHaveBeenCalledOnce();
    expect(performPandaAction).not.toHaveBeenCalled();
  });

  it('학생 전환 후에는 이전 캐릭터와 늦은 응답을 숨기고 새 학생의 서버 기록을 기다린다', async () => {
    persistPandaServerCache(getPandaStorageKey('first-student'), snapshot(normalizePandaGameProfile({ fedTotal: 192, revision: 2 })));
    let finishFirst, finishSecond;
    fetchPandaProfile.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const student = { paidHours: 0, remainingHours: 0 };
    const { rerender } = render(<MyTab studentToken="first-student" student={student} serverEnabled />);
    expect(mascotProps()).toMatchObject({ stage: 5 });
    rerender(<MyTab studentToken="second-student" student={student} serverEnabled />);
    expect(screen.queryByTestId('my-panda-avatar')).toBeNull();
    await act(async () => finishFirst(snapshot(normalizePandaGameProfile({ fedTotal: 192, revision: 3 }))));
    expect(screen.queryByTestId('my-panda-avatar')).toBeNull();
    await act(async () => finishSecond(snapshot(normalizePandaGameProfile({ fedTotal: 0, revision: 0 }))));
    expect(screen.getByTestId('my-panda-avatar')).toBeTruthy();
    expect(mascotProps()).toMatchObject({ stage: 0, decorative: true, ambient: true,
      wardrobe: { hat: null, costume: null, neck: null, hand: null } });
    expect(fetchPandaProfile.mock.calls.map(([token]) => token)).toEqual(['first-student', 'second-student']);
    expect(performPandaAction).not.toHaveBeenCalled();
  });
  it('유효 결제 시간과 예정 포함 남은 시간만 보여주고 판다·동의서 진입은 유지한다', () => {
    const openPanda = vi.fn();
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: 4, remainingHours: 3, remainingSessions: 1, completedMinutes: 60,
      timeLedger: { status: 'needs_review', issues: ['usage_mismatch', 'missing_dates'],
        summary: { creditedHours: 4, availableHours: 1, scheduledHours: 2, remainingHours: 3, differenceHours: 2 },
        rows: [{ id: 'refund', kind: 'payment', hours: 10, effectiveHours: 4, reductionHours: 6, reductionKind: 'refund', date: null }] } }}
      onOpenPanda={openPanda} serverEnabled={false} />);
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
    fireEvent.click(screen.getByRole('button', { name: '랴오랴오 키우기 만나러 가기' }));
    expect(openPanda).toHaveBeenCalledOnce();
  });
  it.each([null, undefined, NaN, Infinity])('결제·잔여가 %s이면 0시간이라고 표시하지 않는다', value => {
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: value, remainingHours: value, completedMinutes: 60 }} serverEnabled={false} />);
    expect(screen.getAllByText('확인 필요')).toHaveLength(2);
    expect(screen.queryByText('0시간')).toBeNull();
  });
  it('확인된 0시간과 음수 잔여는 원래 값을 표시한다', () => {
    render(<MyTab studentToken="QAABCD123456" student={{ paidHours: 0, remainingHours: -0.5 }} serverEnabled={false} />);
    expect(screen.getByText('0시간')).toBeTruthy();
    expect(screen.getByText('-0.5시간')).toBeTruthy();
    expect(screen.queryByText('확인 필요')).toBeNull();
  });
});
