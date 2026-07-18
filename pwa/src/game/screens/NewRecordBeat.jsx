// 신기록 전용 비트 — 신기록을 낸 판에서 결과화면 직전, 어두운 게임오버 비트('수고했어요') 대신 뜨는 밝은 축하 순간.
// ▶ 목적: "방금 최고 기록을 깼다"를 결과화면 도착 전에 **크고 분명하게** 인지시키고 기분 좋게(유입 깔때기 = 성취=축하).
//   → 밝은 프로스티드 딤(게임오버의 어두운 톤과 반대) + 크리스프 플래시 + 색종이 + 트로피 팝 + 큰 '신기록!' + 점수 + 이전기록 대비.
// GameOverBeat과 동일한 "잠깐 멈춰 인지" 골격(zIndex 120·~2초 체류 후 onDone·탭 스킵)이되 무드만 축하로 교체.
// 아이덴티티 톤: 링·글로우·블룸 없이(이 앱엔 촌스러움) 크리스프 플래시 + 색종이 물리로 임팩트. 참조: tone_game_redesign.md §파티클.
import { useEffect, useState } from 'react';
import { TrophyIcon } from '@phosphor-icons/react';
import { TYPE, haptic } from '../tgTokens.js';
import { ConfettiBurst, CrispFlash, LIGHT_CONFETTI } from './shared.jsx';

export function NewRecordBeat({ score = 0, previousBest = 0, onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    haptic([12, 40, 12, 40, 20]); // 축하 = 통통 튀는 리듬(게임오버의 단발 탭과 구분)
    if (hold) return undefined; // [DEV] 미리보기 유지
    const t1 = setTimeout(() => setClosing(true), 2050); // 축하를 충분히 즐길 체류(게임오버보다 살짝 길게)
    const t2 = setTimeout(() => onDone && onDone(), 2350);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const skip = () => { if (!closing) onDone && onDone(); }; // 탭하면 바로 결과로
  const delta = score - previousBest;
  const firstRecord = !(previousBest > 0);
  return (
    <div onClick={skip} style={{
      position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      background: 'radial-gradient(120% 80% at 50% 34%, rgba(255,247,230,0.94), rgba(255,251,244,0.9))',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .32s ease both', cursor: 'pointer', // 페이드=공용 프리미티브(shared.jsx)
    }}>
      <style>{`
        @keyframes nrb-pop { 0%{opacity:0;transform:scale(.4)} 62%{opacity:1;transform:scale(1.12)} 100%{transform:scale(1)} }
        @keyframes nrb-badge { 0%{opacity:0;transform:scale(0) rotate(-32deg)} 66%{opacity:1;transform:scale(1.14) rotate(7deg)} 100%{transform:scale(1) rotate(0)} }
      `}</style>
      {/* 크리스프 플래시 — 등장 순간 화이트 스냅(번쩍) */}
      <CrispFlash color="rgba(255,255,255,0.72)" zIndex={1} />
      {/* 색종이 폭발 + 흰/골드 글리터 — 상단 트로피 위에서 터져 낙하 */}
      <ConfettiBurst count={34} power={1.4} size={10} zIndex={2} style={{ top: '30%' }} />
      <ConfettiBurst colors={LIGHT_CONFETTI} count={18} power={1.35} size={6} zIndex={2} style={{ top: '30%' }} />
      <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -8, padding: 24 }}>
        {/* 트로피 — 골드 원 안에서 팝(회전 오버슛) */}
        <div style={{
          width: 84, height: 84, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #ffd24d 0%, #ff9f40 100%)', boxShadow: '0 12px 26px rgba(255,159,64,0.34)',
          animation: 'nrb-badge .6s cubic-bezier(.34,1.56,.64,1) .04s both',
        }}>
          <TrophyIcon size={44} weight="fill" color="#fff" />
        </div>
        {/* 헤드라인 — 골드 그라디언트 '신기록!' */}
        <span style={{
          marginTop: 16, ...TYPE.titleLg, fontSize: 42, letterSpacing: '-0.01em', lineHeight: 1,
          background: 'linear-gradient(92deg, #ffb020, #ff7a34)', WebkitBackgroundClip: 'text', backgroundClip: 'text',
          WebkitTextFillColor: 'transparent', color: '#ff8f34',
          animation: 'nrb-pop .5s cubic-bezier(.34,1.56,.64,1) .12s both',
        }}>신기록!</span>
        {/* 점수 — 큰 숫자 팝 */}
        <span style={{
          marginTop: 12, ...TYPE.numHero, fontSize: 58, lineHeight: 1, color: '#f2484c', whiteSpace: 'nowrap',
          animation: 'nrb-pop .52s cubic-bezier(.34,1.56,.64,1) .22s both',
        }}>{score.toLocaleString()}</span>
        {/* 이전 기록 대비 — 첫 기록이면 격려, 아니면 '이전 최고 N ▲증가폭' */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .38s both' }}>
          {firstRecord ? (
            <span style={{ ...TYPE.label, color: '#c98a2e' }}>첫 기록을 세웠어요! 🎉</span>
          ) : (
            <>
              <span style={{ ...TYPE.sub, color: '#9a8f80', whiteSpace: 'nowrap' }}>이전 최고 {previousBest.toLocaleString()}</span>
              {delta > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', padding: '3px 9px', borderRadius: 11, background: 'rgba(54,201,141,0.18)' }}>
                  <span style={{ ...TYPE.num, color: '#1fa86a', whiteSpace: 'nowrap' }}>▲ {delta.toLocaleString()}</span>
                </span>
              )}
            </>
          )}
        </div>
        {/* 진행 힌트 */}
        <span style={{
          marginTop: 22, ...TYPE.meta, color: 'rgba(90,80,70,0.5)',
          animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .5s both',
        }}>결과 보기로 이동 중…</span>
      </div>
    </div>
  );
}
