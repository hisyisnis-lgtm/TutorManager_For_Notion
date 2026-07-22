// gameStore — 회원 동기화 데이터 수집(예산·마스터 수 mc) 회귀 테스트.
// 배경: /game/me 저장소가 Notion rich_text(1900자) → D1 game_data TEXT(100KB)로 이전(2026-07-06)되며
// 예산이 대폭 완화(88KB)돼 트림은 사실상 미발동. trimWords 메커니즘은 극단 안전장치로 코드에 유지.
// mc = 트림 대비 마스터 수 보존 안전장치(last-writer, 고수위 아님) — 진짜 강등은 전파, 트림 유실만 차단.
// 참조: tone_game_redesign.md (등급 강등 · 히스테리시스)
import { describe, it, expect, beforeEach } from 'vitest';
import { collectLocalGameData, mergeGuestIntoMember, loadMasteredSync, storeMasteredSync } from './gameStore.js';
import { saveWordStats, isMastered } from './tgWordStats.js';
import { saveToneStats, loadToneStats } from './toneStats.js';
import { saveBest, loadBest } from './tgTokens.js';
import { bumpTierPeak, loadTierPeak } from './earProfile.js';
import { saveAchievements, loadAchievements } from './achievements.js';
import { saveStreak, loadStreak, saveFreezes, loadFreezes } from './streak.js';
import { saveStageScore, stageScoreOf } from './gameLogic.js';

beforeEach(() => { localStorage.clear(); });

// 195단어 통계 샘플 — 짝수=마스터(무실수 100%), 홀수=미마스터(40%)
function bigStats(n = 195) {
  const stats = {};
  for (let i = 0; i < n; i++) {
    const hz = String.fromCharCode(0x4e00 + i) + String.fromCharCode(0x4e00 + 300 + i);
    stats[hz] = i % 2 === 0 ? [5, 5, 9000, 5] : [5, 2, 9000, 5]; // [시도,무실수,소요합,완료수]
  }
  return stats;
}

describe('collectLocalGameData — 트림 + 마스터 수 고수위(mc)', () => {
  it('★195단어: D1 이전으로 예산 대폭 완화(88KB) → 트림 없이 전부 보존 + mc = 전체 마스터 수', () => {
    const stats = bigStats();
    saveWordStats('u', stats);
    const data = collectLocalGameData('u');
    const fullMastered = Object.values(stats).filter(isMastered).length; // 98
    expect(fullMastered).toBeGreaterThan(0);
    // D1(game_data TEXT, 100KB)로 이전 → 195단어(수천 자)는 예산 안이라 트림 미발동: 전부 보존
    expect(Object.keys(data.words).length).toBe(195);
    expect(Object.values(data.words).filter(isMastered).length).toBe(fullMastered);
    // mc(트림돼도 마스터 수 보존하는 안전장치)는 여전히 전체 통계 기준으로 정확 — 트림 안 돼도 값 동일
    expect(data.mc).toBe(fullMastered);
    expect(loadMasteredSync('u')).toBe(fullMastered); // 수집 시 동기화 값도 갱신
  });

  it('예산 이하 소량 통계는 트림 없이 그대로 + mc 포함', () => {
    saveWordStats('u', { 好: [3, 3, 4000, 3], 妈妈: [2, 0, 5000, 2] });
    const data = collectLocalGameData('u');
    expect(Object.keys(data.words).length).toBe(2);
    expect(data.mc).toBe(1); // 好만 마스터
  });
});

describe('collectLocalGameData — 베스트 외 진행도 전부 포함(성조·테마·등급·업적·스트릭)', () => {
  it('성조별 정확도·테마 베스트·최고 등급·업적·복습마스터수·스트릭·프리즈가 수집 블롭에 담긴다', () => {
    saveToneStats('u', { 1: [8, 10, 0.82], 2: [5, 5, 0.9], 3: [0, 0] }); // 시도 0(3성)은 생략됨
    saveBest('u', 'tone-drama', { bestScore: 1234, bestMaxCombo: 9, bestAvgMs: 800, playCount: 3, updatedAt: 1 });
    bumpTierPeak('u', 2);
    saveAchievements('u', ['first-play', 'score-1000']);
    saveStreak('u', { lastDate: '2026-07-06', current: 4, longest: 7 });
    saveFreezes('u', 2);
    const data = collectLocalGameData('u');
    expect(data.tone[1]).toEqual([8, 10, 0.82]);
    expect(data.tone[3]).toBeUndefined();               // 시도 0 성조 생략
    expect(data.best['tone-drama']?.bestScore).toBe(1234); // 테마 베스트 포함
    expect(data.tier).toBe(2);
    expect(data.ach).toEqual(['first-play', 'score-1000']);
    expect(data.streak).toEqual({ lastDate: '2026-07-06', current: 4, longest: 7 });
    expect(data.frz).toBe(2);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(1900); // 서버 저장 한도 준수
  });
});

