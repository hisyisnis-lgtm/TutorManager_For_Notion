// 타이틀 — 모드 선택의 들판 레이어 위에서 성조 캐릭터가 강강술래한다.
import { useEffect, useRef, useState } from 'react';
import { TG, TYPE, TOUCH_OPT, TONE_KEY_COLORS, FONT_TANTAN, RADIUS } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark } from '../tgWidgets.jsx';
import { FigmaScreen, prefersReducedMotion } from './shared.jsx';
import { Eyes, markSize } from './eyes.jsx';
import FieldIllustration from './FieldIllustration.jsx';

const S = 0.93; // 시안 실측 스케일(마크 63.1/68)
// 배경과 같은 좌표를 사용해 캐릭터와 그림자를 새 들판의 잔디 위에 놓는다.
const ORBIT = { rx: 128, ry: 34, period: 45 };
// 큰 화면에서는 풍경이 위까지 차오르고, 작은 화면에서는 로고 아래 공간을 남긴다.
const FIELD_HEIGHT = 'clamp(440px, 82dvh, 700px)';
const BASE_DEG = { 3: -90, 4: -18, 0: 54, 1: 126, 2: 198 };
const TILTS = { 1: -8, 2: 6, 3: 0, 4: -6, 0: 8 };
// 그림자 — 시안 그대로 #D2DDAE + MULTIPLY(CSS mix-blend-mode). 평탄화하면 풀 무늬(#BBC45F) 위에서 블렌드가 깨짐.
const SHADOW = { w: 47, h: 16, color: '#D2DDAE', dy: 27 };
// 말풍선 — 성조별 짧은 한마디(무음)
const LINES = {
  1: ['1성!', '같이 돌자~', '안녕!'],
  2: ['2성~', '신난다', '올라가요'],
  3: ['3성!', '빙글빙글', '요리조리'],
  4: ['4성!', '데구르르', '간다~'],
  0: ['경성…', '어지러워~', '히히'],
};

