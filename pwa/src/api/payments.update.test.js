import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePayment } from './payments.js';
import { updatePage } from './notionClient.js';

vi.mock('./notionClient.js', () => ({ queryPage: vi.fn(), queryAll: vi.fn(), createPage: vi.fn(), updatePage: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('결제 메타데이터 PATCH', () => {
  it.each([null, ''])('명시적으로 지운 수단·날짜 %s를 Notion null로 전송한다', async (empty) => {
    await updatePayment('payment', { paymentMethod: empty, paymentDate: empty });
    expect(updatePage).toHaveBeenCalledWith('payment', { 결제수단: { select: null }, 결제일: { date: null } });
  });
  it('필드를 생략한 환불 수정은 기존 수단·날짜를 건드리지 않는다', async () => {
    await updatePayment('payment', { refundAmount: 100000 });
    expect(updatePage).toHaveBeenCalledWith('payment', { '환불 금액': { number: 100000 } });
  });
  it('수단·날짜 값이 있으면 기존 Notion 형식으로 저장한다', async () => {
    await updatePayment('payment', { paymentMethod: '카드', paymentDate: '2026-09-10' });
    expect(updatePage).toHaveBeenCalledWith('payment', { 결제수단: { select: { name: '카드' } }, 결제일: { date: { start: '2026-09-10' } } });
  });
});
