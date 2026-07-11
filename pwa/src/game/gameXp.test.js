// gameXp — XP 적립 공식·누적 저장·xpTier 파생·max 병합(멱등)·마이그레이션 시딩.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  gameXpGain, xpTier, XP_TIER_MIN, loadXp, saveXp, addXp, mergeXp, seedXpIfMissing,
  loadRank, saveRank, mergeRank, seedRankIfMissing, displayTier,
  examPassed, examFailXp, EXAM_QUESTIONS, EXAM_PASS_RATIO,
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

describe('등급(rank) 저장 — XP와 분리, 우상향', () => {
  it('없으면 null, 저장/로드/상한', () => {
    expect(loadRank('t1')).toBe(null);
    saveRank('t1', 2);
    expect(loadRank('t1')).toBe(2);
    saveRank('t1', 99);
    expect(loadRank('t1')).toBe(XP_TIER_MIN.length - 1); // 상한 클램프
  });
  it('mergeRank = max(우상향)', () => {
    expect(mergeRank(1, 3)).toBe(3);
    expect(mergeRank(3, 1)).toBe(3);
  });
  it('seedRankIfMissing = 현재 XP 도달 등급으로 1회(Phase1 승계)', () => {
    saveXp('t1', XP_TIER_MIN[2] + 10);
    expect(seedRankIfMissing('t1', loadXp('t1'))).toBe(2);
    expect(loadRank('t1')).toBe(2);
    // 이미 있으면 그대로
    saveXp('t1', XP_TIER_MIN[3]);
    expect(seedRankIfMissing('t1', loadXp('t1'))).toBe(2);
  });
});

describe('displayTier — 저장 등급 기준 + examReady 게이트', () => {
  it('XP가 다음 임계 넘어도 등급은 저장 rank 유지, examReady=true', () => {
    const t = displayTier(1, XP_TIER_MIN[2] + 5000); // rank 1인데 XP는 2단계 초과
    expect(t.idx).toBe(1);          // 등급은 안 오름(시험 전)
    expect(t.progress).toBe(1);     // 게이지 만땅
    expect(t.examReady).toBe(true); // 응시 가능
  });
  it('밴드 중간이면 examReady=false', () => {
    const mid = (XP_TIER_MIN[1] + XP_TIER_MIN[2]) / 2;
    const t = displayTier(1, mid);
    expect(t.examReady).toBe(false);
    expect(t.progress).toBeCloseTo(0.5, 5);
  });
  it('최고 등급은 examReady=false·isMax', () => {
    const t = displayTier(XP_TIER_MIN.length - 1, 999999);
    expect(t.isMax).toBe(true);
    expect(t.examReady).toBe(false);
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
  it('불합격 XP = 현재 밴드 15% 차감, 등급 base 아래로 안 내려감', () => {
    const band = XP_TIER_MIN[2] - XP_TIER_MIN[1];
    const penalty = Math.round(band * 0.15);
    // rank 1, XP가 밴드 상단(다음 임계)일 때
    expect(examFailXp(1, XP_TIER_MIN[2])).toBe(XP_TIER_MIN[2] - penalty);
    // 차감이 base 아래로 가면 base로 바닥
    expect(examFailXp(1, XP_TIER_MIN[1] + 10)).toBe(XP_TIER_MIN[1]);
  });
});
