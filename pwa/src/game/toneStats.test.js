import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordTone, toneAccuracy, toneAttempts, weakestTone, allTonesAbove,
  loadToneStats, saveToneStats, TONE_NUMS,
} from './toneStats.js';

beforeEach(() => { localStorage.clear(); });

describe('recordTone', () => {
  it('새 성조는 [정답, 시도]로 시작', () => {
    const s = {};
    recordTone(s, 3, true);
    expect(s[3]).toEqual([1, 1]);
  });
  it('오답은 시도만 늘린다', () => {
    const s = {};
    recordTone(s, 2, false);
    expect(s[2]).toEqual([0, 1]);
  });
  it('누적된다', () => {
    const s = {};
    recordTone(s, 1, true);
    recordTone(s, 1, false);
    recordTone(s, 1, true);
    expect(s[1]).toEqual([2, 3]);
  });
  it('경성(0)도 분리 집계', () => {
    const s = {};
    recordTone(s, 0, true);
    expect(s[0]).toEqual([1, 1]);
  });
});

describe('toneAccuracy / toneAttempts', () => {
  it('정답률 = 정답/시도, 시도 0이면 0', () => {
    expect(toneAccuracy([3, 4])).toBe(0.75);
    expect(toneAccuracy([0, 0])).toBe(0);
    expect(toneAccuracy(undefined)).toBe(0);
  });
  it('시도수', () => {
    expect(toneAttempts([3, 4])).toBe(4);
    expect(toneAttempts(undefined)).toBe(0);
  });
});

describe('weakestTone — 가장 약한 성조', () => {
  it('시도 충분한 것 중 정답률 최저', () => {
    const stats = { 1: [9, 10], 2: [3, 10], 3: [8, 10] }; // 2성 30%
    expect(weakestTone(stats)).toEqual({ tone: 2, acc: 0.3 });
  });
  it('시도 부족(minAttempts 미만)은 제외', () => {
    const stats = { 1: [0, 1], 3: [5, 10] }; // 1성은 시도 1 < 3 → 제외
    expect(weakestTone(stats, 3)).toEqual({ tone: 3, acc: 0.5 });
  });
  it('판정 가능한 성조가 없으면 null', () => {
    expect(weakestTone({ 1: [0, 1] }, 3)).toBe(null);
    expect(weakestTone({}, 3)).toBe(null);
  });
});

describe('allTonesAbove — 성조 마스터 판정', () => {
  it('모든 성조 시도 충분 & 정답률 기준 이상이면 true', () => {
    const stats = {};
    for (const t of TONE_NUMS) stats[t] = [10, 10]; // 전부 100%
    expect(allTonesAbove(stats, 0.9, 5)).toBe(true);
  });
  it('한 성조라도 기준 미달이면 false', () => {
    const stats = {};
    for (const t of TONE_NUMS) stats[t] = [10, 10];
    stats[3] = [7, 10]; // 3성 70%
    expect(allTonesAbove(stats, 0.9, 5)).toBe(false);
  });
  it('한 성조라도 시도 부족이면 false(아직 판정 불가)', () => {
    const stats = {};
    for (const t of TONE_NUMS) stats[t] = [10, 10];
    stats[0] = [2, 2]; // 경성 시도 2 < 5
    expect(allTonesAbove(stats, 0.9, 5)).toBe(false);
  });
});

describe('load/save 라운드트립', () => {
  it('저장/로드', () => {
    saveToneStats('u', { 1: [3, 4] });
    expect(loadToneStats('u')[1]).toEqual([3, 4]);
  });
  it('기록 없으면 빈 객체, 깨진 값도 빈 객체', () => {
    expect(loadToneStats('u')).toEqual({});
    localStorage.setItem('game_tone_u', '{broken');
    expect(loadToneStats('u')).toEqual({});
  });
});
