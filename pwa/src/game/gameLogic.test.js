import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeScore, getEndlessTimeLimit, UNLOCK_THRESHOLD, GAMEKEY,
  diffBestScore, isDifficultyUnlocked, isEndlessUnlocked,
  unlockReqText, unlockToastText, bestLabelForKey,
  overallBestFromLocal, overallBestFromServer,
  loadEndlessBest, saveEndlessBest, headlineBest, resolveEndOutcome,
  themeStars, STAGES, saveStageScore, isStageUnlocked, bossState, stageUnlockToastText,
  earnedRankFromTiers, migrateRankForBoss, isThemeUnlocked, themeBestScore, clearOrphanThemeBests,
  BOSSES, loadBossPeak, saveBossPeak, rankUpperBound, perfectStageCount,
} from './gameLogic.js';
import { saveBest } from './tgTokens.js';
import { THEMES } from '../constants/toneGameWords.js';

const TOKEN = 'test-user';
beforeEach(() => { localStorage.clear(); });

describe('computeScore — 점수 공식', () => {
  it('무실수: 기본 100 + 콤보보너스(newCombo*20) + 남은시간(remaining/100)', () => {
    expect(computeScore({ perfect: true, newCombo: 1, remainingMs: 0 })).toBe(120);
    expect(computeScore({ perfect: true, newCombo: 3, remainingMs: 550 })).toBe(100 + 60 + 5); // 165
  });

  it('무실수에서 newCombo 기본값 0이면 콤보 보너스 없음', () => {
    expect(computeScore({ perfect: true, remainingMs: 0 })).toBe(100);
  });

  it('실수 있음: 시간보너스 없이 플랫 50 (랜덤 탭 방지)', () => {
    expect(computeScore({ perfect: false, remainingMs: 600 })).toBe(50);
    expect(computeScore({ perfect: false, remainingMs: 30000 })).toBe(50); // 시간 많이 남아도 50
    expect(computeScore({ perfect: false, remainingMs: 0 })).toBe(50);
  });

  it('남은시간이 음수면 시간보너스 0으로 클램프', () => {
    expect(computeScore({ perfect: true, newCombo: 2, remainingMs: -500 })).toBe(140);
    expect(computeScore({ perfect: false, remainingMs: -999 })).toBe(50);
  });
});

describe('getEndlessTimeLimit — 무한모드 가속(클리어 램프 + 콤보)', () => {
  it('클리어 0·콤보 0이면 30000ms', () => {
    expect(getEndlessTimeLimit(0, 0)).toBe(30000);
  });

  it('클리어할수록 1400ms씩 짧아진다', () => {
    expect(getEndlessTimeLimit(10, 0)).toBe(30000 - 14000); // 16000
  });

  it('클리어 램프 하한 10000ms (~14단어)', () => {
    expect(getEndlessTimeLimit(20, 0)).toBe(10000);
    expect(getEndlessTimeLimit(100, 0)).toBe(10000);
  });

  it('콤보가 쌓이면 추가로 빨라진다(콤보당 -5%, 65%까지)', () => {
    expect(getEndlessTimeLimit(0, 8)).toBe(Math.round(30000 * 0.65)); // 19500
    expect(getEndlessTimeLimit(20, 8)).toBe(Math.round(10000 * 0.65)); // 6500
    expect(getEndlessTimeLimit(0, 2)).toBe(Math.round(30000 * 0.9)); // 27000
  });
});

