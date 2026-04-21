/**
 * 반복되는 인라인 스타일 객체 상수
 * - 여러 페이지/컴포넌트에서 동일한 패턴으로 사용되는 스타일
 * - design_system.md 타이포그래피·버튼·카드 기준에 정합
 */
import { PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY } from './theme.js';

// ── Form 라벨 (Typography.Text strong 형태로 사용) ─────────
export const FORM_LABEL = {
  fontSize: 14,
  color: TEXT_SECONDARY,
  display: 'block',
  marginBottom: 6,
};

// ── 섹션 헤딩 (홈/상세 카드 내부 17px) ────────────────────
export const SECTION_HEADING = {
  fontSize: 17,
  fontWeight: 600,
  color: TEXT_PRIMARY,
  display: 'block',
  marginBottom: 10,
};

// ── 카드 기본 (variant="borderless" 용) ───────────────────
export const CARD_BASE = {
  borderRadius: 12,
  boxShadow: 'var(--shadow-border)',
};

export const CARD_PROMINENT = {
  borderRadius: 12,
  boxShadow: 'var(--shadow-card)',
};

// ── 대형 CTA 버튼 (폼 제출, 랜딩 CTA) ─────────────────────
export const CTA_LARGE = {
  height: 48,
  borderRadius: 12,
  fontWeight: 700,
  fontSize: 15,
};

// ── 표준 Primary 버튼 ────────────────────────────────────
export const CTA_STANDARD = {
  height: 44,
  borderRadius: 12,
  fontWeight: 600,
  fontSize: 14,
};

// ── Pill Link (랜딩 페이지 보조 CTA) ──────────────────────
export const PILL_LINK = {
  borderRadius: 980,
  border: `1px solid ${PRIMARY}`,
  color: PRIMARY,
  backgroundColor: 'transparent',
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 500,
};

// ── 카드 body padding (Card styles.body.padding 용) ───────
/** 리스트 카드 기본 (ClassCard, PaymentCard 등) */
export const CARD_PADDING = '14px 16px';
/** 밀도 높은 리스트 (HomeworkAlertCard 등) */
export const CARD_PADDING_COMPACT = '12px 16px';
/** 상세/콘텐츠 카드 */
export const CARD_PADDING_DETAIL = 16;

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

// ── 섹션 여백 (탭 내부 세로 리듬) ────────────────────────
/** 탭 콘텐츠 좌우 패딩 (탭 내부 섹션) */
export const TAB_PADDING_X = 16;
/** 섹션 그룹 간 세로 간격 */
export const SECTION_GAP = 24;

// ── 풋노트 (탭 하단 안내문) ──────────────────────────────
export const FOOTNOTE = {
  fontSize: 12,
  textAlign: 'center',
  color: TEXT_TERTIARY,
  margin: '12px 0 24px',
};
