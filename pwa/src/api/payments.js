import { queryPage, createPage, updatePage } from './notionClient.js';

export const PAYMENTS_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';

export const PAYMENT_METHODS = [
  '카드',
  '계좌이체(현영O)',
  '계좌이체(현영X)',
  '현금(현영O)',
  '현금(현영X)',
];

export async function fetchPaymentsPage(opts = {}) {
  const { studentId, cursor } = opts;
  const filter = studentId
    ? { property: '학생', relation: { contains: studentId } }
    : undefined;

  return queryPage(
    PAYMENTS_DB,
    filter,
    [{ property: '결제일', direction: 'descending' }],
    cursor
  );
}

export async function createPayment({
  note,
  studentId,
  classTypeId,
  discountEventId,
  sessionCount,
  actualAmount,
  paymentMethod,
  paymentDate,
}) {
  const properties = {
    비고: { title: [{ text: { content: note || '' } }] },
    학생: { relation: [{ id: studentId }] },
    '수업 종류': { relation: [{ id: classTypeId }] },
    '시간 회차': { number: sessionCount },
    '실제 결제 금액': { number: actualAmount },
  };

  if (discountEventId) {
    properties['할인 적용'] = { relation: [{ id: discountEventId }] };
  }
  if (paymentMethod) {
    properties['결제수단'] = { select: { name: paymentMethod } };
  }
  if (paymentDate) {
    properties['결제일'] = { date: { start: paymentDate } };
  }

  return createPage(PAYMENTS_DB, properties);
}

export async function updatePayment(pageId, {
  studentId,
  classTypeId,
  discountEventId,
  sessionCount,
  actualAmount,
  paymentMethod,
  paymentDate,
  note,
}) {
  const properties = {};
  if (studentId) properties['학생'] = { relation: [{ id: studentId }] };
  if (classTypeId) properties['수업 종류'] = { relation: [{ id: classTypeId }] };
  if (discountEventId !== undefined) {
    properties['할인 적용'] = discountEventId ? { relation: [{ id: discountEventId }] } : { relation: [] };
  }
  if (sessionCount !== undefined) properties['시간 회차'] = { number: sessionCount };
  if (actualAmount !== undefined) properties['실제 결제 금액'] = { number: actualAmount };
  if (paymentMethod) properties['결제수단'] = { select: { name: paymentMethod } };
  else if (paymentMethod === '') properties['결제수단'] = { select: null };
  if (paymentDate) properties['결제일'] = { date: { start: paymentDate } };
  if (note !== undefined) properties['비고'] = { title: [{ text: { content: note } }] };

  return updatePage(pageId, properties);
}

export function parsePayment(page) {
  const p = page.properties;
  return {
    id: page.id,
    note: p['비고']?.title?.[0]?.plain_text ?? '',
    studentIds: p['학생']?.relation?.map((r) => r.id) ?? [],
    classTypeId: p['수업 종류']?.relation?.[0]?.id ?? null,
    discountEventId: p['할인 적용']?.relation?.[0]?.id ?? null,
    unitPrice: p['시간당 단가']?.rollup?.number ?? 0,
    discountRate: p['적용 할인율(%)']?.rollup?.number ?? 0,
    sessionCount: p['시간 회차']?.number ?? 0,
    actualAmount: p['실제 결제 금액']?.number ?? 0,
    paymentAmount: p['결제 금액']?.formula?.number ?? 0,
    unpaid: p['미수금']?.formula?.number ?? 0,
    paymentStatus: p['결제 상태']?.formula?.string ?? '',
    paymentMethod: p['결제수단']?.select?.name ?? null,
    paymentDate: p['결제일']?.date?.start ?? null,
    memo: p['메모']?.rich_text?.[0]?.plain_text ?? '',
  };
}

export function paymentStatusColor(status) {
  if (!status) return { bg: 'bg-gray-100', text: 'text-gray-500' };
  if (status.includes('🟢')) return { bg: 'bg-green-100', text: 'text-green-700' };
  if (status.includes('🔴')) return { bg: 'bg-red-100', text: 'text-red-600' };
  if (status.includes('⬛')) return { bg: 'bg-gray-100', text: 'text-gray-600' };
  if (status.includes('⚠️')) return { bg: 'bg-amber-100', text: 'text-amber-700' };
  return { bg: 'bg-gray-100', text: 'text-gray-500' };
}

/** 결제 예정 금액 클라이언트 계산 (실시간 미리보기용) */
export function calcPaymentAmount(sessionCount, unitPrice, discountRate) {
  return Math.round(sessionCount * unitPrice * (1 - (discountRate || 0) / 100));
}
