import { queryPage, createPage, updatePage } from './notionClient.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getDate,
  getCheckbox,
  getRelationId,
  getRelationIds,
  getFormulaString,
  getFormulaDate,
} from '../utils/notionProp.js';

export const CLASSES_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

export const DURATION_OPTIONS = ['60', '90', '120', '150', '180'];
export const NOTES_OPTIONS = ['🔴 결석', '🟠 보강', '🚫 취소'];
export const LOCATION_OPTIONS = ['강남사무실', '온라인 (Zoom/화상)', '학생 자택 방문', '카페 / 외부 장소'];

/** 수업 목록 조회 */
export async function fetchClassesPage(opts = {}) {
  const { dateFrom, dateTo, studentId, classTypeId, cursor, completedOnly } = opts;
  const filters = [];
  const nowIso = new Date().toISOString();

  if (completedOnly) {
    // 완료 = 현재 시각 이전. 날짜 범위 필터와 병합 (이전엔 completedOnly가 dateFrom/dateTo를
    // 조용히 무시해 완료 탭에서 기간 칩·DatePicker가 무동작이었음)
    const upper = dateTo && dateTo < nowIso ? dateTo : nowIso;
    filters.push({ property: '수업 일시', date: { on_or_before: upper } });
    if (dateFrom) filters.push({ property: '수업 일시', date: { on_or_after: dateFrom } });
  } else {
    if (dateFrom) filters.push({ property: '수업 일시', date: { on_or_after: dateFrom } });
    if (dateTo) filters.push({ property: '수업 일시', date: { on_or_before: dateTo } });
  }
  if (studentId) filters.push({ property: '학생', relation: { contains: studentId } });
  if (classTypeId) filters.push({ property: '수업 유형', relation: { contains: classTypeId } });

  const filter =
    filters.length > 1
      ? { and: filters }
      : filters.length === 1
      ? filters[0]
      : undefined;

  const sorts = completedOnly
    ? [{ property: '수업 일시', direction: 'descending' }]
    : [{ property: '수업 일시', direction: 'ascending' }];

  return queryPage(CLASSES_DB, filter, sorts, cursor, 100);
}

/** 수업 생성 */
export async function createClass({ studentIds, classTypeId, datetime, duration, notes, location, locationMemo, noteMemo, title, phone, roster }) {
  const properties = {
    학생: { relation: studentIds.map((id) => ({ id })) },
    '수업 유형': { relation: [{ id: classTypeId }] },
    '수업 일시': { date: { start: datetime } },
    '수업 시간(분)': { select: { name: String(duration) } },
  };
  if (title) {
    properties['제목'] = { title: [{ text: { content: title } }] };
  }
  if (notes) {
    properties['특이사항'] = { select: { name: notes } };
  }
  if (location) {
    properties['수업 장소'] = { select: { name: location } };
  }
  properties['수업 장소 메모'] = locationMemo
    ? { rich_text: [{ text: { content: locationMemo } }] }
    : { rich_text: [] };
  properties['특이사항 메모'] = noteMemo
    ? { rich_text: [{ text: { content: noteMemo } }] }
    : { rich_text: [] };
  properties['전화번호'] = phone?.trim()
    ? { rich_text: [{ text: { content: phone.trim() } }] }
    : { rich_text: [] };
  properties['수강생'] = roster?.trim()
    ? { rich_text: [{ text: { content: roster.trim() } }] }
    : { rich_text: [] };
  return createPage(CLASSES_DB, properties);
}

/** 반복 수업 일괄 생성.
 * 중간 실패 시 "몇 개까지 생성됐는지"를 에러에 담아 던진다 — 이게 없으면 사용자가
 * 통째로 재시도해서 이미 생성된 앞부분이 중복 등록됨. err.createdCount = 생성 성공 수. */
