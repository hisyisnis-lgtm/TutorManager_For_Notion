import { describe, it, expect, beforeEach } from 'vitest';
import {
  dateKeyKST, diffDays, advanceStreak, effectiveCurrent,
  loadStreak, saveStreak, recordPlay, loadFreezes, saveFreezes,
} from './streak.js';

beforeEach(() => { localStorage.clear(); });

describe('dateKeyKST — KST 날짜 경계', () => {
  it('UTC 자정 직전(한국 오전 9시 직전)도 같은 KST 날짜', () => {
    // 2026-06-13T14:00:00Z = KST 2026-06-13 23:00 → '2026-06-13'
    expect(dateKeyKST(new Date('2026-06-13T14:00:00Z'))).toBe('2026-06-13');
  });
  it('UTC 16:00(KST 익일 01:00)은 한국 기준 다음날', () => {
    // 2026-06-13T16:00:00Z = KST 2026-06-14 01:00 → '2026-06-14'
    expect(dateKeyKST(new Date('2026-06-13T16:00:00Z'))).toBe('2026-06-14');
  });
});

describe('diffDays', () => {
  it('같은 날 0, 다음날 1, 사흘 뒤 3', () => {
    expect(diffDays('2026-06-13', '2026-06-13')).toBe(0);
    expect(diffDays('2026-06-13', '2026-06-14')).toBe(1);
    expect(diffDays('2026-06-13', '2026-06-16')).toBe(3);
  });
  it('월 경계도 정확', () => {
    expect(diffDays('2026-06-30', '2026-07-01')).toBe(1);
  });
});

describe('advanceStreak — 순수 전이', () => {
  it('첫 플레이는 current 1, longest 1', () => {
    expect(advanceStreak(null, '2026-06-13')).toEqual({ lastDate: '2026-06-13', current: 1, longest: 1 });
  });
  it('같은 날 재플레이는 변화 없음', () => {
    const prev = { lastDate: '2026-06-13', current: 3, longest: 5 };
    expect(advanceStreak(prev, '2026-06-13')).toEqual(prev);
  });
  it('바로 다음날이면 +1', () => {
    const prev = { lastDate: '2026-06-13', current: 3, longest: 5 };
    expect(advanceStreak(prev, '2026-06-14')).toEqual({ lastDate: '2026-06-14', current: 4, longest: 5 });
  });
  it('하루 이상 공백이면 1로 리셋(끊김)', () => {
    const prev = { lastDate: '2026-06-13', current: 9, longest: 9 };
    expect(advanceStreak(prev, '2026-06-15')).toEqual({ lastDate: '2026-06-15', current: 1, longest: 9 });
  });
  it('연속 갱신 시 longest가 current를 따라 올라간다', () => {
    let s = advanceStreak(null, '2026-06-13');        // 1
    s = advanceStreak(s, '2026-06-14');               // 2
    s = advanceStreak(s, '2026-06-15');               // 3
    expect(s).toEqual({ lastDate: '2026-06-15', current: 3, longest: 3 });
  });
});

describe('effectiveCurrent — 표시용 유효 스트릭', () => {
  it('오늘 플레이했으면 저장된 current', () => {
    expect(effectiveCurrent({ lastDate: '2026-06-13', current: 4 }, '2026-06-13')).toBe(4);
  });
  it('마지막이 어제면 아직 살아있음(오늘 채우면 이어짐)', () => {
    expect(effectiveCurrent({ lastDate: '2026-06-13', current: 4 }, '2026-06-14')).toBe(4);
  });
  it('마지막이 이틀 전이면 끊겨서 0', () => {
    expect(effectiveCurrent({ lastDate: '2026-06-13', current: 4 }, '2026-06-15')).toBe(0);
  });
  it('기록 없으면 0', () => {
    expect(effectiveCurrent(null, '2026-06-13')).toBe(0);
  });
});

describe('recordPlay — load/advance/save 라운드트립', () => {
  it('첫 호출은 1, 다음날 호출은 2', () => {
    const day1 = recordPlay('u', new Date('2026-06-13T03:00:00Z'));
    expect(day1.current).toBe(1);
    const day2 = recordPlay('u', new Date('2026-06-14T03:00:00Z'));
    expect(day2.current).toBe(2);
    expect(loadStreak('u').current).toBe(2);
  });
  it('같은 날 두 번 플레이해도 1 유지', () => {
    recordPlay('u', new Date('2026-06-13T01:00:00Z'));
    const again = recordPlay('u', new Date('2026-06-13T10:00:00Z'));
    expect(again.current).toBe(1);
  });
  it('깨진 저장값은 첫 플레이로 안전 처리', () => {
    localStorage.setItem('game_streak_u', '{broken');
    expect(loadStreak('u')).toBe(null);
    expect(recordPlay('u', new Date('2026-06-13T03:00:00Z')).current).toBe(1);
  });
});

