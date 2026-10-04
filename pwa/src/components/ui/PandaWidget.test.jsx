import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import PandaWidget, { getPandaStorageKey } from './PandaWidget.jsx';
import { PANDA_MOTION_DURATION } from '../../constants/pandaMascot.js';
import { PANDA_GAME_THEME } from '../../constants/pandaGameTheme.js';
import { PANDA_FEED_PULSE_LIMIT, PANDA_GROWTH_FEEDBACK_DURATION } from '../../hooks/usePandaGrowthFeedback.js';
import { PANDA_FEED_FLIGHT_MS, PANDA_FEED_STAGGER_MS } from '../../constants/pandaFeedMotion.js';
import { EMPTY_PANDA_WARDROBE, pandaWardrobeForSet, savePandaWardrobe } from '../../constants/pandaWardrobe.js';
import { getPandaGameStorageKey, readPandaGameProfile, normalizePandaGameProfile } from '../../constants/pandaGameState.js';
import { readPandaServerCache } from '../../constants/pandaServerState.js';
import { fetchPandaProfile, performPandaAction } from '../../api/pandaApi.js';

const gameViewProps = vi.hoisted(() => ({ current: null }));
vi.mock('./PandaGameView.jsx', () => ({
  default: props => {
    gameViewProps.current = props;
    return <div>
    <span>LV.{props.levelInfo.level}</span>
    <span data-testid="available">{props.available}</span>
    <span data-testid="speech-paused">{String(props.speechPaused)}</span>
    <span data-testid="celebration">{props.celebration?.type || ''}</span>
    <span data-testid="display-stage">{props.displayStage}</span>
    <span data-testid="growth-pulses">{props.growthPulses?.length || 0}</span>
    <span role="status">{props.error || props.notice}</span>
    <div ref={props.pandaRef}><svg data-testid="mascot" data-stage={props.stageIdx} data-motion={props.action.motion} data-action={props.action.id} data-wardrobe={JSON.stringify(props.equipped)} /></div>
    <button ref={props.feedBtnRef} disabled={!props.canFeed || props.available < 1} onClick={() => props.onFeed(1)}>먹이 1개</button>
    <button ref={props.feedAllBtnRef} disabled={!props.canFeed || props.available < 5} onClick={() => props.onFeed(5)}>먹이 5개</button>
    <button disabled={props.isFeeding} onClick={props.onPet}>쓰다듬기</button>
    <button onClick={props.onOpenWardrobe}>옷장</button>
    <button onClick={props.onOpenName}>이름 수정</button>
    {props.onRetry && <button onClick={props.onRetry}>다시 시도</button>}
    {props.namingOpen && <div role="dialog" aria-label={props.namingMode === 'first' ? '레벨 6 달성' : '이름 수정'}>
      <button onClick={() => props.onSaveName('하오')}>이름 저장</button>
      <button onClick={props.onDismissName}>나중에</button>
    </div>}
    {props.wardrobeGuideOpen && <div role="dialog" aria-label="꾸미기 해금 안내">
      <button onClick={props.onDismissWardrobeGuide}>가이드 나중에</button>
      <button onClick={props.onStartWardrobeGuide}>꾸미러 가기</button>
    </div>}
    {props.transitionOpen && <div role="dialog" aria-label="전환 안내">
      <span>돌려받은 먹이 {props.transition.startingFood}개</span>
      <button onClick={props.onConfirmTransition}>전환 확인</button>
    </div>}
  </div>;
  },
}));
vi.mock('./PandaMascot.jsx', () => ({ default: ({ label }) => <svg role="img" aria-label={label} /> }));
vi.mock('../../api/pandaApi.js', () => ({ fetchPandaProfile: vi.fn(), performPandaAction: vi.fn() }));
const remoteSnapshot = ({ profile, availableFood, transition }) => ({ profile: normalizePandaGameProfile(profile), availableFood,
  earnedTotal: profile.fedTotal + (profile.spentFood || 0) - (profile.refundFood || 0) + availableFood,
  transition: transition || { version: 1, initializedAt: '2026-09-30T00:00:00.000Z', startingFood: 0, noticeSeen: true } });
const KEY = getPandaStorageKey('fixture-panda');
const DIALOG_EXIT_MS = Number.parseFloat(PANDA_GAME_THEME.motionExit);
const foods = count => [{ key: 'sessions', label: '완료 수업', count }];
const mascot = () => screen.getByTestId('mascot');
const advance = milliseconds => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
const click = name => act(async () => { fireEvent.click(screen.getByRole('button', { name, exact: true })); });

