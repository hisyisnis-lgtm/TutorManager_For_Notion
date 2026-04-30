/**
 * TutorManager PWA 디자인 토큰
 * - 모든 색상·그림자·그라데이션은 여기서 단일 출처로 관리
 * - 변경 시 design_system.md 메모리도 함께 업데이트
 */

// ── 브랜드 ─────────────────────────────────────────────
export const PRIMARY = '#7f0005';
export const PRIMARY_DARK = '#6b0004';
export const PRIMARY_LIGHT = '#9a0007';
export const PRIMARY_BG = '#fff0f1';
/** 브랜드 반투명(섹션 라벨, 배지 배경 등) */
export const PRIMARY_ALPHA_08 = 'rgba(127,0,5,0.08)';
export const PRIMARY_ALPHA_20 = 'rgba(127,0,5,0.2)';
export const PRIMARY_ALPHA_25 = 'rgba(127,0,5,0.25)';
export const PRIMARY_ALPHA_35 = 'rgba(127,0,5,0.35)';

// ── 텍스트 ─────────────────────────────────────────────
export const TEXT_PRIMARY = '#1d1d1f';
export const TEXT_BODY = '#1a1a1a';
export const TEXT_SECONDARY = '#595959';
export const TEXT_TERTIARY = '#767676';
export const TEXT_INACTIVE = '#8c8c8c';
export const TEXT_DISABLED = '#bfbfbf';

// ── 배경 ───────────────────────────────────────────────
export const BG_APP = '#f9fafb';
export const BG_PUBLIC = '#ffffff';
export const BG_SECTION_ALT = '#f5f5f7';
export const BG_CARD = '#ffffff';
export const BG_ICON_NEUTRAL = '#f9fafb';
export const BG_DARK = '#1a1a1a';
export const BG_SUCCESS = '#f6ffed';

// ── 테두리 ─────────────────────────────────────────────
export const BORDER_SUBTLE = 'rgba(0,0,0,0.06)';
export const BORDER_DEFAULT = '#ebebeb';
export const BORDER_INPUT = 'rgba(0,0,0,0.15)';
export const BORDER_NEUTRAL = '#d9d9d9';

// ── 상태 (antd 기본 + 확장) ─────────────────────────────
export const STATUS_SUCCESS = '#52c41a';
export const STATUS_SUCCESS_DARK = '#389e0d';
export const STATUS_SUCCESS_BG = '#f6ffed';
export const STATUS_WARNING = '#faad14';
export const STATUS_WARNING_BG = '#fff7e6';
export const STATUS_ERROR = '#ff4d4f';
export const STATUS_ERROR_BG = '#fff2f0';
export const STATUS_ERROR_TEXT = '#cf1322';
export const STATUS_ERROR_BORDER = '#ffccc7';
export const STATUS_INFO = '#1677ff';
export const STATUS_INFO_DARK = '#0958d9';

// ── 그라데이션 ─────────────────────────────────────────
export const GRADIENTS = {
  /** HeroSection 메인 그라데이션 */
  hero: 'linear-gradient(150deg, #6b0004 0%, #7f0005 50%, #9a0007 100%)',
  /** PandaPage 심플 버티컬 그라데이션 */
  panda: 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)',
};

// ── 그림자 ─────────────────────────────────────────────
/**
 * 주의: 인라인에서 아래 값을 직접 쓰기보다
 *   boxShadow: 'var(--shadow-border)' 등 CSS 변수 사용 권장.
 *   (CSS 변수는 index.css에 정의됨)
 */
export const SHADOWS = {
  nav: '0px -1px 0px 0px rgba(0,0,0,0.06), 0px -2px 8px 0px rgba(0,0,0,0.04)',
  brandButton: `0 4px 16px ${PRIMARY_ALPHA_35}`,
  brandCard: `0 4px 16px ${PRIMARY_ALPHA_25}`,
  modal: '0 8px 40px rgba(0,0,0,0.18)',
};

// ── 공통 객체 (편의) ───────────────────────────────────
export const COLORS = {
  primary: PRIMARY,
  primaryDark: PRIMARY_DARK,
  primaryLight: PRIMARY_LIGHT,
  primaryBg: PRIMARY_BG,
  text: {
    primary: TEXT_PRIMARY,
    body: TEXT_BODY,
    secondary: TEXT_SECONDARY,
    tertiary: TEXT_TERTIARY,
    inactive: TEXT_INACTIVE,
    disabled: TEXT_DISABLED,
  },
  bg: {
    app: BG_APP,
    public: BG_PUBLIC,
    sectionAlt: BG_SECTION_ALT,
    card: BG_CARD,
    iconNeutral: BG_ICON_NEUTRAL,
    dark: BG_DARK,
    success: BG_SUCCESS,
  },
  border: {
    subtle: BORDER_SUBTLE,
    default: BORDER_DEFAULT,
    input: BORDER_INPUT,
    neutral: BORDER_NEUTRAL,
  },
};

// ── Ant Design v6 테마 ─────────────────────────────────
export const antdTheme = {
  token: {
    colorPrimary: PRIMARY,
    borderRadius: 12,
    colorBgContainer: '#ffffff',
    fontFamily: 'inherit',
  },
};
