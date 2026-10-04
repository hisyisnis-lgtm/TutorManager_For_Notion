import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PandaWardrobe from './PandaWardrobe.jsx';
import { PANDA_PART_RARITIES } from '../../constants/pandaWardrobe.js';
vi.mock('./PandaFigure.jsx', () => ({ default: ({ wardrobe }) => <svg data-testid="preview" data-wardrobe={JSON.stringify(wardrobe)} /> }));
const profile = (overrides = {}) => ({ fedTotal: 192, owned: [], equipped: {}, purchasePrices: {}, ...overrides });
const base = { open: true, onOpenChange: vi.fn(), available: 40, busy: false, blocked: false, onAction: vi.fn(async () => true), onHelp: vi.fn() };
const click = name => act(async () => fireEvent.click(screen.getByRole('button', { name, exact: true })));
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(query => ({ media: query, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Figma wardrobe flows', () => {
  it('닫힘 모션은 거래 본문을 보존하고 모션 감소 변경 즉시 제거하며 초점을 복원한다', async () => {
    const listeners = new Set();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_, listener) => listeners.add(listener),
      removeEventListener: (_, listener) => listeners.delete(listener),
    })));
    const originalStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
      const style = originalStyle(node);
      if (!node.classList.contains('panda-ui-dialog')) return style;
      // Browsers return a live CSSStyleDeclaration. Emulate that animation name in jsdom.
      return new Proxy(style, { get(target, key) {
        if (key === 'animationName') return 'panda-ui-dialog-' + (node.dataset.state === 'open' ? 'in' : 'out');
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    render(<PandaWardrobe {...base} profile={profile()} />);
    const trigger = screen.getByRole('button', { name: '새싹 정원사 모자 구매' });
    trigger.focus();
    await click('새싹 정원사 모자 구매');
    const dialog = document.querySelector('.panda-wardrobe-transaction');
    fireEvent.animationStart(dialog);
    await click('취소');
    expect(dialog.isConnected).toBe(true);
    expect(dialog.dataset.state).toBe('closed');
    expect(dialog.textContent).toContain('새싹 정원사 모자');
    expect(dialog.textContent).toContain('구매 할까요?');
    expect(dialog.hasAttribute('inert')).toBe(true);
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
    act(() => listeners.forEach(listener => listener({ matches: true })));
    expect(dialog.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(base.onAction).not.toHaveBeenCalled();
  });

  it('keeps five UI categories and permits locked preview without equipping the live slots', async () => {
    render(<PandaWardrobe {...base} profile={profile({ fedTotal: 112 })} />);
    await click('딸기 소풍 모자 미리보기');
    expect(JSON.parse(screen.getByTestId('preview').dataset.wardrobe).hat).toBe('strawberry');
    expect(screen.getByRole('button', { name: '머리: 착용 없음' })).toBeTruthy();
    await click('딸기 소풍 모자 구매');
    expect(screen.getByRole('status').textContent).toContain('Lv.7');
    expect(base.onAction).not.toHaveBeenCalled();
    await click('표정');
    expect(screen.getByText('구매할 아이템이 없어요')).toBeTruthy();
  });
  it('starts owned profiles in inventory and keeps actual clothing on shop tab changes', async () => {
    render(<PandaWardrobe {...base} profile={profile({ owned: ['gardener:hat'], equipped: { hat: 'gardener:hat' } })} />);
    expect(screen.getByRole('button', { name: '내 아이템' }).getAttribute('aria-pressed')).toBe('true');
    await click('상점');
    expect(JSON.parse(screen.getByTestId('preview').dataset.wardrobe).hat).toBe('gardener');
    expect(screen.queryByRole('button', { name: '새싹 정원사 모자 구매' })).toBeNull();
  });
  it('shows exact shortage and dismisses the reason after three seconds', async () => {
    vi.useFakeTimers();
    render(<PandaWardrobe {...base} available={2} profile={profile()} />);
    await click('새싹 정원사 모자 구매');
    expect(screen.getByRole('status').textContent).toContain('먹이가 4개 부족해요.');
    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('우측 알림 닫기로 안내를 닫아도 다음 요청의 안내와 자동 닫힘은 유지한다', async () => {
    vi.useFakeTimers();
    render(<PandaWardrobe {...base} available={2} profile={profile()} />);
    await click('새싹 정원사 모자 구매');
    expect(screen.getByRole('button', { name: '알림 닫기' }).tagName).toBe('BUTTON');
    await click('알림 닫기');
    expect(screen.queryByRole('status')).toBeNull();
    await click('새싹 정원사 모자 구매');
    expect(screen.getByRole('status').textContent).toContain('먹이가 4개 부족해요.');
    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(base.onAction).not.toHaveBeenCalled();
  });
  it('blocks duplicate purchase during processing and stays in the shop after choosing to wear later', async () => {
    let finish;
    const onAction = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    render(<PandaWardrobe {...base} onAction={onAction} profile={profile()} />);
    await click('새싹 정원사 모자 구매');
    await click('구매하기');
    expect(screen.getByRole('button', { name: '구매 중...' }).disabled).toBe(true);
    expect(onAction).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    expect(screen.getByRole('button', { name: '바로 착용' })).toBeTruthy();
    await click('나중에');
    expect(screen.getByRole('button', { name: '상점' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('구매 후 바로 착용해도 상점과 선택한 카테고리를 유지한다', async () => {
    const onAction = vi.fn(async () => true);
    const view = render(<PandaWardrobe {...base} onAction={onAction} profile={profile()} />);
    await click('코스튬');
    await click('새싹 정원사 코스튬 구매');
    await click('구매하기');
    const purchased = profile({ owned: ['gardener:costume'], purchasePrices: { 'gardener:costume': 8 } });
    view.rerender(<PandaWardrobe {...base} onAction={onAction} available={32} profile={purchased} />);
    await click('바로 착용');
    view.rerender(<PandaWardrobe {...base} onAction={onAction} available={32}
      profile={{ ...purchased, equipped: { costume: 'gardener:costume' } }} />);
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'buy', itemId: 'gardener:costume' },
      { type: 'equip', slot: 'costume', itemId: 'gardener:costume' },
    ]);
    expect(screen.getByRole('button', { name: '상점' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '코스튬', exact: true }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '새싹 정원사 코스튬 구매' })).toBeNull();
    expect(screen.getByRole('button', { name: '딸기 소풍 코스튬 구매' })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('preview').dataset.wardrobe).costume).toBe('gardener');
  });
  it('resolves ambiguous purchase through retry without sending another buy action', async () => {
    const onAction = vi.fn(async () => false), onRetry = vi.fn(async () => profile({ owned: ['gardener:hat'] }));
    const view = render(<PandaWardrobe {...base} onAction={onAction} onRetry={onRetry} profile={profile()} />);
    await click('새싹 정원사 모자 구매'); await click('구매하기');
    view.rerender(<PandaWardrobe {...base} onAction={onAction} onRetry={onRetry} blocked profile={profile()} />);
    await click('다시 시도');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '바로 착용' })).toBeTruthy();
  });
  it('confirms sale separately and passes equip removal without changing ownership itself', async () => {
    const onAction = vi.fn(async () => true);
    render(<PandaWardrobe {...base} onAction={onAction} profile={profile({ owned: ['gardener:hat'], equipped: { hat: 'gardener:hat' } })} />);
    await click('새싹 정원사 모자 해제');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'equip', slot: 'hat', itemId: null });
    await click('새싹 정원사 모자 판매');
    expect(screen.getByText('+3')).toBeTruthy();
    await click('취소');
    expect(onAction).toHaveBeenCalledTimes(1);
    await click('새싹 정원사 모자 판매'); await click('판매하기');
    expect(onAction).toHaveBeenLastCalledWith({ type: 'sell', itemId: 'gardener:hat' });
    expect(screen.getByRole('status').textContent).toContain('먹이 3개를 받았어요.');
  });

  it('거래가 차단되지 않은 로컬 착용 실패도 오류를 표시한다', async () => {
    render(<PandaWardrobe {...base} onAction={vi.fn(async () => false)} notice="저장 공간을 확인해 주세요."
      profile={profile({ owned: ['gardener:costume'] })} />);
    await click('코스튬');
    await click('새싹 정원사 코스튬 착용');
    expect(screen.getByRole('alert').textContent).toContain('저장 공간을 확인해 주세요.');
  });

  it('구매 완료 뒤 바로 착용이 실패하면 완료 팝업 안에서 오류를 보여준다', async () => {
    render(<PandaWardrobe {...base} onAction={vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)} profile={profile()} />);
    await click('새싹 정원사 모자 구매'); await click('구매하기'); await click('바로 착용');
    expect(screen.getByRole('alert').textContent).toContain('착용을 변경하지 못했어요.');
    expect(screen.getByRole('button', { name: '바로 착용' })).toBeTruthy();
  });

  it('중첩 거래 창에 제목 초점을 주고 취소하면 구매 버튼으로 복귀한다', async () => {
    render(<PandaWardrobe {...base} profile={profile()} />);
    const trigger = screen.getByRole('button', { name: '새싹 정원사 모자 구매' });
    trigger.focus();
    await click('새싹 정원사 모자 구매');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '구매 할까요?' }));
    await click('취소');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('authored part cards', () => {
  it('toggles equip and remove from the inventory card itself', async () => {
    const onAction = vi.fn(async () => true);
    const owned = ['gardener:hat'];
    const view = render(<PandaWardrobe {...base} onAction={onAction} profile={profile({ owned })} />);
    await click('새싹 정원사 모자 카드 착용');
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'equip', slot: 'hat', itemId: 'gardener:hat' });
    view.rerender(<PandaWardrobe {...base} onAction={onAction} profile={profile({ owned, equipped: { hat: 'gardener:hat' } })} />);
    expect(screen.getByRole('button', { name: '새싹 정원사 모자 카드 해제' }).getAttribute('aria-pressed')).toBe('true');
    await click('새싹 정원사 모자 카드 해제');
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenLastCalledWith({ type: 'equip', slot: 'hat', itemId: null });
  });
  it('keeps the existing equip and sale buttons independent from card toggling', async () => {
    const onAction = vi.fn(async () => true);
    render(<PandaWardrobe {...base} onAction={onAction} profile={profile({ owned: ['gardener:hat'] })} />);
    await click('새싹 정원사 모자 착용');
    expect(onAction).toHaveBeenCalledTimes(1);
    await click('새싹 정원사 모자 판매');
    expect(screen.getByRole('button', { name: '판매하기' })).toBeTruthy();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it.each([{ busy: true }, { blocked: true }])('disables card transactions with %j', async state => {
    const onAction = vi.fn();
    render(<PandaWardrobe {...base} {...state} onAction={onAction} profile={profile({ owned: ['gardener:hat'] })} />);
    const card = screen.getByRole('button', { name: '새싹 정원사 모자 카드 착용' });
    expect(card.disabled).toBe(true);
    await act(async () => fireEvent.click(card));
    expect(onAction).not.toHaveBeenCalled();
  });
  it('does not submit another card equip while the first one is pending', async () => {
    let finish;
    const onAction = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    render(<PandaWardrobe {...base} onAction={onAction} profile={profile({ owned: ['gardener:hat'] })} />);
    await click('새싹 정원사 모자 카드 착용');
    await click('새싹 정원사 모자 카드 착용');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '새싹 정원사 모자 카드 착용' }).disabled).toBe(true);
    await act(async () => finish(true));
  });
  it('paints costume sleeves behind the body in the shared thumbnail', async () => {
    render(<PandaWardrobe {...base} profile={profile()} />);
    await click('코스튬');
    const art = screen.getByRole('button', { name: '새싹 정원사 코스튬 미리보기' });
    expect(Array.from(art.querySelectorAll('image'), node => node.getAttribute('href'))).toEqual([
      '/panda/wardrobe/gardener-back.svg', '/panda/wardrobe/gardener-sleeve-left.svg',
      '/panda/wardrobe/gardener-sleeve-right.svg', '/panda/wardrobe/gardener-costume.svg',
    ]);
  });
  it('shares the rarity background between its inventory card, equipped slot and transaction', async () => {
    render(<PandaWardrobe {...base} profile={profile({ owned: ['gardener:hat'], equipped: { hat: 'gardener:hat' } })} />);
    const card = screen.getByRole('button', { name: '새싹 정원사 모자 카드 해제' }).closest('article');
    const slot = screen.getByRole('button', { name: '머리: 새싹 정원사 모자' });
    expect(card.style.getPropertyValue('--pw-thumbnail')).toBe(PANDA_PART_RARITIES.common.background);
    expect(slot.style.getPropertyValue('--pw-thumbnail')).toBe(PANDA_PART_RARITIES.common.background);
    expect(card.style.getPropertyValue('--pw-thumbnail-center')).toBe(PANDA_PART_RARITIES.common.backgroundCenter);
    expect(slot.style.getPropertyValue('--pw-thumbnail-center')).toBe(PANDA_PART_RARITIES.common.backgroundCenter);
    await click('새싹 정원사 모자 판매');
    const transaction = document.querySelector('.panda-wardrobe-transaction-item');
    expect(transaction.style.getPropertyValue('--pw-thumbnail')).toBe(PANDA_PART_RARITIES.common.background);
    expect(transaction.style.getPropertyValue('--pw-thumbnail-center')).toBe(PANDA_PART_RARITIES.common.backgroundCenter);
  });
});
