import { queryAll, updatePage, createPage, getPage } from './notionClient.js';
import { stripEmoji } from '../utils/stringUtils.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getEmail,
  getPhone,
  getCreatedTime,
  getFormulaNumber,
  getRollupNumber,
  getCheckbox,
} from '../utils/notionProp.js';

export const STUDENTS_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';

const SORTS = [
  { property: '상태', direction: 'ascending' },
  { property: '이름', direction: 'ascending' },
];

const STATUS_ORDER = { '🟢 수강중': 0, '🟡 일시중단': 1, '⚫ 수강종료': 2 };

/** 전체 학생 조회 (DataContext 초기화용) */
export async function fetchAllStudents() {
  return queryAll(STUDENTS_DB, undefined, SORTS);
}

/** 학생 상태 변경 */
export async function updateStudentStatus(pageId, status) {
  return updatePage(pageId, {
    상태: { select: { name: status } },
  });
}

/** 학생 VIP(숙제 관리 대상) 토글 — 켜야 숙제 등록/관리 진입 가능 */
export async function updateStudentVip(pageId, vip) {
  return updatePage(pageId, {
    VIP: { checkbox: !!vip },
  });
}

/**
 * 학생페이지 첫 공유 시점 기록 — 강사가 "학생 페이지 공유" 버튼을 처음 누른 시점.
 * 이미 기록된 학생은 건드리지 않아 재공유 시 시점이 리셋되지 않는다.
 * Worker가 이 값을 sharedAt으로 사용해 판다 먹이(수업시간 30분당 1개)를 그 이후 수업으로만 집계.
 * 반환: 새로 기록했으면 true, 이미 있어서 스킵했으면 false.
 */
export async function markStudentSharedIfEmpty(pageId) {
  const page = await getPage(pageId);
  if (page?.properties?.['공유일']?.date?.start) return false;
  await updatePage(pageId, {
    '공유일': { date: { start: new Date().toISOString() } },
  });
  return true;
}

/** 학생 정보 수정 */
export async function updateStudent(pageId, { name, phone, email, level, goal, status, memo, bookingCode }) {
  const properties = {};
  if (name) properties['이름'] = { title: [{ text: { content: name } }] };
  if (status) properties['상태'] = { select: { name: status } };
  properties['전화번호'] = phone ? { phone_number: phone } : { phone_number: null };
  properties['이메일'] = email ? { email } : { email: null };
  properties['레벨'] = { rich_text: level ? [{ text: { content: level } }] : [] };
  properties['목표'] = { rich_text: goal ? [{ text: { content: goal } }] : [] };
  properties['메모'] = { rich_text: memo ? [{ text: { content: memo } }] : [] };
  properties['예약 코드'] = { rich_text: bookingCode ? [{ text: { content: bookingCode } }] : [] };
  return updatePage(pageId, properties);
}

/** 학생 생성 */
export async function createStudent({ name, phone, email, level, goal, status, memo, bookingCode }) {
  const properties = {
    이름: { title: [{ text: { content: name } }] },
    상태: { select: { name: status || '🟢 수강중' } },
  };
  if (phone) properties['전화번호'] = { phone_number: phone };
  if (email) properties['이메일'] = { email };
  if (level) properties['레벨'] = { rich_text: [{ text: { content: level } }] };
  if (goal) properties['목표'] = { rich_text: [{ text: { content: goal } }] };
  if (memo) properties['메모'] = { rich_text: [{ text: { content: memo } }] };
  if (bookingCode) properties['예약 코드'] = { rich_text: [{ text: { content: bookingCode } }] };
  return createPage(STUDENTS_DB, properties);
}

/** Notion 페이지 → 학생 객체 변환 */
export function parseStudent(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: stripEmoji(getTitle(p['이름'], '(이름 없음)')),
    phone: getPhone(p['전화번호']),
    email: getEmail(p['이메일']),
    level: getRichText(p['레벨']),
    goal: getRichText(p['목표']),
    status: getSelect(p['상태'], ''),
    // Notion '잔여 시간 회차'는 환불이 반영되지 않는 롤업에 의존한다(payments.js remainingSessionsOf 주석).
    // 표시용 잔여 시간은 결제 데이터로 다시 계산하므로, 이 값은 참고용으로만 남긴다.
    remainingSessions: getFormulaNumber(p['잔여 시간 회차']),
    usedSessions: getRollupNumber(p['사용 시간 회차']),
    unpaidAmount: getRollupNumber(p['미수금 합계']),
    memo: getRichText(p['메모']),
    bookingCode: getRichText(p['예약 코드']),
    createdAt: getCreatedTime(p['등록일']),
    // 숙제 관리 대상(VIP) 여부 — 숙제 등록/관리 진입은 VIP 학생만 허용
    vip: getCheckbox(p['VIP']),
  };
}

export const STATUS_OPTIONS = ['🟢 수강중', '🟡 일시중단', '⚫ 수강종료'];

/** 활성 수강생 판정용 단일 출처 — 이모지까지 포함한 Notion select 원본값. */
export const STATUS_ACTIVE = '🟢 수강중';

export function statusColor(status) {
  switch (status) {
    case '🟢 수강중':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case '🟡 일시중단':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case '⚫ 수강종료':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-500' };
  }
}