describe('잠금 사다리 — diffBestScore / isDifficultyUnlocked / isEndlessUnlocked', () => {
  it('기록 없으면 점수 0', () => {
    expect(diffBestScore(TOKEN, 'easy')).toBe(0);
  });

  it('초급은 항상 열려 있다', () => {
    expect(isDifficultyUnlocked(TOKEN, 'easy')).toBe(true);
  });

  it('중급은 초급 1000점 미만이면 잠김, 이상이면 열림', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: UNLOCK_THRESHOLD - 1 });
    expect(isDifficultyUnlocked(TOKEN, 'normal')).toBe(false);
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: UNLOCK_THRESHOLD });
    expect(isDifficultyUnlocked(TOKEN, 'normal')).toBe(true);
  });

  it('고급은 중급 1000점 달성 시 열림 (초급과 무관)', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 9999 });
    expect(isDifficultyUnlocked(TOKEN, 'hard')).toBe(false); // 중급 기록 없음
    saveBest(TOKEN, GAMEKEY.normal, { bestScore: UNLOCK_THRESHOLD });
    expect(isDifficultyUnlocked(TOKEN, 'hard')).toBe(true);
  });

  it('무한은 고수 마지막 스테이지(고수5) 클리어 시 열림 — rank 무관(2026-07-22)', () => {
    expect(isEndlessUnlocked(TOKEN, 0)).toBe(false);
    expect(isEndlessUnlocked(TOKEN, 2)).toBe(false); // rank 높아도 스테이지 안 깼으면 잠김
    const hardLast = STAGES.find((s) => s.tier === 'hard' && s.bandIndex === 4);
    saveStageScore(TOKEN, hardLast.id, 99999); // 고수5 별
    expect(isEndlessUnlocked(TOKEN, 0)).toBe(true); // rank 0이어도 고수5 깼으면 열림
  });

  it('사다리는 한 칸씩만 — 초급만 깨도 고급/무한은 잠김', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 5000 });
    expect(isDifficultyUnlocked(TOKEN, 'normal')).toBe(true);
    expect(isDifficultyUnlocked(TOKEN, 'hard')).toBe(false);
    expect(isEndlessUnlocked(TOKEN, 0)).toBe(false);
  });
});

describe('보스 사다리 — 스테이지 해제(rank 게이트) / bossState', () => {
  const S = (tier, b) => STAGES.find((s) => s.tier === tier && s.bandIndex === b);
  it('입문(첫 급) 스테이지는 rank 무관하게 항상 열림', () => {
    expect(isStageUnlocked(TOKEN, S('easy', 0), 0)).toBe(true);
  });
  it('급 내 스테이지는 직전 스테이지 별1↑로 열림(rank 무관)', () => {
    expect(isStageUnlocked(TOKEN, S('easy', 1), 0)).toBe(false);
    saveStageScore(TOKEN, S('easy', 0).id, 99999); // 입문1 별
    expect(isStageUnlocked(TOKEN, S('easy', 1), 0)).toBe(true);
  });
  it('다음 급 첫 스테이지는 이전 급 보스 통과(rank)로만 열림', () => {
    expect(isStageUnlocked(TOKEN, S('normal', 0), 0)).toBe(false); // 입문 보스 전
    expect(isStageUnlocked(TOKEN, S('normal', 0), 1)).toBe(true);  // 입문 보스 통과(rank1)
    expect(isStageUnlocked(TOKEN, S('hard', 0), 1)).toBe(false);   // 실전 보스 전
    expect(isStageUnlocked(TOKEN, S('hard', 0), 2)).toBe(true);    // 실전 보스 통과(rank2)
  });
  it('급 첫 스테이지 잠금 문구 = 그 급으로 승급하는 시험 이름(=그 급 이름, 2026-07-23)', () => {
    // 실전1은 '실전 승급시험'(입문 끝, 실전으로 승급) 통과로 열림
    expect(stageUnlockToastText(TOKEN, S('normal', 0), 0)).toBe('실전 승급시험을 통과하면 열려요');
    // 고수1은 '고수 승급시험'(실전 끝, 고수로 승급) 통과로 열림 — 구버전은 '실전 승급시험'으로 잘못 표기했음
    expect(stageUnlockToastText(TOKEN, S('hard', 0), 0)).toBe('고수 승급시험을 통과하면 열려요');
  });
  it('bossState 상시개방: 통과 전=ready(스테이지·순서 무관), 통과한 급=beaten (2026-07-23)', () => {
    expect(bossState(TOKEN, 0, 0)).toBe('ready'); // 입문 승급시험 — 스테이지 안 깨도 응시 가능
    expect(bossState(TOKEN, 1, 0)).toBe('ready'); // 실전 승급시험도 rank 0에서 바로 응시(순서 무관·테스트아웃)
    expect(bossState(TOKEN, 0, 1)).toBe('beaten'); // 입문 승급시험 통과함
    expect(bossState(TOKEN, 0, 2)).toBe('beaten');
  });
});