describe('mergeGuestIntoMember — 게스트로 쌓은 기록이 회원 로컬로 넘어온다(카카오·구글 공통 경로)', () => {
  it('로그인 안 하고 게스트로 쌓은 성조 정확도·테마 점수·등급·업적·스트릭이 회원 쪽에 병합', () => {
    localStorage.setItem('tg_guest_id', 'g_x');
    saveToneStats('g_x', { 1: [9, 10, 0.88], 4: [3, 6, 0.5] });
    saveBest('g_x', 'tone-travel', { bestScore: 2000, bestMaxCombo: 12, bestAvgMs: 700, playCount: 5, updatedAt: 1 });
    bumpTierPeak('g_x', 3);
    saveAchievements('g_x', ['first-play', 'combo-10']);
    saveStreak('g_x', { lastDate: '2026-07-06', current: 6, longest: 6 });
    saveFreezes('g_x', 1);

    const member = { kind: 'member', id: 'm_1' };
    saveAchievements('m_1', ['first-play']); // 회원엔 일부만 — 합집합 확인용
    mergeGuestIntoMember(member);

    expect(loadToneStats('m_1')[1]).toEqual([9, 10, 0.88]);     // 성조별 정확도 이관
    expect(loadBest('m_1', 'tone-travel')?.bestScore).toBe(2000); // 테마 베스트 이관
    expect(loadTierPeak('m_1')).toBe(3);                        // 최고 등급 이관
    expect(loadAchievements('m_1').sort()).toEqual(['combo-10', 'first-play']); // 업적 합집합
    expect(loadStreak('m_1')).toEqual({ lastDate: '2026-07-06', current: 6, longest: 6 });
    expect(loadFreezes('m_1')).toBe(1);
  });
});

describe('스테이지 최고점(stg) — 급 내 스테이지 해제·별·등급 근거의 동기화(2026-07-21)', () => {
  it('collectLocalGameData가 스테이지 점수를 stg로 담고, 게스트→회원 병합 시 id별 max로 이관', () => {
    localStorage.setItem('tg_guest_id', 'g_stg');
    saveStageScore('g_stg', 'easy-1', 500);
    saveStageScore('g_stg', 'easy-2', 800);
    const data = collectLocalGameData('g_stg');
    expect(data.stg).toEqual({ 'easy-1': 500, 'easy-2': 800 }); // 수집 블롭에 포함

    const member = { kind: 'member', id: 'm_stg' };
    saveStageScore('m_stg', 'easy-1', 300);  // 회원엔 더 낮은 값 — max 병합 확인용
    mergeGuestIntoMember(member);
    expect(stageScoreOf('m_stg', 'easy-1')).toBe(500); // max(300,500)
    expect(stageScoreOf('m_stg', 'easy-2')).toBe(800); // 신규 이관
  });
});

describe('스트릭 병합 — 연속일 이어달리기(2026-07-21)', () => {
  it('회원{어제,30} + 게스트{오늘,1} 병합 = {오늘,31} (하루 이어 뛴 것으로 인식)', () => {
    localStorage.setItem('tg_guest_id', 'g_str');
    saveStreak('g_str', { lastDate: '2026-07-21', current: 1, longest: 1 });
    const member = { kind: 'member', id: 'm_str' };
    saveStreak('m_str', { lastDate: '2026-07-20', current: 30, longest: 30 });
    mergeGuestIntoMember(member);
    expect(loadStreak('m_str')).toEqual({ lastDate: '2026-07-21', current: 31, longest: 31 });
  });
  it('이틀 이상 공백이면 끊김 — 최근 기록의 current 그대로(부활 아님)', () => {
    localStorage.setItem('tg_guest_id', 'g_gap');
    saveStreak('g_gap', { lastDate: '2026-07-21', current: 1, longest: 1 });
    const member = { kind: 'member', id: 'm_gap' };
    saveStreak('m_gap', { lastDate: '2026-07-18', current: 30, longest: 30 });
    mergeGuestIntoMember(member);
    expect(loadStreak('m_gap')).toEqual({ lastDate: '2026-07-21', current: 1, longest: 30 });
  });
});

describe('마스터 수 동기화 값(mc) — last-writer(강등 전파, 고수위 아님)', () => {
  it('낮은 값으로도 덮어써짐 — 진짜 실력 하락(마스터 해제)이 기기 간 전파돼야 함', () => {
    expect(storeMasteredSync('u', 12)).toBe(12);
    expect(storeMasteredSync('u', 7)).toBe(7); // ★강등 전파(고수위였다면 12 유지 — 폐기된 동작)
    expect(loadMasteredSync('u')).toBe(7);
    expect(storeMasteredSync('u', 20)).toBe(20);
  });
  it('음수는 0으로 클램프, 깨진 저장값은 0으로', () => {
    expect(storeMasteredSync('u', -3)).toBe(0);
    localStorage.setItem('game_mastered_sync_u', 'abc');
    expect(loadMasteredSync('u')).toBe(0);
  });
});
