// gameXp — XP 적립 공식·누적 저장·max 병합(멱등)·시딩·rank·레벨.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  gameXpGain, XP_TIER_MIN, loadXp, saveXp, addXp, mergeXp, seedXpIfMissing,
  loadRank, saveRank, mergeRank, seedRankIfMissing,
  examPassed, EXAM_QUESTIONS, EXAM_PASS_RATIO,
  levelInfo, rankInfo, xpForLevel,
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

describe('seedXpIfMissing — 마이그레이션(초기 XP 시드)', () => {
  it('키 없으면 tier idx의 min XP로 시딩', () => {
    expect(seedXpIfMissing('t1', 2)).toBe(XP_TIER_MIN[2]);
    expect(loadXp('t1')).toBe(XP_TIER_MIN[2]);
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

describe('등급(rank) 저장 — XP와 분리, 우상향, 3단계 상한', () => {
  it('없으면 null, 저장/로드/상한(고수=2)', () => {
    expect(loadRank('t1')).toBe(null);
    saveRank('t1', 2);
    expect(loadRank('t1')).toBe(2);
    saveRank('t1', 99);
    expect(loadRank('t1')).toBe(2); // EAR_TIERS 3단계 → 상한 클램프 2(고수)
  });
  it('mergeRank = max(우상향), 상한 2', () => {
    expect(mergeRank(0, 2)).toBe(2);
    expect(mergeRank(2, 1)).toBe(2);
    expect(mergeRank(1, 99)).toBe(2); // 상한 clamp
  });
  it('seedRankIfMissing = 키 없으면 0, 이미 있으면 그대로(시험·배치로만 오름)', () => {
    expect(seedRankIfMissing('t1')).toBe(0);
    expect(loadRank('t1')).toBe(0);
    saveRank('t1', 2);
    expect(seedRankIfMissing('t1')).toBe(2);
  });
});

describe('승급 시험 판정', () => {
  it('합격 = 정답률 80% 이상(16/20)', () => {
    expect(examPassed(16)).toBe(true);
    expect(examPassed(15)).toBe(false);
    expect(examPassed(20)).toBe(true);
    expect(EXAM_QUESTIONS).toBe(20);
    expect(EXAM_PASS_RATIO).toBe(0.8);
  });
});

describe('레벨(Lv.N) — 누적 XP 연속 성장', () => {
  it('Lv1=0에서 시작, 점증 커브로 레벨업', () => {
    expect(levelInfo(0).level).toBe(1);
    expect(xpForLevel(1)).toBe(0);
    expect(levelInfo(xpForLevel(2)).level).toBe(2);
    expect(levelInfo(xpForLevel(2) - 1).level).toBe(1); // 임계 직전
    expect(levelInfo(xpForLevel(5)).level).toBe(5);
    expect(xpForLevel(3)).toBeGreaterThan(xpForLevel(2)); // 점증
    expect(xpForLevel(4) - xpForLevel(3)).toBeGreaterThan(xpForLevel(3) - xpForLevel(2)); // 증가폭 커짐
  });
  it('게이지 progress는 0~1, toNext는 다음 레벨까지', () => {
    const mid = Math.floor((xpForLevel(3) + xpForLevel(4)) / 2);
    const li = levelInfo(mid);
    expect(li.level).toBe(3);
    expect(li.progress).toBeGreaterThan(0);
    expect(li.progress).toBeLessThan(1);
    expect(li.toNext).toBe(xpForLevel(4) - mid);
  });
});

describe('rankInfo — 등급(보스 기반, 급과 1:1)', () => {
  it('rank로 EAR_TIERS 엠블럼 결정, 범위 clamp', () => {
    expect(rankInfo(0).idx).toBe(0);
    expect(rankInfo(0).name).toBe('입문');
    expect(rankInfo(0).isMax).toBe(false);
    expect(rankInfo(2).name).toBe('고수');
    expect(rankInfo(2).isMax).toBe(true); // 고수=최고 등급
    expect(rankInfo(99).idx).toBe(2); // 상한 clamp
    expect(rankInfo(-5).idx).toBe(0); // 하한 clamp
  });
});