describe('보스 마이그레이션 — 기존 유저 급클리어 → rank 승계(1회)', () => {
  const S = (tier, b) => STAGES.find((s) => s.tier === tier && s.bandIndex === b);
  const clearTier = (tier) => { for (let b = 0; b < 5; b++) saveStageScore(TOKEN, S(tier, b).id, 99999); };
  it('earnedRankFromTiers = 아래(입문)부터 연속 클리어된 급 수', () => {
    expect(earnedRankFromTiers(TOKEN)).toBe(0);
    clearTier('easy'); expect(earnedRankFromTiers(TOKEN)).toBe(1);
    clearTier('normal'); expect(earnedRankFromTiers(TOKEN)).toBe(2);
  });
  it('migrateRankForBoss는 1회만 승계 — 이후 신규 클리어엔 미적용(보스로만)', () => {
    clearTier('easy');
    expect(migrateRankForBoss(TOKEN, 0)).toBe(1); // 입문 클리어 → rank1 승계 + 플래그
    clearTier('normal');                          // 이후 실전 클리어해도
    expect(migrateRankForBoss(TOKEN, 1)).toBe(1); // 플래그 있어 자동승급 없음
  });
  it('기존 rank가 승계값보다 높으면 유지(하락 없음)', () => {
    clearTier('easy'); // earned=1
    expect(migrateRankForBoss(TOKEN, 3)).toBe(3); // max(3,1)
  });
});

describe('승급시험 2개 + 배치고사(2026-07-22)', () => {
  const S = (tier, b) => STAGES.find((s) => s.tier === tier && s.bandIndex === b);
  const clearTier = (tier) => { for (let b = 0; b < 5; b++) saveStageScore(TOKEN, S(tier, b).id, 99999); };
  it('BOSSES는 입문·실전 2개뿐 — 고수(마지막 급)엔 승급시험 없음', () => {
    expect(BOSSES.length).toBe(2);
    expect(BOSSES.map((b) => b.tier)).toEqual(['easy', 'normal']);
  });
  it('졸업급(rank>tierIdx)은 전 스테이지 해제 — 배치고사로 상위 급에 오면 아래 급 복습 자유', () => {
    // rank 2(고수 진입) → 입문·실전은 졸업급: band>0도 별 없이 전부 열림
    expect(isStageUnlocked(TOKEN, S('easy', 3), 2)).toBe(true);  // 입문4: rank2>0 → 열림
    expect(isStageUnlocked(TOKEN, S('normal', 4), 2)).toBe(true); // 실전5: rank2>1 → 열림
    // 현재급(고수, rank==tierIdx 2)은 stage1만, band>0은 별 게이트
    expect(isStageUnlocked(TOKEN, S('hard', 0), 2)).toBe(true);  // 고수1: 열림
    expect(isStageUnlocked(TOKEN, S('hard', 1), 2)).toBe(false); // 고수2: 직전 별 없어 잠김
  });
  it('bossPeak = 통과한 최고 급(max 병합·상한 BOSSES.length)', () => {
    expect(loadBossPeak(TOKEN)).toBe(0);
    saveBossPeak(TOKEN, 2); expect(loadBossPeak(TOKEN)).toBe(2);
    saveBossPeak(TOKEN, 1); expect(loadBossPeak(TOKEN)).toBe(2); // 하락 안 함
    saveBossPeak(TOKEN, 9); expect(loadBossPeak(TOKEN)).toBe(2); // BOSSES.length 상한
  });
  it('rankUpperBound = max(스테이지클리어 근거, bossPeak) — 배치고사 rank가 클램프에 안 깎임', () => {
    expect(rankUpperBound(TOKEN)).toBe(0);
    saveBossPeak(TOKEN, 2); // 배치고사로 실전 승급시험 통과(스테이지 클리어 0)
    expect(rankUpperBound(TOKEN)).toBe(2); // 스테이지 안 깼어도 상한 2 → rank 2 보존
    clearTier('easy'); // earnedRankFromTiers=1이지만 bossPeak=2가 더 큼
    expect(rankUpperBound(TOKEN)).toBe(2);
  });
  it('perfectStageCount = 완벽(3별) 스테이지 수 — 고득점 조기 승급시험 유도 판정(2026-07-23)', () => {
    expect(perfectStageCount(TOKEN, 'easy')).toBe(0);
    saveStageScore(TOKEN, S('easy', 0).id, 999999); // 3별 임계 초과 → 완벽
    expect(perfectStageCount(TOKEN, 'easy')).toBe(1); // 1별 클리어(작은 점수)는 완벽 아님
    saveStageScore(TOKEN, S('easy', 2).id, 5);        // 낮은 점수(별0~1) — 완벽 미포함
    saveStageScore(TOKEN, S('easy', 3).id, 999999);   // 두 번째 완벽
    expect(perfectStageCount(TOKEN, 'easy')).toBe(2); // 완벽 2개 → 유도 조건 충족
  });
});

