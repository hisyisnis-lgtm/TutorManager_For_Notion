import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordTone, toneAccuracy, weakestTone, allTonesAbove,
  loadToneStats, saveToneStats, TONE_NUMS, summarizeTonePractice,
} from './toneStats.js';

beforeEach(() => { localStorage.clear(); });

describe('recordTone', () => {
  it('새 성조는 [정답, 시도, ema]로 시작 — 첫 기록 ema = 결과 그대로', () => {
    const s = {};
    recordTone(s, 3, true);
    expect(s[3]).toEqual([1, 1, 1]);
  });
  it('오답은 시도만 늘린다', () => {
    const s = {};
    recordTone(s, 2, false);
    expect(s[2]).toEqual([0, 1, 0]);
  });
  it('누적된다 + ema 갱신', () => {
    const s = {};
    recordTone(s, 1, true);   // ema 1
    recordTone(s, 1, false);  // 1 → 0.9
    recordTone(s, 1, true);   // 0.9 → 0.91
    expect(s[1][0]).toBe(2);
    expect(s[1][1]).toBe(3);
    expect(s[1][2]).toBeCloseTo(0.91, 10);
  });
  it('경성(0)도 분리 집계', () => {
    const s = {};
    recordTone(s, 0, true);
    expect(s[0]).toEqual([1, 1, 1]);
  });
  it('레거시 [정답,시도] 항목은 누적 정확도로 시드 후 갱신(자동 마이그레이션)', () => {
    const s = { 2: [8, 10] }; // 누적 80%
    recordTone(s, 2, true);
    expect(s[2][0]).toBe(9);
    expect(s[2][1]).toBe(11);
    expect(s[2][2]).toBeCloseTo(0.8 + (1 - 0.8) * 0.1, 10); // 0.82
  });
});

describe('toneAccuracy', () => {
  it('레거시 항목은 누적 정답률 폴백, 시도 0이면 0', () => {
    expect(toneAccuracy([3, 4])).toBe(0.75);
    expect(toneAccuracy([0, 0])).toBe(0);
    expect(toneAccuracy(undefined)).toBe(0);
  });
  it('ema 있으면 ema 우선(최근 가중)', () => {
    expect(toneAccuracy([3, 4, 0.5])).toBe(0.5);
  });
  it('★최근 가중 — 시도가 많이 쌓여도 최근 연속 오답이 정답률을 실질 반영(고착 방지)', () => {
    const s = { 1: [90, 100] }; // 누적 90%
    for (let i = 0; i < 5; i++) recordTone(s, 1, false); // 최근 5연속 오답
    const cumulative = s[1][0] / s[1][1]; // 90/105 ≈ 0.857 — 누적은 거의 안 움직임
    expect(toneAccuracy(s[1])).toBeCloseTo(0.9 * 0.9 ** 5, 10); // ema ≈ 0.531 — 크게 하락
    expect(toneAccuracy(s[1])).toBeLessThan(cumulative - 0.3);
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

describe('결과의 누적 성조 정답률과 다음 연습', () => {
  it('EMA와 구분해 실제 정답/응답 수로 계산하고 원기록을 바꾸지 않는다', () => {
    const stats = { 1: [9, 10, 0.1], 2: [4, 10, 0.95] }, before = globalThis.structuredClone(stats);
    const result = summarizeTonePractice(stats);
    expect(result.rows[0]).toMatchObject({ accuracy: 0.9, correct: 9, attempts: 10 });
    expect(result).toMatchObject({ state: 'practice', suggestedTone: 2 });
    expect(toneAccuracy(stats[1])).toBe(0.1);
    expect(stats).toEqual(before);
  });
  it('10회 미만 성조는 정답률을 보여도 연습 후보로 단정하지 않는다', () => {
    expect(summarizeTonePractice({ 1: [0, 9], 2: [9, 10] })).toMatchObject({ state: 'building', suggestedTone: null });
    expect(summarizeTonePractice({ 1: [0, 10] })).toMatchObject({ state: 'practice', suggestedTone: 1 });
  });
  it('모든 성조가 충분하고 80% 이상이면 가장 낮은 성조에도 약점 표시를 하지 않는다', () => {
    const stats = Object.fromEntries(TONE_NUMS.map(tone => [tone, [10, 10]])); stats[0] = [8, 10];
    expect(summarizeTonePractice(stats)).toMatchObject({ state: 'steady', suggestedTone: null });
  });
  it('기록 없음은 0%로 표시하지 않고 손상된 항목도 판단에서 제외한다', () => {
    const result = summarizeTonePractice({ 1: [15, 10], 2: [-1, 10], 3: [1, NaN], 4: 'corrupt' });
    expect(result).toMatchObject({ state: 'building', totalAttempts: 0, suggestedTone: null });
    expect(result.rows.every(row => row.accuracy === null && !row.enough)).toBe(true);
    expect(summarizeTonePractice(null).rows).toHaveLength(5);
  });
  it('경성 0도 다음 연습에 선택되며 부분 기록을 전체 성조 성취로 보지 않는다', () => {
    expect(summarizeTonePractice({ 0: [5, 10] })).toMatchObject({ state: 'practice', suggestedTone: 0 });
    expect(summarizeTonePractice({ 0: [10, 10] }).state).toBe('building');
  });
  it('게스트와 계정별로 읽은 기존 저장키의 기록을 각각 요약한다', () => {
    saveToneStats(null, { 1: [0, 10] }); saveToneStats('member-a', { 2: [4, 10] }); saveToneStats('member-b', { 4: [2, 10] });
    expect(summarizeTonePractice(loadToneStats(null)).suggestedTone).toBe(1);
    expect(summarizeTonePractice(loadToneStats('member-a')).suggestedTone).toBe(2);
    expect(summarizeTonePractice(loadToneStats('member-b')).suggestedTone).toBe(4);
  });
});
