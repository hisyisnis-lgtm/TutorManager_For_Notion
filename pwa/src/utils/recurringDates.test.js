// 반복 수업 날짜 생성 테스트.
// 한 번에 수십 건을 만드는 기능이라 어긋나면 피해가 크고, 되돌리려면 수업을 일일이 지워야 한다.
// 특히 **기기 시간대와 무관하게** 같은 결과가 나오는지가 핵심(CI는 UTC, 강사 기기는 KST).
import { describe, it, expect } from 'vitest';
import { generateRecurringDates } from './recurringDates.js';

// Date → KST 기준 'YYYY-MM-DD HH:MM' (실행 시간대에 영향받지 않게 UTC로 환산해 확인)
const kst = (d) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');

describe('generateRecurringDates', () => {
  it('선택한 요일만 고른다 — 2026-03-02(월)~03-15(일), 월·수', () => {
    const out = generateRecurringDates('2026-03-02', '2026-03-15', [1, 3], '14:30');
    expect(out.map(kst)).toEqual([
      '2026-03-02 14:30', // 월
      '2026-03-04 14:30', // 수
      '2026-03-09 14:30', // 월
      '2026-03-11 14:30', // 수
    ]);
  });

  it('시작일·종료일이 선택 요일이면 둘 다 포함한다(경계)', () => {
    const out = generateRecurringDates('2026-03-02', '2026-03-09', [1], '09:00');
    expect(out.map(kst)).toEqual(['2026-03-02 09:00', '2026-03-09 09:00']);
  });

  it('시각은 KST로 고정된다 — 14:30 KST = 05:30 UTC', () => {
    const [d] = generateRecurringDates('2026-03-02', '2026-03-02', [1], '14:30');
    expect(d.toISOString()).toBe('2026-03-02T05:30:00.000Z');
  });

  it('자정 직전·직후 시각도 날짜가 밀리지 않는다', () => {
    const [late] = generateRecurringDates('2026-03-02', '2026-03-02', [1], '23:55');
    expect(kst(late)).toBe('2026-03-02 23:55');
    const [early] = generateRecurringDates('2026-03-02', '2026-03-02', [1], '00:05');
    expect(kst(early)).toBe('2026-03-02 00:05');
  });

  it('월말을 넘어간다', () => {
    const out = generateRecurringDates('2026-03-30', '2026-04-07', [2], '10:00'); // 화요일
    expect(out.map(kst)).toEqual(['2026-03-31 10:00', '2026-04-07 10:00']);
  });

  it('윤년 2월 29일을 건너뛰지 않는다 (2028년)', () => {
    const out = generateRecurringDates('2028-02-28', '2028-03-01', [0, 1, 2, 3, 4, 5, 6], '10:00');
    expect(out.map(kst)).toEqual(['2028-02-28 10:00', '2028-02-29 10:00', '2028-03-01 10:00']);
  });

  it('여러 요일을 한 번에 고를 수 있다', () => {
    const out = generateRecurringDates('2026-03-02', '2026-03-08', [1, 3, 5], '16:00');
    expect(out).toHaveLength(3); // 월·수·금
  });

  it('종료일이 시작일보다 이르면 빈 목록', () => {
    expect(generateRecurringDates('2026-03-10', '2026-03-01', [1], '10:00')).toEqual([]);
  });

  it('요일 미선택·빈 날짜·빈 시각은 빈 목록', () => {
    expect(generateRecurringDates('2026-03-02', '2026-03-09', [], '10:00')).toEqual([]);
    expect(generateRecurringDates('', '2026-03-09', [1], '10:00')).toEqual([]);
    expect(generateRecurringDates('2026-03-02', '', [1], '10:00')).toEqual([]);
    expect(generateRecurringDates('2026-03-02', '2026-03-09', [1], '')).toEqual([]);
  });

  it('시각 형식이 깨져도 터지지 않고 빈 목록', () => {
    expect(generateRecurringDates('2026-03-02', '2026-03-09', [1], '아무말')).toEqual([]);
  });

  it('범위가 터무니없이 길어도 무한 루프에 빠지지 않는다', () => {
    const out = generateRecurringDates('2026-01-01', '2099-12-31', [1], '10:00');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(800); // MAX_DAYS 상한 안에서 멈춘다
  });
});
