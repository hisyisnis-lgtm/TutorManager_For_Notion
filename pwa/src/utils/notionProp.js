// Notion API 응답의 properties 객체에서 값을 추출하는 헬퍼.
// 각 함수는 단일 property 객체를 받아 적절한 fallback과 함께 값을 반환.

export const getTitle = (prop, fallback = '') =>
  prop?.title?.[0]?.plain_text ?? fallback;

export const getRichText = (prop, fallback = '') =>
  prop?.rich_text?.[0]?.plain_text ?? fallback;

export const getSelect = (prop, fallback = null) =>
  prop?.select?.name ?? fallback;

export const getNumber = (prop, fallback = 0) =>
  prop?.number ?? fallback;

export const getDate = (prop, fallback = null) =>
  prop?.date?.start ?? fallback;

export const getCheckbox = (prop, fallback = false) =>
  prop?.checkbox ?? fallback;

export const getEmail = (prop, fallback = '') =>
  prop?.email ?? fallback;

export const getPhone = (prop, fallback = '') =>
  prop?.phone_number ?? fallback;

export const getCreatedTime = (prop, fallback = '') =>
  prop?.created_time ?? fallback;

export const getFormulaString = (prop, fallback = '') =>
  prop?.formula?.string ?? fallback;

export const getFormulaNumber = (prop, fallback = 0) =>
  prop?.formula?.number ?? fallback;

export const getFormulaDate = (prop, fallback = null) =>
  prop?.formula?.date?.start ?? fallback;

export const getRollupNumber = (prop, fallback = 0) =>
  prop?.rollup?.number ?? fallback;

export const getRelationIds = (prop) =>
  prop?.relation?.map((r) => r.id) ?? [];

export const getRelationId = (prop, fallback = null) =>
  prop?.relation?.[0]?.id ?? fallback;
