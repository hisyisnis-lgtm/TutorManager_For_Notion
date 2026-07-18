// 업적 획득 축하 오버레이(P4) — 게임 종료 후 새로 달성한 업적마다 1장씩(큐). 잠금해제·마스터도 업적이라 함께 커버.
// 톤 원칙: 성취 = 격려·축하(서비스 정체성). 딤+카드+글로우 배지+컨페티+CTA. 참조: tone_game_redesign.md (P4)
import { useEffect } from 'react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { AchBadge } from './AchievementsScreen.jsx';

const CONFETTI = ['#FF4D6D', '#FF9F40', TG.SUCCESS_GLOW, '#4D8DFF', TG.SUN, TG.CORAL];
// 컨페티 입자 — index로 결정적 분포(좌우 퍼짐·낙하 속도·회전 다양화)
const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 6.1 + 4) % 96,
  color: CONFETTI[i % CONFETTI.length],
  w: 7 + (i % 3) * 2,
  h: 7 + ((i + 1) % 3) * 3,
  delay: (i % 5) * 0.12,
  dur: 2.4 + (i % 4) * 0.35,
  round: i % 2 === 0,
  rot: (i % 2 ? 1 : -1) * (220 + (i % 3) * 180),
}));

export function CelebrationOverlay({ achievement, remaining = 0, onNext }) {
  useEffect(() => { playSfx('unlock'); }, [achievement?.id]);
  if (!achievement) return null;
  return (
    <div onClick={onNext} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(26,16,20,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, overflow: 'hidden', ...TOUCH_OPT }}>
      <style>{`
        @keyframes tgc-pop{0%{transform:scale(.82);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
        @keyframes tgc-badge{0%{transform:scale(0) rotate(-30deg)}70%{transform:scale(1.12) rotate(6deg)}100%{transform:scale(1) rotate(0)}}
        @keyframes tgc-glow{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.12);opacity:.85}}
        @keyframes tgc-fall{0%{transform:translateY(-30px) rotate(0);opacity:0}10%{opacity:1}100%{transform:translateY(460px) rotate(var(--tgc-r));opacity:0}}
      `}</style>
      {/* 컨페티(낙하) */}
      {PARTICLES.map((p, i) => (
        <div key={i} style={{ position: 'absolute', top: 110, left: `${p.left}%`, width: p.w, height: p.h, background: p.color, borderRadius: p.round ? '50%' : 2, '--tgc-r': `${p.rot}deg`, animation: `tgc-fall ${p.dur}s ease-in ${p.delay}s forwards`, pointerEvents: 'none' }} />
      ))}
      {/* 카드(팝인) */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 300, background: TG.CARD, borderRadius: RADIUS.card, padding: '56px 24px 24px', boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md, animation: 'tgc-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        {/* 배지 — 카드 상단 걸침 + 글로우(맥동) */}
        <div style={{ position: 'absolute', top: -36, left: '50%', transform: 'translateX(-50%)' }}>
          <div style={{ position: 'absolute', inset: -18, borderRadius: '50%', background: 'rgba(255,176,46,0.24)', animation: 'tgc-glow 2.2s ease-in-out infinite' }} />
          <div style={{ position: 'relative', animation: 'tgc-badge .6s cubic-bezier(.34,1.56,.64,1) .1s both' }}>
            <AchBadge ach={achievement} earned size={92} />
          </div>
        </div>
        <span style={{ ...TYPE.labelSm, color: TG.CORAL_DK, letterSpacing: 0.5 }}>업적 달성!</span>
        <span style={{ ...TYPE.titleLg, fontSize: 25, color: TG.INK, textAlign: 'center' }}>{achievement.label}</span>
        <span style={{ ...TYPE.sub, color: TG.SUB, textAlign: 'center', lineHeight: 1.4 }}>{achievement.desc}</span>
        <button onClick={onNext} className="tg-press" style={{ marginTop: SPACE.x2, width: '100%', height: 52, borderRadius: RADIUS.btn, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0px 8px 16px rgba(242,72,76,0.32)', ...TYPE.btn, color: '#fff', ...TOUCH_OPT }}>
          {remaining > 0 ? `다음 (${remaining})` : '좋아요!'}
        </button>
      </div>
    </div>
  );
}