describe('해제 안내 문구', () => {
  it('unlockReqText / unlockToastText는 난이도별 조건을 안내', () => {
    expect(unlockReqText('normal')).toContain('입문');
    expect(unlockReqText('hard')).toContain('실전');
    expect(unlockReqText('easy')).toBe('');
    expect(unlockToastText('normal')).toContain('입문');
    expect(unlockToastText('hard')).toContain('실전');
  });
});

describe('최고점 라벨 / 통합 최고', () => {
  it('bestLabelForKey는 gameKey를 난이도 라벨로', () => {
    expect(bestLabelForKey('tone-easy')).toBe('입문');
    expect(bestLabelForKey('tone-normal')).toBe('실전');
    expect(bestLabelForKey('tone-hard')).toBe('고수');
    expect(bestLabelForKey('unknown')).toBe('입문'); // 폴백
  });

  it('overallBestFromLocal은 3난이도 중 최고 점수+라벨', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 800 });
    saveBest(TOKEN, GAMEKEY.normal, { bestScore: 1500 });
    saveBest(TOKEN, GAMEKEY.hard, { bestScore: 1200 });
    const top = overallBestFromLocal(TOKEN);
    expect(top.bestScore).toBe(1500);
    expect(top.label).toBe('실전');
  });

  it('overallBestFromLocal은 기록이 전혀 없으면 null', () => {
    expect(overallBestFromLocal(TOKEN)).toBe(null);
  });

  it('overallBestFromServer는 서버 배열에서 최고를 뽑고 avgSec→ms 변환', () => {
    const top = overallBestFromServer([
      { gameKey: 'tone-easy', bestScore: 500, bestAvgSec: 3 },
      { gameKey: 'tone-hard', bestScore: 1800, bestMaxCombo: 7, bestAvgSec: 2 },
    ]);
    expect(top.bestScore).toBe(1800);
    expect(top.label).toBe('고수');
    expect(top.bestAvgMs).toBe(2000);
  });
});

describe('headlineBest — 무한 우선', () => {
  it('무한 기록이 있으면 무한을 헤드라인으로(라벨 "무한")', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 5000 });
    saveEndlessBest(TOKEN, { bestScore: 300 });
    const h = headlineBest(TOKEN);
    expect(h.bestScore).toBe(300);
    expect(h.label).toBe('무한');
  });

  it('무한 기록이 없으면 난이도 통합 최고로 폴백', () => {
    saveBest(TOKEN, GAMEKEY.normal, { bestScore: 900 });
    const h = headlineBest(TOKEN);
    expect(h.bestScore).toBe(900);
    expect(h.label).toBe('실전');
  });

  it('아무 기록도 없으면 null', () => {
    expect(headlineBest(TOKEN)).toBe(null);
  });

  it('saveEndlessBest/loadEndlessBest 라운드트립', () => {
    saveEndlessBest(TOKEN, { bestScore: 777, playCount: 3 });
    expect(loadEndlessBest(TOKEN).bestScore).toBe(777);
  });
});

describe('resolveEndOutcome — 게임 종료 판정', () => {
  it('연습·복습은 기록 미반영, 게임오버음', () => {
    for (const mode of ['practice', 'review']) {
      const o = resolveEndOutcome({ mode, prev: { bestScore: 500 }, score: 9999, maxCombo: 9 });
      expect(o.tracksBest).toBe(false);
      expect(o.isNewBest).toBe(false);
      expect(o.previousBest).toBe(0);
      expect(o.updated).toBe(null);
      expect(o.sfx).toBe('gameover');
    }
  });

  it('난이도 신기록이면 updated에 새 값 + win음', () => {
    const o = resolveEndOutcome({ mode: 'normal', prev: { bestScore: 300, bestMaxCombo: 2, playCount: 4 }, score: 800, maxCombo: 5, avgMs: 3000 });
    expect(o.tracksBest).toBe(true);
    expect(o.isNewBest).toBe(true);
    expect(o.previousBest).toBe(300);
    expect(o.updated).toMatchObject({ bestScore: 800, bestMaxCombo: 5, bestAvgMs: 3000, playCount: 5 });
    expect(o.sfx).toBe('win');
  });

  it('신기록 아니면 이전 best 유지, playCount만 증가, gameover음', () => {
    const o = resolveEndOutcome({ mode: 'normal', prev: { bestScore: 1200, bestMaxCombo: 8, bestAvgMs: 2000, playCount: 10 }, score: 500, maxCombo: 3, avgMs: 5000 });
    expect(o.isNewBest).toBe(false);
    expect(o.updated).toEqual({ bestScore: 1200, bestMaxCombo: 8, bestAvgMs: 2000, playCount: 11 });
    expect(o.sfx).toBe('gameover');
  });

  it('난이도에서 1000점 임계를 처음 넘으면 unlock음', () => {
    const o = resolveEndOutcome({ mode: 'normal', prev: { bestScore: 900 }, score: 1100, maxCombo: 4 });
    expect(o.sfx).toBe('unlock');
  });

  it('이미 1000점 넘긴 상태에서 또 신기록이면 unlock 아님(win)', () => {
    const o = resolveEndOutcome({ mode: 'normal', prev: { bestScore: 1200 }, score: 1500 });
    expect(o.sfx).toBe('win');
  });

  it('무한모드는 잠금해제 개념이 없어 임계를 넘어도 win음', () => {
    const o = resolveEndOutcome({ mode: 'endless', prev: { bestScore: 900 }, score: 1100 });
    expect(o.tracksBest).toBe(true);
    expect(o.sfx).toBe('win');
  });

  it('이전 기록이 null이면 previousBest 0, 첫 점수가 신기록', () => {
    const o = resolveEndOutcome({ mode: 'endless', prev: null, score: 200 });
    expect(o.previousBest).toBe(0);
    expect(o.isNewBest).toBe(true);
    expect(o.updated.playCount).toBe(1);
  });
});