beforeEach(() => {
  gameViewProps.current = null;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(query => ({ media: query, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  localStorage.clear();
  vi.mocked(fetchPandaProfile).mockReset();
  vi.mocked(performPandaAction).mockReset();
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  document.head.querySelectorAll('style[id^="kf-panda-"]').forEach(node => node.remove());
});

describe('PandaWidget 상태와 거래 연결', () => {
  it('전환 안내는 도움말 다음에 표시하고 응답 유실 후 재시도 성공까지 유지한다', async () => {
    const initial = remoteSnapshot({ profile: { fedTotal: 0, revision: 1 }, availableFood: 169,
      transition: { version: 1, initializedAt: '2026-09-30T00:00:00.000Z', startingFood: 169, noticeSeen: false } });
    fetchPandaProfile.mockResolvedValue(initial);
    performPandaAction.mockRejectedValueOnce(new Error('응답 유실'))
      .mockResolvedValueOnce({ ...initial, profile: { ...initial.profile, revision: 2 }, transition: { ...initial.transition, noticeSeen: true } });
    let view;
    await act(async () => { view = render(<PandaWidget storageKey={KEY} studentToken="fixture-panda" serverEnabled speechPaused />); });
    expect(gameViewProps.current.hasProfile).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(true);
    view.rerender(<PandaWidget storageKey={KEY} studentToken="fixture-panda" serverEnabled />);
    expect(screen.getByRole('dialog', { name: '전환 안내' }).textContent).toContain('169개');
    await click('이름 수정');
    await click('옷장');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await click('전환 확인');
    expect(screen.getByRole('dialog', { name: '전환 안내' })).toBeTruthy();
    await click('다시 시도');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readPandaServerCache(KEY).transition.noticeSeen).toBe(true);
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(0);
    expect(readPandaServerCache(KEY).availableFood).toBe(169);
    expect(performPandaAction.mock.calls[1][1]).toEqual(performPandaAction.mock.calls[0][1]);
  });

  it('초기 서버 조회를 재시도해 성체 기록을 불러와도 진화나 이름 안내를 재생하지 않는다', async () => {
    fetchPandaProfile.mockRejectedValueOnce(new Error('불러오기 실패'))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { version: 2, fedTotal: 112, revision: 4 }, availableFood: 10 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(122)} studentToken="fixture-panda" serverEnabled />));
    await click('다시 시도');
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(112);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(screen.getByTestId('growth-pulses').textContent).toBe('0');
    expect(mascot().dataset.motion).toBe('idle');
    await advance(4000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('진화 중 신규 입력은 막지만 이미 접수한 먹이는 완료하고 연출 종료 후 다시 먹인다', async () => {
    localStorage.setItem(KEY, '2');
    render(<PandaWidget storageKey={KEY} foodSources={foods(10)} />);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    await click('먹이 1개');
    await click('먹이 5개');
    await advance(749);
    expect(screen.getByTestId('growth-pulses').textContent).toBe('0');
    await advance(1);
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(screen.getByTestId('display-stage').textContent).toBe('0');
    expect(screen.getByTestId('growth-pulses').textContent).toBe('2');
    expect(screen.getByRole('button', { name: '먹이 5개' }).disabled).toBe(true);
    expect(gameViewProps.current.celebration.phase).toBe('charge');
    let accepted;
    await act(async () => { accepted = await gameViewProps.current.onFeed(1); });
    expect(accepted).toBe(false);
    await advance(520);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(8);
    expect(screen.getByTestId('available').textContent).toBe('2');
    expect(screen.getByTestId('display-stage').textContent).toBe('0');
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.charge - 520);
    expect(screen.getByTestId('display-stage').textContent).toBe('1');
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(gameViewProps.current.celebration.phase).toBe('reveal');
    await act(async () => { accepted = await gameViewProps.current.onFeed(1); });
    expect(accepted).toBe(false);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution - PANDA_GROWTH_FEEDBACK_DURATION.charge - PANDA_GROWTH_FEEDBACK_DURATION.evolutionExit);
    expect(gameViewProps.current.celebration.phase).toBe('out');
    await act(async () => { accepted = await gameViewProps.current.onFeed(1); });
    expect(accepted).toBe(false);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolutionExit);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(false);
    await click('먹이 1개');
    await advance(750);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(9);
    expect(screen.getByTestId('available').textContent).toBe('1');
  });

  it('옷장과 외부 팝업의 말풍선 정지 상태를 함께 전달한다', async () => {
    localStorage.setItem(KEY, '112');
    const { rerender } = render(<PandaWidget storageKey={KEY} foodSources={foods(112)} />);
    expect(screen.getByTestId('speech-paused').textContent).toBe('false');
    rerender(<PandaWidget storageKey={KEY} foodSources={foods(112)} speechPaused />);
    expect(screen.getByTestId('speech-paused').textContent).toBe('true');
    rerender(<PandaWidget storageKey={KEY} foodSources={foods(112)} />);
    await click('옷장');
    expect(screen.getByTestId('speech-paused').textContent).toBe('true');
    await click('꾸미기 나가기');
    expect(screen.getByTestId('speech-paused').textContent).toBe('false');
  });

  it('x5는 각 잎이 도착할 때 하나씩 터지고 반응을 처음부터 재생하되, 마지막에 한 번만 저장한다', async () => {
    const profile = { version: 2, fedTotal: 20, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 10 }));
    let finish;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(30)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 5개');
    await advance(PANDA_FEED_FLIGHT_MS - 1);
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    expect(mascot().dataset.motion).toBe('idle');
    let eatingId = Number(mascot().dataset.action);
    for (let index = 0; index < 5; index++) {
      await advance(index ? PANDA_FEED_STAGGER_MS : 1);
      expect(gameViewProps.current.growthPulses).toHaveLength(index + 1);
      expect(gameViewProps.current.growthPulses.every(pulse => pulse.count === 1)).toBe(true);
      expect(mascot().dataset.motion).toBe('eating');
      eatingId += 1;
      expect(Number(mascot().dataset.action)).toBe(eatingId);
      expect(readPandaServerCache(KEY).profile.fedTotal).toBe(20);
      expect(performPandaAction).toHaveBeenCalledTimes(index === 4 ? 1 : 0);
    }
    expect(performPandaAction.mock.calls[0][1]).toMatchObject({ type: 'feed', count: 5, expectedRevision: 1 });
    // All visual arrivals precede this deliberately delayed server receipt.
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.pulse);
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    await act(async () => finish(remoteSnapshot({ profile: { ...profile, fedTotal: 25, revision: 2 }, availableFood: 5 })));
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(25);
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(Number(mascot().dataset.action)).toBe(eatingId);
  });

  it('연속 x5 두 번은 열 번의 도착을 받으며 파티클 예산과 두 번의 FIFO 저장을 유지한다', async () => {
    const profile = { version: 2, fedTotal: 20, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 10 }));
    performPandaAction.mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, fedTotal: 25, revision: 2 }, availableFood: 5 }))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, fedTotal: 30, revision: 3 }, availableFood: 0 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(30)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 5개');
    await click('먹이 5개');
    const seen = new Set();
    const initialActionId = Number(mascot().dataset.action);
    for (let index = 0; index < 5; index++) {
      await advance(index ? PANDA_FEED_STAGGER_MS : PANDA_FEED_FLIGHT_MS);
      gameViewProps.current.growthPulses.forEach(pulse => seen.add(pulse.id));
      expect(gameViewProps.current.growthPulses.length).toBeLessThanOrEqual(PANDA_FEED_PULSE_LIMIT);
      expect(seen.size).toBe((index + 1) * 2);
      expect(Number(mascot().dataset.action)).toBe(initialActionId + (index + 1) * 2);
    }
    expect(performPandaAction.mock.calls.map(([, payload]) => [payload.count, payload.expectedRevision])).toEqual([[5, 1], [5, 2]]);
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(30);
    expect(screen.getByTestId('available').textContent).toBe('0');
  });

  it.each(['좌표 ref 없음', '동작 줄이기'])('%s 경로는 비행 없이 저장하고 먹이 요청마다 반응을 한 번씩 재시작한다', async mode => {
    if (mode === '동작 줄이기') {
      window.matchMedia.mockImplementation(query => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    }
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(26)} />);
    if (mode === '좌표 ref 없음') gameViewProps.current.pandaRef.current = null;
    const initialActionId = Number(mascot().dataset.action);
    await act(async () => { expect(await gameViewProps.current.onFeed(5)).toBe(true); });
    expect(readPandaGameProfile(KEY).fedTotal).toBe(25);
    expect(Number(mascot().dataset.action)).toBe(initialActionId + 1);
    expect(mascot().dataset.motion).toBe('eating');
    await act(async () => { expect(await gameViewProps.current.onFeed(1)).toBe(true); });
    expect(readPandaGameProfile(KEY).fedTotal).toBe(26);
    expect(Number(mascot().dataset.action)).toBe(initialActionId + 2);
    expect(screen.getByTestId('available').textContent).toBe('0');
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    expect(document.querySelector('[data-particle="feed"]')).toBeNull();
  });

  it('저장 실패는 아직 도착하지 않은 잎과 타이머를 취소하고 이미 보인 장식만 자연 종료한다', async () => {
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(30)} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await click('먹이 1개');
    await advance(100);
    await click('먹이 5개');
    await advance(PANDA_FEED_FLIGHT_MS - 100);
    expect(gameViewProps.current.growthPulses).toHaveLength(1);
    expect(gameViewProps.current.celebration).toBeNull();
    expect(mascot().dataset.motion).toBe('idle');
    expect(document.querySelector('[data-particle="feed"]')).toBeNull();
    expect(readPandaGameProfile(KEY).fedTotal).toBe(20);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.pulse);
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    await advance(1000);
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(20);
  });

  it('추가 먹이 실패는 직전 성공 먹이의 씹기를 끊거나 더 연장하지 않는다', async () => {
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(26)} />);
    await click('먹이 1개');
    await click('먹이 5개');
    await advance(PANDA_FEED_FLIGHT_MS);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(21);
    const eatingId = mascot().dataset.action;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const stagger = 4 * PANDA_FEED_STAGGER_MS;
    await advance(stagger);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(21);
    expect(mascot().dataset.motion).toBe('eating');
    // Four later leaves restart the reaction; failure recovery does not restart it again.
    expect(Number(mascot().dataset.action)).toBe(Number(eatingId) + 4);
    await advance(PANDA_MOTION_DURATION.eating - stagger - 1);
    expect(mascot().dataset.motion).toBe('eating');
    await advance(1);
    expect(mascot().dataset.motion).toBe('idle');
  });

  it('x5 첫 도착 뒤 화면을 닫으면 남은 네 도착과 아직 안 보낸 저장을 취소한다', async () => {
    localStorage.setItem(KEY, '20');
    const view = render(<PandaWidget storageKey={KEY} foodSources={foods(25)} />);
    await click('먹이 5개');
    await advance(PANDA_FEED_FLIGHT_MS);
    expect(gameViewProps.current.growthPulses).toHaveLength(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(20);
    expect(document.head.querySelector('style[id^="kf-panda-"]')).toBeNull();
  });

  it('레벨업 중 신규 먹이는 핸들러에서도 막고 이미 예약한 먹이는 손실 없이 저장한다', async () => {
    localStorage.setItem(KEY, '151');
    render(<PandaWidget storageKey={KEY} foodSources={foods(200)} />);
    await click('먹이 1개');
    await click('먹이 5개');
    await advance(750);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(152);
    expect(screen.getByTestId('celebration').textContent).toBe('level');
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이 5개' }).disabled).toBe(true);
    const availableBefore = screen.getByTestId('available').textContent;
    let accepted;
    await act(async () => { accepted = await gameViewProps.current.onFeed(1); });
    expect(accepted).toBe(false);
    expect(screen.getByTestId('available').textContent).toBe(availableBefore);
    await advance(520);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(157);
    expect(screen.getByTestId('celebration').textContent).toBe('level');
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.level - 520);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(false);
    await click('먹이 1개');
    await advance(750);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(158);
    expect(screen.getByTestId('available').textContent).toBe('42');
  });

  it('x5와 x1을 연속 예약해 클릭 순서대로 도착 후 저장하고 씹는 동안에도 추가로 먹인다', async () => {
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(30)} />);
    await click('먹이 5개');
    await click('먹이 1개');
    expect(screen.getByTestId('available').textContent).toBe('4');
    expect(screen.getByRole('button', { name: '먹이 5개' }).disabled).toBe(true);
    await advance(1269);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(20);
    await advance(1);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(26);
    expect(screen.getByTestId('available').textContent).toBe('4');
    expect(mascot().dataset.motion).toBe('eating');
    const eatingId = mascot().dataset.action;
    await click('먹이 1개');
    await advance(750);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(27);
    expect(screen.getByTestId('available').textContent).toBe('3');
    expect(Number(mascot().dataset.action)).toBe(Number(eatingId) + 1);
    await advance(PANDA_MOTION_DURATION.eating - 1);
    expect(mascot().dataset.motion).toBe('eating');
    await advance(1);
    expect(mascot().dataset.motion).toBe('idle');
  });

  it('같은 이벤트 루프의 빠른 클릭도 마지막 먹이까지만 예약한다', async () => {
    render(<PandaWidget storageKey={KEY} foodSources={foods(6)} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '먹이 5개' }));
      fireEvent.click(screen.getByRole('button', { name: '먹이 1개' }));
      fireEvent.click(screen.getByRole('button', { name: '먹이 1개' }));
      fireEvent.click(screen.getByRole('button', { name: '먹이 5개' }));
    });
    expect(screen.getByTestId('available').textContent).toBe('0');
    await advance(1270);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(6);
    expect(screen.getByTestId('available').textContent).toBe('0');
  });

  it('동작 줄이기에서도 예약 수량을 초과하지 않고 모든 클릭을 순차 저장한다', async () => {
    window.matchMedia.mockImplementation(query => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<PandaWidget storageKey={KEY} foodSources={foods(6)} />);
    const initialActionId = Number(mascot().dataset.action);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '먹이 5개' }));
      fireEvent.click(screen.getByRole('button', { name: '먹이 1개' }));
      fireEvent.click(screen.getByRole('button', { name: '먹이 1개' }));
    });
    expect(readPandaGameProfile(KEY).fedTotal).toBe(6);
    expect(Number(mascot().dataset.action)).toBe(initialActionId + 2);
    expect(screen.getByTestId('available').textContent).toBe('0');
    expect(document.querySelector('[data-particle="feed"]')).toBeNull();
    expect(gameViewProps.current.growthPulses).toHaveLength(0);
  });

  it('일시적으로 획득 먹이가 줄어도 기록을 보존하고 학생 전환 시 상태를 분리한다', async () => {
    localStorage.setItem(KEY, '192');
    savePandaWardrobe(KEY, pandaWardrobeForSet('reader'));
    const other = getPandaStorageKey('other');
    localStorage.setItem(other, '20');
    const { rerender } = render(<PandaWidget storageKey={KEY} foodSources={foods(0)} />);
    expect(mascot().dataset.stage).toBe('5');
    expect(JSON.parse(mascot().dataset.wardrobe)).toEqual(pandaWardrobeForSet('reader'));
    expect(readPandaGameProfile(KEY).fedTotal).toBe(192);
    rerender(<PandaWidget storageKey={other} foodSources={foods(30)} />);
    expect(mascot().dataset.stage).toBe('2');
    expect(JSON.parse(mascot().dataset.wardrobe)).toEqual(EMPTY_PANDA_WARDROBE);
  });

  it('성체 이전에는 저장된 파츠도 렌더하지 않는다', () => {
    localStorage.setItem(KEY, '111');
    savePandaWardrobe(KEY, pandaWardrobeForSet('gardener'));
    render(<PandaWidget storageKey={KEY} foodSources={foods(111)} />);
    expect(JSON.parse(mascot().dataset.wardrobe)).toEqual(EMPTY_PANDA_WARDROBE);
  });

  it('처음 6단계에 도달할 때만 이름 팝업을 열고 나중에 이력을 저장한다', async () => {
    localStorage.setItem(KEY, '111');
    const { unmount } = render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await click('먹이 1개');
    // Flush the arrival render before advancing the effect-owned evolution timer.
    await advance(750);
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_MOTION_DURATION.eating);
    expect(mascot().dataset.motion).toBe('idle');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution - PANDA_MOTION_DURATION.eating - 1);
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(1);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(screen.getAllByRole('dialog', { name: '레벨 6 달성' })).toHaveLength(1);
    await click('나중에');
    expect(readPandaGameProfile(KEY).namingPromptSeen).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('진화 전에 예약한 추가 먹이의 느린 저장과 마지막 씹기까지 이름 안내를 기다린다', async () => {
    const profile = { version: 2, fedTotal: 111, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 6 }));
    let finish;
    performPandaAction.mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, fedTotal: 112, revision: 2 }, availableFood: 5 }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(117)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 1개');
    await click('먹이 5개');
    await advance(750);
    // Both batches were accepted before evolution. The second server response
    // is still pending after the reveal, so naming must continue to wait.
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(112);
    expect(performPandaAction.mock.calls.map(([, payload]) => payload.count)).toEqual([1, 5]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => finish(remoteSnapshot({ profile: { ...profile, fedTotal: 117, revision: 3 }, availableFood: 0 })));
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(117);
    expect(mascot().dataset.motion).toBe('eating');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_MOTION_DURATION.eating - 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(1);
    expect(mascot().dataset.motion).toBe('idle');
    expect(screen.getAllByRole('dialog', { name: '레벨 6 달성' })).toHaveLength(1);
  });

  it('이미 성체인 사용자에게 최초 팝업을 강제로 열지 않고 수정 저장한다', async () => {
    localStorage.setItem(KEY, '192');
    render(<PandaWidget storageKey={KEY} foodSources={foods(192)} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await click('이름 수정');
    await click('이름 저장');
    expect(readPandaGameProfile(KEY).nickname).toBe('하오');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('성체 도달 중 연 옷장을 닫은 뒤에만 첫 이름 안내를 연다', async () => {
    localStorage.setItem(KEY, '111');
    render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    await advance(750);
    await click('옷장');
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    expect(screen.queryByRole('dialog', { name: '레벨 6 달성' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '랴오랴오 꾸미기' })).toBeTruthy();
    await click('꾸미기 나가기');
    expect(screen.getByRole('dialog', { name: '레벨 6 달성' })).toBeTruthy();
    await click('나중에');
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('도움말이나 나가기 확인이 열려 있으면 첫 이름 안내를 기다린다', async () => {
    localStorage.setItem(KEY, '111');
    const view = render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    view.rerender(<PandaWidget storageKey={KEY} foodSources={foods(117)} speechPaused />);
    await advance(750);
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution - 1);
    expect(screen.getByTestId('celebration').textContent).toBe('evolution');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(1);
    expect(screen.getByTestId('celebration').textContent).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    expect(screen.getAllByRole('dialog', { name: '레벨 6 달성' })).toHaveLength(1);
  });

  it('이름 저장 응답이 유실되어도 재시도 성공 후 이름 창을 닫는다', async () => {
    const profile = { version: 2, fedTotal: 112, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 5 }));
    performPandaAction.mockRejectedValueOnce(new Error('응답을 확인하지 못했어요.'))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, nickname: '하오', revision: 2 }, availableFood: 5 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(117)} studentToken="fixture-panda" serverEnabled />));
    await click('이름 수정');
    await click('이름 저장');
    expect(screen.getByRole('dialog', { name: '이름 수정' })).toBeTruthy();
    await click('다시 시도');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readPandaServerCache(KEY).profile.nickname).toBe('하오');
    expect(performPandaAction.mock.calls[1][1].requestId).toBe(performPandaAction.mock.calls[0][1].requestId);
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('첫 이름을 저장하면 이름창 퇴장 후에만 꾸미기 안내를 한 번 열고, 나중에 닫은 뒤 다시 예약하지 않는다', async () => {
    localStorage.setItem(KEY, '111');
    const view = render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    expect(screen.getByRole('dialog', { name: '레벨 6 달성' })).toBeTruthy();
    await click('이름 저장');
    expect(readPandaGameProfile(KEY).nickname).toBe('하오');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(DIALOG_EXIT_MS - 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(1);
    expect(screen.getAllByRole('dialog', { name: '꾸미기 해금 안내' })).toHaveLength(1);
    await click('가이드 나중에');
    await click('이름 수정');
    await click('이름 저장');
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await advance(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('첫 이름을 나중에 정해도 꾸미기 안내를 열고, CTA는 안내 퇴장이 끝나면 옷장을 연다', async () => {
    localStorage.setItem(KEY, '111');
    render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    await click('나중에');
    await advance(DIALOG_EXIT_MS);
    expect(screen.getByRole('dialog', { name: '꾸미기 해금 안내' })).toBeTruthy();
    await click('꾸미러 가기');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(DIALOG_EXIT_MS - 1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(1);
    expect(screen.getByRole('dialog', { name: '랴오랴오 꾸미기' })).toBeTruthy();
    await click('꾸미기 나가기');
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('첫 이름 저장에 실패하면 안내를 예약하지 않고 같은 요청 재시도 성공 뒤에만 연다', async () => {
    const profile = { version: 2, fedTotal: 111, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    const adult = { ...profile, fedTotal: 112, namingPromptSeen: true, revision: 2 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 6 }));
    performPandaAction.mockResolvedValueOnce(remoteSnapshot({ profile: adult, availableFood: 5 }))
      .mockRejectedValueOnce(new Error('응답을 확인하지 못했어요.'))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { ...adult, nickname: '하오', revision: 3 }, availableFood: 5 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(117)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    await click('이름 저장');
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.getByRole('dialog', { name: '레벨 6 달성' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '꾸미기 해금 안내' })).toBeNull();
    await click('다시 시도');
    expect(readPandaServerCache(KEY).profile.nickname).toBe('하오');
    expect(performPandaAction.mock.calls[2][1].requestId).toBe(performPandaAction.mock.calls[1][1].requestId);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(DIALOG_EXIT_MS);
    expect(screen.getAllByRole('dialog', { name: '꾸미기 해금 안내' })).toHaveLength(1);
  });

  it('예약된 꾸미기 안내는 추가 먹기의 마지막 씹기와 외부 도움말 종료를 모두 기다린다', async () => {
    localStorage.setItem(KEY, '111');
    const view = render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    await click('나중에');
    await click('먹이 5개');
    await advance(DIALOG_EXIT_MS);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_FEED_FLIGHT_MS + 4 * PANDA_FEED_STAGGER_MS - DIALOG_EXIT_MS);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(117);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<PandaWidget storageKey={KEY} foodSources={foods(117)} speechPaused />);
    await advance(PANDA_MOTION_DURATION.eating);
    expect(mascot().dataset.motion).toBe('idle');
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    expect(screen.getByRole('dialog', { name: '꾸미기 해금 안내' })).toBeTruthy();
  });

  it('안내가 열리기 전에 직접 옷장을 열면 대기 중인 안내를 소비하고 이름창 퇴장 뒤 옷장만 연다', async () => {
    localStorage.setItem(KEY, '111');
    render(<PandaWidget storageKey={KEY} foodSources={foods(117)} />);
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    await click('나중에');
    await click('옷장');
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(DIALOG_EXIT_MS);
    expect(screen.getByRole('dialog', { name: '랴오랴오 꾸미기' })).toBeTruthy();
    await click('꾸미기 나가기');
    await advance(DIALOG_EXIT_MS + 1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('동작 줄이기에서는 이름·안내·옷장 사이에 불필요한 퇴장 대기를 두지 않는다', async () => {
    window.matchMedia.mockImplementation(query => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    localStorage.setItem(KEY, '111');
    render(<PandaWidget storageKey={KEY} foodSources={foods(112)} />);
    await click('먹이 1개');
    await advance(Math.max(PANDA_MOTION_DURATION.eating, PANDA_GROWTH_FEEDBACK_DURATION.reduced));
    expect(screen.getByRole('dialog', { name: '레벨 6 달성' })).toBeTruthy();
    await click('나중에');
    expect(screen.getByRole('dialog', { name: '꾸미기 해금 안내' })).toBeTruthy();
    await click('꾸미러 가기');
    expect(screen.getByRole('dialog', { name: '랴오랴오 꾸미기' })).toBeTruthy();
  });

  it.each(['guide', 'wardrobe'])('%s 전환 대기 중 화면을 닫으면 전환 타이머를 정리한다', async target => {
    localStorage.setItem(KEY, '111');
    const view = render(<PandaWidget storageKey={KEY} foodSources={foods(112)} />);
    await click('먹이 1개');
    await advance(PANDA_FEED_FLIGHT_MS);
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    await click('나중에');
    if (target === 'wardrobe') {
      await advance(DIALOG_EXIT_MS);
      await click('꾸미러 가기');
    }
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(5000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('저장 실패 시 먹이를 차감하거나 경험치를 올리지 않고 버튼을 다시 풀어준다', async () => {
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(21)} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await click('먹이 1개');
    await advance(750);
    expect(mascot().dataset.motion).toBe('idle');
    expect(screen.getByTestId('available').textContent).toBe('1');
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toMatch(/저장하지 못/);
  });

  it('첫 저장이 실패하면 아직 보내지 않은 먹이와 파티클을 모두 취소하고 예약을 돌려준다', async () => {
    localStorage.setItem(KEY, '20');
    render(<PandaWidget storageKey={KEY} foodSources={foods(30)} />);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await click('먹이 1개');
    await click('먹이 5개');
    expect(screen.getByTestId('available').textContent).toBe('4');
    await advance(750);
    expect(screen.getByTestId('available').textContent).toBe('10');
    expect(mascot().dataset.motion).toBe('idle');
    expect(document.head.querySelector('style[id^="kf-panda-feed-"]')).toBeNull();
    const attempts = write.mock.calls.length;
    await advance(2000);
    expect(write).toHaveBeenCalledTimes(attempts);
    expect(readPandaGameProfile(KEY).fedTotal).toBe(20);
  });

  it('느린 서버 응답 중에도 먹이를 예약하지만 서버 거래는 한 번에 한 건씩 보낸다', async () => {
    const profile = { version: 2, fedTotal: 20, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 10 }));
    let finish;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, fedTotal: 26, revision: 3 }, availableFood: 4 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(30)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 1개');
    await advance(750);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '먹이 5개' }).disabled).toBe(false);
    await click('먹이 5개');
    await advance(1270);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('available').textContent).toBe('4');
    await act(async () => finish(remoteSnapshot({ profile: { ...profile, fedTotal: 21, revision: 2 }, availableFood: 9 })));
    expect(performPandaAction.mock.calls.map(([, payload]) => payload.count)).toEqual([1, 5]);
    expect(performPandaAction.mock.calls[1][1].expectedRevision).toBe(2);
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(26);
    expect(screen.getByTestId('available').textContent).toBe('4');
  });

  it('먹이 응답 유실 시 나머지 예약을 취소하며 원래 요청만 같은 ID로 재시도한다', async () => {
    const profile = { version: 2, fedTotal: 111, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 6 }));
    performPandaAction.mockRejectedValueOnce(new Error('응답을 확인하지 못했어요.'))
      .mockResolvedValueOnce(remoteSnapshot({ profile: { ...profile, fedTotal: 112, revision: 2 }, availableFood: 5 }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(117)} studentToken="fixture-panda" serverEnabled />));
    await click('먹이 1개');
    await click('먹이 5개');
    await advance(2000);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(true);
    expect(screen.getByTestId('available').textContent).toBe('6');
    const arrivalIds = gameViewProps.current.growthPulses.map(pulse => pulse.id);
    await click('다시 시도');
    expect(performPandaAction).toHaveBeenCalledTimes(2);
    expect(performPandaAction.mock.calls[1][1].requestId).toBe(performPandaAction.mock.calls[0][1].requestId);
    expect(readPandaServerCache(KEY).profile.fedTotal).toBe(112);
    expect(screen.getByTestId('available').textContent).toBe('5');
    expect(gameViewProps.current.growthPulses.map(pulse => pulse.id)).toEqual(arrivalIds);
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(PANDA_GROWTH_FEEDBACK_DURATION.evolution);
    expect(screen.getByRole('dialog', { name: '레벨 6 달성' })).toBeTruthy();
  });

  it('다른 거래가 저장 중이면 먹이 큐를 열지 않는다', async () => {
    const profile = { version: 2, fedTotal: 112, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 5 }));
    let finish;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => render(<PandaWidget storageKey={KEY} foodSources={foods(117)} studentToken="fixture-panda" serverEnabled />));
    await click('이름 수정');
    await click('이름 저장');
    expect(screen.getByRole('button', { name: '먹이 1개' }).disabled).toBe(true);
    await click('먹이 1개');
    await advance(2000);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    await act(async () => finish(remoteSnapshot({ profile: { ...profile, nickname: '하오', revision: 2 }, availableFood: 5 })));
  });

  it('먹는 중 쓰다듬기는 소비 동작을 끊지 않는다', async () => {
    render(<PandaWidget storageKey={KEY} foodSources={foods(1)} />);
    await click('먹이 1개');
    await advance(750);
    const actionId = mascot().dataset.action;
    await click('쓰다듬기');
    expect(mascot().dataset.motion).toBe('eating');
    expect(mascot().dataset.action).toBe(actionId);
    await advance(PANDA_MOTION_DURATION.eating);
    await click('쓰다듬기');
    expect(mascot().dataset.motion).toBe('petting');
  });

  it('도착 전에 닫으면 소비와 남은 파티클 타이머를 취소한다', async () => {
    const { unmount } = render(<PandaWidget storageKey={KEY} foodSources={foods(6)} />);
    await click('먹이 1개');
    await click('먹이 5개');
    unmount();
    await advance(5000);
    expect(localStorage.getItem(getPandaGameStorageKey(KEY))).toBeNull();
    expect(document.head.querySelector('style[id^="kf-panda-"]')).toBeNull();
  });

  it('서버로 보낸 요청 뒤에 닫아도 아직 안 보낸 예약은 전송하지 않는다', async () => {
    const profile = { version: 2, fedTotal: 20, spentFood: 0, refundFood: 0, owned: [], equipped: {}, revision: 1 };
    fetchPandaProfile.mockResolvedValue(remoteSnapshot({ profile, availableFood: 6 }));
    let finish;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let view;
    await act(async () => { view = render(<PandaWidget storageKey={KEY} foodSources={foods(26)} studentToken="fixture-panda" serverEnabled />); });
    await click('먹이 1개');
    await advance(750);
    await click('먹이 5개');
    view.unmount();
    await act(async () => finish(remoteSnapshot({ profile: { ...profile, fedTotal: 21, revision: 2 }, availableFood: 5 })));
    await advance(5000);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(document.head.querySelector('style[id^="kf-panda-"]')).toBeNull();
  });
});
