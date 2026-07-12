// KST 날짜 유틸 테스트 — 과거 KST 버그 이력(월말 누락·타임존 밀림)이 있어 경계값을 고정한다.
// 실행 환경 타임존과 무관해야 하는 함수는 vi.setSystemTime으로 UTC 경계 시각을 줘서 검증.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  KST, todayKST, addMonths, timeToMin, formatDuration,
  toISOLocalKST, toNotionDate, toDatetimeLocal,
  getTodayStart, getMonthStart, getMonthEnd, formatKRW,
} from './dateUtils.js';

afterEach(() => vi.useRealTimers());

describe('KST 상수·todayKST', () => {
  it('KST 단일 출처', () => {
    expect(KST).toBe('Asia/Seoul');
  });
  it('UTC 자정 직전(=KST 오전)에도 KST 날짜를 반환', () => {
    // 2026-07-11 23:30 UTC = 2026-07-12 08:30 KST → todayKST는 12일이어야 함
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T23:30:00Z'));
    expect(todayKST()).toBe('2026-07-12');
  });
  it('KST 자정 직전(=UTC 오후)에는 아직 같은 날', () => {
    // 2026-07-12 14:59 UTC = 2026-07-12 23:59 KST
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T14:59:00Z'));
    expect(todayKST()).toBe('2026-07-12');
  });
});

describe('addMonths — 달력 월 이동', () => {
  it('연도 경계를 넘는 이동', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('여러 달 이동', () => {
    expect(addMonths('2026-07', 6)).toBe('2027-01');
  });
});

describe('getTodayStart / getMonthStart / getMonthEnd — KST 경계 ISO', () => {
  it('월말(31일·30일·2월)을 정확히 계산', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T03:00:00Z')); // KST 7/12 정오
    expect(getMonthStart()).toBe('2026-07-01T00:00:00+09:00');
    expect(getMonthEnd()).toBe('2026-07-31T23:59:59+09:00');

    vi.setSystemTime(new Date('2026-02-10T03:00:00Z')); // 평년 2월
    expect(getMonthEnd()).toBe('2026-02-28T23:59:59+09:00');

    vi.setSystemTime(new Date('2028-02-10T03:00:00Z')); // 윤년 2월
    expect(getMonthEnd()).toBe('2028-02-29T23:59:59+09:00');
  });
  it('UTC 날짜와 KST 날짜가 다른 시각에도 KST 기준', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T20:00:00Z')); // KST 8/1 05:00
    expect(getTodayStart()).toBe('2026-08-01T00:00:00+09:00');
    expect(getMonthStart()).toBe('2026-08-01T00:00:00+09:00');
  });
});

describe('시간 변환 유틸', () => {
  it('timeToMin', () => {
    expect(timeToMin('09:30')).toBe(570);
    expect(timeToMin('00:00')).toBe(0);
  });
  it('formatDuration', () => {
    expect(formatDuration(60)).toBe('1시간');
    expect(formatDuration(90)).toBe('1시간 30분');
  });
  it('toNotionDate — datetime-local → KST 명시 ISO', () => {
    expect(toNotionDate('2026-07-12T14:30')).toBe('2026-07-12T14:30:00+09:00');
    expect(toNotionDate('')).toBeNull();
  });
  it('toISOLocalKST — 로컬 컴포넌트에 +09:00 접미 (기기=KST 가정 함수)', () => {
    const d = new Date(2026, 6, 12, 14, 30); // 로컬 7/12 14:30
    expect(toISOLocalKST(d)).toBe('2026-07-12T14:30:00+09:00');
  });
  it('toDatetimeLocal — KST 24시 표기를 00으로 보정', () => {
    // KST 자정(00:00) = UTC 15:00 전날 — ko-KR formatToParts가 '24'를 낼 수 있는 경계
    expect(toDatetimeLocal('2026-07-12T00:00:00+09:00')).toBe('2026-07-12T00:00');
  });
});

describe('formatKRW', () => {
  it('천 단위 구분 + ₩', () => {
    expect(formatKRW(1234567)).toBe('₩1,234,567');
    expect(formatKRW(0)).toBe('₩0');
    expect(formatKRW(null)).toBe('');
  });
});
