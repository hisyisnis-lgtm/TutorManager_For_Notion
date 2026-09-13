// 현재 Notion 기록을 학생에게 설명하는 읽기 전용 명세. 과거 시점의 잔액을 재구성하지 않는다.
const EPSILON = 1e-7;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sum = values => values.some(value => value === null) ? null : values.reduce((total, value) => total + value, 0);
const dateValue = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const numeric = (props, name, type) => finite(props?.[name]?.[type]?.number);

// Notion의 4xx JSON, 누락/반복 cursor를 정상 빈 결과로 취급하지 않는다.
export async function queryStudentTimePages(n, databaseId, studentId) {
  const pages = [], cursors = new Set(), ids = new Set();
  let cursor;
  do {
    const data = await n('POST', `/databases/${databaseId}/query`, {
      filter: { property: '학생', relation: { contains: studentId } }, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!Array.isArray(data?.results) || typeof data.has_more !== 'boolean') throw new Error('시간 내역을 모두 확인하지 못했습니다. 다시 시도해주세요.');
    for (const page of data.results) {
      if (!page?.id || ids.has(page.id) || pages.length >= 10000) throw new Error('시간 내역을 모두 확인하지 못했습니다. 다시 시도해주세요.');
      ids.add(page.id); pages.push(page);
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new Error('시간 내역을 모두 확인하지 못했습니다. 다시 시도해주세요.');
    cursors.add(cursor);
  } while (cursor);
  return pages;
}

export function studentSessionTotals(payments, studentProps) {
  const paidSessions = sum(payments.map(page => numeric(page.properties, '유효 시간 회차', 'formula')));
  const usedSessions = numeric(studentProps, '사용 시간 회차', 'rollup');
  return { paidSessions, usedSessions,
    remainingSessions: paidSessions === null || usedSessions === null ? null : paidSessions - usedSessions };
}

export function buildStudentLedger({ payments, classes, studentProps, asOf }) {
  if (!dateValue(asOf)) throw new Error('시간 내역의 기준 시각을 확인할 수 없습니다.');
  const now = Date.parse(asOf), issues = new Set();
  const paymentRows = payments.map(page => {
    const p = page.properties || {};
    const hours = finite(p['시간 회차']?.number);
    const effectiveHours = numeric(p, '유효 시간 회차', 'formula');
    const reductionHours = hours === null || effectiveHours === null ? null : hours - effectiveHours;
    const status = p['결제 상태']?.formula?.string || '';
    const settled = status.includes('🟢') || status.includes('⚠️');
    const pending = status.includes('🔴') || status.includes('⬛');
    const hasRefund = finite(p['환불 금액']?.number) > 0;
    let reductionKind = 'none';
    if (reductionHours === null || reductionHours < -EPSILON || hours < 0 || effectiveHours < 0) {
      reductionKind = 'unknown'; issues.add('payment_unconfirmed');
    } else if (reductionHours > EPSILON) {
      if (settled && hasRefund) reductionKind = 'refund';
      else if (pending && effectiveHours === 0) reductionKind = 'unreflected';
      else { reductionKind = 'unknown'; issues.add('payment_unconfirmed'); }
    }
    const date = dateValue(p['결제일']?.date?.start);
    const refundDate = hasRefund ? dateValue(p['환불일']?.date?.start) : null;
    if (!date || (hasRefund && !refundDate)) issues.add('missing_dates');
    return { id: page.id, kind: 'payment', date, hours, effectiveHours, reductionHours, reductionKind, refundDate };
  });
  const classRows = classes.map(page => {
    const p = page.properties || {};
    const hours = numeric(p, '시간 회차', 'formula');
    const date = dateValue(p['수업 일시']?.date?.start);
    const special = p['특이사항']?.select?.name;
    const exemption = special === '🚫 취소' ? 'cancelled' : special === '🟠 보강' ? 'makeup'
      : numeric(p, '무료 수업', 'rollup') === 0 ? 'free' : null;
    if (hours === null || hours < 0 || (exemption && hours !== 0)) issues.add('class_unconfirmed');
    if (!date) issues.add('missing_dates');
    return { id: page.id, kind: 'class', date, hours, exemption,
      state: !date ? 'undated' : Date.parse(date) > now ? 'scheduled' : 'used' };
  });
  const { paidSessions, usedSessions, remainingSessions } = studentSessionTotals(payments, studentProps);
  const recordedClassHours = sum(classRows.map(row => row.hours));
  // 날짜 없는 차감 기록은 예정/완료 어느 쪽인지 추측하지 않는다.
  const unplaced = classRows.some(row => row.state === 'undated' && row.hours !== 0);
  const scheduledHours = unplaced ? null : sum(classRows.filter(row => row.state === 'scheduled').map(row => row.hours));
  const completedHours = unplaced ? null : sum(classRows.filter(row => row.state === 'used').map(row => row.hours));
  const differenceHours = usedSessions === null || recordedClassHours === null ? null : usedSessions - recordedClassHours;
  if (paidSessions === null || usedSessions === null || recordedClassHours === null) issues.add('totals_unconfirmed');
  if (differenceHours !== null && Math.abs(differenceHours) > EPSILON) issues.add('usage_mismatch');
  const rows = [...paymentRows, ...classRows].sort((a, b) =>
    (b.date ? Date.parse(b.date) : -Infinity) - (a.date ? Date.parse(a.date) : -Infinity) || a.id.localeCompare(b.id));
  return {
    version: 1, asOf, status: issues.size ? 'needs_review' : 'matched', issues: [...issues],
    summary: {
      creditedHours: paidSessions, usedAndScheduledHours: usedSessions, recordedClassHours, completedHours,
      scheduledHours, availableHours: remainingSessions,
      remainingHours: remainingSessions === null || scheduledHours === null ? null : remainingSessions + scheduledHours,
      differenceHours,
    }, rows,
  };
}
