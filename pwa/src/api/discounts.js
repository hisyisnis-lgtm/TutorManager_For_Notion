import { queryAll } from './notionClient.js';

export const DISCOUNTS_DB = '314838fa-f2a6-81d3-9ce4-c628edab065b';

export async function fetchActiveDiscounts() {
  // 활성 여부 formula로 필터링 (formula boolean 필터)
  return queryAll(DISCOUNTS_DB, {
    or: [
      { property: '강제 ON', checkbox: { equals: true } },
      {
        and: [
          { property: '강제 OFF', checkbox: { equals: false } },
          { property: '시작일', date: { is_not_empty: true } },
          { property: '종료일', date: { is_not_empty: true } },
          { property: '시작일', date: { on_or_before: new Date().toISOString().split('T')[0] } },
          { property: '종료일', date: { on_or_after: new Date().toISOString().split('T')[0] } },
        ],
      },
    ],
  });
}

export async function fetchAllDiscounts() {
  return queryAll(DISCOUNTS_DB, undefined, [
    { property: '이벤트명', direction: 'ascending' },
  ]);
}

export function parseDiscount(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: p['이벤트명']?.title?.[0]?.plain_text ?? '',
    rate: p['할인율(%)']?.number ?? 0,
    startDate: p['시작일']?.date?.start ?? null,
    endDate: p['종료일']?.date?.start ?? null,
    isActive: p['활성 여부']?.formula?.boolean ?? false,
  };
}
