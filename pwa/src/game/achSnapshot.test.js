// 업적 스냅샷 회귀 테스트 (2026-08-10 검수에서 나온 버그의 재발 방지)
//
// 원 버그: 종료 이펙트가 스냅샷을 따로 집계하면서 `rank`·`perfectStages`를 빠뜨려
//  perfect-1 / perfect-5 / rank-1 / rank-2 네 업적이 **영원히 획득되지 않았다**.
//  업적 화면은 progress()로 달성처럼 보여줘서 증상까지 가려졌다.
//
// 이 테스트의 핵심은 아래 '모든 업적 달성 가능' 케이스다 — 저장소를 만점 상태로 채웠을 때
// buildAchSnapshot이 만든 스냅샷만으로 ACHIEVEMENTS 전부가 달성돼야 한다.
// 새 업적이 스냅샷에 없는 필드를 읽기 시작하면 여기서 바로 깨진다.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAchSnapshot } from './achSnapshot.js';
import { ACHIEVEMENTS, evaluateAchievements } from './achievements.js';
import { DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';
import { saveBest } from './tgTokens.js';
import { saveEndlessBest, STAGES, saveStageScore, stageStarScores } from './gameLogic.js';
import { saveRank } from './gameXp.js';
import { addReviewMastered } from './achievements.js';

const TOKEN = 'ach-snap-user';
beforeEach(() => { localStorage.clear(); });

// 모든 성조를 만점으로 — tone-3 / tone-master 업적용([정답, 시도, ema])
const PERFECT_TONES = { 1: [50, 50, 1], 2: [50, 50, 1], 3: [50, 50, 1], 4: [50, 50, 1], 0: [50, 50, 1] };

// 저장소를 '전 업적 달성' 상태로 채운다.
function seedEverything() {
  for (const d of DIFFICULTIES) saveBest(TOKEN, d.gameKey, { bestScore: 9999, bestMaxCombo: 40, playCount: 30 });
  for (const t of THEMES) saveBest(TOKEN, t.gameKey, { bestScore: 5000, bestMaxCombo: 40, playCount: 10 });
  saveEndlessBest(TOKEN, { bestScore: 9999, bestMaxCombo: 40, playCount: 10 });
  // 완벽런(별 3개) 스테이지 — perfect-1 / perfect-5
  for (const s of STAGES) saveStageScore(TOKEN, s.id, stageStarScores(s.timeMultiplier)[2] + 1);
  saveRank(TOKEN, 2);                 // rank-1 / rank-2 (실전·고수 승급)
  addReviewMastered(TOKEN, 50);       // review-master-5 / review-master-20
}

describe('buildAchSnapshot — 업적이 읽는 필드를 빠짐없이 만든다', () => {
  it('★모든 업적이 이 스냅샷만으로 달성 가능해야 한다 (필드 누락 = 영구 미획득 버그)', () => {
    seedEverything();
    const snap = buildAchSnapshot(TOKEN, 100, PERFECT_TONES, 60);
    const earned = evaluateAchievements(snap);
    const missing = ACHIEVEMENTS.map((a) => a.id).filter((id) => !earned.includes(id));
    expect(missing).toEqual([]);
  });

  it('rank를 담는다 — 승급 업적(rank-1/rank-2)의 근거', () => {
    saveRank(TOKEN, 2);
    expect(buildAchSnapshot(TOKEN, 0, {}, 0).rank).toBe(2);
  });

  it('perfectStages를 담는다 — 완벽런 업적(perfect-1/perfect-5)의 근거', () => {
    const s = STAGES[0];
    saveStageScore(TOKEN, s.id, stageStarScores(s.timeMultiplier)[2] + 1); // 별 3개
    expect(buildAchSnapshot(TOKEN, 0, {}, 0).perfectStages).toBe(1);
  });

  it('playCount·maxComboEver는 난이도+테마+무한을 모두 합산한다', () => {
    saveBest(TOKEN, DIFFICULTIES[0].gameKey, { bestScore: 100, bestMaxCombo: 5, playCount: 3 });
    saveBest(TOKEN, THEMES[0].gameKey, { bestScore: 100, bestMaxCombo: 11, playCount: 4 });
    saveEndlessBest(TOKEN, { bestScore: 100, bestMaxCombo: 7, playCount: 2 });
    const snap = buildAchSnapshot(TOKEN, 0, {}, 0);
    expect(snap.playCount).toBe(9);
    expect(snap.maxComboEver).toBe(11); // 테마 기록도 콤보 업적에 반영
  });

  it('bestScoreAny는 테마 점수도 포함한다 (테마 1,500점이 천 점 클럽에 안 잡히던 불일치)', () => {
    saveBest(TOKEN, THEMES[0].gameKey, { bestScore: 1500 });
    expect(buildAchSnapshot(TOKEN, 0, {}, 0).bestScoreAny).toBe(1500);
  });

  it('기록이 하나도 없으면 전부 0 — bestScoreAny가 -Infinity로 새지 않는다', () => {
    const snap = buildAchSnapshot(TOKEN, 0, {}, 0);
    expect(snap.bestScoreAny).toBe(0);
    expect(snap.playCount).toBe(0);
    expect(snap.rank).toBe(0);
    expect(snap.perfectStages).toBe(0);
  });
});
