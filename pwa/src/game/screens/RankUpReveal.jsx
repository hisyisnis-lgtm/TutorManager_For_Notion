// 등급 진행/하락 연출 — 게임오버 비트 다음, 결과화면 전.
//  진행(새 마스터): 엠블럼 + 게이지가 이전%→새%로 차오름. 등급 임계 넘으면 "등급 상승!" + 더 화려.
//  하락(티어 다운, 2026-07-04): 담백·차분 — 파티클/차오름 없음, 회색 톤 + 최고 기록 칩 + 회복 안내.
//  압박·죄책감 카피 금지(노FOMO) — "내려갔다"는 사실 고지 + "복습하면 되찾는다"는 경로 제시까지만.
import { useEffect, useState } from 'react';
import { TG, FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';
import { earTier, EAR_TIERS } from '../earProfile.js';

const PARTICLE_POS = [[-92, -28, 13], [86, -42, 10], [-100, 42, 9], [96, 30, 12], [4, -84, 11], [-58, 76, 9], [72, 70, 10]];

export function RankUpReveal({ prev = 0, now = 0, peakIdx = 0, onDone, hold = false }) {
  const prevT = earTier(prev);
  const nowT = earTier(now);
  const tierUp = nowT.idx > prevT.idx;
  const tierDown = nowT.idx < prevT.idx;
  const start = tierUp ? 0 : Math.round(prevT.progress * 100);
  const end = Math.round(nowT.progress * 100);
  const [w, setW] = useState(start);
  useEffect(() => {
    haptic(tierDown ? 12 : tierUp ? [20, 40, 20, 40] : [15, 30]); // 하락은 가볍게 한 번만
    if (tierDown) return undefined;
    const t = setTimeout(() => setW(end), 280); // 마운트 후 게이지 채우기 시작(하락은 정적)
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gained = Math.max(0, now - prev);
  const peak = EAR_TIERS[Math.min(EAR_TIERS.length - 1, Math.max(peakIdx | 0, prevT.idx))]; // 최고 기록(최소한 방금 잃은 등급)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(28,24,32,0.85)', padding: 24 }}>
      <style>{'@keyframes ru-pop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}@keyframes ru-sink{0%{opacity:0;transform:translateY(-8px)}100%{opacity:1;transform:translateY(0)}}'}</style>
      {/* eyebrow */}
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: tierDown ? '#cfc8bf' : tierUp ? '#FFC94D' : nowT.spark, marginBottom: 8, animation: tierDown ? 'ru-sink .45s ease both' : 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        {tierDown ? '등급이 내려갔어요' : tierUp ? '✨ 등급 상승!' : `✨ 단어 ${gained}개 마스터!`}
      </span>
      {/* 엠블럼 — 하락은 글로우·파티클 없이 차분하게(현재 등급을 정직하게 보여줌) */}
      <div style={{ position: 'relative', width: '100%', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!tierDown && (
          <div aria-hidden="true" style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', pointerEvents: 'none', background: `radial-gradient(closest-side, ${nowT.glow}66, ${nowT.glow}1a 55%, ${nowT.glow}00 72%)` }} />
        )}
        {!tierDown && PARTICLE_POS.slice(0, nowT.particles).map(([dx, dy, sz], i) => (
          <div key={i} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(${dx}px, ${dy}px)`, pointerEvents: 'none' }}>
            <div style={{ animation: `tg-sparkle ${2.2 + i * 0.3}s ease-in-out ${i * 0.4}s infinite` }}>
              <svg viewBox="0 0 24 24" width={sz} height={sz} aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={nowT.spark} /></svg>
            </div>
          </div>
        ))}
        <img src={nowT.emblem} alt="" width={150} height={150} style={{ position: 'relative',
          animation: tierUp ? 'ru-pop .6s cubic-bezier(.34,1.56,.64,1) .15s both' : tierDown ? 'ru-sink .5s ease .1s both' : 'none',
          filter: tierDown ? 'grayscale(0.25) drop-shadow(0 8px 20px rgba(0,0,0,0.35))' : `drop-shadow(0 8px 20px ${nowT.glow}66)` }} />
      </div>
      {/* 단계명 */}
      <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#fff', marginTop: 4 }}>{nowT.name}</span>
      {tierDown ? (
        <>
          {/* 최고 기록 칩 — 성취의 기억은 안 뺏음 + 회복 경로 안내 */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,246,232,0.14)', padding: '5px 13px', borderRadius: 12, marginTop: 14, animation: 'ru-sink .45s ease .2s both' }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#FFC94D' }}>🏆 최고 기록 · {peak.name}</span>
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 10, animation: 'ru-sink .45s ease .3s both' }}>복습하면 금방 되찾을 수 있어요</span>
        </>
      ) : (
        <>
          {/* 게이지 (이전→새 차오름) */}
          <div style={{ width: 220, height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: 14 }}>
            <div style={{ width: `${w}%`, height: '100%', borderRadius: 5, background: nowT.glow, transition: 'width .9s cubic-bezier(.4,0,.2,1)' }} />
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>마스터한 단어 {now}개</span>
        </>
      )}
      {/* 확인 */}
      {!hold && (
        <button onClick={onDone} className="tg-press" style={{ marginTop: 40, padding: '14px 44px', borderRadius: 16, border: 'none', cursor: 'pointer', background: tierDown ? 'rgba(255,255,255,0.14)' : TG.CORAL_GRAD, boxShadow: tierDown ? 'none' : '0 10px 24px rgba(242,72,76,0.32)', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: '#fff' }}>확인</button>
      )}
    </div>
  );
}