describe('advanceStreak — 보호권 브릿지', () => {
  const prev = { lastDate: '2026-06-13', current: 5, longest: 5 };
  it('하루 공백 + 보호권 1개면 이어짐(+1)', () => {
    expect(advanceStreak(prev, '2026-06-15', 1)).toEqual({ lastDate: '2026-06-15', current: 6, longest: 6 });
  });
  it('하루 공백 + 보호권 0개면 리셋', () => {
    expect(advanceStreak(prev, '2026-06-15', 0)).toEqual({ lastDate: '2026-06-15', current: 1, longest: 5 });
  });
  it('이틀 공백 + 보호권 2개면 이어짐', () => {
    expect(advanceStreak(prev, '2026-06-16', 2)).toEqual({ lastDate: '2026-06-16', current: 6, longest: 6 });
  });
  it('이틀 공백 + 보호권 1개면 리셋(부족)', () => {
    expect(advanceStreak(prev, '2026-06-16', 1)).toEqual({ lastDate: '2026-06-16', current: 1, longest: 5 });
  });
  it('시계 역행(과거 날짜)은 무변화', () => {
    expect(advanceStreak(prev, '2026-06-12', 2)).toEqual(prev);
  });
});

describe('effectiveCurrent — 보호권 반영', () => {
  const state = { lastDate: '2026-06-13', current: 5 };
  it('하루 공백 + 보호권 있으면 살아있음', () => {
    expect(effectiveCurrent(state, '2026-06-15', 1)).toBe(5);
  });
  it('하루 공백 + 보호권 0이면 0', () => {
    expect(effectiveCurrent(state, '2026-06-15', 0)).toBe(0);
  });
  it('이틀 공백 + 보호권 2면 살아있음', () => {
    expect(effectiveCurrent(state, '2026-06-16', 2)).toBe(5);
  });
  it('사흘 공백은 보호권 2로도 못 지킴(0)', () => {
    expect(effectiveCurrent(state, '2026-06-17', 2)).toBe(0);
  });
});

describe('recordPlay — 보호권 획득/소비', () => {
  it('7일 연속 도달 시 보호권 +1', () => {
    let d = new Date('2026-06-13T03:00:00Z');
    for (let i = 0; i < 6; i++) { recordPlay('u', d); d = new Date(d.getTime() + 86400000); }
    expect(loadFreezes('u')).toBe(0);           // 아직 6일
    const seventh = recordPlay('u', d);          // 7일째
    expect(seventh.current).toBe(7);
    expect(seventh.freezeEarned).toBe(1);
    expect(loadFreezes('u')).toBe(1);
  });
  it('공백을 보호권으로 메우면 소비되고 스트릭 이어짐', () => {
    saveStreak('u', { lastDate: '2026-06-13', current: 4, longest: 4 });
    saveFreezes('u', 1);
    const r = recordPlay('u', new Date('2026-06-15T03:00:00Z')); // 하루 공백
    expect(r.current).toBe(5);
    expect(r.freezeUsed).toBe(1);
    expect(loadFreezes('u')).toBe(0);
  });
  it('보호권 없이 공백이면 리셋(소비 0)', () => {
    saveStreak('u', { lastDate: '2026-06-13', current: 9, longest: 9 });
    saveFreezes('u', 0);
    const r = recordPlay('u', new Date('2026-06-15T03:00:00Z'));
    expect(r.current).toBe(1);
    expect(r.freezeUsed).toBe(0);
  });
  it('보유 상한(2) 초과 획득은 버려짐', () => {
    saveStreak('u', { lastDate: '2026-06-13', current: 13, longest: 13 });
    saveFreezes('u', 2);
    const r = recordPlay('u', new Date('2026-06-14T03:00:00Z')); // 14일째
    expect(r.current).toBe(14);
    expect(r.freezeEarned).toBe(0);
    expect(loadFreezes('u')).toBe(2);
  });
});
