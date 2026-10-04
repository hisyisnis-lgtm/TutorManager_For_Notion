import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePandaGrowthFeedback, { PANDA_FEED_PULSE_LIMIT, PANDA_GROWTH_FEEDBACK_DURATION as DURATION } from './usePandaGrowthFeedback.js';
import { PANDA_ADULT_FED, PANDA_ADULT_LEVEL_FOOD, PANDA_GROWTH_THRESHOLDS } from '../constants/pandaWardrobe.js';

const advance = time => act(() => { vi.advanceTimersByTime(time); });
const setup = (fedTotal = 0, reducedMotion = false) => renderHook(props => usePandaGrowthFeedback(props), {
  initialProps: { fedTotal, reducedMotion }, wrapper: StrictMode,
});
const feed = (view, previous, next, reducedMotion = false) => {
  act(() => view.result.current.recordFeed({ fedTotal: previous }, { fedTotal: next }));
  view.rerender({ fedTotal: next, reducedMotion });
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('랴오랴오의 확정 성장 피드백', () => {
  it('최초 원격 로드·프로필 재동기화는 현재 체형만 반영하고 연출을 시작하지 않는다', () => {
    const view = setup();
    view.rerender({ fedTotal: PANDA_ADULT_FED, reducedMotion: false });
    expect(view.result.current.displayStage).toBe(5);
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.celebration).toBeNull();
    expect(view.result.current.pulses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(PANDA_GROWTH_THRESHOLDS.slice(1).map((fed, index) => [index, fed]))(
    '%i단계에서 다음 체형은 1500ms 뒤 드러나고 퇴장 후 안내를 끝낸다', (fromStage, threshold) => {
      const view = setup(threshold - 1);
      feed(view, threshold - 1, threshold);
      expect(view.result.current.celebration).toMatchObject({ type: 'evolution', fromStage, toStage: fromStage + 1, fromLevel: fromStage + 1, toLevel: fromStage + 2, phase: 'charge' });
      expect(view.result.current.displayStage).toBe(fromStage);
      expect(view.result.current.busy).toBe(true);
      advance(DURATION.charge - 1);
      expect(view.result.current.displayStage).toBe(fromStage);
      advance(1);
      expect(view.result.current.celebration.phase).toBe('reveal');
      expect(view.result.current.displayStage).toBe(fromStage + 1);
      advance(DURATION.evolution - DURATION.charge - DURATION.evolutionExit);
      expect(view.result.current.celebration.phase).toBe('out');
      expect(view.result.current.displayStage).toBe(fromStage + 1);
      advance(DURATION.evolutionExit - 1);
      expect(view.result.current.busy).toBe(true);
      advance(1);
      expect(view.result.current.celebration).toBeNull();
      expect(view.result.current.busy).toBe(false);
      expect(view.result.current.displayStage).toBe(fromStage + 1);
    },
  );

  it('x5의 도착 다섯 번은 각각 850ms 유지하며 마지막 저장에서 중복 입자를 만들지 않는다', () => {
    const view = setup(20);
    for (let index = 0; index < 5; index++) {
      if (index) advance(130);
      act(() => view.result.current.recordArrival());
      expect(view.result.current.pulses).toHaveLength(index + 1);
    }
    const ids = view.result.current.pulses.map(pulse => pulse.id);
    expect(view.result.current.pulses.map(pulse => pulse.count)).toEqual([1, 1, 1, 1, 1]);
    expect(view.result.current.celebration).toBeNull();
    expect(view.result.current.busy).toBe(false);
    feed(view, 20, 25);
    expect(view.result.current.pulses.map(pulse => pulse.id)).toEqual(ids);
    advance(329);
    expect(view.result.current.pulses).toHaveLength(5);
    advance(1);
    expect(view.result.current.pulses.map(pulse => pulse.id)).toEqual(ids.slice(1));
    advance(520);
    expect(view.result.current.pulses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('매우 빠른 연속 도착은 렌더 입자 예산을 넘지 않고 새 도착만 추가한다', () => {
    const view = setup(20);
    act(() => {
      for (let index = 0; index < PANDA_FEED_PULSE_LIMIT + 4; index++) view.result.current.recordArrival();
    });
    expect(view.result.current.pulses).toHaveLength(PANDA_FEED_PULSE_LIMIT);
    expect(new Set(view.result.current.pulses.map(pulse => pulse.id)).size).toBe(PANDA_FEED_PULSE_LIMIT);
    expect(view.result.current.pulses.every(pulse => pulse.count === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(PANDA_FEED_PULSE_LIMIT);
    advance(DURATION.pulse);
    expect(view.result.current.pulses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('확정 성장과 재시도 응답만으로는 도착 장식을 새로 만들지 않는다', () => {
    const [, threshold] = PANDA_GROWTH_THRESHOLDS;
    const view = setup(threshold - 1);
    feed(view, threshold - 1, threshold);
    expect(view.result.current.celebration?.type).toBe('evolution');
    expect(view.result.current.pulses).toEqual([]);
    act(() => view.result.current.recordFeed(threshold - 1, threshold));
    expect(view.result.current.pulses).toEqual([]);
  });

  it('한 번에 여러 경계를 넘어도 모든 체형을 순서대로 보여주고 중간에 성체로 건너뛰지 않는다', () => {
    const view = setup();
    feed(view, 0, PANDA_ADULT_FED);
    for (let stage = 0; stage < 5; stage++) {
      expect(view.result.current.celebration).toMatchObject({ fromStage: stage, toStage: stage + 1, phase: 'charge' });
      expect(view.result.current.displayStage).toBe(stage);
      advance(DURATION.charge);
      expect(view.result.current.displayStage).toBe(stage + 1);
      advance(DURATION.evolution - DURATION.charge);
    }
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.displayStage).toBe(5);
  });

  it('연속 성공은 진행 중 진화를 덮어쓰지 않고 다음 경계를 이어서 재생한다', () => {
    const [, first, second] = PANDA_GROWTH_THRESHOLDS;
    const view = setup(first - 1);
    feed(view, first - 1, first);
    const id = view.result.current.celebration.id;
    advance(300);
    feed(view, first, second);
    expect(view.result.current.celebration.id).toBe(id);
    expect(view.result.current.displayStage).toBe(0);
    advance(DURATION.evolution - 300);
    expect(view.result.current.celebration).toMatchObject({ fromStage: 1, toStage: 2, phase: 'charge' });
    expect(view.result.current.displayStage).toBe(1);
  });

  it('진화와 성체 레벨업이 같은 거래면 마지막 진화에 도달 레벨을 함께 표시한다', () => {
    const view = setup(PANDA_ADULT_FED - 1);
    const next = PANDA_ADULT_FED + PANDA_ADULT_LEVEL_FOOD * 2;
    feed(view, PANDA_ADULT_FED - 1, next);
    expect(view.result.current.celebration).toMatchObject({ type: 'evolution', fromLevel: 5, toLevel: 8, toStage: 5 });
    advance(DURATION.evolution);
    expect(view.result.current.celebration).toBeNull();
  });

  it('진행 중 레벨업은 유지하고 대기 중 레벨업만 최신 도달 레벨로 합친다', () => {
    const nextLevel = PANDA_ADULT_FED + PANDA_ADULT_LEVEL_FOOD;
    const view = setup(PANDA_ADULT_FED);
    feed(view, PANDA_ADULT_FED, nextLevel);
    const id = view.result.current.celebration.id;
    feed(view, nextLevel, nextLevel + PANDA_ADULT_LEVEL_FOOD);
    feed(view, nextLevel + PANDA_ADULT_LEVEL_FOOD, nextLevel + PANDA_ADULT_LEVEL_FOOD * 2);
    expect(view.result.current.celebration).toMatchObject({ id, type: 'level', fromLevel: 6, toLevel: 7, phase: 'reveal' });
    advance(DURATION.level - DURATION.levelExit);
    expect(view.result.current.celebration).toMatchObject({ id, toLevel: 7, phase: 'out' });
    expect(view.result.current.busy).toBe(true);
    advance(DURATION.levelExit);
    expect(view.result.current.celebration).toMatchObject({ type: 'level', fromLevel: 7, toLevel: 9, phase: 'reveal' });
    expect(view.result.current.celebration.id).not.toBe(id);
    advance(DURATION.level - DURATION.levelExit - 1);
    expect(view.result.current.celebration.phase).toBe('reveal');
    advance(1);
    expect(view.result.current.celebration.phase).toBe('out');
    advance(DURATION.levelExit);
    expect(view.result.current.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('레벨업 중 추가 먹이는 퇴장 시간을 늘리거나 도달 레벨을 바꾸지 않는다', () => {
    const next = PANDA_ADULT_FED + PANDA_ADULT_LEVEL_FOOD;
    const view = setup(next - 1);
    feed(view, next - 1, next);
    const id = view.result.current.celebration.id;
    advance(1000);
    feed(view, next, next + 1);
    advance(DURATION.level - DURATION.levelExit - 1000);
    expect(view.result.current.celebration).toMatchObject({ id, toLevel: 7, phase: 'out' });
    expect(view.result.current.displayStage).toBe(5);
    advance(DURATION.levelExit);
    expect(view.result.current.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('동작 줄이기 레벨업은 1초간 정적으로 표시하고 일반 퇴장 타이머를 남기지 않는다', () => {
    const next = PANDA_ADULT_FED + PANDA_ADULT_LEVEL_FOOD;
    const view = setup(next - 1);
    feed(view, next - 1, next);
    advance(1500);
    view.rerender({ fedTotal: next, reducedMotion: true });
    expect(view.result.current.celebration.phase).toBe('reveal');
    expect(view.result.current.pulses).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    advance(DURATION.reduced - 1);
    expect(view.result.current.celebration.phase).toBe('reveal');
    advance(1);
    expect(view.result.current.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('실패·동일 응답 재처리·감소값은 효과나 중복 진화를 추가하지 않는다', () => {
    const [, threshold] = PANDA_GROWTH_THRESHOLDS;
    const view = setup(threshold - 1);
    act(() => {
      view.result.current.recordFeed({ fedTotal: threshold - 1 }, null);
      view.result.current.recordFeed(threshold, threshold - 1);
      view.result.current.recordFeed(threshold, threshold);
    });
    expect(view.result.current.pulses).toEqual([]);
    feed(view, threshold - 1, threshold);
    act(() => view.result.current.recordFeed(threshold - 1, threshold));
    expect(view.result.current.pulses).toHaveLength(0);
    advance(DURATION.evolution);
    expect(view.result.current.busy).toBe(false);
    act(() => view.result.current.recordFeed(threshold - 1, threshold));
    expect(view.result.current.celebration).toBeNull();
  });

  it('동작 줄이기에서는 입자와 충전 없이 새 체형을 보여주고 1초 후 다음 알림으로 넘어간다', () => {
    const view = setup(0, true);
    act(() => view.result.current.recordArrival());
    feed(view, 0, PANDA_GROWTH_THRESHOLDS[2], true);
    expect(view.result.current.pulses).toEqual([]);
    expect(view.result.current.celebration.phase).toBe('reveal');
    expect(view.result.current.displayStage).toBe(1);
    advance(1000);
    expect(view.result.current.displayStage).toBe(2);
    expect(view.result.current.celebration.phase).toBe('reveal');
    advance(1000);
    expect(view.result.current.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('설정을 바꾸면 기존 충전·입자 타이머를 정리하고 체형을 되돌리지 않는다', () => {
    const [, threshold] = PANDA_GROWTH_THRESHOLDS;
    const view = setup(threshold - 1);
    act(() => view.result.current.recordArrival());
    feed(view, threshold - 1, threshold);
    advance(200);
    view.rerender({ fedTotal: threshold, reducedMotion: true });
    expect(view.result.current.pulses).toEqual([]);
    expect(view.result.current.displayStage).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    advance(500);
    view.rerender({ fedTotal: threshold, reducedMotion: false });
    expect(view.result.current.displayStage).toBe(1);
    advance(500);
    expect(view.result.current.busy).toBe(true);
    expect(view.result.current.displayStage).toBe(1);
    advance(DURATION.evolution - 500);
    expect(view.result.current.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('언마운트 시 모든 타이머를 취소하며 캡처된 콜백도 새 효과를 만들지 않는다', () => {
    const view = setup();
    act(() => view.result.current.recordArrival());
    feed(view, 0, PANDA_ADULT_FED);
    const recordFeed = view.result.current.recordFeed;
    const recordArrival = view.result.current.recordArrival;
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => recordFeed(PANDA_ADULT_FED, PANDA_ADULT_FED + 1));
    act(() => recordArrival());
    advance(10000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
