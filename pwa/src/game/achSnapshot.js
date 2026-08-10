// 업적 판정 스냅샷 — 저장소(베스트·스테이지·등급·복습수)에서 achievements.js가 읽는 필드를 모아 만든다.
//
// ★이 파일이 **업적 스냅샷의 유일한 출처**다. 예전엔 ToneGamePage의 종료 이펙트가 같은 집계를 따로 하고 있었고,
//  거기에 `rank`·`perfectStages`가 빠져 있어서 그 필드를 보는 업적 4종(perfect-1/perfect-5/rank-1/rank-2)이
//  **영원히 획득되지 않았다**. 업적 화면은 progress로 달성처럼 보여줘서 증상까지 가려졌다(2026-08-10 검수).
//  → 화면 표시와 적립이 같은 함수를 쓰도록 페이지 밖으로 꺼냈다. 새 업적이 새 필드를 읽게 되면
//    여기에 그 필드를 추가해야 하고, achSnapshot.test.js가 누락을 잡는다.
import { DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';
import { loadBest } from './tgTokens.js';
import { loadEndlessBest, perfectStageCount } from './gameLogic.js';
import { loadRank } from './gameXp.js';
import { loadReviewMastered } from './achievements.js';

// token = 로컬 저장 키(identity.id). masteredN·toneStats·streakLongest는 호출부가 이미 들고 있는 값이라 인자로 받는다.
export function buildAchSnapshot(token, masteredN, toneStats, streakLongest) {
  const bestByDiff = {}; let playCount = 0; let maxComboEver = 0;
  for (const d of DIFFICULTIES) { const b = loadBest(token, d.gameKey); bestByDiff[d.id] = b?.bestScore || 0; playCount += b?.playCount || 0; maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0); }
  const themeRecs = THEMES.map((t) => loadBest(token, t.gameKey));
  for (const b of themeRecs) { playCount += b?.playCount || 0; maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0); }
  const eb = loadEndlessBest(token); const endlessBest = eb?.bestScore || 0;
  playCount += eb?.playCount || 0; maxComboEver = Math.max(maxComboEver, eb?.bestMaxCombo || 0);
  // 승급(rank)·완벽런 스테이지 수 — 2026-08-08 신규 업적(실전/고수 승급, 완벽한 한 판)의 근거.
  //  둘 다 이미 저장돼 있는 값이라 추적 로직 추가 없이 읽기만 한다.
  const perfectStages = DIFFICULTIES.reduce((n, d) => n + perfectStageCount(token, d.id), 0);
  return {
    playCount, maxComboEver, bestByDiff, endlessBest, masteredCount: masteredN,
    bestScoreAny: Math.max(...Object.values(bestByDiff), endlessBest, ...themeRecs.map((b) => b?.bestScore || 0)),
    streakLongest: streakLongest || 0, toneStats: toneStats || {}, reviewMastered: loadReviewMastered(token),
    rank: loadRank(token) || 0, perfectStages,
  };
}
