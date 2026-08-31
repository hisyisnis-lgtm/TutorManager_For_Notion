// 업적 획득 축하 오버레이(P4) — 게임 종료 후 새로 달성한 업적마다 1장씩(큐). 잠금해제·마스터도 업적이라 함께 커버.
// 톤 원칙: 성취 = 격려·축하(서비스 정체성). 딤+카드+글로우 배지+컨페티+CTA. 참조: tone_game_redesign.md (P4)
import { useEffect } from 'react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { AchBadge, ACH_ACCENT } from './AchievementsScreen.jsx';
import { KeycapCta } from './shared.jsx';

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

export function CelebrationOverlay({ achievement, onNext }) {
  useEffect(() => { playSfx('unlock'); }, [achievement?.id]);
  if (!achievement) return null;
  return (
    <div onClick={onNext} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(26,16,20,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 24px 24px', overflow: 'hidden', ...TOUCH_OPT }}>
      <style>{`
        @keyframes tgc-pop{0%{transform:scale(.82);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
        @keyframes tgc-badge{0%{transform:scale(0) rotate(-30deg)}70%{transform:scale(1.12) rotate(6deg)}100%{transform:scale(1) rotate(0)}}
        /* ★위에 닫는 중괄호가 하나 더 있어 CSS 파서가 여기서부터를 통째로 버렸다 → tgc-fall이 정의되지 않아
           컨페티 16개가 애니메이션 없이 초기 위치(top:110 · left 4%,10.1%,16.2%…)에 **가로로 줄지어 멈춰** 있었다.
           업적 모달이 뜬 화면에서만 보여 원인 파악이 늦음(2026-08-08 사용자 지적). */
        @keyframes tgc-fall{0%{transform:translateY(-30px) rotate(0);opacity:0}10%{opacity:1}100%{transform:translateY(460px) rotate(var(--tgc-r));opacity:0}}
      `}</style>
      {/* 컨페티(낙하) */}
      {PARTICLES.map((p, i) => (
        <div key={i} style={{ position: 'absolute', top: 110, left: `${p.left}%`, width: p.w, height: p.h, background: p.color, borderRadius: p.round ? '50%' : 2, '--tgc-r': `${p.rot}deg`, animation: `tgc-fall ${p.dur}s ease-in ${p.delay}s forwards`, pointerEvents: 'none' }} />
      ))}
      {/* 카드(팝인) — 시안 512:2: 300 r28 · padding 56/22/24 · gap 16 · 배지 92가 상단에 걸침 */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 300, background: TG.CARD, borderRadius: RADIUS.card, padding: '56px 22px 24px', boxShadow: '0px 4px 9px rgba(43,39,48,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2, animation: 'tgc-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        {/* 배지 — 시안 512:2: **흰 원 92 + 그 업적의 아이콘 50**(카드 위로 46 걸침). 글로우 원은 시안에 없어 제거. */}
        <div style={{ position: 'absolute', top: -46, left: '50%', transform: 'translateX(-50%)' }}>
          <div style={{ position: 'relative', animation: 'tgc-badge .6s cubic-bezier(.34,1.56,.64,1) .1s both' }}>
            <AchBadge ach={achievement} earned size={92} bg="#fff" iconSize={50} color={ACH_ACCENT} />
          </div>
        </div>
        {/* 텍스트 — [업적 달성!(14) + 업적명(26)] 간격 6, 그 아래 설명(14) 간격 10 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.lg }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm }}>
            <span style={{ ...TYPE.label, color: TG.CORAL_DK, letterSpacing: 0.5 }}>업적 달성!</span>
            <span style={{ ...TYPE.head, fontSize: 26, color: TG.INK, textAlign: 'center' }}>{achievement.label}</span>
          </div>
          <span style={{ ...TYPE.label, color: TG.SUB, textAlign: 'center', lineHeight: 1.4 }}>{achievement.desc}</span>
        </div>
        {/* CTA — 키캡 60. 업적이 여러 개면 큐로 **한 장씩 순서대로** 뜬다(남은 개수는 노출하지 않음, 2026-08-07 사용자 요청) */}
        <KeycapCta label="확인" onClick={onNext} />
      </div>

    </div>
  );
}
