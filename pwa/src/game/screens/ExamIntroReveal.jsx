// 승급시험 진입 연출 — 시험 런이 라이브(카운트다운 종료)가 되는 순간 잠깐(≈2s) "{급} 승급시험"임을 알림.
// 톤: 게임오버·모드해제 연출과 통일한 프로스티드 딤 + 급 색 메달 팝. 탭/자동으로 넘어가 첫 문제 시작.
import { useEffect, useState } from 'react';
import { MedalIcon } from '@phosphor-icons/react';
import { TG, TYPE, haptic, RADIUS, SPACE, DIFF_COLORS } from '../tgTokens.js';

export function ExamIntroReveal({ tier = 'easy', tierLabel = '입문', onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  const c = DIFF_COLORS[tier] || DIFF_COLORS.easy;
  useEffect(() => {
    haptic([30, 50, 30, 50, 40]); // 등장 = 묵직한 관문 리듬
    if (hold) return undefined;
    const t1 = setTimeout(() => setClosing(true), 1900);
    const t2 = setTimeout(() => onDone && onDone(), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div onClick={() => !hold && onDone && onDone()} style={{
      position: 'fixed', inset: 0, zIndex: 138, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(24,20,28,0.82)', backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)', padding: SPACE.x4,
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .35s ease both', cursor: 'pointer',
    }}>
      <style>{`
        @keyframes ei-icon { 0%{opacity:0;transform:scale(.55) rotate(-14deg)} 62%{opacity:1;transform:scale(1.12) rotate(6deg)} 100%{transform:scale(1) rotate(0)} }
      `}</style>
      {/* 메달 아이콘 + 급 색 글로우 (팝) */}
      <div style={{ position: 'relative', margin: '0 0 18px', animation: 'ei-icon .6s cubic-bezier(.34,1.56,.64,1) .04s both' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: -18, borderRadius: RADIUS.pill, background: `radial-gradient(closest-side, ${c.accent}55, ${c.accent}00 72%)` }} />
        <div style={{ position: 'relative', width: 96, height: 96, borderRadius: RADIUS.pill, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 14px 34px ${c.glow}` }}>
          <MedalIcon size={50} weight="fill" color={c.accent} />
        </div>
      </div>
      {/* 타이틀 — {급} 승급시험 */}
      <span style={{ ...TYPE.titleLg, fontSize: 28, color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>{tierLabel} 승급시험</span>
      {/* 설명 — 규칙: 20문제, 틀리면 하트 없이 다음 문제로 진행 */}
      <span style={{ ...TYPE.sub, color: 'rgba(255,255,255,0.78)', marginTop: SPACE.sm, textAlign: 'center', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .24s both' }}>20문제 · 틀리면 다음 문제로</span>
      <span style={{ ...TYPE.meta, color: 'rgba(255,255,255,0.5)', marginTop: SPACE.xs, textAlign: 'center', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .3s both' }}>정답률 80% 이상이면 등급 상승</span>
      {!hold && <span style={{ ...TYPE.meta, color: 'rgba(255,255,255,0.4)', marginTop: SPACE.x4, animation: 'tg-rise .5s ease .5s both' }}>탭하여 시작</span>}
    </div>
  );
}
