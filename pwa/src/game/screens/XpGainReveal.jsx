// 게임 종료 경험치 획득 연출 — 게임오버 비트 다음, 결과화면 전(등급업 연출과 같은 자리·풀스크린 오버레이).
//  환산 요소(점수·정답·신기록)가 하나씩 '쾅' 팝인하며 총 XP가 오르고 등급 게이지가 차오른다.
//  게이지가 가득 차는 순간(examReady) '승급 시험 가능' 정보 노출. XP 적립 판(일반·무한·테마)만.
import { useEffect, useState } from 'react';
import { TG, FONT_BODY, FONT_NUM, haptic } from '../tgTokens.js';
import { displayTier, XP_PER_CORRECT, XP_NEWBEST_BONUS } from '../gameXp.js';
import { play as playSfx } from '../tgSfx.js';
import { useCountUp } from '../tgWidgets.jsx';

export function XpGainReveal({ gained, prevXp = 0, newXp = 0, score = 0, correct = 0, isNewBest = false, rank = 0, onDone, hold = false }) {
  // 환산 내역(점수·정답×3·신기록) — 0인 항목은 제외.
  const sources = [
    { key: 'score', label: '점수', val: Math.max(0, Math.round(score || 0)) },
    { key: 'correct', label: `정답 ${correct || 0}개`, val: Math.max(0, (correct || 0) * XP_PER_CORRECT) },
    ...(isNewBest ? [{ key: 'best', label: '신기록', val: XP_NEWBEST_BONUS }] : []),
  ].filter((s) => s.val > 0);

  const [step, setStep] = useState(0); // 지금까지 '쾅' 공개된 항목 수
  const addedSoFar = sources.slice(0, step).reduce((a, s) => a + s.val, 0);
  const animTotal = useCountUp(addedSoFar, 420); // 각 쾅마다 총 XP가 그 값까지 오름
  const nowT = displayTier(rank, prevXp + addedSoFar);   // 현재까지 반영된 게이지
  const prevT = displayTier(rank, prevXp);
  const finalT = displayTier(rank, newXp);
  const done = step >= sources.length;
  const justReady = done && !prevT.examReady && finalT.examReady; // 이번 판에 게이지 만땅 도달

  // 순차 공개 — 첫 항목 400ms, 이후 620ms 간격. 각 항목마다 '쾅'(햅틱+효과음). 다 끝나면 승급 가능 시 팡파레.
  useEffect(() => {
    if (done) {
      if (justReady) { haptic([40, 60, 40]); playSfx('unlock'); }
      return undefined;
    }
    const t = setTimeout(() => {
      setStep((s) => s + 1);
      haptic([25, 30]);
      playSfx('combo'); // 쾅
    }, step === 0 ? 400 : 620);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const pct = Math.round(nowT.progress * 100);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(28,24,32,0.88)', padding: 24 }}>
      <style>{`
        @keyframes xg-bang{0%{opacity:0;transform:scale(1.7)}45%{opacity:1;transform:scale(.9)}72%{transform:scale(1.05)}100%{transform:scale(1)}}
        @keyframes xg-punch{0%{transform:scale(1)}30%{transform:scale(1.16)}100%{transform:scale(1)}}
        @keyframes xg-pop{0%{opacity:0;transform:scale(.5)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
      `}</style>
      {/* eyebrow */}
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.6)', marginBottom: 6, animation: 'xg-pop .4s ease both' }}>경험치 획득</span>
      {/* 총 XP — 쾅마다 punch */}
      <div key={step} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 22, animation: step > 0 ? 'xg-punch .3s ease' : 'none' }}>
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 52, color: '#fff', lineHeight: 1 }}>+{animTotal.toLocaleString()}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 18, color: 'rgba(255,255,255,0.6)' }}>XP</span>
      </div>
      {/* 환산 내역 — 하나씩 '쾅' 등장(어떤 수치로 됐는지) */}
      <div style={{ width: '100%', maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {sources.map((s, i) => (
          <div key={s.key} style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderRadius: 12, background: 'rgba(255,255,255,0.08)', opacity: i < step ? 1 : 0, animation: i < step ? 'xg-bang .42s cubic-bezier(.3,1.4,.5,1) both' : 'none' }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: 'rgba(255,255,255,0.82)' }}>{s.label}</span>
            <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 16, color: '#FFC94D' }}>+{s.val.toLocaleString()}</span>
          </div>
        ))}
      </div>
      {/* 등급 게이지 — 항목 공개마다 차오름 */}
      <div style={{ width: '100%', maxWidth: 280 }}>
        <div style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: TG.CORAL_GRAD, transition: 'width .5s cubic-bezier(.4,0,.2,1)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{nowT.name}</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: nowT.examReady ? '#FFC94D' : 'rgba(255,255,255,0.55)' }}>{nowT.isMax ? '최고 등급' : nowT.examReady ? '가득 참!' : `다음까지 ${nowT.toNext.toLocaleString()} XP`}</span>
        </div>
      </div>
      {/* 승급 가능 배너 — 게이지 만땅 순간 */}
      {justReady && (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 14, background: TG.CORAL_GRAD, boxShadow: '0 8px 20px rgba(242,72,76,0.4)', animation: 'xg-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14.5, color: '#fff' }}>🎖 승급 시험 가능!</span>
        </div>
      )}
      {/* 확인 — 다 끝나면 등장 */}
      {!hold && done && (
        <button onClick={onDone} className="tg-press" style={{ marginTop: 34, padding: '13px 46px', borderRadius: 16, border: 'none', cursor: 'pointer', background: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: TG.INK, animation: 'xg-pop .4s ease .1s both' }}>확인</button>
      )}
    </div>
  );
}
