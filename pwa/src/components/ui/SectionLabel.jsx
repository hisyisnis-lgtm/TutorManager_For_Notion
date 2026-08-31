import { PRIMARY } from '../../constants/theme';

export default function SectionLabel({ children }) {
  return (
    <span style={{
      display: 'inline-block',
      // antd Tag가 주던 것 중 span에 없는 두 가지를 이어받는다.
      // lineHeight는 무단위로 둔다 — 호출부가 fontSize를 키울 때(예: 숙제 상세 15px)
      // 같이 커져야 세로 균형이 유지된다. 고정 20px이면 그 경우 깨진다.
      lineHeight: 1.6667,
      whiteSpace: 'nowrap',
      backgroundColor: 'rgba(127,0,5,0.08)', color: PRIMARY,
      border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700,
      marginBottom: 10, letterSpacing: '0.05em', padding: '2px 10px',
    }}>
      {children}
    </span>
  );
}
