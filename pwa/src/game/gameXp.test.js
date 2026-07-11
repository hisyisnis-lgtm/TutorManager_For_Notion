// gameXp — XP 적립 공식·누적 저장·xpTier 파생·max 병합(멱등)·마이그레이션 시딩.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  gameXpGain, xpTier, XP_TIER_MIN, loadXp, saveXp, addXp, mergeXp, seedXpIfMissing,
} from './gameXp.js';

beforeEach(() => { localStorage.clear(); });

describe('gameXpGain — 1판 XP = 점수 + 정답×3 + 신기록', () => {
  it('기본 합산', () => {
    expect(gameXpGain({ score: 800, correct: 12, isNewBest: false })).toBe(800 + 36);
    expect(gameXpGain({ score: 800, correct: 12, isNewBest: true })).toBe(800 + 36 + 100);
  });
  it('음수·빈값 방어', () => {
    expect(gameXpGain({})).toBe(0);
    expect(gameXpGain({ score: -50, correct: -3 })).toBe(0);
  });
});

describe('xpTier — 누적 XP → 등급', () => {
  it('경계값: 임계 XP에서 등급이 오른다', () => {
    expect(xpTier(0).idx).toBe(0);
    expect(xpTier(XP_TIER_MIN[1] - 1).idx).toBe(0);
    expect(xpTier(XP_TIER_MIN[1]).idx).toBe(1);
    expect(xpTier(XP_TIER_MIN[2]).idx).toBe(2);
    expect(xpTier(XP_TIER_MIN[3]).idx).toBe(3);
  });
  it('최고 등급은 isMax·progress 1', () => {
    const t = xpTier(XP_TIER_MIN[3] + 99999);
    expect(t.isMax).toBe(true);
    expect(t.progress).toBe(1);
    expect(t.toNext).toBe(0);
  });
  it('진행도·다음까지 XP', () => {
    const mid = (XP_TIER_MIN[0] + XP_TIER_MIN[1]) / 2;
    const t = xpTier(mid);
    expect(t.idx).toBe(0);
    expect(t.progress).toBeCloseTo(0.5, 5);
    expect(t.toNext).toBe(XP_TIER_MIN[1] - mid);
  });
  it('earTier와 같은 형태(name·emblem 존재)', () => {
    const t = xpTier(0);
    expect(typeof t.name).toBe('string');
    expect(typeof t.emblem).toBe('string');
  });
});

describe('저장·적립', () => {
  it('없으면 null, 저장 후 로드', () => {
    expect(loadXp('t1')).toBe(null);
    saveXp('t1', 1234);
    expect(loadXp('t1')).toBe(1234);
  });
  it('0도 유효값(미시딩 null과 구분)', () => {
    saveXp('t1', 0);
    expect(loadXp('t1')).toBe(0);
  });
  it('addXp 누적', () => {
    expect(addXp('t1', 500)).toBe(500);
    expect(addXp('t1', 300)).toBe(800);
    expect(loadXp('t1')).toBe(800);
  });
});

describe('mergeXp — max(멱등)', () => {
  it('큰 쪽을 취한다', () => {
    expect(mergeXp(500, 800)).toBe(800);
    expect(mergeXp(800, 500)).toBe(800);
  });
  it('멱등 — 반복 병합해도 인플레 없음', () => {
    let x = 1000;
    for (let i = 0; i < 5; i++) x = mergeXp(x, 1000);
    expect(x).toBe(1000);
  });
});

describe('seedXpIfMissing — 마이그레이션(현재 등급 보존)', () => {
  it('키 없으면 현재 등급의 min XP로 시딩', () => {
    expect(seedXpIfMissing('t1', 2)).toBe(XP_TIER_MIN[2]);
    expect(loadXp('t1')).toBe(XP_TIER_MIN[2]);
    expect(xpTier(loadXp('t1')).idx).toBe(2); // 등급 그대로 유지
  });
  it('이미 있으면 덮어쓰지 않음', () => {
    saveXp('t1', 30000);
    expect(seedXpIfMissing('t1', 0)).toBe(30000);
    expect(loadXp('t1')).toBe(30000);
  });
  it('idx 0(신규)도 정상 시딩(0 저장)', () => {
    expect(seedXpIfMissing('t1', 0)).toBe(0);
    expect(loadXp('t1')).toBe(0); // 이후 재시딩 안 함
    expect(seedXpIfMissing('t1', 3)).toBe(0);
  });
});
