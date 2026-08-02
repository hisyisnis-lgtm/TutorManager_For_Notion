// 타이틀 화면 — 사용자 Figma 리디자인 v3(2026-07-29, 프레임 461:22): 초원 씬.
// 하늘(#FFFDF8) 아래 구름 능선 + 오두막(굴뚝 연기) + 나무들 + 연두 동산·풀밭 위에서
// 성조 캐릭터 5마리가 타원 궤도로 강강술래(45초/바퀴) + 가끔 말풍선(무음) + 나뭇잎 낙하.
// 장식 벡터는 시안에서 추출한 SVG 에셋(/game/title-*.svg). 세로 배치는 비율 기반(해상도 대응).
import { useEffect, useRef, useState } from 'react';
import { TG, TYPE, TOUCH_OPT, TONE_KEY_COLORS, FONT_TANTAN, RADIUS } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark } from '../tgWidgets.jsx';
import { FigmaScreen, prefersReducedMotion } from './shared.jsx';
import { Eyes, markSize } from './eyes.jsx';

const S = 0.93; // 시안 실측 스케일(마크 63.1/68)
// 궤도 — 땅 타원 중심(844 기준 y582 = 69%)에서 22px 위(그림자 포함 무게중심 보정). 시안 오각형 = 시작각.
// 궤도 납작비 = 흙 땅 타원(479×164)과 동일 — 경로가 바닥과 평행해야 이질감 없음(2026-07-29).
const GROUND_CY_RATIO = 582 / 844;
const GROUND_RATIO = 164 / 479;
const ORBIT = { rx: 128, ry: 128 * GROUND_RATIO, period: 45 }; // 45초/바퀴(천천히)
// 하단 배경 씬 = 시안 프레임 높이(844) 고정 wrapper를 bottom:0 앵커로 붙임. 내부는 전부 시안 y좌표(px) 고정 →
// 해상도가 바뀌어도 씬 내부 상대 위치 불변(한 덩어리로 하단에 붙어 오르내림). 세로 %앵커 금지.
const FRAME_H = 844;
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
      const H = wrapRef.current ? wrapRef.current.clientHeight : 844;
      const cx0 = W / 2;
      const cy0 = H * GROUND_CY_RATIO - 22; // 해상도 대응 — 땅 중심 비율에서 파생
      const t = reduced ? 0 : ((now - t0) / 1000) * ((Math.PI * 2) / ORBIT.period);
      for (const num of [1, 2, 3, 4, 0]) {
        const el = charRefs.current[num]; if (!el) continue;
        const a = (BASE_DEG[num] * Math.PI) / 180 + t;
        const x = cx0 + ORBIT.rx * Math.cos(a);
        const y = cy0 + ORBIT.ry * Math.sin(a);
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
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
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

// 땅(풀밭) 컨테이너 공통 배치 — 본체(z 낮음)와 앞돌 오버레이(z 높음)가 같은 앵커를 공유.
// 씬 wrapper(FRAME_H) 기준 px 고정 — 시안 y500(땅 중심 582 - 반높이 82).
const groundAnchor = (z) => ({
  position: 'absolute', left: '50%', transform: 'translateX(-50%)',
  top: GROUND_CY_RATIO * FRAME_H - 82, width: 479, height: 164, pointerEvents: 'none', zIndex: z,
});

export function TitleScreen({ onStart }) {
  const reduced = prefersReducedMotion();
  return (
    <FigmaScreen>
      {/* 화면 전체 터치 시작 (뒤로가기 버튼 없음 — 나가기는 홈 메뉴에서) */}
      <div onClick={() => onStart && onStart()} style={{ position: 'absolute', inset: 0, cursor: 'pointer', ...TOUCH_OPT }}>
        {/* 하단 배경 씬 — FRAME_H(844) 고정 wrapper를 bottom:0 앵커로. 내부는 전부 시안 y좌표(px) 고정 →
            해상도가 바뀌어도 능선·오두막·나무·동산·풀밭·돌·앞숲이 상대 위치를 유지한 채 한 덩어리로 오르내림.
            앞나무/동산이 아래로 넘치므로 overflow visible. 터치는 부모가 받음(pointerEvents none). */}
        <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FRAME_H, pointerEvents: 'none' }}>
          {/* 구름 능선 — 하늘/언덕 경계 배너(시안 y423) */}
          <img src="/game/title-ridge.svg" alt="" style={{ position: 'absolute', left: 0, top: 423, width: '100%', height: 'auto', zIndex: 1 }} />
          {/* 오두막 + 동산 뒤 나무 3그루(시안 z: 동산 앞에 그려져 하단이 언덕에 묻힘) */}
          <img src="/game/title-house.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 105.5px)', top: 399, width: 122, height: 81, zIndex: 1 }} />
          <img src="/game/title-tree-a.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 185px)', top: 433, width: 27, height: 63.6, zIndex: 1 }} />
          <img src="/game/title-tree-c.svg" alt="" style={{ position: 'absolute', left: 'calc(50% + 68px)', top: 412, width: 30, height: 71, zIndex: 1 }} />
          <img src="/game/title-tree-e.svg" alt="" style={{ position: 'absolute', left: 'calc(50% + 159.5px)', top: 438.7, width: 25.5, height: 60.2, zIndex: 1 }} />
          {/* 동산 — 화면 하부를 덮는 연두 언덕(시안 1287×768, 상단 y472) */}
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 472, width: 1287, height: 768, borderRadius: '50%', background: '#DFEB8D', zIndex: 2 }} />
          {/* 동산 위 — 돌 + 나무 2그루(시안 z: 동산 뒤 나무들보다 앞).
              ⚠️ 이 돌은 시안에서 세로 뒤집힌(FLIP_Y) 벡터 → node.y(487)는 시각적 bottom임. 시각 top-left = absoluteBoundingBox 기준 461.
              돌 4개 모두 FLIP_Y라 반드시 absoluteBoundingBox로 배치할 것(node.x/y 쓰면 높이만큼 아래로 밀림) */}
          <img src="/game/title-rock-hill.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 71px)', top: 461, width: 41, height: 26, zIndex: 2 }} />
          <img src="/game/title-tree-b.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 122px)', top: 397.9, width: 38.8, height: 91.8, zIndex: 2 }} />
          <img src="/game/title-tree-d.svg" alt="" style={{ position: 'absolute', left: 'calc(50% + 110px)', top: 392.2, width: 40, height: 95, zIndex: 2 }} />
          {/* 오두막 창문·문 디테일 — 시안 z가 동산보다 위(문 하단이 언덕에 안 묻힘) */}
          <div style={{ position: 'absolute', left: 'calc(50% - 105.5px)', top: 399, width: 122, height: 81, zIndex: 5 }}>
            <div style={{ position: 'absolute', left: 78.5, top: 34, width: 19, height: 4, background: '#DBDD8B' }} />
            <div style={{ position: 'absolute', left: 73.5, top: 45, width: 29, height: 4, background: '#DBDD8B' }} />
            <div style={{ position: 'absolute', left: 84.5, top: 59, width: 9, height: 15, background: '#9AAC5D' }} />
          </div>
          {/* 굴뚝 연기 — 굴뚝 입구에서 피어올라 커지며 옅어지는 루프(시안 3단 퍼프 12→38→65가 키프레임 기준점) */}
          <div style={{ position: 'absolute', left: 'calc(50% - 50.5px)', top: 399, zIndex: 6 }}>
            {reduced ? (
              <>
                <div style={{ position: 'absolute', left: -10.5, top: -17, width: 12, height: 11, borderRadius: 35, background: '#EEE9D3' }} />
                <div style={{ position: 'absolute', left: -4.5, top: -52, width: 38, height: 34, borderRadius: 35, background: '#EEE9D3' }} />
                <div style={{ position: 'absolute', left: -61.5, top: -101, width: 65, height: 58, borderRadius: 35, background: '#EEE9D3' }} />
              </>
            ) : (
              [0, 1, 2].map((i) => (
                // 상승·팽창·사그라짐(직선 linear)과 좌우 흔들림(사인 alternate)을 분리 — 한 키프레임에 합치면 방향 전환이 뚝 끊김
                <div key={i} style={{ position: 'absolute', left: -32, top: -29, animation: `tg-smoke-rise 5s linear ${(-i * 5) / 3}s infinite` }}>
                  <div style={{ width: 65, height: 58, borderRadius: 35, background: '#EEE9D3', animation: `tg-smoke-sway ${2.3 + i * 0.4}s ease-in-out ${-i * 0.9}s infinite alternate` }} />
                </div>
              ))
            )}
          </div>
          {/* 땅(풀밭) — 타원 + 무늬 3 + 돌 3. 캐릭터 궤도의 무대 */}
          <div style={groundAnchor(3)}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#C7D06C' }} />
            <div style={{ position: 'absolute', left: 31, top: 45, width: 237, height: 81, borderRadius: '50%', background: '#BBC45F' }} />
            <div style={{ position: 'absolute', left: 293, top: 27, width: 124, height: 42, borderRadius: '50%', background: '#BBC45F' }} />
            <div style={{ position: 'absolute', left: 135, top: 182, width: 20, height: 7, borderRadius: '50%', background: '#BBC45F' }} />
            {/* 3개 다 FLIP_Y — 시각 top-left(absoluteBoundingBox) 기준: 프레임 [78,484.3]/[306,476]/[333,478] → 땅그룹(원점 -44,500) 상대 */}
            <img src="/game/title-rock-a.svg" alt="" style={{ position: 'absolute', left: 122, top: -15.7, width: 25, height: 16 }} />
            <img src="/game/title-rock-b.svg" alt="" style={{ position: 'absolute', left: 350, top: -24, width: 26, height: 17 }} />
            <img src="/game/title-rock-c.svg" alt="" style={{ position: 'absolute', left: 377, top: -22, width: 11, height: 7 }} />
          </div>
          {/* 성조 캐릭터 — 강강술래 궤도(45초/바퀴) + 가끔 말풍선 (z 100+y). 씬 wrapper 기준(FRAME_H) */}
          <OrbitStage />
          {/* 앞돌 — 캐릭터보다 앞(전경). 시안 4개 shape를 개별 배치. 4개 다 FLIP_Y(세로뒤집힘)이라
              시각 top-left(absoluteBoundingBox) 기준 배치: 프레임 [317,643]/[3,723]/[282,667]/[27,742].
              (node.y 쓰면 각 높이만큼 아래로 밀림). 씬 wrapper 기준 px, 중앙 앵커(N=시안x−195). z800(캐릭터 위·앞나무 아래) */}
          <img src="/game/title-frock-0.svg" alt="" style={{ position: 'absolute', left: 'calc(50% + 122px)', top: 643, width: 43, height: 31, zIndex: 800 }} />
          <img src="/game/title-frock-2.svg" alt="" style={{ position: 'absolute', left: 'calc(50% + 87px)', top: 667, width: 22, height: 15, zIndex: 800 }} />
          <img src="/game/title-frock-1.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 192px)', top: 723, width: 62, height: 44, zIndex: 800 }} />
          <img src="/game/title-frock-3.svg" alt="" style={{ position: 'absolute', left: 'calc(50% - 168px)', top: 742, width: 92, height: 65, zIndex: 800 }} />
          {/* 앞나무 전경 — 하단 숲(씬 바닥 앵커, 폭 스케일) */}
          <img src="/game/title-tree-front.svg" alt="" style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: 'auto', zIndex: 900 }} />
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

        {/* 타이틀 — 레터링 로고 SVG + For 하늘하늘중국어 필 */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '12.6%', width: 290, display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1000 }}>
          <img src="/game/title-logo.svg" alt="매일매일 성조키우기" style={{ display: 'block', width: 290, height: 'auto', animation: 'tg-logo-pop .7s cubic-bezier(.34,1.56,.64,1) both' }} />
          <div style={{ marginTop: 14, height: 22, padding: '0 12px', borderRadius: 43, background: '#2D1A0E', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontFamily: FONT_TANTAN, fontSize: 14, color: '#fff', lineHeight: 1 }}>For 하늘하늘중국어</span>
          </div>
        </div>

        {/* 터치 안내 — 탄탄체, 맥동(시안 y706 → 하단 앵커 14.5%) */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(14.5% + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', animation: 'tg-pulse 1.8s ease-in-out infinite', zIndex: 1000 }}>
          <span style={{ fontFamily: FONT_TANTAN, fontSize: 16, color: '#000', lineHeight: 1 }}>화면을 터치하면 시작합니다!</span>
        </div>
      </div>
    </FigmaScreen>
  );
}
