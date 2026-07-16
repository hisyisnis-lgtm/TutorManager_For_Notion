import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeScore, getEndlessTimeLimit, UNLOCK_THRESHOLD, GAMEKEY,
  diffBestScore, isDifficultyUnlocked, isEndlessUnlocked,
  unlockReqText, unlockToastText, bestLabelForKey,
  overallBestFromLocal, overallBestFromServer,
  loadEndlessBest, saveEndlessBest, headlineBest, resolveEndOutcome,
  themeStars,
} from './gameLogic.js';
import { saveBest } from './tgTokens.js';

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

  it('무한은 고급 1000점 달성 시 열림', () => {
    expect(isEndlessUnlocked(TOKEN)).toBe(false);
    saveBest(TOKEN, GAMEKEY.hard, { bestScore: UNLOCK_THRESHOLD });
    expect(isEndlessUnlocked(TOKEN)).toBe(true);
  });

  it('사다리는 한 칸씩만 — 초급만 깨도 고급/무한은 잠김', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 5000 });
    expect(isDifficultyUnlocked(TOKEN, 'normal')).toBe(true);
    expect(isDifficultyUnlocked(TOKEN, 'hard')).toBe(false);
    expect(isEndlessUnlocked(TOKEN)).toBe(false);
  });
});

describe('해제 안내 문구', () => {
  it('unlockReqText / unlockToastText는 난이도별 조건을 안내', () => {
    expect(unlockReqText('normal')).toContain('초급');
    expect(unlockReqText('hard')).toContain('중급');
    expect(unlockReqText('easy')).toBe('');
    expect(unlockToastText('normal')).toContain('초급');
    expect(unlockToastText('hard')).toContain('중급');
  });
});

describe('최고점 라벨 / 통합 최고', () => {
  it('bestLabelForKey는 gameKey를 난이도 라벨로', () => {
    expect(bestLabelForKey('tone-easy')).toBe('초급');
    expect(bestLabelForKey('tone-normal')).toBe('중급');
    expect(bestLabelForKey('tone-hard')).toBe('고급');
    expect(bestLabelForKey('unknown')).toBe('초급'); // 폴백
  });

  it('overallBestFromLocal은 3난이도 중 최고 점수+라벨', () => {
    saveBest(TOKEN, GAMEKEY.easy, { bestScore: 800 });
    saveBest(TOKEN, GAMEKEY.normal, { bestScore: 1500 });
    saveBest(TOKEN, GAMEKEY.hard, { bestScore: 1200 });
    const top = overallBestFromLocal(TOKEN);
    expect(top.bestScore).toBe(1500);
    expect(top.label).toBe('중급');
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
    expect(top.label).toBe('고급');
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
    expect(h.label).toBe('중급');
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
