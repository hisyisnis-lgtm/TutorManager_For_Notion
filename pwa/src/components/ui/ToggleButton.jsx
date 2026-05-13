import { PRIMARY, BORDER_NEUTRAL, TEXT_SECONDARY } from '../../constants/theme';

/**
 * ToggleButton — 선택/비선택 상태를 가진 토글 버튼
 * LandingPage 무료상담 폼에서 레벨 선택 등에 사용합니다.
 */
export default function ToggleButton({ label, selected, onClick, fullWidth = false, style = {} }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="active:scale-[0.96] transition-[scale,background-color,border-color,color] duration-150 ease-out"
      style={{
        width: fullWidth ? '100%' : undefined,
        height: 44, borderRadius: 12, fontSize: 14, fontWeight: 500,
        cursor: 'pointer',
        border: `1px solid ${selected ? PRIMARY : BORDER_NEUTRAL}`,
        backgroundColor: selected ? PRIMARY : '#ffffff',
        color: selected ? '#ffffff' : TEXT_SECONDARY,
        textAlign: fullWidth ? 'left' : 'center',
        padding: fullWidth ? '0 16px' : '0',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
