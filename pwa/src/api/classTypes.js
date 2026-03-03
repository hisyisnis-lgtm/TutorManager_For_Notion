import { queryAll } from './notionClient.js';

export const CLASS_TYPES_DB = '314838fa-f2a6-81c3-b4e4-da87c48f9b43';

export async function fetchAllClassTypes() {
  return queryAll(CLASS_TYPES_DB, undefined, [
    { property: '수업 유형', direction: 'ascending' },
    { property: '타이틀', direction: 'ascending' },
  ]);
}

export function parseClassType(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: p['타이틀']?.title?.[0]?.plain_text ?? '',
    classType: p['수업 유형']?.select?.name ?? '',
    duration: p['시간(분)']?.number ?? 60,
    unitPrice: p['1인 단가']?.number ?? 0,
    memo: p['메모']?.rich_text?.[0]?.plain_text ?? '',
  };
}
