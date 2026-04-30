import { queryPage, createPage, updatePage } from './notionClient.js';
import {
  getTitle,
  getRichText,
  getSelect,
  getRelationId,
  getRelationIds,
} from '../utils/notionProp.js';

export const LESSON_LOGS_DB = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';

export const ENGAGEMENT_OPTIONS = ['😊 좋음', '😐 보통', '😞 저조'];

export async function fetchLessonLogsPage(opts = {}) {
  const { studentId, cursor } = opts;
  const filter = studentId
    ? { property: '학생', relation: { contains: studentId } }
    : undefined;

  return queryPage(
    LESSON_LOGS_DB,
    filter,
    [{ timestamp: 'created_time', direction: 'descending' }],
    cursor
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
