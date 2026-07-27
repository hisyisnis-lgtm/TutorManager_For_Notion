// 모드 잠금해제 연출 — 난이도(중급·고급)·무한·테마(여행)가 열렸을 때 전용 "새 모드 열림!" 오버레이.
// 기존엔 난이도·무한이 제네릭 업적 카드로만, 테마는 연출 전무(gap)였음 → 통합 전용 연출로.
// 톤: 게임오버·레벨 연출과 통일한 프로스티드 딤 + 미니멀(오버슛·컨페티 없음), 단 잠금해제라 아이콘+글로우로 살짝 축하.
import { useEffect, useState } from 'react';
import { Rocket, Crown, Infinity, MapPoint, ChefHat, Stars, LockUnlocked } from '@solar-icons/react';
import { TG, TYPE, haptic, SPACE } from '../tgTokens.js';

const ICONS = { Rocket, Crown, Infinity, MapPin: MapPoint, ForkKnife: ChefHat, Sparkle: Stars };

export function ModeUnlockReveal({ unlock, onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    haptic([20, 40, 20]);
    if (hold) return undefined;
    const t1 = setTimeout(() => setClosing(true), 2600);
    const t2 = setTimeout(() => onDone && onDone(), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!unlock) return null;
  const Icon = ICONS[unlock.icon] || LockUnlocked;
  const accent = unlock.accent || TG.CORAL_DK;
  return (
    <div onClick={() => !hold && onDone && onDone()} style={{
      position: 'fixed', inset: 0, zIndex: 135, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(24,20,28,0.74)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', padding: SPACE.x4,
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .35s ease both', // 페이드=공용 프리미티브(shared.jsx)
    }}>
      <style>{`
        @keyframes mu-icon { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
      `}</style>
      {/* 아이콘 원 + 은은한 글로우(맥동 없음) */}
      <div style={{ position: 'relative', animation: 'mu-icon .55s cubic-bezier(.22,1,.36,1) .05s both' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: `radial-gradient(closest-side, ${accent}44, ${accent}00 72%)` }} />
        <div style={{ position: 'relative', width: 88, height: 88, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 32px rgba(0,0,0,0.32)' }}>
          <Icon size={44} weight="Bold" color={accent} />
        </div>
      </div>
      <span style={{ ...TYPE.labelSm, color: accent, letterSpacing: 0.5, marginTop: SPACE.x3, animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>새 모드 열림</span>
      <span style={{ ...TYPE.titleLg, fontSize: 28, color: '#fff', marginTop: SPACE.sm, animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .22s both' }}>{unlock.label}</span>
      <span style={{ ...TYPE.sub, color: 'rgba(255,255,255,0.7)', marginTop: SPACE.lg, textAlign: 'center', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .3s both' }}>{unlock.desc}</span>
      {!hold && <span style={{ ...TYPE.meta, color: 'rgba(255,255,255,0.4)', marginTop: SPACE.x4, animation: 'tg-rise .5s ease .5s both' }}>탭하여 계속</span>}
    </div>
  );
}
