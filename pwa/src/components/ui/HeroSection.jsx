import { PRIMARY } from '../../constants/theme';

const HANZI_PARTICLES = [
  { char: '好', left: '6%',  bottom: '10%', size: 24, delay: '0s',   dur: '7s'   },
  { char: '学', left: '20%', bottom: '5%',  size: 17, delay: '2.2s', dur: '8.5s' },
  { char: '说', left: '38%', bottom: '14%', size: 26, delay: '0.8s', dur: '6.5s' },
  { char: '语', left: '57%', bottom: '7%',  size: 19, delay: '3.1s', dur: '7.5s' },
  { char: '中', left: '72%', bottom: '13%', size: 22, delay: '0.4s', dur: '9s'   },
  { char: '文', left: '84%', bottom: '4%',  size: 16, delay: '1.8s', dur: '6s'   },
  { char: '话', left: '13%', bottom: '24%', size: 15, delay: '4s',   dur: '8s'   },
  { char: '音', left: '62%', bottom: '22%', size: 14, delay: '1.4s', dur: '7s'   },
  { char: '口', left: '46%', bottom: '2%',  size: 18, delay: '2.8s', dur: '6.5s' },
];

/**
 * HeroSection — 빨간 그라데이션 히어로 공유 컴포넌트
 * PricingPage 와 IntroContent 에서 공통으로 사용합니다.
 * 배경·장식 요소를 수정할 때 이 파일만 수정하면 두 곳에 모두 반영됩니다.
 *
 * @param {React.ReactNode} children - 섹션 안에 표시할 콘텐츠
 * @param {React.Ref}       sectionRef - section 엘리먼트에 연결할 ref (선택)
 * @param {object}          style - section 스타일 override (padding, borderRadius 등)
 */
export default function HeroSection({ children, sectionRef, style }) {
  return (
    <section
      ref={sectionRef}
      style={{
        background: `linear-gradient(150deg, #6b0004 0%, ${PRIMARY} 50%, #9a0007 100%)`,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '0 0 28px 28px',
        ...style,
      }}
    >
      {/* 배경: 심볼 로고 장식 */}
      <img
        aria-hidden="true"
        src="/logo/symbol-white.png"
        alt=""
        style={{
          position: 'absolute', right: -24, bottom: -20,
          width: 300, height: 300,
          objectFit: 'contain',
          opacity: 0.07,
          pointerEvents: 'none', userSelect: 'none',
        }}
      />
      {/* 배경: 상단 빛 번짐 */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: -80, right: -60,
        width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.09) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* 한자 파티클 */}
      {HANZI_PARTICLES.map(({ char, left, bottom, size, delay, dur }) => (
        <span
          key={`${char}-${left}`}
          data-particle
          aria-hidden="true"
          style={{
            position: 'absolute', left, bottom,
            fontSize: size, lineHeight: 1,
            color: 'white', fontFamily: 'serif',
            animation: `hanziFloat ${dur} ease-in-out ${delay} infinite both`,
            pointerEvents: 'none', userSelect: 'none',
            zIndex: 1,
          }}
        >{char}</span>
      ))}
      {/* 콘텐츠 */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {children}
      </div>
    </section>
  );
}