export async function bulkCreateClasses(items) {
  // items: Array<{ studentIds, classTypeId, datetime (ISO string), duration, notes }>
  const results = [];
  for (const item of items) {
    try {
      results.push(await createClass(item));
    } catch (e) {
      const err = new Error(
        `${items.length}개 중 ${results.length}개 등록 후 실패했어요 (${e.message}). ` +
        `이미 등록된 ${results.length}개는 캘린더에 남아 있으니, 남은 수업만 다시 등록해주세요.`
      );
      err.createdCount = results.length;
      err.cause = e;
      throw err;
    }
  }
  return results;
}

/** 수업 수정 (충돌_감지 checkbox는 건드리지 않음) */
export async function updateClass(pageId, { studentIds, classTypeId, datetime, duration, notes, location, locationMemo, noteMemo, title, phone, roster }) {
  const properties = {};
  if (studentIds) properties['학생'] = { relation: studentIds.map((id) => ({ id })) };
  if (classTypeId) properties['수업 유형'] = { relation: [{ id: classTypeId }] };
  if (datetime) properties['수업 일시'] = { date: { start: datetime } };
  if (duration) properties['수업 시간(분)'] = { select: { name: String(duration) } };
  if (title !== undefined) {
    properties['제목'] = title
      ? { title: [{ text: { content: title } }] }
      : { title: [] };
  }
  // notes가 null이면 특이사항 제거, 값이 있으면 설정
  properties['특이사항'] = notes ? { select: { name: notes } } : { select: null };
  // location이 null이면 제거, 값이 있으면 설정
  properties['수업 장소'] = location ? { select: { name: location } } : { select: null };
  properties['수업 장소 메모'] = locationMemo
    ? { rich_text: [{ text: { content: locationMemo } }] }
    : { rich_text: [] };
  properties['특이사항 메모'] = noteMemo
    ? { rich_text: [{ text: { content: noteMemo } }] }
    : { rich_text: [] };
  if (phone !== undefined) {
    properties['전화번호'] = phone?.trim()
      ? { rich_text: [{ text: { content: phone.trim() } }] }
      : { rich_text: [] };
  }
  if (roster !== undefined) {
    properties['수강생'] = roster?.trim()
      ? { rich_text: [{ text: { content: roster.trim() } }] }
      : { rich_text: [] };
  }

  return updatePage(pageId, properties);
}

/** Notion 페이지 → 수업 객체 변환 */
export function parseClass(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: getTitle(p['제목']),
    studentIds: getRelationIds(p['학생']),
    classTypeId: getRelationId(p['수업 유형']),
    datetime: getDate(p['수업 일시']),
    duration: getSelect(p['수업 시간(분)']),
    status: getFormulaString(p['상태']),
    notes: getSelect(p['특이사항']),
    sessionShortage: getFormulaString(p['시간 회차 부족']),
    conflictDetected: getCheckbox(p['충돌_감지']),
    endTime: getFormulaDate(p['수업 종료 시간']),
    lessonLogIds: getRelationIds(p['수업 일지']),
    location: getSelect(p['수업 장소']),
    locationMemo: getRichText(p['수업 장소 메모']),
    noteMemo: getRichText(p['특이사항 메모']),
    phone: getRichText(p['전화번호']),
    roster: getRichText(p['수강생']),
  };
}

export function classStatusColor(status) {
  if (status?.includes('🟢')) return { bg: 'bg-green-100', text: 'text-green-700' };
  if (status?.includes('🔵')) return { bg: 'bg-blue-100', text: 'text-blue-700' };
  if (status?.includes('🔴')) return { bg: 'bg-red-100', text: 'text-red-600' };
  return { bg: 'bg-gray-100', text: 'text-gray-500' };
}

export function notesColor(notes) {
  if (!notes) return null;
  if (notes.includes('결석')) return { bg: 'bg-red-50', text: 'text-red-600' };
  if (notes.includes('보강')) return { bg: 'bg-orange-50', text: 'text-orange-600' };
  if (notes.includes('취소')) return { bg: 'bg-gray-100', text: 'text-gray-500' };
  return null;
}
