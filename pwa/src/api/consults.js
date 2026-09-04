import { queryAll, updatePage } from './notionClient.js';
import { CONSULT_DB } from '../constants.js';

/**
 * 무료상담 ↔ 학생 연결 (2026-09-04).
 *
 * 상담은 학생 등록 없이 진행한다(사용자 결정). 대신 **학생을 등록하는 순간** 같은 전화번호의 상담 신청을 찾아
 * 자동으로 연결하고 상태를 '완료'로 바꾼다. 상담 상세를 찾아 들어가 "학생으로 등록"을 누르는 흐름은
 * 상담이 쌓이면 찾기 힘들다는 이유로 채택하지 않았다.
 *  - 전화번호 일치(숫자만 비교) → 자동 연결. 같은 번호가 여럿이면 가장 최근 신청.
 *  - 이름만 일치 → 자동 연결하지 않고 호출부가 한 번 묻는다(동명이인 오연결 방지).
 * 전환율 = 학생이 연결된 상담 ÷ 전체 상담(최근 2주 제외) — notify_daily_brief.mjs 월간 지표.
 */

export function normalizePhone(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  // 국가번호 형태(82-10-…)는 0으로 시작하게 맞춘다
  return digits.startsWith('82') && digits.length > 10 ? '0' + digits.slice(2) : digits;
}

export function parseConsult(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: p['이름']?.title?.[0]?.plain_text ?? '',
    phone: p['전화번호']?.rich_text?.[0]?.plain_text ?? '',
    level: p['수준']?.select?.name ?? '',
    days: (p['희망 요일']?.multi_select ?? []).map((o) => o.name),
    time: p['희망 시간대']?.select?.name ?? '',
    content: p['상담 내용']?.rich_text?.[0]?.plain_text ?? '',
    status: p['상태']?.select?.name ?? '',
    appliedAt: p['신청 일시']?.date?.start ?? page.created_time,
    studentId: p['학생']?.relation?.[0]?.id ?? null,
  };
}

/** 아직 학생이 연결되지 않은 상담 전부(최신순). 건수가 적어 클라이언트에서 매칭한다. */
export async function fetchUnlinkedConsults() {
  const pages = await queryAll(
    CONSULT_DB,
    { property: '학생', relation: { is_empty: true } },
    [{ timestamp: 'created_time', direction: 'descending' }],
  );
  return pages.map(parseConsult);
}

/**
 * 새 학생과 맞는 상담 찾기. 순수 함수(테스트용).
 * @returns {{ byPhone: object|null, byName: object[] }} byPhone은 가장 최근 1건, byName은 이름만 같은 것들(전화 불일치 제외)
 */
export function matchConsults(consults, { name, phone }) {
  const np = normalizePhone(phone);
  const nn = String(name ?? '').replace(/\s+/g, '').trim();
  const phoneHits = np ? consults.filter((c) => normalizePhone(c.phone) === np) : [];
  const byPhone = phoneHits[0] ?? null;
  const byName = nn
    ? consults.filter((c) => c !== byPhone
        && String(c.name ?? '').replace(/\s+/g, '') === nn
        && (!np || !normalizePhone(c.phone) || normalizePhone(c.phone) === np))
    : [];
  return { byPhone, byName };
}

/** 상담에 학생 연결 + 상태 '완료' */
export function linkConsultToStudent(consultId, studentId) {
  return updatePage(consultId, {
    '학생': { relation: [{ id: studentId }] },
    '상태': { select: { name: '완료' } },
  });
}

/** 결제까지 가지 않은 상담 닫기 */
export function closeConsult(consultId) {
  return updatePage(consultId, { '상태': { select: { name: '불발' } } });
}

/** 강사가 처음 확인했을 때 */
export function acknowledgeConsult(consultId) {
  return updatePage(consultId, { '상태': { select: { name: '확인됨' } } });
}
