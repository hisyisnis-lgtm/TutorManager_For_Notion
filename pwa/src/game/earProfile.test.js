// earProfile — 등급 엠블럼(rank=급 기반 3단계) + 최고 등급(peak) 기록(오르기만).
import { describe, it, expect, beforeEach } from 'vitest';
import { EAR_TIERS, loadTierPeak, bumpTierPeak } from './earProfile.js';

beforeEach(() => { localStorage.clear(); });

describe('EAR_TIERS — 급과 1:1 3단계', () => {
  it('성조 입문자/수련생/고수 3단계·엠블럼 존재', () => {
    expect(EAR_TIERS.length).toBe(3);
    expect(EAR_TIERS.map((t) => t.name)).toEqual(['성조 입문자', '성조 수련생', '성조 고수']);
    expect(EAR_TIERS.every((t) => typeof t.emblem === 'string')).toBe(true);
  });
});

describe('최고 등급(peak) — 이것만은 오르기만', () => {
  it('bump는 max 유지', () => {
    expect(bumpTierPeak('u', 2)).toBe(2);
    expect(bumpTierPeak('u', 1)).toBe(2); // 하락 후에도 최고 유지
    expect(loadTierPeak('u')).toBe(2);
  });
  it('초기 0, 깨진 저장값도 0', () => {
    expect(loadTierPeak('u')).toBe(0);
    localStorage.setItem('game_tier_peak_u', 'zzz');
    expect(loadTierPeak('u')).toBe(0);
  });
});
