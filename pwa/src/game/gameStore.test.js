// gameStore — 회원 동기화 데이터 수집(트림·마스터 수 mc) 회귀 테스트.
// 배경: /game/me는 Notion rich_text 1900자 캡 → 단어 통계는 1500자 예산으로 트림.
// 단어 풀 195+ 시대엔 트림이 상시 발동 → 마스터 단어 통계가 빠져 '마스터 수(등급)'가 기기 간
// 유실될 수 있던 것을 mc 필드로 방어. mc = last-writer(고수위 아님) — 진짜 강등은 전파, 트림 유실만 차단.
// 참조: tone_game_redesign.md (등급 강등 · 히스테리시스)
import { describe, it, expect, beforeEach } from 'vitest';
import { collectLocalGameData, loadMasteredSync, storeMasteredSync } from './gameStore.js';
import { saveWordStats, isMastered } from './tgWordStats.js';

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
