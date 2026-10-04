import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PandaGameView, { validatePandaNickname } from './PandaGameView.jsx';

vi.mock('./PandaMascot.jsx', () => ({ default: ({ stage, ambient, wardrobe }) => <span data-testid="mascot" data-stage={stage} data-ambient={ambient} data-wardrobe={JSON.stringify(wardrobe)} /> }));
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ media: query, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const base = {
  stageIdx: 5, stage: { label: '다 자란 판다' }, fedTotal: 112,
  available: 7, nickname: '랴오랴오', remaining: 40,
};

describe('잠깐 나타나는 랴오랴오 말풍선', () => {
  const bubble = () => document.querySelector('.panda-game-speech');
  const visible = () => bubble().getAttribute('aria-hidden') === 'false';
  const advance = milliseconds => act(() => vi.advanceTimersByTime(milliseconds));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('StrictMode에서도 첫 인사는 3초 후 사라지고 20초 유휴 후 다시 3초 나타난다', () => {
    render(<StrictMode><PandaGameView {...base} /></StrictMode>);
    expect(visible()).toBe(true);
    expect(bubble().textContent).toBe('냠냠, 오늘도 같이 자라요!');
    advance(2999);
    expect(visible()).toBe(true);
    advance(1);
    expect(visible()).toBe(false);
    advance(19999);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
    advance(3000);
    expect(visible()).toBe(false);
  });

  it('유휴 간격은 20~35초 범위에서 무작위로 정한다', () => {
    Math.random.mockReturnValue(.5);
    render(<PandaGameView {...base} />);
    advance(3000);
    advance(27499);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
  });

  it('먹이 반응이 기존 인사를 대체하며 모션 종료나 같은 id 재렌더로 3초가 바뀌지 않는다', () => {
    const { rerender } = render(<PandaGameView {...base} />);
    advance(2000);
    rerender(<PandaGameView {...base} isFeeding action={{ motion: 'eating', id: 1 }} />);
    expect(bubble().textContent).toBe('냠냠! 맛있게 먹고 있어요.');
    advance(1200);
    rerender(<PandaGameView {...base} action={{ motion: 'idle', id: 1 }} />);
    advance(1000);
    rerender(<PandaGameView {...base} action={{ motion: 'eating', id: 1 }} />);
    advance(799);
    expect(visible()).toBe(true);
    advance(1);
    expect(visible()).toBe(false);
  });

  it('새 쓰다듬기는 노출 시간을 다시 시작하고 오류 안내는 별도로 유지한다', () => {
    const { rerender } = render(<PandaGameView {...base} action={{ motion: 'petting', id: 1 }} error="연결 오류" />);
    advance(2500);
    rerender(<PandaGameView {...base} action={{ motion: 'petting', id: 2 }} error="연결 오류" />);
    expect(bubble().textContent).toBe('쓰다듬어 줘서 고마워요!');
    advance(2999);
    expect(visible()).toBe(true);
    advance(1);
    expect(visible()).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('연결 오류');
  });

  it.each(['speechPaused', 'namingOpen'])('%s 동안 숨기고 지난 행동 없이 복귀 시 새 유휴 주기를 시작한다', prop => {
    const { rerender } = render(<PandaGameView {...base} />);
    rerender(<PandaGameView {...base} {...{ [prop]: true }} action={{ motion: 'petting', id: 1 }} />);
    expect(visible()).toBe(false);
    advance(60000);
    expect(visible()).toBe(false);
    rerender(<PandaGameView {...base} action={{ motion: 'petting', id: 1 }} />);
    advance(19999);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
    expect(bubble().textContent).toBe('냠냠, 오늘도 같이 자라요!');
  });

  it('백그라운드 탭에서는 숨기고 돌아올 때 유휴 시간을 새로 센다', () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    render(<PandaGameView {...base} />);
    hidden = true;
    fireEvent(document, new Event('visibilitychange'));
    expect(visible()).toBe(false);
    advance(60000);
    hidden = false;
    fireEvent(document, new Event('visibilitychange'));
    advance(19999);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
  });

  it('거래 중 유휴 노출을 멈추되 성공한 먹이 반응은 표시한다', () => {
    const { rerender } = render(<PandaGameView {...base} />);
    advance(22000);
    rerender(<PandaGameView {...base} isBusy />);
    advance(60000);
    expect(visible()).toBe(false);
    rerender(<PandaGameView {...base} isFeeding action={{ motion: 'eating', id: 1 }} />);
    expect(visible()).toBe(true);
    expect(bubble().textContent).toBe('냠냠! 맛있게 먹고 있어요.');
    advance(3000);
    expect(visible()).toBe(false);
    rerender(<PandaGameView {...base} action={{ motion: 'idle', id: 1 }} />);
    advance(19999);
    expect(visible()).toBe(false);
    advance(1);
    expect(visible()).toBe(true);
  });
});

