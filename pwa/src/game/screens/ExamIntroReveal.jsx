// 승급시험 진입 연출 — 시험 런이 라이브(카운트다운 종료)가 되는 순간 잠깐(≈2s) "{급} 승급시험"임을 알림.
// 톤: 게임오버·모드해제 연출과 통일한 프로스티드 딤 + 급 색 메달 팝. 탭/자동으로 넘어가 첫 문제 시작.
import { useEffect, useState } from 'react';
import { MedalStar } from '@solar-icons/react';
import { TG, TYPE, haptic } from '../tgTokens.js';
import { RevealStage, RevealRings, BeatContent } from './shared.jsx';

// total — "N문제 · 틀리면…" 접두어. 일반 판(10문제)과 분량이 달라 미리 알려준다(2026-08-08 사용자 유지 결정).
export function ExamIntroReveal({ tierLabel = '입문', total = 20, onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
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
      position: 'fixed', inset: 0, zIndex: 138,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)',
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .35s ease both', cursor: 'pointer',
    }}>
      <style>{`
        @keyframes ei-icon { 0%{opacity:0;transform:scale(.55) rotate(-14deg)} 62%{opacity:1;transform:scale(1.12) rotate(6deg)} 100%{transform:scale(1) rotate(0)} }
      `}</style>
      {/* 동심원 배경 — 딤 위·콘텐츠 아래. ★BeatContent 밖에 둔다: 안에 있으면 부모 퇴장(170ms)이
          먼저 지워버려 바깥부터 퍼지는 out 모션이 보이지 않는다(2026-08-09) */}
      <RevealRings out={closing} />
      <BeatContent closing={closing}>
      <RevealStage>
      {/* 메달 아이콘 — 시안 757:2: 흰 원 배경 **삭제**(hidden), 골드 메달만 126×126 @y306 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 306, display: 'flex', justifyContent: 'center' }}>
        <MedalStar size={126} weight="Bold" color={TG.SUN} style={{ animation: 'tg-ic-medal .6s cubic-bezier(.34,1.56,.64,1) .04s both' }} />
      </div>
      {/* 타이틀 — {급} 승급시험 (시안 32px/42, y432) */}
      <span style={{ position: 'absolute', left: 0, right: 0, top: 432, textAlign: 'center', ...TYPE.head, fontSize: 32, lineHeight: '42px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>{tierLabel} 승급시험</span>
      {/* 설명 2줄 (시안 y494 · y520) — 규칙: 틀려도 하트 없이 다음 문제로 진행 */}
      <span style={{ position: 'absolute', left: 0, right: 0, top: 494, textAlign: 'center', ...TYPE.body, fontSize: 14, lineHeight: '20px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .24s both' }}>{total}문제 · 틀리면 다음 문제로</span>
      <span style={{ position: 'absolute', left: 0, right: 0, top: 520, textAlign: 'center', ...TYPE.body, fontSize: 14, lineHeight: '19px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .3s both' }}>정답률 80% 이상이면 등급 상승</span>
      </RevealStage>
      </BeatContent>
    </div>
  );
}
