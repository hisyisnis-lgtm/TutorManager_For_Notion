import { queryPage, createPage, updatePage } from './notionClient.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getNumber,
  getDate,
  getRelationId,
  getRelationIds,
  getFormulaNumber,
  getFormulaString,
  getRollupNumber,
} from '../utils/notionProp.js';

export const PAYMENTS_DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';

export const PAYMENT_METHODS = [
  '카드',
  '계좌이체(현영O)',
  '계좌이체(현영X)',
  '현금(현영O)',
  '현금(현영X)',
];

export async function fetchPaymentsPage(opts = {}) {
  const { studentId, classTypeId, cursor } = opts;
  const filters = [];
  if (studentId) filters.push({ property: '학생', relation: { contains: studentId } });
  if (classTypeId) filters.push({ property: '수업 종류', relation: { contains: classTypeId } });
  const filter = filters.length > 1 ? { and: filters } : filters.length === 1 ? filters[0] : undefined;

  return queryPage(
    PAYMENTS_DB,
    filter,
    [{ property: '결제일', direction: 'descending' }],
    cursor
  );
}

export async function createPayment({
  note,
  guestName,   // 학생앱 미등록자(온라인그룹수업 등) 수강생 이름 → 타이틀
  phone,       // 학생 없는 결제의 연락처 (선택)
  studentId,
  classTypeId,
  discountEventId,
  sessionCount,
  actualAmount,
  paymentMethod,
  paymentDate,
}) {
  // 학생 연결 결제는 타이틀=비고(note), 학생 없는 결제는 타이틀=수강생 이름(guestName)
  const title = studentId ? (note || '') : (guestName || '');
  const properties = {
    타이틀: { title: [{ text: { content: title } }] },
    '수업 종류': { relation: [{ id: classTypeId }] },
    '시간 회차': { number: sessionCount },
    '실제 결제 금액': { number: actualAmount },
  };

  if (studentId) {
    properties['학생'] = { relation: [{ id: studentId }] };
  } else if (note) {
    // 학생 없는 결제: 비고는 메모 필드로 (타이틀은 이름이 차지)
    properties['메모'] = { rich_text: [{ text: { content: note } }] };
  }
  if (!studentId && phone?.trim()) {
    properties['전화번호'] = { phone_number: phone.trim() };
  }
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
  refundAmount,
  refundDate,
  refundReason,
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
  if (note !== undefined) properties['타이틀'] = { title: [{ text: { content: note } }] };
  if (refundAmount !== undefined) properties['환불 금액'] = { number: refundAmount };
  if (refundDate !== undefined) properties['환불일'] = refundDate ? { date: { start: refundDate } } : { date: null };
  if (refundReason !== undefined) {
    properties['환불 사유'] = refundReason ? { rich_text: [{ text: { content: refundReason } }] } : { rich_text: [] };
  }

  return updatePage(pageId, properties);
}

export function parsePayment(page) {
  const p = page.properties;
  return {
    id: page.id,
    note: getTitle(p['타이틀']),
    studentIds: getRelationIds(p['학생']),
    classTypeId: getRelationId(p['수업 종류']),
    discountEventId: getRelationId(p['할인 적용']),
    unitPrice: getRollupNumber(p['시간당 단가']),
    discountRate: getRollupNumber(p['적용 할인율(%)']),
    sessionCount: getNumber(p['시간 회차']),
    actualAmount: getNumber(p['실제 결제 금액']),
    paymentAmount: getFormulaNumber(p['결제 금액']),
    unpaid: getFormulaNumber(p['미수금']),
    paymentStatus: getFormulaString(p['결제 상태']),
    paymentMethod: getSelect(p['결제수단']),
    paymentDate: getDate(p['결제일']),
    memo: getRichText(p['메모']),
    phone: p['전화번호']?.phone_number ?? '',
    refundAmount: getNumber(p['환불 금액']),
    refundDate: getDate(p['환불일']),
    refundReason: getRichText(p['환불 사유']),
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
