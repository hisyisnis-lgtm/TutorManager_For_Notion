import { queryPage, queryAll, createPage, updatePage } from './notionClient.js';
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
    // 환불분이 차감된 회차. 학생 DB의 '결제 시간 회차 합계' 롤업은 이 값을 합산하도록
    // 돼 있지만 환불 후에도 갱신되지 않아(아래 remainingSessionsOf 주석 참고) 앱이 직접 합산한다.
    effectiveSessions: getFormulaNumber(p['유효 시간 회차']),
    refundAmount: getNumber(p['환불 금액']),
    refundDate: getDate(p['환불일']),
    refundReason: getRichText(p['환불 사유']),
  };
}

/** 학생의 결제 전체 조회 — 잔여 회차 계산용이라 100건 초과에도 누락되면 안 되므로 queryAll. */
export async function fetchAllPayments(studentId) {
  return queryAll(
    PAYMENTS_DB,
    studentId ? { property: '학생', relation: { contains: studentId } } : undefined,
    [{ property: '결제일', direction: 'descending' }]
  );
}

/**
 * 학생의 잔여 시간 회차 — Notion '잔여 시간 회차' formula를 쓰지 않고 앱에서 계산한다.
 *
 * Notion 학생 DB의 '결제 시간 회차 합계'는 결제.'유효 시간 회차'(환불 차감 포함)를 sum하는
 * rollup인데, **결제 행이 연결된 시점의 값에 고정되고 이후 환불을 반영하지 않는다**.
 * 2026-08-25 검증: 새 학생·새 결제(4회차)를 만들면 롤업 4 → 10만원(2회차) 환불 후에도 롤업 4.
 * 결제 페이지의 '유효 시간 회차'는 2로 정확히 계산되므로, 그 값을 직접 합산한다.
 * (Notion UI는 실시간 계산이라 0을 보여주지만 공개 API는 굳은 값을 반환 — 앱은 API를 쓴다.)
 * 롤업 재정의·수식 재저장·관계 재연결 모두 효과 없었고, formula에서 다른 formula를 참조할 수
 * 없어 Notion 안에서는 우회로가 없다.
 */
export function remainingSessionsOf(student, payments) {
  const paid = payments.reduce((sum, p) => sum + (p.effectiveSessions ?? 0), 0);
  return paid - (student?.usedSessions ?? 0);
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

/**
 * 결제 폼 제출 검증 — 통과 시 null, 실패 시 에러 문구 반환.
 * 온라인그룹수업은 시간 회차 개념이 없어(0으로 저장) 회차 검증을 건너뛴다.
 * (이전 버그: 그룹수업 편집 시 회차 검증에 걸려 저장 자체가 불가능했음)
 * @param {{ classTypeId, sessionCount, actualAmount, studentId }} form
 * @param {{ isOnlineGroup:boolean, isEdit:boolean }} ctx
 */
export function validatePaymentForm(form, { isOnlineGroup, isEdit }) {
  if (!form.classTypeId) return '수업 종류를 선택하세요.';
  if (!isOnlineGroup) {
    if (!form.sessionCount || isNaN(parseFloat(form.sessionCount))) return '시간 회차를 입력하세요.';
    if (parseFloat(form.sessionCount) <= 0) return '시간 회차는 0보다 커야 합니다.';
  }
  if (form.actualAmount === '' || isNaN(parseFloat(form.actualAmount))) return '실제 결제 금액을 입력하세요.';
  if (parseFloat(form.actualAmount) < 0) return '결제 금액은 0 이상이어야 합니다.';
  if (!isEdit && !form.studentId) return '학생을 선택하세요.';
  return null;
}

/**
 * 환불 금액 → 환산 시간 회차 (할인 적용 단가 기준, 반올림 없이 소수 그대로).
 * Notion '유효 시간 회차' formula의 차감식과 동일하게 단가 0이면 0 반환(div-by-zero 가드).
 * 학생 없는 결제(단가 0)는 0이라 회차 개념 미적용.
 */
export function refundSessions({ refundAmount, unitPrice, discountRate } = {}) {
  const perSession = (unitPrice || 0) * (1 - (discountRate || 0) / 100);
  if (!perSession || !refundAmount) return 0;
  return refundAmount / perSession;
}

/** 시간 회차 표시용 포맷 — 정수면 정수, 소수면 소수점 2자리까지(불필요한 0 제거) */
export function formatSessions(n) {
  const r = Math.round((n || 0) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(parseFloat(r.toFixed(2)));
}

/** 환산 회차가 정수로 딱 떨어지는지 (소수면 false → 경고 표시용) */
export function isWholeSession(n) {
  return Math.abs((n || 0) - Math.round(n || 0)) < 1e-9;
}
