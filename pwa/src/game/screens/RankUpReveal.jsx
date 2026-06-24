// 등급 진행 연출 — 게임오버 비트 다음, 결과화면 전에 (이 판에 새로 마스터한 단어가 있을 때만).
// 엠블럼 + 게이지가 이전%→새%로 차오름. 등급 임계 넘으면 "등급 상승!" + 더 화려.
import { useEffect, useState } from 'react';
import { TG, FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';
import { earTier } from '../earProfile.js';

const PARTICLE_POS = [[-92, -28, 13], [86, -42, 10], [-100, 42, 9], [96, 30, 12], [4, -84, 11], [-58, 76, 9], [72, 70, 10]];

export function RankUpReveal({ prev = 0, now = 0, onDone, hold = false }) {
  const prevT = earTier(prev);
  const nowT = earTier(now);
  const tierUp = nowT.idx > prevT.idx;
  const start = tierUp ? 0 : Math.round(prevT.progress * 100);
  const end = Math.round(nowT.progress * 100);
  const [w, setW] = useState(start);
  useEffect(() => {
    haptic(tierUp ? [20, 40, 20, 40] : [15, 30]);
    const t = setTimeout(() => setW(end), 280); // 마운트 후 게이지 채우기 시작
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gained = Math.max(0, now - prev);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(28,24,32,0.85)', padding: 24 }}>
      <style>{'@keyframes ru-pop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}'}</style>
      {/* eyebrow */}
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: tierUp ? '#FFC94D' : nowT.spark, marginBottom: 8, animation: 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        {tierUp ? '✨ 등급 상승!' : `✨ 단어 ${gained}개 마스터!`}
      </span>
      {/* 엠블럼 + 글로우 + 반짝임 */}
      <div style={{ position: 'relative', width: '100%', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div aria-hidden="true" style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', pointerEvents: 'none', background: `radial-gradient(closest-side, ${nowT.glow}66, ${nowT.glow}1a 55%, ${nowT.glow}00 72%)` }} />
        {PARTICLE_POS.slice(0, nowT.particles).map(([dx, dy, sz], i) => (
          <div key={i} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(${dx}px, ${dy}px)`, pointerEvents: 'none' }}>
            <div style={{ animation: `tg-sparkle ${2.2 + i * 0.3}s ease-in-out ${i * 0.4}s infinite` }}>
              <svg viewBox="0 0 24 24" width={sz} height={sz} aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={nowT.spark} /></svg>
            </div>
          </div>
        ))}
        <img src={nowT.emblem} alt="" width={150} height={150} style={{ position: 'relative', animation: tierUp ? 'ru-pop .6s cubic-bezier(.34,1.56,.64,1) .15s both' : 'none', filter: `drop-shadow(0 8px 20px ${nowT.glow}66)` }} />
      </div>
      {/* 단계명 */}
      <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#fff', marginTop: 4 }}>{nowT.name}</span>
      {/* 게이지 (이전→새 차오름) */}
      <div style={{ width: 220, height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: 14 }}>
        <div style={{ width: `${w}%`, height: '100%', borderRadius: 5, background: nowT.glow, transition: 'width .9s cubic-bezier(.4,0,.2,1)' }} />
      </div>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>마스터한 단어 {now}개</span>
      {/* 확인 */}
      {!hold && (
        <button onClick={onDone} className="tg-press" style={{ marginTop: 40, padding: '14px 44px', borderRadius: 16, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0 10px 24px rgba(242,72,76,0.32)', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: '#fff' }}>확인</button>
      )}
    </div>
  );
}
