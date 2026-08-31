import { CircleNotchIcon } from '@phosphor-icons/react';
import { PRIMARY, TEXT_TERTIARY } from '../../constants/theme.js';

export default function LoadingSpinner({ message = '불러오는 중...' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '80px 0' }}>
      {/* antd Spin large는 32였지만 아이콘 스케일 토큰(12/16/20/24/44)에 없다(§19).
          44는 빈 상태 일러스트 전용이라 24로 맞춘다 — 스피너가 antd 때보다 8px 작아진다. */}
      <CircleNotchIcon size={24} weight="bold" className="animate-spin" style={{ color: PRIMARY }} aria-hidden />
      {/* role=status를 보이는 텍스트에 직접 건다. sr-only로 같은 문구를 한 번 더 넣으면
          스크린리더가 두 번 읽는다. */}
      <span role="status" style={{ fontSize: 14, color: TEXT_TERTIARY }}>{message}</span>
    </div>
  );
}
