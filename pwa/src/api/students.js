import { queryAll, queryPage, updatePage } from './notionClient.js';

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

/** 페이지별 학생 조회 (목록 UI용) */
export async function fetchStudentsPage(statusFilter, cursor) {
  const filter =
    statusFilter && statusFilter !== '전체'
      ? { property: '상태', select: { equals: statusFilter } }
      : undefined;

  return queryPage(STUDENTS_DB, filter, SORTS, cursor, 50);
}

/** 학생 상태 변경 */
export async function updateStudentStatus(pageId, status) {
  return updatePage(pageId, {
    상태: { select: { name: status } },
  });
}

/** Notion 페이지 → 학생 객체 변환 */
export function parseStudent(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: p['이름']?.title?.[0]?.plain_text ?? '(이름 없음)',
    phone: p['전화번호']?.phone_number ?? '',
    email: p['이메일']?.email ?? '',
    level: p['레벨']?.rich_text?.[0]?.plain_text ?? '',
    goal: p['목표']?.rich_text?.[0]?.plain_text ?? '',
    status: p['상태']?.select?.name ?? '',
    remainingSessions: p['잔여 시간 회차']?.formula?.number ?? 0,
    unpaidAmount: p['미수금 합계']?.rollup?.number ?? 0,
    memo: p['메모']?.rich_text?.[0]?.plain_text ?? '',
    createdAt: p['등록일']?.created_time ?? '',
  };
}

export const STATUS_OPTIONS = ['🟢 수강중', '🟡 일시중단', '⚫ 수강종료'];

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
