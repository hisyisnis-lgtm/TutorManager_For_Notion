// earProfile — 등급 파생 + 최고 등급(peak) 기록. 등급 강등 도입(2026-07-04) 후:
// 현재 등급 = 마스터 수 정직 반영(내려갈 수 있음) / 최고 등급 = 오르기만(성취 보존).
import { describe, it, expect, beforeEach } from 'vitest';
import { earTier, EAR_TIERS, loadTierPeak, bumpTierPeak } from './earProfile.js';

beforeEach(() => { localStorage.clear(); });

describe('earTier — 마스터 수 → 단계', () => {
  it('경계값: 0=1단계, 1=2단계, 10=3단계, 25=4단계(최고)', () => {
    expect(earTier(0).idx).toBe(0);
    expect(earTier(1).idx).toBe(1);
    expect(earTier(9).idx).toBe(1);
    expect(earTier(10).idx).toBe(2);
    expect(earTier(25).idx).toBe(3);
    expect(earTier(25).isMax).toBe(true);
  });
  it('마스터 수가 줄면 단계도 내려간다(강등 — 정직한 현재 실력)', () => {
    expect(earTier(12).idx).toBe(2); // 골드
    expect(earTier(8).idx).toBe(1);  // 실버로 하락
  });
});

describe('최고 등급(peak) — 이것만은 오르기만', () => {
  it('bump는 max 유지 — 강등돼도 최고 기록 보존', () => {
    expect(bumpTierPeak('u', 2)).toBe(2);
    expect(bumpTierPeak('u', 1)).toBe(2); // 강등 후에도 최고=골드 유지
    expect(loadTierPeak('u')).toBe(2);
    expect(bumpTierPeak('u', 3)).toBe(3);
  });
  it('초기 0, 깨진 저장값도 0', () => {
    expect(loadTierPeak('u')).toBe(0);
    localStorage.setItem('game_tier_peak_u', 'zzz');
    expect(loadTierPeak('u')).toBe(0);
  });
  it('peak 인덱스는 EAR_TIERS 범위 내에서 쓰인다(칩 렌더 가드용)', () => {
    expect(EAR_TIERS.length).toBe(4);
  });
});
