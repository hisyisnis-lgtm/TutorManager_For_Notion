import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTimeLimitForCombo, getBestKey, loadBest, saveBest, serverToCache,
  formatTime, pickCelebratePanda, shuffle, ASSETS,
} from './tgTokens.js';

beforeEach(() => { localStorage.clear(); });

describe('getTimeLimitForCombo — 콤보 단계별 제한시간', () => {
  it('콤보가 오를수록 짧아진다(난이도 배수 1.0)', () => {
    expect(getTimeLimitForCombo(0)).toBe(7000);
    expect(getTimeLimitForCombo(2)).toBe(5500);
    expect(getTimeLimitForCombo(4)).toBe(4500);
    expect(getTimeLimitForCombo(6)).toBe(3500);
    expect(getTimeLimitForCombo(8)).toBe(3000);
    expect(getTimeLimitForCombo(99)).toBe(3000); // 8 이상 동일 하한
  });

  it('난이도 배수를 곱하고 반올림한다', () => {
    expect(getTimeLimitForCombo(0, 0.85)).toBe(Math.round(7000 * 0.85)); // 5950
    expect(getTimeLimitForCombo(2, 0.7)).toBe(Math.round(5500 * 0.7));   // 3850
  });
});

describe('getBestKey / loadBest / saveBest 캐시', () => {
  it('토큰 유무에 따라 키가 달라진다', () => {
    expect(getBestKey('abc', 'tone-easy')).toBe('game_best_tone-easy_abc');
    expect(getBestKey(null, 'tone-easy')).toBe('game_best_tone-easy');
  });

  it('저장/로드 라운드트립', () => {
    saveBest('u', 'tone-easy', { bestScore: 1234 });
    expect(loadBest('u', 'tone-easy').bestScore).toBe(1234);
  });

  it('기록 없으면 null', () => {
    expect(loadBest('u', 'tone-easy')).toBe(null);
  });

  it('깨진 JSON은 null로 안전 처리', () => {
    localStorage.setItem(getBestKey('u', 'tone-easy'), '{not json');
    expect(loadBest('u', 'tone-easy')).toBe(null);
  });
});

describe('serverToCache — 서버 응답 → 캐시 형태', () => {
  it('avgSec를 ms로, 누락 필드는 0/기본값으로', () => {
    const c = serverToCache({ bestScore: 500, bestMaxCombo: 4, bestAvgSec: 2.5, playCount: 7, lastPlayedAt: '2026-06-01T00:00:00Z' });
    expect(c.bestScore).toBe(500);
    expect(c.bestAvgMs).toBe(2500);
    expect(c.playCount).toBe(7);
  });

  it('null이면 null', () => {
    expect(serverToCache(null)).toBe(null);
  });

  it('빈 객체는 0으로 채운다', () => {
    const c = serverToCache({});
    expect(c.bestScore).toBe(0);
    expect(c.bestAvgMs).toBe(0);
  });
});

describe('formatTime', () => {
  it('ms를 m:ss로', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65000)).toBe('1:05');
    expect(formatTime(125000)).toBe('2:05');
  });
});

describe('pickCelebratePanda — 결과 판다 단계', () => {
  it('신기록이면 만세(03)', () => {
    expect(pickCelebratePanda(true, 0)).toBe(ASSETS.celebrate[2]);
  });
  it('신기록 아니고 콤보 5+면 손흔들기(02)', () => {
    expect(pickCelebratePanda(false, 5)).toBe(ASSETS.celebrate[1]);
  });
  it('무난하면 차분(01)', () => {
    expect(pickCelebratePanda(false, 2)).toBe(ASSETS.celebrate[0]);
  });
});

describe('shuffle — 불변식', () => {
  it('원본을 변형하지 않고 같은 원소를 반환', () => {
    const src = [1, 2, 3, 4, 5];
    const out = shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5]);          // 원본 보존
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]); // 멀티셋 동일
    expect(out).toHaveLength(5);
  });

  it('빈 배열도 안전', () => {
    expect(shuffle([])).toEqual([]);
  });
});
