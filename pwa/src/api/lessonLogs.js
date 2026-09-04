import { queryAll, createPage, updatePage } from './notionClient.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getRelationId,
  getRelationIds,
} from '../utils/notionProp.js';

export const LESSON_LOGS_DB = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';

export const ENGAGEMENT_OPTIONS = ['😊 좋음', '😐 보통', '😞 저조'];

/**
 * 수업 일지 전체 조회 (최신순).
 * 날짜 필터가 **로드된 것만** 거르면 안 되므로 페이지네이션이 아니라 전부 받는다
 * (2026-08-27 기준 469건 · 5회 왕복, notionClient의 레이트 리미터가 속도를 잡는다).
 * 화면에 한 번에 다 그리지는 않는다 — 렌더 개수는 목록 쪽에서 제한한다.
 */
export async function fetchAllLessonLogs(studentId) {
  return queryAll(
    LESSON_LOGS_DB,
    studentId ? { property: '학생', relation: { contains: studentId } } : undefined,
    [{ timestamp: 'created_time', direction: 'descending' }]
  );
}

/** 수업 일지 내용 업데이트 */
export async function updateLessonLog(pageId, { content, homework, nextPrepare, engagement, memo }) {
  const properties = {
    '오늘 내용': { rich_text: [{ text: { content: content || '' } }] },
    숙제: { rich_text: [{ text: { content: homework || '' } }] },
    '다음 수업 준비': { rich_text: [{ text: { content: nextPrepare || '' } }] },
  };

  properties['학생 참여도'] = engagement ? { select: { name: engagement } } : { select: null };
  if (memo !== undefined) {
    properties['메모'] = { rich_text: [{ text: { content: memo || '' } }] };
  }

  return updatePage(pageId, properties);
}

/** 수동으로 수업 일지 생성 (GitHub Actions가 아직 생성 안 한 경우) */
export async function createLessonLog({ title, classId, studentIds }) {
  const properties = {
    제목: { title: [{ text: { content: title } }] },
  };
  if (classId) properties['수업'] = { relation: [{ id: classId }] };
  if (studentIds?.length) properties['학생'] = { relation: studentIds.map((id) => ({ id })) };

  return createPage(LESSON_LOGS_DB, properties);
}

export function parseLessonLog(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: getTitle(p['제목']),
    createdTime: page.created_time ?? '',
    // rollup '수업 일시'(수업 relation → 수업 일시, 2026-09-04). 목록 정렬·월 필터는 이 값을 우선 쓰고,
    // 수업이 연결되지 않은 옛 일지만 생성 시각으로 대신한다.
    classDate: page.properties['수업 일시']?.rollup?.date?.start ?? null,
    classId: getRelationId(p['수업']),
    studentIds: getRelationIds(p['학생']),
    content: getRichText(p['오늘 내용']),
    homework: getRichText(p['숙제']),
    nextPrepare: getRichText(p['다음 수업 준비']),
    engagement: getSelect(p['학생 참여도']),
    memo: getRichText(p['메모']),
  };
}

export function isEmpty(log) {
  return !log.content && !log.homework && !log.nextPrepare;
}

/**
 * 수업 id 목록 → { [classId]: { writtenLogId, anyLogId } }.
 *
 * "일지가 있다"와 "일지를 썼다"는 다르다 — create_lesson_logs.mjs가 매시간 완료 수업에 **빈 일지**를
 * 만들어 두기 때문에 relation 존재만 보면 안 쓴 일지도 '작성됨'으로 오판한다(2026-09-04, 이소미 수업:
 * 자동 생성 빈 일지 + 앱에서 쓴 일지가 같은 수업에 2개 달려 있었고 카드는 빈 쪽을 열었다).
 * 그래서 내용이 있는 일지(writtenLogId)와 아무 일지(anyLogId)를 구분해 돌려준다.
 */
export async function fetchLogsByClassIds(classIds) {
  const ids = [...new Set((classIds ?? []).filter(Boolean))];
  const map = {};
  if (ids.length === 0) return map;
  const filter = ids.length === 1
    ? { property: '수업', relation: { contains: ids[0] } }
    : { or: ids.map((id) => ({ property: '수업', relation: { contains: id } })) };
  const pages = await queryAll(LESSON_LOGS_DB, filter, [{ timestamp: 'created_time', direction: 'ascending' }]);
  for (const page of pages) {
    const log = parseLessonLog(page);
    if (!log.classId) continue;
    const slot = (map[log.classId] ??= { writtenLogId: null, anyLogId: null });
    if (!slot.anyLogId) slot.anyLogId = log.id;
    if (!slot.writtenLogId && !isEmpty(log)) slot.writtenLogId = log.id;
  }
  return map;
}

/** parseClass 결과 배열에 writtenLogId·anyLogId를 붙인다(홈·수업 마무리 공용). */
export async function attachLogInfo(classes) {
  const map = await fetchLogsByClassIds(classes.map((c) => c.id));
  return classes.map((c) => ({ ...c, ...(map[c.id] ?? { writtenLogId: null, anyLogId: c.lessonLogIds?.[0] ?? null }) }));
}