describe('themeStars — 테마 성취 별(한 판 최고점 500/1000/1800, 콤보 무관)', () => {
  it('점수 구간별 별 0~3개 — 오름차순이라 항상 연속(구멍 없음)', () => {
    expect(themeStars(0)).toBe(0);
    expect(themeStars(499)).toBe(0);
    expect(themeStars(500)).toBe(1);
    expect(themeStars(999)).toBe(1);
    expect(themeStars(1000)).toBe(2);
    expect(themeStars(1799)).toBe(2);
    expect(themeStars(1800)).toBe(3);
    expect(themeStars(9999)).toBe(3);
  });
});

describe('isThemeUnlocked — 체인 전체(transitive) 해제', () => {
  const byKey = (k) => THEMES.find((t) => t.gameKey === k);
  it('첫 테마(unlock=null)는 항상 열림', () => {
    expect(isThemeUnlocked(TOKEN, byKey('tone-drama'))).toBe(true);
  });
  it('직전이 잠겼으면 중간 stale best가 있어도 뒷 테마 안 열림(건너뛰기 방지)', () => {
    saveBest(TOKEN, 'tone-cooking', { bestScore: 1200 }); // 요리 best만 남음(드라마 0)
    expect(isThemeUnlocked(TOKEN, byKey('tone-cooking'))).toBe(false); // 드라마 0 → 요리 잠김
    expect(isThemeUnlocked(TOKEN, byKey('tone-travel'))).toBe(false);  // 요리 잠김 → 여행 잠김
  });
  it('체인이 모두 충족되면 열림', () => {
    saveBest(TOKEN, 'tone-drama', { bestScore: 800 });
    saveBest(TOKEN, 'tone-cooking', { bestScore: 800 });
    expect(isThemeUnlocked(TOKEN, byKey('tone-cooking'))).toBe(true);
    expect(isThemeUnlocked(TOKEN, byKey('tone-travel'))).toBe(true);
  });
});

describe('clearOrphanThemeBests — 잠긴 테마 유령 기록 정리', () => {
  it('체인상 잠긴 테마의 stale best 제거(열린 건 유지)', () => {
    saveBest(TOKEN, 'tone-cooking', { bestScore: 3243 }); // 드라마 0(잠김)인데 요리 best 남음
    saveBest(TOKEN, 'tone-travel', { bestScore: 2000 });  // 여행도 유령
    expect(clearOrphanThemeBests(TOKEN)).toBe(2);
    expect(themeBestScore(TOKEN, 'tone-cooking')).toBe(0);
    expect(themeBestScore(TOKEN, 'tone-travel')).toBe(0);
  });
  it('정식 해제(체인 충족) 테마 best는 유지', () => {
    saveBest(TOKEN, 'tone-drama', { bestScore: 800 });
    saveBest(TOKEN, 'tone-cooking', { bestScore: 1200 });
    expect(clearOrphanThemeBests(TOKEN)).toBe(0);
    expect(themeBestScore(TOKEN, 'tone-cooking')).toBe(1200);
  });
});
