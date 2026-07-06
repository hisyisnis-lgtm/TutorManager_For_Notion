// gameStore — 회원 동기화 데이터 수집(트림·마스터 수 mc) 회귀 테스트.
// 배경: /game/me는 Notion rich_text 1900자 캡 → 단어 통계는 1500자 예산으로 트림.
// 단어 풀 195+ 시대엔 트림이 상시 발동 → 마스터 단어 통계가 빠져 '마스터 수(등급)'가 기기 간
// 유실될 수 있던 것을 mc 필드로 방어. mc = last-writer(고수위 아님) — 진짜 강등은 전파, 트림 유실만 차단.
// 참조: tone_game_redesign.md (등급 강등 · 히스테리시스)
import { describe, it, expect, beforeEach } from 'vitest';
import { collectLocalGameData, mergeGuestIntoMember, loadMasteredSync, storeMasteredSync } from './gameStore.js';
import { saveWordStats, isMastered } from './tgWordStats.js';
import { saveToneStats, loadToneStats } from './toneStats.js';
import { saveBest, loadBest } from './tgTokens.js';
import { bumpTierPeak, loadTierPeak } from './earProfile.js';
import { saveAchievements, loadAchievements } from './achievements.js';
import { saveStreak, loadStreak, saveFreezes, loadFreezes } from './streak.js';

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
  it('★195단어: words는 1500자 예산 내로 트림되지만 mc는 전체 기준 마스터 수 보존', () => {
    const stats = bigStats();
    saveWordStats('u', stats);
    const data = collectLocalGameData('u');
    expect(JSON.stringify(data.words).length).toBeLessThanOrEqual(1500); // 예산 준수
    expect(Object.keys(data.words).length).toBeLessThan(195);            // 트림 발동 확인
    const fullMastered = Object.values(stats).filter(isMastered).length; // 98
    expect(fullMastered).toBeGreaterThan(0);
    // 트림된 words만으로 세면 마스터 수가 줄어든다(미마스터 우선 보존이라) — mc가 그 손실을 보존
    const trimmedMastered = Object.values(data.words).filter(isMastered).length;
    expect(trimmedMastered).toBeLessThan(fullMastered);
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
