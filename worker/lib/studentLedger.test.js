import { describe, expect, it, vi } from 'vitest';
import { buildStudentLedger, queryStudentTimePages } from './studentLedger.js';

export const payment = (id, hours, effective, extra = {}) => ({ id, properties: {
  '시간 회차': { number: hours }, '유효 시간 회차': { formula: { number: effective } },
  '결제 상태': { formula: { string: '🟢완료' } }, '결제일': { date: { start: '2026-09-01' } }, ...extra,
} });
export const lesson = (id, hours, date = '2026-09-09T12:00:00+09:00', extra = {}) => ({ id, properties: {
  '시간 회차': { formula: { number: hours } }, '수업 일시': { date: date ? { start: date } : null },
  '수업 시간(분)': { select: { name: '60' } }, '무료 수업': { rollup: { number: 1 } }, ...extra,
} });
const build = (payments = [], classes = [], used = 0) => buildStudentLedger({ payments, classes,
  studentProps: { '사용 시간 회차': { rollup: { number: used } } }, asOf: '2026-09-10T00:00:00Z' });

describe('현재 기록 기준 학생 시간 명세', () => {
  it('예정 포함 잔여와 강사 기준 예약 가능 시간을 구분하고 음수를 보존한다', () => {
    const ledger = build([payment('p', 2, 2)], [lesson('past', 1), lesson('future', 2, '2026-09-11')], 3);
    expect(ledger.status).toBe('matched');
    expect(ledger.summary).toMatchObject({ creditedHours: 2, completedHours: 1, scheduledHours: 2, availableHours: -1, remainingHours: 1, differenceHours: 0 });
  });
  it('할인 후 환불 formula를 따르며 미납 감소를 환불로 꾸미지 않는다', () => {
    const ledger = build([
      payment('discount-refund', 10, 4, { '실제 결제 금액': { number: 450000 }, '환불 금액': { number: 250000 },
        '시간당 단가': { rollup: { number: 50000 } }, '환불일': { date: { start: '2026-09-09' } }, '메모': { rich_text: [{ plain_text: 'internal-secret' }] } }),
      payment('pending', 3, 0, { '결제 상태': { formula: { string: '🔴미완료' } } }),
      payment('unpaid-refund', 2, 0, { '결제 상태': { formula: { string: '⬛미결제' } }, '환불 금액': { number: 1 }, '환불일': { date: { start: '2026-09-09' } } }),
    ], [lesson('used', 3)], 3);
    expect(ledger.summary.remainingHours).toBe(1);
    expect(ledger.rows.find(row => row.id === 'discount-refund')).toMatchObject({ reductionKind: 'refund', reductionHours: 6, effectiveHours: 4 });
    expect(ledger.rows.find(row => row.id === 'pending').reductionKind).toBe('unreflected');
    expect(ledger.rows.find(row => row.id === 'unpaid-refund').reductionKind).toBe('unreflected');
    expect(JSON.stringify(ledger)).not.toMatch(/450000|250000|50000|internal-secret|실제 결제|메모/);
  });
  it('취소·보강·무료는 formula 0을 쓰고 결석은 기존 유효 차감을 유지한다', () => {
    const ledger = build([payment('p', 5, 5)], [
      lesson('cancel', 0, undefined, { '특이사항': { select: { name: '🚫 취소' } } }),
      lesson('makeup', 0, undefined, { '특이사항': { select: { name: '🟠 보강' } } }),
      lesson('free', 0, undefined, { '무료 수업': { rollup: { number: 0 } } }),
      lesson('absent', 1.5, undefined, { '특이사항': { select: { name: '🔴 결석' } } }),
    ], 1.5);
    expect(ledger.summary).toMatchObject({ completedHours: 1.5, remainingHours: 3.5 });
    expect(ledger.status).toBe('matched');
  });
  it('과거 기록 불일치는 드러내되 이월이나 조정 행을 생성하지 않는다', () => {
    const ledger = build([payment('p', 5, 5)], [lesson('known', 1)], 3);
    expect(ledger.issues).toContain('usage_mismatch');
    expect(ledger.summary).toMatchObject({ availableHours: 2, remainingHours: 2, differenceHours: 2 });
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows.every(row => ['class', 'payment'].includes(row.kind))).toBe(true);
  });
  it('날짜 없는 차감은 예정/사용으로 추측하지 않으며 알려진 예약 가능 값은 보존한다', () => {
    const ledger = build([payment('p', 4, 4, { '결제일': { date: null } })], [lesson('undated', 1, null)], 1);
    expect(ledger.issues).toContain('missing_dates');
    expect(ledger.summary).toMatchObject({ availableHours: 3, scheduledHours: null, completedHours: null, remainingHours: null });
    expect(ledger.rows.every(row => row.date === null)).toBe(true);
  });
  it('누락 수치와 근거 없는 감소는 0 또는 환불 성공으로 위장하지 않는다', () => {
    const missing = build([payment('p', 4, null)], [lesson('c', null)], null);
    expect(missing.summary).toMatchObject({ creditedHours: null, availableHours: null, remainingHours: null });
    expect(missing.status).toBe('needs_review');
    const unknown = build([payment('unknown', 4, 2)]);
    expect(unknown.rows[0].reductionKind).toBe('unknown');
    expect(unknown.issues).toContain('payment_unconfirmed');
  });
  it('시작 시각 경계와 소수 합계는 반올림 전 값으로 계산한다', () => {
    const ledger = build([payment('p', 1, 1)], [lesson('a', 1 / 3, '2026-09-10T00:00:00Z'), lesson('b', 1 / 3, '2026-09-10T00:00:00.001Z')], 2 / 3);
    expect(ledger.summary.completedHours).toBe(1 / 3);
    expect(ledger.summary.remainingHours).toBeCloseTo(2 / 3);
    expect(ledger.status).toBe('matched');
  });
  it('100건 이후에도 본인 relation 필터를 유지하며 모두 읽는다', async () => {
    const n = vi.fn().mockResolvedValueOnce({ results: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` })), has_more: true, next_cursor: 'second' })
      .mockResolvedValueOnce({ results: [{ id: 'last' }], has_more: false });
    expect(await queryStudentTimePages(n, 'db', 'student')).toHaveLength(101);
    expect(n.mock.calls[1]).toEqual(['POST', '/databases/db/query', { filter: { property: '학생', relation: { contains: 'student' } }, page_size: 100, start_cursor: 'second' }]);
  });
  it('Notion 오류·누락 cursor·반복 페이지가 합계 성공으로 처리되지 않는다', async () => {
    for (const data of [{ object: 'error' }, { results: [], has_more: true }, { results: [{ id: 'same' }, { id: 'same' }], has_more: false }]) {
      await expect(queryStudentTimePages(vi.fn(async () => data), 'db', 'student')).rejects.toThrow('모두 확인');
    }
    await expect(queryStudentTimePages(vi.fn(async () => ({ results: [], has_more: true, next_cursor: 'same' })), 'db', 'student')).rejects.toThrow('모두 확인');
  });
});
