import { queryPage, createPage, updatePage } from './notionClient.js';

export const CLASSES_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';

export const DURATION_OPTIONS = ['60', '90', '120', '150', '180'];
export const NOTES_OPTIONS = ['🔴 결석', '🟠 보강', '🚫 취소'];
export const LOCATION_OPTIONS = ['강남사무실', '온라인 (Zoom/화상)', '학생 자택 방문', '카페 / 외부 장소'];

/** 수업 목록 조회 */
export async function fetchClassesPage(opts = {}) {
  const { dateFrom, dateTo, studentId, cursor, completedOnly, excludeCompleted } = opts;
  const filters = [];
  const nowIso = new Date().toISOString();

  // formula 필터 미지원 → 수업 일시 기준으로 완료/예정 구분
  // 완료: 수업 일시 <= now, 예정/수업중: 수업 일시 >= now - 최대수업시간(180분)
  if (completedOnly) {
    filters.push({ property: '수업 일시', date: { on_or_before: nowIso } });
  } else {
    const ongoingCoverIso = excludeCompleted
      ? new Date(Date.now() - 180 * 60 * 1000).toISOString()
      : null;
    const effectiveDateFrom = ongoingCoverIso ?? dateFrom;
    if (effectiveDateFrom) filters.push({ property: '수업 일시', date: { on_or_after: effectiveDateFrom } });
    if (dateTo) filters.push({ property: '수업 일시', date: { on_or_before: dateTo } });
  }
  if (studentId) filters.push({ property: '학생', relation: { contains: studentId } });

  const filter =
    filters.length > 1
      ? { and: filters }
      : filters.length === 1
      ? filters[0]
      : undefined;

  const sorts = completedOnly
    ? [{ property: '수업 일시', direction: 'descending' }]
    : [{ property: '수업 일시', direction: 'ascending' }];

  return queryPage(CLASSES_DB, filter, sorts, cursor);
}

/** 수업 생성 */
export async function createClass({ studentIds, classTypeId, datetime, duration, notes, location, locationMemo, title, phone }) {
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
  properties['전화번호'] = phone?.trim()
    ? { rich_text: [{ text: { content: phone.trim() } }] }
    : { rich_text: [] };
  return createPage(CLASSES_DB, properties);
}

/** 반복 수업 일괄 생성 */
export async function bulkCreateClasses(items) {
  // items: Array<{ studentIds, classTypeId, datetime (ISO string), duration, notes }>
  const results = [];
  for (const item of items) {
    results.push(await createClass(item));
  }
  return results;
}

/** 수업 수정 (충돌_감지 checkbox는 건드리지 않음) */
export async function updateClass(pageId, { studentIds, classTypeId, datetime, duration, notes, location, locationMemo, title, phone }) {
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
  if (phone !== undefined) {
    properties['전화번호'] = phone?.trim()
      ? { rich_text: [{ text: { content: phone.trim() } }] }
      : { rich_text: [] };
  }

  return updatePage(pageId, properties);
}

/** Notion 페이지 → 수업 객체 변환 */
export function parseClass(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: p['제목']?.title?.[0]?.plain_text ?? '',
    studentIds: p['학생']?.relation?.map((r) => r.id) ?? [],
    classTypeId: p['수업 유형']?.relation?.[0]?.id ?? null,
    datetime: p['수업 일시']?.date?.start ?? null,
    duration: p['수업 시간(분)']?.select?.name ?? null,
    status: p['상태']?.formula?.string ?? '',
    notes: p['특이사항']?.select?.name ?? null,
    sessionShortage: p['시간 회차 부족']?.formula?.string ?? '',
    conflictDetected: p['충돌_감지']?.checkbox ?? false,
    endTime: p['수업 종료 시간']?.formula?.date?.start ?? null,
    lessonLogIds: p['수업 일지']?.relation?.map((r) => r.id) ?? [],
    location: p['수업 장소']?.select?.name ?? null,
    locationMemo: p['수업 장소 메모']?.rich_text?.[0]?.plain_text ?? '',
    phone: p['전화번호']?.rich_text?.[0]?.plain_text ?? '',
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
