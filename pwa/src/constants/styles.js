/**
 * 반복되는 인라인 스타일 객체 상수
 * - 여러 페이지/컴포넌트에서 동일한 패턴으로 사용되는 스타일
 * - design_system.md 타이포그래피·버튼·카드 기준에 정합
 */
import { TEXT_PRIMARY, TEXT_TERTIARY } from './theme.js';

// ── 섹션 헤딩 (홈/상세 카드 내부 17px) ────────────────────
export const SECTION_HEADING = {
  fontSize: 17,
  fontWeight: 600,
  color: TEXT_PRIMARY,
  display: 'block',
  marginBottom: 10,
};

// ── 상태 배지 (pill) ─────────────────────────────────────
/** 카드 내부 인라인 작은 배지 (상태·태그) */
export const BADGE_SMALL = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 20,
};
/** 강조 배지 (히어로 카드·예약 현황 등) */
export const BADGE_MEDIUM = {
  fontSize: 12,
  fontWeight: 700,
  padding: '4px 10px',
  borderRadius: 20,
};

// ── 전역 BottomNav 회피 오프셋 ────────────────────────────
/**
 * 페이지가 자체 하단 고정 바(선택 삭제 바·CTA 등)를 둘 때 쓰는 bottom 값.
 * BottomNav는 `fixed; bottom:0; zIndex:50`이고 실제 렌더 높이는 **62.3px**(+safe-area)다.
 * CLAUDE.md의 "60px"은 어림값이라 그대로 쓰면 2px 겹친다(2026-08-26 실측으로 확인).
 * 이 값을 쓰는 요소의 zIndex는 반드시 50 미만으로 둘 것.
 */
export const ABOVE_BOTTOM_NAV = 'calc(62px + env(safe-area-inset-bottom))';

/**
 * 페이지 안에서 PageHeader 바로 아래에 sticky로 붙이는 요소(탭 바 등)의 top 값.
 * PageHeader는 `sticky; top:0; zIndex:40`, 실측 높이 56 + 하단 보더 ≈ 56.7px.
 * 56을 쓰면 보더 두께만큼 헤더 뒤로 살짝 들어가 **틈이 안 생긴다**(헤더가 zIndex로 위에 있음).
 * 57 이상이면 스크롤 중 1px 틈으로 콘텐츠가 비친다.
 * 붙이는 요소는 zIndex 40 미만 + **불투명 배경**(BG_APP)을 반드시 줄 것 — 안 그러면 카드가 비친다.
 */
export const BELOW_PAGE_HEADER = 56;

// ── 풋노트 (탭 하단 안내문) ──────────────────────────────
export const FOOTNOTE = {
  fontSize: 12,
  textAlign: 'center',
  color: TEXT_TERTIARY,
  margin: '12px 0 24px',
};
