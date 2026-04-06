import { Button, Typography } from 'antd';
import FadeUp from '../FadeUp';

const { Text } = Typography;

/**
 * CtaSection — "무료 상담 신청하기" 하단 CTA 섹션
 * IntroContent · PricingPage 에서 공통으로 사용합니다.
 *
 * @param {Function} onCtaClick - "무료 상담 신청하기" 버튼 클릭 콜백
 * @param {string}   [className] - 버튼에 추가할 className (예: "cta-btn")
 * @param {React.Ref} [sectionRef] - section 엘리먼트에 연결할 ref (선택)
 */
export default function CtaSection({ onCtaClick, className, sectionRef }) {
  return (
    <FadeUp>
      <section ref={sectionRef} style={{ padding: '36px 24px 32px' }}>
        <Text strong style={{ fontSize: 16, color: '#1a1a1a', lineHeight: 1.65, display: 'block', marginBottom: 6, textAlign: 'center' }}>
          현재 레벨과 목표에 따라<br />가장 적합한 방향을 함께 안내드립니다.
        </Text>
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 24, textAlign: 'center' }}>
          편하게 상담 신청해 주세요 :)
        </Text>
        <Button
          type="primary" size="large" block
          className={className}
          onClick={onCtaClick}
          style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15, marginBottom: 14 }}
        >
          무료 상담 신청하기
        </Button>
        <a
          href="https://pf.kakao.com/_jFnFn"
          target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', textAlign: 'center', fontSize: 13, color: '#595959', textDecoration: 'none' }}
        >
          채널톡으로 문의하기 →
        </a>
      </section>
    </FadeUp>
  );
}
