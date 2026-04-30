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

// ── 풋노트 (탭 하단 안내문) ──────────────────────────────
export const FOOTNOTE = {
  fontSize: 12,
  textAlign: 'center',
  color: TEXT_TERTIARY,
  margin: '12px 0 24px',
};
