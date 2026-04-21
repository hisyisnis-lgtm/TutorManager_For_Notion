import { Button } from 'antd';
import { ArrowRightIcon } from '@phosphor-icons/react';

/**
 * FloatingCtaButton — 스크롤 시 나타나는 플로팅 "무료 상담 신청" 버튼
 * LandingPage · PricingPage 소개 탭에서 공통으로 사용합니다.
 *
 * @param {boolean}  visible  - 버튼 표시 여부 (true: 표시)
 * @param {Function} onClick  - 버튼 클릭 콜백
 */
export default function FloatingCtaButton({ visible, onClick }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%',
      zIndex: 200,
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(16px)',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <Button
        type="primary" size="large" onClick={onClick}
        style={{
          height: 48, borderRadius: 24, fontWeight: 700, fontSize: 15,
          paddingInline: 28, boxShadow: 'var(--shadow-brand-button)',
        }}
      >
        무료 상담 신청 <ArrowRightIcon weight="fill" />
      </Button>
    </div>
  );
}
