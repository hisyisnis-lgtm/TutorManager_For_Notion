// 모드 잠금해제 연출 — 난이도(중급·고급)·무한·테마(여행)가 열렸을 때 전용 "새 모드 열림!" 오버레이.
// 기존엔 난이도·무한이 제네릭 업적 카드로만, 테마는 연출 전무(gap)였음 → 통합 전용 연출로.
// 톤: 게임오버·레벨 연출과 통일한 프로스티드 딤 + 미니멀(오버슛·컨페티 없음), 단 잠금해제라 아이콘+글로우로 살짝 축하.
import { useEffect, useState } from 'react';
import { RocketIcon, CrownIcon, InfinityIcon, MapPinIcon, ForkKnifeIcon, SparkleIcon, LockKeyOpenIcon } from '@phosphor-icons/react';
import { FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';

const ICONS = { Rocket: RocketIcon, Crown: CrownIcon, Infinity: InfinityIcon, MapPin: MapPinIcon, ForkKnife: ForkKnifeIcon, Sparkle: SparkleIcon };

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
  const Icon = ICONS[unlock.icon] || LockKeyOpenIcon;
  const accent = unlock.accent || '#F2484C';
  return (
    <div onClick={() => !hold && onDone && onDone()} style={{
      position: 'fixed', inset: 0, zIndex: 135, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(24,20,28,0.74)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', padding: 24,
      animation: closing ? 'mu-out .3s ease forwards' : 'mu-in .35s ease both',
    }}>
      <style>{`
        @keyframes mu-in { from{opacity:0} to{opacity:1} }
        @keyframes mu-out { from{opacity:1} to{opacity:0} }
        @keyframes mu-rise { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes mu-icon { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
      `}</style>
      {/* 아이콘 원 + 은은한 글로우(맥동 없음) */}
      <div style={{ position: 'relative', animation: 'mu-icon .55s cubic-bezier(.22,1,.36,1) .05s both' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: `radial-gradient(closest-side, ${accent}44, ${accent}00 72%)` }} />
        <div style={{ position: 'relative', width: 88, height: 88, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 32px rgba(0,0,0,0.32)' }}>
          <Icon size={44} weight="fill" color={accent} />
        </div>
      </div>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13, color: accent, letterSpacing: 0.5, marginTop: 20, animation: 'mu-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>새 모드 열림</span>
      <span style={{ fontFamily: FONT_TITLE, fontSize: 28, color: '#fff', marginTop: 6, animation: 'mu-rise .5s cubic-bezier(.22,1,.36,1) .22s both' }}>{unlock.label}</span>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13.5, color: 'rgba(255,255,255,0.7)', marginTop: 10, textAlign: 'center', animation: 'mu-rise .5s cubic-bezier(.22,1,.36,1) .3s both' }}>{unlock.desc}</span>
      {!hold && <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 22, animation: 'mu-rise .5s ease .5s both' }}>탭하여 계속</span>}
    </div>
  );
}
