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
/** 편지지 톤(따뜻한 오프화이트) — 손편지 느낌 카드 전용 */
export const BG_LETTER = '#fffdf8';

// ── 중립 회색 (면·구분선) ───────────────────────────────
// 2026-08-25 신설. 그 전까지 #f5f5f5(17곳)·#f0f0f0(9곳)·#fafafa(5곳)가 토큰 없이 흩어져 있었다.
/** 아주 옅은 면 — 리스트 안쪽 행, 보조 영역 */
export const GRAY_50 = '#fafafa';
/** 비활성 버튼·칩·배지 배경 (가장 많이 쓰이는 중립 면) */
export const GRAY_100 = '#f5f5f5';
/** 연한 구분선·보더 */
export const GRAY_200 = '#f0f0f0';
/** 또렷한 보더 */
export const GRAY_300 = '#e0e0e0';
/** 진한 잉크 — 다크 배지·강조 배경 */
export const INK_900 = '#262626';

// ── 외부 브랜드 색 (SNS 아이콘 전용) ─────────────────────
// 우리 팔레트가 아니라 상대 브랜드 규정을 따르는 값. 단일 액센트 정책(§16)의 예외.
export const BRAND_EXTERNAL = {
  naver: '#03C75A',
  instagram: '#E1306C',
  youtube: '#FF0000',
  kakao: '#FEE500',
};

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
export const STATUS_WARNING_BORDER = '#ffd591';
export const STATUS_WARNING_TEXT = '#d46b08';
export const STATUS_WARNING_TEXT_DARK = '#ad4e00';
export const STATUS_ERROR = '#ff4d4f';
export const STATUS_ERROR_BG = '#fff2f0';
export const STATUS_ERROR_TEXT = '#cf1322';
export const STATUS_ERROR_BORDER = '#ffccc7';
export const STATUS_SUCCESS_BORDER = '#b7eb8f';
// ── 보조 상태 색 (배지 전용) ─────────────────────────────
// ⚠️ 배지 배경/텍스트 조합으로만 쓴다. 본문 텍스트·인터랙티브 요소에 쓰지 말 것.
//    "단일 액센트(#7f0005)" 정책의 예외가 아니라, 상태를 구분하는 의미색이다.
export const STATUS_TEAL_BG = '#e6fffb';
export const STATUS_TEAL_TEXT = '#08979c';
export const STATUS_GOLD_BG = '#fffbe6';
export const STATUS_GOLD_TEXT = '#d48806';
export const STATUS_PURPLE_BG = '#f9f0ff';
export const STATUS_PURPLE_TEXT = '#531dab';
export const STATUS_INFO = '#1677ff';
export const STATUS_INFO_DARK = '#0958d9';
export const STATUS_INFO_BG = '#e6f4ff';

// ── 그라데이션 ─────────────────────────────────────────
export const GRADIENTS = {
  /** HeroSection 메인 그라데이션 */
  hero: 'linear-gradient(150deg, #6b0004 0%, #7f0005 50%, #9a0007 100%)',
  /** PandaPage 심플 버티컬 그라데이션 */
  panda: 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)',
  /** 학생앱 상단 히어로 */
  studentHero: 'linear-gradient(135deg, #7f0005 0%, #a80006 100%)',
  /** 온보딩 캐러셀 브랜드 존 */
  onboarding: 'linear-gradient(160deg, #6b0004 0%, #9a0007 100%)',
  /** 판다 위젯 경험치 바 (앰버) */
  xp: 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)',
};

/** 온보딩 캐러셀 밝은 존 배경 (따뜻한 중립 그레이) */
export const BG_WARM = '#f7f5f3';

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
