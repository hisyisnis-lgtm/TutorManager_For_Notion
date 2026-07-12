// 수업 유형 이름 판정 — Notion '수업 유형' 제목 문자열 매칭의 단일 출처.
// Notion에서 유형 이름이 바뀌면 여기 한 곳만 고친다 (이전엔 5개 파일에 같은 includes가 산재해
// 이름 변경 시 조용히 동시 파손되는 구조였음). title은 undefined/null 허용.

export const isOnlineGroupTitle = (title) => !!title?.includes('온라인그룹수업');

export const isFreeConsultTitle = (title) => !!title?.includes('무료상담');

// 고정 가격 상품 — 1인 단가가 총액 기준으로 저장되는 유형
export const isFixedPriceTitle = (title) =>
  !!(title?.includes('원데이클래스') || title?.includes('체험수업'));
