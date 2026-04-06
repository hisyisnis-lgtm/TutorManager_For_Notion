import { PRIMARY } from '../../constants/theme';

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
      style={{
        width: fullWidth ? '100%' : undefined,
        height: 44, borderRadius: 12, fontSize: 14, fontWeight: 500,
        cursor: 'pointer',
        transition: 'background-color 0.2s, border-color 0.2s, color 0.2s',
        border: `1px solid ${selected ? PRIMARY : '#d9d9d9'}`,
        backgroundColor: selected ? PRIMARY : '#ffffff',
        color: selected ? '#ffffff' : '#595959',
        textAlign: fullWidth ? 'left' : 'center',
        padding: fullWidth ? '0 16px' : '0',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
