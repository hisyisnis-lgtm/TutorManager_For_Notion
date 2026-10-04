import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePandaAmbientMotion, { PANDA_AMBIENT_DURATION } from './usePandaAmbientMotion.js';

const advance = time => act(() => vi.advanceTimersByTime(time));
const setup = (enabled = true, stage = 5) => renderHook(props => usePandaAmbientMotion(props.enabled, props.stage, props.hand), {
  initialProps: { enabled, stage, hand: null },
});
let hidden;
let media;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const listeners = new Set();
  media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    change(matches) { this.matches = matches; listeners.forEach(fn => fn({ matches })); } };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('랴오랴오의 공유 idle 스케줄러', () => {
  it.each([['greeting', 0], ['ears', .35], ['look', .65], ['pupils', .9]])('%s만 단독 재생하고 끝난 뒤 다음 간격을 센다', (name, random) => {
    const view = setup();
    Math.random.mockReturnValue(random);
    advance(11999);
    expect(view.result.current).toBeNull();
    advance(1);
    expect(view.result.current).toBe(name);
    advance(PANDA_AMBIENT_DURATION[name] - 1);
    expect(view.result.current).toBe(name);
    advance(1);
    expect(view.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    advance(12000 + random * 10000 - 1);
    expect(view.result.current).toBeNull();
    advance(1);
    expect(view.result.current).toBe(name);
  });

  it('먹기·팝업 등으로 비활성화하면 중단하고 복귀 후 다시 기다린다', () => {
    const view = setup();
    advance(12000);
    view.rerender({ enabled: false, stage: 5, hand: null });
    expect(view.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ enabled: true, stage: 5, hand: null });
    advance(11999);
    expect(view.result.current).toBeNull();
    advance(1);
    expect(view.result.current).toBe('greeting');
  });

  it.each([1, 2, 3, 4])('%i 성장 단계는 인사 없이 귀·고개·눈동자 동작만 선택한다', stage => {
    const view = setup(true, stage);
    advance(12000);
    expect(view.result.current).toBe('ears');
    advance(PANDA_AMBIENT_DURATION.ears);
    expect(view.result.current).toBeNull();
    Math.random.mockReturnValue(.5);
    advance(12000);
    expect(view.result.current).toBe('look');
    advance(PANDA_AMBIENT_DURATION.look);
    expect(view.result.current).toBeNull();
    Math.random.mockReturnValue(.99);
    advance(17000);
    expect(view.result.current).toBe('pupils');
    advance(PANDA_AMBIENT_DURATION.pupils);
    expect(view.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('성체 인사 도중 이전 단계로 바뀌면 즉시 중단하고 해당 단계 동작을 새로 예약한다', () => {
    const view = setup();
    advance(12000);
    expect(view.result.current).toBe('greeting');
    view.rerender({ enabled: true, stage: 4, hand: null });
    expect(view.result.current).toBeNull();
    advance(12000);
    expect(view.result.current).toBe('ears');
    view.rerender({ enabled: true, stage: 5, hand: null });
    advance(12000);
    expect(view.result.current).toBe('greeting');
  });

  it('알·썸네일에는 예약하지 않으며 숨김·동작 줄이기에서 중단한다', () => {
    const view = setup(false);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ enabled: true, stage: 0, hand: null });
    expect(vi.getTimerCount()).toBe(0);
    view.rerender({ enabled: true, stage: 5, hand: null });
    advance(12000);
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(view.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(12000);
    act(() => media.change(true));
    expect(view.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => media.change(false));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
