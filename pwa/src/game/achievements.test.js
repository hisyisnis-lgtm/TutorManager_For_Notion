import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACHIEVEMENTS, achievementById, evaluateAchievements,
  loadAchievements, saveAchievements, syncAchievements,
  loadReviewMastered, addReviewMastered,
} from './achievements.js';
import { TONE_NUMS } from './toneStats.js';

beforeEach(() => { localStorage.clear(); });

// 모든 성조 정답률 100%인 toneStats 헬퍼
const perfectTones = () => Object.fromEntries(TONE_NUMS.map((t) => [t, [10, 10]]));

describe('업적 정의 무결성', () => {
  it('id 중복 없음, 필수 필드 존재', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.label).toBeTruthy();
      expect(a.desc).toBeTruthy();
      expect(typeof a.check).toBe('function');
    }
  });
  it('achievementById 조회', () => {
    expect(achievementById('first-play').label).toBe('첫걸음');
    expect(achievementById('nope')).toBe(null);
  });
});

describe('evaluateAchievements — 스냅샷 판정', () => {
  it('빈 스냅샷은 아무것도 달성 안 함', () => {
    expect(evaluateAchievements({})).toEqual([]);
  });

  it('첫 완주 + 천 점 + 콤보10', () => {
    const ids = evaluateAchievements({ playCount: 1, bestScoreAny: 1200, maxComboEver: 12 });
    expect(ids).toContain('first-play');
    expect(ids).toContain('score-1000');
    expect(ids).toContain('combo-10');
    expect(ids).not.toContain('combo-20');
  });

  it('잠금해제 업적은 직전 난이도 1000점 기준', () => {
    const ids = evaluateAchievements({ bestByDiff: { easy: 1000, normal: 1000, hard: 0 } });
    expect(ids).toContain('unlock-normal'); // 초급 1000 → 중급 열림
    expect(ids).toContain('unlock-hard');   // 중급 1000 → 고급 열림
    expect(ids).not.toContain('unlock-endless'); // 고급 0
  });

  it('마스터 단어 수 업적', () => {
    expect(evaluateAchievements({ masteredCount: 10 })).toContain('master-10');
    expect(evaluateAchievements({ masteredCount: 30 })).toContain('master-30');
    expect(evaluateAchievements({ masteredCount: 9 })).not.toContain('master-10');
  });

  it('스트릭은 longest 기준', () => {
    expect(evaluateAchievements({ streakLongest: 3 })).toContain('streak-3');
    expect(evaluateAchievements({ streakLongest: 7 })).toContain('streak-7');
    expect(evaluateAchievements({ streakLongest: 2 })).not.toContain('streak-3');
  });

  it('성조 감별사 — 전 성조 90%+ & 시도 충분', () => {
    expect(evaluateAchievements({ toneStats: perfectTones() })).toContain('tone-master');
    const weak = perfectTones(); weak[3] = [6, 10]; // 3성 60%
    expect(evaluateAchievements({ toneStats: weak })).not.toContain('tone-master');
  });

  it('복습의 힘 — 복습으로 마스터한 단어 5개 누적', () => {
    expect(evaluateAchievements({ reviewMastered: 5 })).toContain('review-master-5');
    expect(evaluateAchievements({ reviewMastered: 4 })).not.toContain('review-master-5');
  });
});

describe('복습 성과 카운터 — loadReviewMastered / addReviewMastered', () => {
  it('초기 0, 증가분 누적', () => {
    expect(loadReviewMastered('u')).toBe(0);
    expect(addReviewMastered('u', 2)).toBe(2);
    expect(addReviewMastered('u', 3)).toBe(5);
    expect(loadReviewMastered('u')).toBe(5);
  });
  it('음수·소수 증가분은 무시(0으로 클램프·정수화)', () => {
    addReviewMastered('u', -3);
    expect(loadReviewMastered('u')).toBe(0);
  });
  it('깨진 저장값은 0으로', () => {
    localStorage.setItem('game_review_mastered_u', 'abc');
    expect(loadReviewMastered('u')).toBe(0);
  });
});

describe('syncAchievements — 평가→저장, 새 달성 반환', () => {
  it('첫 동기화는 달성분을 저장하고 새 목록 반환', () => {
    const fresh = syncAchievements('u', { playCount: 1, bestScoreAny: 1200 });
    expect(fresh.sort()).toEqual(['first-play', 'score-1000'].sort());
    expect(loadAchievements('u').sort()).toEqual(['first-play', 'score-1000'].sort());
  });

  it('두 번째 동기화에서 새로 달성한 것만 fresh로', () => {
    syncAchievements('u', { playCount: 1 }); // first-play 저장
    const fresh = syncAchievements('u', { playCount: 1, bestScoreAny: 1000 });
    expect(fresh).toEqual(['score-1000']);
  });

  it('새 달성 없으면 빈 배열 + 저장 변화 없음', () => {
    saveAchievements('u', ['first-play']);
    expect(syncAchievements('u', { playCount: 1 })).toEqual([]);
    expect(loadAchievements('u')).toEqual(['first-play']);
  });

  it('이미 달성한 업적은 데이터가 후퇴해도 유지(누적 합집합)', () => {
    syncAchievements('u', { masteredCount: 30 }); // master-10, master-30
    // 이후 스냅샷에서 masteredCount가 낮아도(이상 케이스) 기존 달성은 보존
    syncAchievements('u', { masteredCount: 0, playCount: 1 });
    const all = loadAchievements('u');
    expect(all).toContain('master-30');
    expect(all).toContain('first-play');
  });
});
