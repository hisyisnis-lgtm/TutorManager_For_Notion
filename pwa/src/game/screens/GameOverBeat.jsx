// 게임오버 비트 — 결과화면 직전, 게임 화면 위 오버레이(전 종료 공통). 강조 디자인 + 스태거 등장 연출.
// 스포트라이트 딤 → 별(레이 방사·팝) → 헤드라인 → 점수 패널, 순차 팝인. ~1.3초 후 자동 소멸(onDone). SFX는 end-effect 담당, 여긴 햅틱만.
import { useEffect, useState } from 'react';
import { StarIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';

// 종료 사유별 헤드라인 — 압박 아닌 격려 톤. (lives='아쉬워요!'는 무한 하트 모드 병합 시 추가)
const HEADLINE = { timeout: '시간 종료!', complete: '수고했어요!', lives: '아쉬워요!' };

export function GameOverBeat({ endKind = 'complete', onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    haptic([30, 40, 30]);
    if (hold) return undefined; // [DEV] 미리보기 유지
    const t1 = setTimeout(() => setClosing(true), 1100);
    const t2 = setTimeout(() => onDone && onDone(), 1350);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rays = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(28,24,32,0.86)', animation: closing ? 'gob-fade .25s ease forwards' : 'gob-bg .28s ease both',
    }}>
      <style>{`
        @keyframes gob-bg { from{opacity:0} to{opacity:1} }
        @keyframes gob-fade { to{opacity:0} }
        @keyframes gob-spot { 0%{opacity:0;transform:scale(.6)} 100%{opacity:1;transform:scale(1)} }
        @keyframes gob-pop { 0%{opacity:0;transform:scale(.5) translateY(10px)} 55%{opacity:1;transform:scale(1.12) translateY(0)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes gob-ray { 0%{opacity:0;transform:translate(-50%,-50%) scale(.2)} 30%{opacity:.95} 100%{opacity:0;transform:translate(calc(-50% + var(--rx)),calc(-50% + var(--ry))) scale(1)} }
        @keyframes gob-starspin { 0%{opacity:0;transform:scale(.3) rotate(-40deg)} 60%{opacity:1;transform:scale(1.18) rotate(6deg)} 100%{opacity:1;transform:scale(1) rotate(0)} }
      `}</style>
      {/* 중앙 스포트라이트 — 콘텐츠를 띄워 보이게 */}
      <div style={{ position: 'absolute', width: 460, height: 460, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(255,176,46,0.18), rgba(255,176,46,0))', animation: 'gob-spot .4s ease both' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -16 }}>
        {/* 별 + 레이 방사 */}
        <div style={{ position: 'relative', width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
          {rays.map((i) => {
            const a = (i / rays.length) * Math.PI * 2; const r = 46;
            return (
              <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 8, height: 8, '--rx': `${Math.cos(a) * r}px`, '--ry': `${Math.sin(a) * r}px`, animation: 'gob-ray .7s ease-out .12s both' }}>
                <svg viewBox="0 0 24 24" width={8} height={8} aria-hidden="true"><path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" fill={TG.SUN} /></svg>
              </div>
            );
          })}
          <StarIcon size={64} weight="fill" color={TG.SUN} style={{ filter: 'drop-shadow(0 6px 16px rgba(255,176,46,0.55))', animation: 'gob-starspin .55s cubic-bezier(.34,1.56,.64,1) both' }} />
        </div>
        {/* 헤드라인 */}
        <span style={{ fontFamily: FONT_TITLE, fontSize: 40, color: '#fff', textShadow: '0 3px 16px rgba(0,0,0,0.4)', animation: 'gob-pop .5s cubic-bezier(.34,1.56,.64,1) .1s both' }}>{HEADLINE[endKind] || HEADLINE.complete}</span>
        {/* 진행 힌트 (점수 미표시 — 사용자 요청) */}
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 16, animation: 'gob-pop .5s ease .28s both' }}>결과 보기로 이동 중…</span>
      </div>
    </div>
  );
}
