// 튜토리얼 완료 비트 — 튜토리얼과 '첫 실전 한 판' 사이의 숨. (2026-08-07 사용자 피드백: "너무 갑작스러워")
//  구: 튜토리얼 마지막 프레임 → 0.2초 만에 코랄 웨이브 + "3" 카운트다운이 덮쳐 밀려 들어가는 느낌이었다.
//  이 비트가 ①배웠다는 마무리 ②이제 무엇이 시작되는지(스테이지·문제 수)를 알려주고 카운트다운으로 넘긴다.
// 톤: ExamIntroReveal·ModeUnlockReveal과 같은 딤 + RevealStage 절대좌표 언어. 다만 축하 판다로 따뜻하게.
// 탭하면 즉시 넘어감(기다리게 하지 않는다).
import { useEffect, useState } from 'react';
import { TYPE, ASSETS, haptic } from '../tgTokens.js';
import { RevealStage, BeatContent } from './shared.jsx';

const AUTO_MS = 2300;   // 자동 진행(탭하면 즉시)
const FADE_MS = 300;

export function TutorialDoneBeat({ stageLabel = '입문 1', total = 10, onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    haptic([20, 40, 20]);
    if (hold) return undefined;
    const t1 = setTimeout(() => setClosing(true), AUTO_MS - FADE_MS);
    const t2 = setTimeout(() => onDone && onDone(), AUTO_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div onClick={() => !hold && onDone && onDone()} style={{
      position: 'fixed', inset: 0, zIndex: 138,
      background: 'rgba(24,20,28,0.82)', backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)',
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .35s ease both', cursor: 'pointer',
    }}>
      <BeatContent closing={closing}>
      <RevealStage>
        {/* 축하 판다 — 결과화면과 같은 만세 판다(성취 언어 통일) */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 300, display: 'flex', justifyContent: 'center' }}>
          <img src={ASSETS.celebrate[2]} alt="" width={150} height={150}
            style={{ display: 'block', objectFit: 'contain', animation: 'tg-pop .55s cubic-bezier(.34,1.56,.64,1) .04s both' }} />
        </div>
        <span style={{ position: 'absolute', left: 0, right: 0, top: 462, textAlign: 'center', ...TYPE.label, lineHeight: '19px', color: 'rgba(255,255,255,0.8)', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>튜토리얼 끝!</span>
        <span style={{ position: 'absolute', left: 0, right: 0, top: 482, textAlign: 'center', ...TYPE.head, fontSize: 28, lineHeight: '44px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .22s both' }}>이제 진짜 한 판</span>
        <span style={{ position: 'absolute', left: 0, right: 0, top: 530, textAlign: 'center', ...TYPE.body, fontSize: 14, lineHeight: '20px', color: 'rgba(255,255,255,0.85)', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .3s both' }}>{stageLabel} · {total}문제</span>
      </RevealStage>
      </BeatContent>
    </div>
  );
}
