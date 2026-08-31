import {
  Button } from '../shadcn/button';
import FadeUp from '../FadeUp';
import { TEXT_BODY,
  TEXT_SECONDARY,
  TEXT_TERTIARY } from '../../constants/theme';


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
        <span style={{ fontWeight: 600, fontSize: 16, color: TEXT_BODY, lineHeight: 1.65, display: 'block', marginBottom: 6, textAlign: 'center' }}>
          현재 레벨과 목표에 따라<br />가장 적합한 방향을 함께 안내드립니다.
        </span>
        <span style={{ color: TEXT_TERTIARY, fontSize: 13, display: 'block', marginBottom: 24, textAlign: 'center' }}>
          편하게 상담 신청해 주세요 :)
        </span>
        <Button
          size="lg" block
          className={className}
          onClick={onCtaClick}
          style={{ marginBottom: 14 }}
        >
          무료 상담 신청하기
        </Button>
        <a
          href="https://pf.kakao.com/_jFnFn"
          target="_blank" rel="noopener noreferrer"
          style={{ display: 'block', textAlign: 'center', fontSize: 13, color: TEXT_SECONDARY, textDecoration: 'none' }}
        >
          채널톡으로 문의하기 →
        </a>
      </section>
    </FadeUp>
  );
}
