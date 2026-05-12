import { useEffect, useState } from 'react';
import { LeafIcon } from '@phosphor-icons/react';

// 먹이 1개를 얻은 순간 화면 중앙 아래쪽에 잠깐 떠오르는 게임형 피드백 토스트.
// 트리거: 숙제 첫 제출 / 피드백 첫 확인 시점에 호출.
// 자동 dismiss(1800ms) 후 onClose. pointer-events 없음 — UI 가리지 않음.
export default function FoodEarnedToast({ open, onClose, message = '먹이를 얻었어요!' }) {
  const [phase, setPhase] = useState('enter');

  useEffect(() => {
    if (!open) return;
    setPhase('enter');
    const holdTimer = setTimeout(() => setPhase('exit'), 1500);
    const closeTimer = setTimeout(() => { onClose?.(); setPhase('enter'); }, 1800);
    return () => { clearTimeout(holdTimer); clearTimeout(closeTimer); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '30%',
      left: '50%',
      zIndex: 9998,
      pointerEvents: 'none',
      animation: phase === 'enter'
        ? 'food-earned-in 450ms cubic-bezier(0.34, 1.56, 0.64, 1) both'
        : 'food-earned-out 300ms ease-in both',
    }}>
      <div style={{
        background: 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)',
        color: 'white',
        padding: '14px 22px',
        borderRadius: 18,
        boxShadow: '0 10px 32px rgba(127,0,5,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 200,
        justifyContent: 'center',
        whiteSpace: 'nowrap',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LeafIcon weight="fill" size={20} color="#dcfce7" />
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.2px' }}>
            +1 먹이!
          </div>
          <div style={{ fontSize: 12, opacity: 0.88, marginTop: 2, fontWeight: 500 }}>
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}
