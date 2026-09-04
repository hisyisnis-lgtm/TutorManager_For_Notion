// 신기록 전용 비트 — 신기록을 낸 판에서 결과화면 직전, 어두운 게임오버 비트('수고했어요') 대신 뜨는 밝은 축하 순간.
// ▶ 목적: "방금 최고 기록을 깼다"를 결과화면 도착 전에 **크고 분명하게** 인지시키고 기분 좋게(유입 깔때기 = 성취=축하).
//   → 게임오버와 같은 어두운 딤 위에 골드 트로피 팝 + 큰 '신기록!' + 큰 점수 + 이전 기록(2026-08-06 시안 773:55: 밝은 크림 딤·색종이·플래시·증가폭 칩 폐기).
// GameOverBeat과 동일한 "잠깐 멈춰 인지" 골격(zIndex 120·~2초 체류 후 onDone·탭 스킵)이되 무드만 축하로 교체.
// 아이덴티티 톤: 링·글로우·블룸 없이(이 앱엔 촌스러움) 크리스프 플래시 + 색종이 물리로 임팩트. 참조: tone_game_redesign.md §파티클.
import { useEffect, useState } from 'react';
import { Cup } from '@solar-icons/react';
import { TYPE, haptic, SPACE, TG } from '../tgTokens.js';
import { RevealRings, BeatContent } from './shared.jsx';

const RECORD_GOLD = TG.SUN; // 트로피 색(시안 773:55 — 골드 원 배경 없이 아이콘만)

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
  const firstRecord = !(previousBest > 0);
  return (
    <div onClick={skip} style={{
      position: 'fixed', inset: 0, zIndex: 120, overflow: 'hidden',
      cursor: 'pointer', // 딤은 BeatDim(공용 레이어) 담당 — 체인 사이 깜빡임 방지(2026-08-08)
    }}>
      <style>{`
        @keyframes nrb-pop { 0%{opacity:0;transform:scale(.4)} 62%{opacity:1;transform:scale(1.12)} 100%{transform:scale(1)} }
        @keyframes nrb-badge { 0%{opacity:0;transform:scale(0) rotate(-32deg)} 66%{opacity:1;transform:scale(1.14) rotate(7deg)} 100%{transform:scale(1) rotate(0)} }
      `}</style>
      {/* 동심원 배경 — 딤 위·콘텐츠 아래. ★BeatContent 밖에 둔다: 안에 있으면 부모 퇴장(170ms)이
          먼저 지워버려 바깥부터 퍼지는 out 모션이 보이지 않는다(2026-08-09) */}
      <RevealRings out={closing} />
      <BeatContent closing={closing}>
      {/* 시안 773:55(2026-08-08 간격 수정본) — 스택 전체(282 높이)가 **화면 정중앙**.
          [트로피126 + '신기록!'] 간격 0 / 묶음 간격 20 / [점수 + 이전기록] 간격 **16**(구 6). 화면 높이가 달라도 구도가 유지된다. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x3,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {/* 트로피 — 시안: 골드 원 배경 없이 아이콘만 126(회전 오버슛 팝) */}
          <Cup size={126} weight="Bold" color={RECORD_GOLD} style={{ animation: 'tg-ic-trophy .38s cubic-bezier(.22,1,.36,1) .04s both' }} />
          <span style={{
            ...TYPE.head, fontSize: 32, lineHeight: '42px', color: '#fff', whiteSpace: 'nowrap',
            animation: 'nrb-pop .5s cubic-bezier(.34,1.56,.64,1) .12s both',
          }}>신기록!</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2 }}>
          <span style={{
            ...TYPE.numHero, fontSize: 70, fontWeight: 700, lineHeight: '58px', color: '#fff', whiteSpace: 'nowrap',
            animation: 'nrb-pop .52s cubic-bezier(.34,1.56,.64,1) .22s both',
          }}>{score.toLocaleString()}</span>
          {/* 이전 기록 — 첫 기록이면 격려 */}
          <span style={{
            ...TYPE.body, fontSize: 18, lineHeight: '20px', color: '#fff', whiteSpace: 'nowrap', textAlign: 'center',
            animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .38s both',
          }}>{firstRecord ? '첫 기록을 세웠어요! 🎉' : `이전 최고 ${previousBest.toLocaleString()}`}</span>
        </div>
      </div>
      </BeatContent>
    </div>
  );
}