describe('랴오랴오 게임 화면의 거래 입력', () => {
  it('확인된 프로필이 없는 로딩과 오류에는 가짜 알·단계·먹이를 보여주지 않는다', () => {
    const onRetry = vi.fn();
    const view = render(<PandaGameView hasProfile={false} loading />);
    expect(screen.getByRole('heading', { name: '기록을 불러오는 중이에요' })).toBeTruthy();
    expect(screen.queryByTestId('mascot')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: '먹이주기 x1' })).toBeNull();
    expect(document.querySelector('.panda-game-food')).toBeNull();
    view.rerender(<PandaGameView hasProfile={false} error="연결을 확인해 주세요." onRetry={onRetry} />);
    expect(screen.getByRole('heading', { name: '기록을 확인하지 못했어요' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('첫 전환 안내는 전액 복원 수량을 알리고 실패 안내와 재시도를 창 안에 유지한다', async () => {
    const onConfirmTransition = vi.fn().mockResolvedValue(false);
    const onRetry = vi.fn().mockResolvedValue({ fedTotal: 0 });
    const transition = { startingFood: 169 };
    const view = render(<PandaGameView {...base} transitionOpen transition={transition} onConfirmTransition={onConfirmTransition} />);
    expect(screen.getByRole('dialog', { name: '랴오랴오와 새 출발!' }).textContent).toContain('돌려받은 먹이 169개');
    expect(screen.getByRole('dialog').textContent).toContain('이미 먹인 것까지 전부 돌려드렸어요.');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '랴오랴오와 새 출발!' }));
    expect(document.querySelector('.panda-game-speech').getAttribute('aria-hidden')).toBe('true');
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '확인하고 시작하기' })));
    expect(screen.getByRole('alert').textContent).toContain('다시 시도');
    view.rerender(<PandaGameView {...base} transitionOpen transition={transition} onConfirmTransition={onConfirmTransition}
      canTransact={false} error="응답을 확인하지 못했어요." onRetry={onRetry} />);
    expect(document.querySelector('.panda-game-toast')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '다시 시도' })));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onConfirmTransition).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it.each([['evolution', false], ['evolution', true], ['level', false], ['level', true]])('%s 오버레이는 fullscreen=%s에서도 먹이 버튼과 같은 게임 루트 안에 둔다', (type, fullscreen) => {
    const celebration = { id: 1, type, fromStage: 4, toStage: 5, toLevel: 6, phase: 'reveal' };
    const view = render(<div className="panda-page" style={{ position: 'fixed' }}><PandaGameView {...base} fullscreen={fullscreen} celebration={celebration} /></div>);
    const gameRoot = view.container.querySelector('.panda-game-view');
    const overlay = document.querySelector(`.panda-${type}-overlay`);
    expect(overlay.parentElement).toBe(gameRoot);
    expect(overlay.closest('.panda-game-stage')).toBeNull();
    expect(gameRoot.querySelector('.panda-game-feed-actions button').closest('.panda-game-view')).toBe(gameRoot);
    view.unmount();
    expect(document.querySelector(`.panda-${type}-overlay`)).toBeNull();
  });

  it('진화는 이전 체형에서 공개·퇴장까지 먹이 입력을 막고 끝나면 같은 자리에서 복귀한다', () => {
    const celebration = { id: 1, type: 'evolution', fromStage: 4, toStage: 5, fromLevel: 5, toLevel: 6, phase: 'charge' };
    const onFeed = vi.fn();
    const view = render(<PandaGameView {...base} onFeed={onFeed} celebration={celebration} displayStage={4} growthPulses={[{ id: 1, count: 1 }]} />);
    expect(document.querySelector('.panda-game-panda [data-testid=mascot]').getAttribute('data-stage')).toBe('4');
    expect(document.querySelector('.panda-evolution-silhouette [data-testid=mascot]').getAttribute('data-stage')).toBe('4');
    expect(document.querySelector('.panda-evolution-overlay .panda-celebration-surface')).toBeNull();
    expect(document.querySelector('.panda-celebration-ground-shadow')).toBeNull();
    expect(document.querySelectorAll('.panda-room-backdrop')).toHaveLength(1);
    expect(document.querySelector('.panda-game-panda [data-testid=mascot]').getAttribute('data-ambient')).toBe('false');
    const controls = document.querySelector('.panda-game-feed-actions');
    expect(controls.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.panda-game-view').classList.contains('panda-game-view--celebrating')).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x5' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '닉네임 수정' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /쓰다듬기/ }).disabled).toBe(true);
    expect(document.querySelector('.panda-game-speech').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(<PandaGameView {...base} onFeed={onFeed} celebration={{ ...celebration, phase: 'reveal' }} displayStage={5} />);
    expect(document.querySelector('.panda-game-panda [data-testid=mascot]').getAttribute('data-stage')).toBe('5');
    expect(document.querySelector('.panda-evolution-color [data-testid=mascot]').getAttribute('data-stage')).toBe('5');
    expect(document.querySelector('.panda-evolution-figure .panda-celebration-surface')).not.toBeNull();
    expect(document.querySelector('.panda-evolution-figure .panda-room-backdrop').innerHTML).toBe(document.querySelector('.panda-game-stage > .panda-room-backdrop').innerHTML);
    expect(document.querySelector('.panda-evolution-figure .panda-celebration-ground-shadow').getAttribute('src')).toBe(document.querySelector('.panda-game-ground-shadow').getAttribute('src'));
    expect(screen.getByRole('status').textContent).toBe('진화했어요! Lv.6 · 다 자란 랴오랴오');
    expect(document.querySelector('.panda-evolution-caption').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(document.querySelector('.panda-evolution-rings').children).toHaveLength(3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(controls.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).not.toHaveBeenCalled();
    view.rerender(<PandaGameView {...base} onFeed={onFeed} celebration={{ ...celebration, phase: 'out' }} displayStage={5} />);
    expect(controls.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).not.toHaveBeenCalled();
    view.rerender(<PandaGameView {...base} onFeed={onFeed} />);
    expect(document.querySelector('.panda-game-feed-actions')).toBe(controls);
    expect(controls.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: '닉네임 수정' }).disabled).toBe(false);
    expect(screen.getByTestId('mascot').getAttribute('data-ambient')).toBe('true');
  });

  it('레벨업은 착용을 유지하고 먹이 영역을 숨겨 입력을 막다가 끝나면 그대로 복귀한다', () => {
    const celebration = { id: 2, type: 'level', toStage: 5, toLevel: 7, phase: 'reveal' };
    const onFeed = vi.fn();
    const equipped = { hat: 'reader-hat', costume: 'reader-costume' };
    const view = render(<PandaGameView {...base} onFeed={onFeed} equipped={equipped} celebration={celebration}
      growthPulses={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id => ({ id, count: 1 }))} />);
    expect(screen.getByRole('status').textContent).toBe('레벨 업! Lv.7');
    expect(document.querySelector('.panda-evolution-overlay')).toBeNull();
    expect(document.querySelector('.panda-growth-glow')).toBeNull();
    expect(document.querySelector('.panda-growth-badge')).toBeNull();
    expect(document.querySelector('.panda-level-number').textContent).toBe('Lv.7');
    expect(document.querySelector('.panda-level-figure .panda-celebration-surface')).not.toBeNull();
    expect(document.querySelector('.panda-level-figure .panda-room-backdrop').innerHTML).toBe(document.querySelector('.panda-game-stage > .panda-room-backdrop').innerHTML);
    const shadow = document.querySelector('.panda-level-figure .panda-celebration-ground-shadow');
    expect(shadow.getAttribute('src')).toBe(document.querySelector('.panda-game-ground-shadow').getAttribute('src'));
    expect(shadow.closest('.panda-celebration-surface')).not.toBeNull();
    expect(shadow.closest('.panda-figure')).toBeNull();
    expect(shadow.getAttribute('width')).toBe('184');
    expect(document.querySelector('.panda-level-figure [data-testid=mascot]').getAttribute('data-wardrobe')).toBe(JSON.stringify(equipped));
    expect(screen.getByRole('button', { name: '랴오랴오 꾸미기' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /방 꾸미기/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '닉네임 수정' }).disabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    const controls = document.querySelector('.panda-game-feed-actions');
    const feedButtons = [...controls.querySelectorAll('button')];
    expect(document.querySelector('.panda-game-view').classList.contains('panda-game-view--celebrating')).toBe(true);
    expect(controls.hasAttribute('inert')).toBe(true);
    expect(feedButtons.every(button => button.disabled)).toBe(true);
    feedButtons.forEach(button => fireEvent.click(button));
    expect(onFeed).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('[data-growth-pulse]')].map(node => node.getAttribute('data-growth-pulse'))).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
    const figure = document.querySelector('.panda-level-figure');
    view.rerender(<PandaGameView {...base} onFeed={onFeed} equipped={equipped} celebration={{ ...celebration, phase: 'out' }} />);
    expect(document.querySelector('.panda-level-overlay').getAttribute('data-phase')).toBe('out');
    expect(document.querySelector('.panda-level-figure')).toBe(figure);
    feedButtons.forEach(button => fireEvent.click(button));
    expect(onFeed).not.toHaveBeenCalled();
    view.rerender(<PandaGameView {...base} onFeed={onFeed} equipped={equipped} />);
    expect(document.querySelector('.panda-level-overlay')).toBeNull();
    expect(document.querySelector('.panda-game-feed-actions')).toBe(controls);
    expect(controls.hasAttribute('inert')).toBe(false);
    expect(feedButtons.every(button => !button.disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: '랴오랴오 꾸미기' }).disabled).toBe(false);
  });

  it.each(['level', 'evolution'])('먹이가 부족해도 %s 중에는 숨긴 버튼 위의 안내용 히트영역을 만들지 않는다', type => {
    const celebration = { id: 2, type, toStage: 5, toLevel: 7, phase: 'reveal' };
    const view = render(<PandaGameView {...base} available={0} celebration={celebration} />);
    expect(document.querySelector('.panda-game-lock-hit')).toBeNull();
    view.rerender(<PandaGameView {...base} available={0} />);
    expect(screen.getByRole('button', { name: '먹이주기 x1 불가 이유 보기' })).toBeTruthy();
  });

  it.each(['level', 'evolution'])('동작 줄이기의 %s는 밝은 무대와 캐릭터를 유지하고 입자를 만들지 않는다', type => {
    window.matchMedia.mockImplementation(query => ({ media: query, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<PandaGameView {...base} celebration={{ id: 2, type, toStage: 5, toLevel: 7, phase: 'reveal' }} />);
    expect(screen.getByRole('status').textContent).toContain('Lv.7');
    expect(document.querySelector(`.panda-${type}-figure`)).not.toBeNull();
    expect(document.querySelector(`.panda-${type}-figure .panda-celebration-surface`)).not.toBeNull();
    expect(document.querySelectorAll('.panda-room-backdrop')).toHaveLength(2);
    expect(document.querySelector('.panda-evolution-flash')).toBeNull();
    expect(document.querySelector('.panda-growth-confetti')).toBeNull();
  });

  it('경험치 변화는 같은 트랙의 scale로 반영하고 레벨업은 새 분율에서 시작한다', () => {
    const view = render(<PandaGameView {...base} progress={25} />);
    const first = screen.getByRole('progressbar').firstElementChild;
    expect(first.style.width).toBe('100%');
    expect(first.style.transform).toBe('scaleX(0.25)');
    view.rerender(<PandaGameView {...base} progress={50} />);
    expect(screen.getByRole('progressbar').firstElementChild).toBe(first);
    expect(first.style.transform).toBe('scaleX(0.5)');
    view.rerender(<PandaGameView {...base} fedTotal={152} progress={0} />);
    expect(screen.getByRole('progressbar').firstElementChild).not.toBe(first);
    expect(screen.getByRole('progressbar').firstElementChild.style.transform).toBe('scaleX(0)');
  });

  it('닉네임은 NFC와 앞뒤 공백을 정리하되 제어문자와 12자를 넘는 입력은 거부한다', () => {
    expect(validatePandaNickname('  가  ')).toEqual({ name: '가', valid: true });
    expect(validatePandaNickname('🐼'.repeat(12)).valid).toBe(true);
    expect(validatePandaNickname('🐼'.repeat(13)).valid).toBe(false);
    expect(validatePandaNickname('  ').valid).toBe(false);
    expect(validatePandaNickname('\n랴오').valid).toBe(false);
    expect(validatePandaNickname('랴\u0085오').valid).toBe(false);
  });

  it('x1과 x5가 정확한 수량을 전달하며 5개 미만이면 x5만 막는다', () => {
    const onFeed = vi.fn();
    const { rerender } = render(<PandaGameView {...base} onFeed={onFeed} />);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x5' }));
    expect(onFeed.mock.calls).toEqual([[1], [5]]);
    rerender(<PandaGameView {...base} available={4} onFeed={onFeed} />);
    expect(screen.getByRole('button', { name: '먹이주기 x5' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x5 불가 이유 보기' }));
    expect(screen.getByRole('status').textContent).toContain('먹이가 1개 부족해요.');
    expect(onFeed.mock.calls).toEqual([[1], [5]]);
  });

  it('비행 중 표시 먹이는 유지하면서 예약된 수량만큼 추가 먹이 버튼을 막는다', () => {
    const onFeed = vi.fn();
    render(<PandaGameView {...base} available={7} feedingAvailable={0} isFeeding onFeed={onFeed} />);
    expect(screen.getByLabelText('보유 먹이 7개')).toBeTruthy();
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x5' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1' }));
    expect(onFeed).not.toHaveBeenCalled();
  });

  it('늦은 저장 안내는 응답이 끝날 때까지 유지하고 끝나면 사라진다', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PandaGameView {...base} notice="성장 기록을 저장하고 있어요…" noticePending />);
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('status').textContent).toContain('저장하고 있어요');
    rerender(<PandaGameView {...base} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('먹이 연출과 먹이 전용 저장 중에도 추가 먹이를 받되 일반 거래 차단을 유지한다', () => {
    const onFeed = vi.fn();
    const view = render(<PandaGameView {...base} isFeeding onFeed={onFeed} />);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '먹이주기 x5' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /쓰다듬기/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '닉네임 수정' }).disabled).toBe(true);
    view.rerender(<PandaGameView {...base} isFeeding isBusy canTransact={false} canFeed onFeed={onFeed} />);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x5' }));
    expect(onFeed).toHaveBeenCalledWith(5);
    view.rerender(<PandaGameView {...base} isBusy canTransact={false} onFeed={onFeed} />);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    view.rerender(<PandaGameView {...base} isFeeding canFeed available={0} onFeed={onFeed} />);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x1 불가 이유 보기' })).toBeTruthy();
  });

  it('시안의 홈에는 직접 먹이 버튼만 있고 정보 영역이 새 창을 만들지 않는다', () => {
    const { rerender } = render(<PandaGameView {...base} nickname="" />);
    expect(screen.queryByRole('button', { name: '수량 골라 주기' })).toBeNull();
    expect(screen.getByRole('heading', { name: '레벨6 : 다 자란 랴오랴오' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /보유 먹이/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<PandaGameView {...base} nickname="하오" />);
    expect(screen.getByRole('heading', { name: '레벨6 : 하오' })).toBeTruthy();
  });

  it('먹이가 없을 때 클릭한 잠금 이유는 원본 문구로 3초 동안 안내한다', () => {
    vi.useFakeTimers();
    const onFeed = vi.fn();
    render(<PandaGameView {...base} available={0} onFeed={onFeed} />);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1 불가 이유 보기' }));
    expect(screen.getByRole('status').textContent).toBe('먹이가 없어요.\n수업과 학습 활동으로 먹이를 모아보세요.');
    expect(onFeed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('알림 닫기는 같은 오류를 숨기되 거래 차단을 유지하고 새 오류는 다시 표시한다', () => {
    const onRetry = vi.fn();
    const view = render(<PandaGameView {...base} canTransact={false} error="연결을 확인해 주세요." onRetry={onRetry} />);
    const close = screen.getByRole('button', { name: '알림 닫기' });
    expect(close.tagName).toBe('BUTTON');
    expect(close.getAttribute('type')).toBe('button');
    fireEvent.click(close);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
    view.rerender(<PandaGameView {...base} available={6} canTransact={false} error="연결을 확인해 주세요." onRetry={onRetry} />);
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<PandaGameView {...base} canTransact={false} error="다시 연결하지 못했어요." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('다시 연결하지 못했어요.');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('수동으로 닫은 일반 안내도 같은 버튼을 다시 누르면 새로 표시한다', () => {
    render(<PandaGameView {...base} available={0} />);
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1 불가 이유 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '먹이주기 x1 불가 이유 보기' }));
    expect(screen.getByRole('status').textContent).toContain('먹이가 없어요.');
  });

  it('이름 저장 중에는 닫지 않고, 실패하면 입력과 오류를 유지한다', async () => {
    let finish;
    const onSaveName = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onDismissName = vi.fn();
    render(<PandaGameView {...base} namingOpen onSaveName={onSaveName} onDismissName={onDismissName} />);
    fireEvent.change(screen.getByRole('textbox', { name: '닉네임' }), { target: { value: '  새 이름  ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    expect(screen.getByRole('button', { name: '취소' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull();
    expect(onSaveName).toHaveBeenCalledWith('새 이름');
    finish(false);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('저장하지 못했어요'));
    expect(screen.getByRole('textbox', { name: '닉네임' }).value).toBe('  새 이름  ');
    expect(onDismissName).not.toHaveBeenCalled();
  });

  it('거래가 차단되어도 재시도는 사용할 수 있다', () => {
    const onRetry = vi.fn();
    render(<PandaGameView {...base} canTransact={false} error="연결을 확인해 주세요." onRetry={onRetry} />);
    expect(screen.getByRole('button', { name: '먹이주기 x1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '먹이주기 x5' }).disabled).toBe(true);
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('처음 이름 짓기는 빈 입력을 저장할 수 없고 나중에는 별도 동작이다', () => {
    const onDismissName = vi.fn();
    render(<PandaGameView {...base} namingOpen namingMode="first" onSaveName={vi.fn()} onDismissName={onDismissName} />);
    expect(screen.getByPlaceholderText('닉네임을 입력해 주세요').value).toBe('');
    expect(screen.getByRole('button', { name: '이름 짓기' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(onDismissName).toHaveBeenCalledOnce();
  });

  it('꾸미기 해금 안내는 제목에 초점을 주고 나중에와 꾸미기 이동을 구분한다', async () => {
    const onDismissWardrobeGuide = vi.fn();
    const onStartWardrobeGuide = vi.fn();
    const wardrobeTriggerRef = { current: null };
    const view = render(<PandaGameView {...base} wardrobeTriggerRef={wardrobeTriggerRef} />);
    const trigger = screen.getByRole('button', { name: '랴오랴오 꾸미기' });
    trigger.focus();
    view.rerender(<PandaGameView {...base} wardrobeTriggerRef={wardrobeTriggerRef} wardrobeGuideOpen
      onDismissWardrobeGuide={onDismissWardrobeGuide} onStartWardrobeGuide={onStartWardrobeGuide} />);
    expect(screen.getByRole('dialog', { name: '이제 꾸밀 수 있어요!' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '이제 꾸밀 수 있어요!' }));
    expect(document.querySelector('.panda-game-speech').getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-testid="mascot"]').getAttribute('data-ambient')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(onDismissWardrobeGuide).toHaveBeenCalledOnce();
    expect(onStartWardrobeGuide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '꾸미러 가기' }));
    expect(onStartWardrobeGuide).toHaveBeenCalledOnce();
    view.rerender(<PandaGameView {...base} wardrobeTriggerRef={wardrobeTriggerRef} />);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('이름 창은 제목에 초점을 주고 닫으면 닉네임 수정 버튼으로 복귀한다', async () => {
    const view = render(<PandaGameView {...base} />);
    const trigger = screen.getByRole('button', { name: '닉네임 수정' });
    trigger.focus();
    view.rerender(<PandaGameView {...base} namingOpen onSaveName={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '닉네임 수정' }));
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '닉네임' }));
    view.rerender(<PandaGameView {...base} />);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('유효하지 않은 이름은 길이 안내를 화면에 보이고 정상 입력이면 기존 배치를 유지한다', () => {
    render(<PandaGameView {...base} namingOpen onSaveName={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: '닉네임' });
    fireEvent.change(input, { target: { value: '1234567890123' } });
    const hint = screen.getByRole('alert');
    expect(hint.textContent).toBe('이름은 줄바꿈 없이 1~12자로 입력해 주세요.');
    expect(hint.classList.contains('sr-only')).toBe(false);
    expect(screen.getByRole('button', { name: '저장하기' }).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '초코' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById(input.getAttribute('aria-describedby')).classList.contains('sr-only')).toBe(true);
  });
});