function OrbitStage() {
  const wrapRef = useRef(null);
  const charRefs = useRef({});
  const shadowRefs = useRef({});
  const [say, setSay] = useState(null); // { num, line }
  useEffect(() => {
    const reduced = prefersReducedMotion();
    let raf = 0;
    const t0 = performance.now();
    const place = (now) => {
      const W = wrapRef.current ? wrapRef.current.clientWidth : 390;
      const H = wrapRef.current ? wrapRef.current.clientHeight : 480;
      const cx0 = W / 2;
      const cy0 = H * 0.78; // 집 앞 잔디로 궤도를 올려 전경과 화면 하단에 여유를 둔다
      const t = reduced ? 0 : ((now - t0) / 1000) * ((Math.PI * 2) / ORBIT.period);
      for (const num of [1, 2, 3, 4, 0]) {
        const el = charRefs.current[num]; if (!el) continue;
        const a = (BASE_DEG[num] * Math.PI) / 180 + t;
        const x = cx0 + Math.min(ORBIT.rx, W / 2 - 44) * Math.cos(a);
        const y = cy0 + Math.min(ORBIT.ry, H * 0.06) * Math.sin(a);
        // 중심축 회전(회전목마) 깊이감 — 뒤(위)로 가면 작게·앞(아래)로 오면 크게. 그림자도 같은 비율.
        const k = 1 + 0.14 * Math.sin(a); // 0.86(뒤) ~ 1.14(앞)
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
        el.style.zIndex = String(100 + Math.round(y)); // 앞(아래쪽)이 위로
        const sh = shadowRefs.current[num];
        if (sh) sh.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + SHADOW.dy * k).toFixed(1)}px, 0) scale(${k.toFixed(3)})`;
      }
      if (!reduced) raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    // 모션 최소화 모드는 rAF 루프가 없어 리사이즈 때 재배치
    const onResize = () => { if (reduced) place(performance.now()); };
    window.addEventListener('resize', onResize);
    // 가끔 한 명씩 말하기 — 5.5~9.5초 간격, 2.3초 노출
    let speakT, hideT;
    const speakLoop = () => {
      speakT = setTimeout(() => {
        const nums = [1, 2, 3, 4, 0];
        const num = nums[Math.floor(Math.random() * nums.length)];
        const pool = LINES[num];
        setSay({ num, line: pool[Math.floor(Math.random() * pool.length)] });
        hideT = setTimeout(() => setSay(null), 2300);
        speakLoop();
      }, 5500 + Math.random() * 4000);
    };
    speakLoop();
    return () => { cancelAnimationFrame(raf); clearTimeout(speakT); clearTimeout(hideT); window.removeEventListener('resize', onResize); };
  }, []);
  return (
    <div ref={wrapRef} data-title-orbit="" style={{ position: 'absolute', inset: 0, bottom: 'env(safe-area-inset-bottom)', pointerEvents: 'none' }}>
      {/* 그림자 레이어 — 캐릭터 아래 z.
          ⚠️ mix-blend-mode는 스태킹 컨텍스트(willChange 등)를 만드는 래퍼 '자신'에 걸어야 배경(땅)과 섞임 —
          안쪽 자식에 걸면 래퍼가 격리해 블렌드가 무효(투명 부모와만 곱해짐) */}
      {[1, 2, 3, 4, 0].map((num) => (
        <div key={`sh${num}`} ref={(n) => { shadowRefs.current[num] = n; }} aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, zIndex: 50, willChange: 'transform', mixBlendMode: 'multiply' }}>
          <div style={{ width: SHADOW.w, height: SHADOW.h, marginLeft: -SHADOW.w / 2, marginTop: -SHADOW.h / 2, borderRadius: '50%', background: SHADOW.color }} />
        </div>
      ))}
      {/* 캐릭터 — 궤도 좌표는 rAF가 transform으로 */}
      {[1, 2, 3, 4, 0].map((num, i) => {
        const tone = TONES.find((t) => t.num === num);
        const bw = (num === 0 ? 42 : 68) * S, bh = (num === 0 ? 42 : 34) * S;
        return (
          <div key={num} ref={(n) => { charRefs.current[num] = n; }}
            style={{ position: 'absolute', left: 0, top: 0, willChange: 'transform' }}>
            <div style={{ position: 'relative', marginLeft: -bw / 2, marginTop: -bh / 2, width: bw, height: bh }}>
              {/* 말풍선 — 흰 카드 + 아래 꼬리(홈과 동일 문법) */}
              {say && say.num === num && (
                <div style={{ position: 'absolute', left: '50%', bottom: bh + 10, transform: 'translateX(-50%)', zIndex: 3 }}>
                  <div className="tg-enter" style={{ position: 'relative', background: '#fff', color: TG.INK, ...TYPE.labelSm, lineHeight: 1.2, padding: '5px 10px', borderRadius: RADIUS.md, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(43,39,48,0.2)' }}>
                    {say.line}
                    <div style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '7px solid #fff' }} />
                  </div>
                </div>
              )}
              {/* ⚠️ tg-bob 키프레임이 transform을 덮어씀 — 기울임(rotate)은 안쪽 별도 래퍼로 */}
              <div style={{ animation: `tg-bob ${2.4 + i * 0.35}s ease-in-out ${i * 0.22}s infinite` }}>
                <div style={{ position: 'relative', display: 'inline-block', color: tone.color, transform: `rotate(${TILTS[num]}deg)` }}>
                  <ToneMark tone={num} size={markSize(num) * S} outline={TONE_KEY_COLORS[num].dark} />
                  <Eyes num={num} i={num / 1.4} scale={S} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TitleScreen({ onStart }) {
  const reduced = prefersReducedMotion();
  return (
    <FigmaScreen>
      {/* 화면 전체 터치 시작 (뒤로가기 버튼 없음 — 나가기는 홈 메뉴에서) */}
      <div onClick={() => onStart && onStart()} style={{ position: 'absolute', inset: 0, cursor: 'pointer', ...TOUCH_OPT }}>
        {/* 같은 들판을 확대해 타이틀 무대로 사용. 캐릭터는 화면 폭 안에서만 돌며 배경과 높이를 공유한다. */}
        <div aria-hidden="true" className="tg-title-field" style={{ '--tg-title-field-height': FIELD_HEIGHT, position: 'absolute', left: 0, right: 0, bottom: 0, height: FIELD_HEIGHT, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', bottom: 0, width: 'calc(var(--tg-title-field-height) * 1.5)', height: '100%', transform: 'translateX(-50%)', maskImage: 'linear-gradient(to bottom, transparent, black 28%)' }}>
            <FieldIllustration />
          </div>
          <OrbitStage />
        </div>
        {/* 나뭇잎 파티클 — 하늘에서 살랑살랑 낙하(모션 최소화는 시안 위치 정지 3개) */}
        {reduced ? (
          <>
            <img src="/game/title-leaf.svg" alt="" aria-hidden="true" style={{ position: 'absolute', left: 'calc(50% - 161px)', top: '7.5%', width: 15, height: 23, transform: 'rotate(47deg)', pointerEvents: 'none', zIndex: 1010 }} />
            <img src="/game/title-leaf.svg" alt="" aria-hidden="true" style={{ position: 'absolute', left: 'calc(50% + 66px)', top: '10.4%', width: 15, height: 23, transform: 'rotate(-28deg)', pointerEvents: 'none', zIndex: 1010 }} />
            <img src="/game/title-leaf.svg" alt="" aria-hidden="true" style={{ position: 'absolute', left: 'calc(50% + 153px)', top: '35%', width: 15, height: 23, transform: 'rotate(-171deg)', pointerEvents: 'none', zIndex: 1010 }} />
          </>
        ) : (
          [{ left: '6%', dur: 14, delay: -3, sway: 2.6 }, { left: '36%', dur: 18, delay: -9, sway: 3.1 }, { left: '66%', dur: 23, delay: -15, sway: 2.9 }].map((p, i) => (
            <div key={i} aria-hidden="true" style={{ position: 'absolute', left: p.left, top: 0, pointerEvents: 'none', zIndex: 1010, animation: `tg-leaf-fall ${p.dur}s linear ${p.delay}s infinite` }}>
              <div style={{ animation: `tg-leaf-sway ${p.sway}s ease-in-out infinite alternate` }}>
                <img src="/game/title-leaf.svg" alt="" style={{ width: 15, height: 23, display: 'block' }} />
              </div>
            </div>
          ))
        )}

        {/* 타이틀 — 시안 542:40(2026-08-09 로고 리디자인): 288×134 @y124.
            레터링 '성조다락방'(288×59) + 부제 '매일매일 성조키우기'(244×26) + For 하늘하늘중국어 필.
            간격은 시안대로 로고↔부제 10, 부제↔필 14(gap 10 + marginTop 4). */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '14.7%', width: 288, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, zIndex: 1000 }}>
          <img src="/game/title-logo.svg" alt="성조다락방" style={{ display: 'block', width: 288, height: 'auto', animation: 'tg-logo-pop .7s cubic-bezier(.34,1.56,.64,1) both' }} />
          {/* 부제는 로고보다 한 박자 늦게 — 두 장이 동시에 튀면 한 덩어리로 뭉개져 보인다 */}
          <img src="/game/title-sub.svg" alt="매일매일 성조키우기" style={{ display: 'block', width: 244, height: 'auto', animation: 'tg-logo-pop .7s cubic-bezier(.34,1.56,.64,1) .09s both' }} />
          <div style={{ marginTop: 4, height: 25, padding: '0 12px', borderRadius: 43, background: '#2D1A0E', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: FONT_TANTAN, fontSize: 14, color: '#fff', lineHeight: 1 }}>For 하늘하늘중국어</span>
          </div>
        </div>

        {/* 안내는 로고 아래 하늘에 배치해 새 들판과 캐릭터를 가리지 않는다. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(14.7% + 164px)', display: 'flex', justifyContent: 'center', animation: 'tg-pulse 1.8s ease-in-out infinite', zIndex: 1000 }}>
          <span style={{ fontFamily: FONT_TANTAN, fontSize: 16, color: TG.INK, lineHeight: 1 }}>화면을 터치하면 시작합니다!</span>
        </div>
      </div>
    </FigmaScreen>
  );
}
