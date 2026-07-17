// 게임오버 비트 — 결과화면 직전, 게임 화면 위 오버레이(전 종료 공통).
// ▶ 목적: 게임오버 조건 즉시 결과로 전환되면 상황을 못 알아채므로, "잠깐 멈춰 인지시키는" 기능적 비트.
//   → 화려함이 아니라 ①명확한 멈춤(딤+블러) ②충분한 체류 시간 ③왜 끝났는지 명시 가 핵심.
// 미니멀 타이포 연출(토스풍): 프로스티드 딤 위로 헤드라인 + 원인 한 줄이 부드럽게 떠오름(오버슛 없음).
// ~2초 체류 후 자동 소멸(onDone). SFX는 end-effect 담당, 여긴 햅틱만.
import { useEffect, useState } from 'react';
import { FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';

// 종료 사유별 헤드라인 + 원인 한 줄 — 압박 아닌 격려 톤이되, 왜 끝났는지 분명히.
// complete=모든 문제 완료(정상) · timeout=시간 초과 · miss=무한 서든데스 오답 종료
// ('lives'는 서든데스 전환으로 폐기 — 하트=건너뛰기 예산이라 소진해도 게임오버 아님)
const END = {
  complete: { title: '수고했어요!', reason: '모든 문제를 마쳤어요' },
  timeout: { title: '시간 종료!', reason: '시간 안에 풀지 못했어요' },
  miss: { title: '아쉬워요!', reason: '틀려서 게임이 끝났어요' },
};

export function GameOverBeat({ endKind = 'complete', onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    haptic(24); // 단발 부드러운 탭
    if (hold) return undefined; // [DEV] 미리보기 유지
    const t1 = setTimeout(() => setClosing(true), 1750); // 체류 연장 — 인지 시간 확보
    const t2 = setTimeout(() => onDone && onDone(), 2050);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const e = END[endKind] || END.complete;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(24,20,28,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      animation: closing ? 'tg-fade-out .3s ease forwards' : 'tg-dim-in .35s ease both', // 공용 프리미티브(shared.jsx)
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -8 }}>
        {/* 헤드라인 — 클린 타이포, 부드럽게 떠오르며 페이드(오버슛 없음) */}
        <span style={{
          fontFamily: FONT_TITLE, fontSize: 38, color: '#fff', letterSpacing: '-0.01em',
          animation: 'tg-rise .55s cubic-bezier(.22,1,.36,1) .05s both',
        }}>{e.title}</span>
        {/* 원인 한 줄 — 왜 끝났는지 명시(인지) */}
        <span style={{
          fontFamily: FONT_BODY, fontWeight: 600, fontSize: 15, color: 'rgba(255,255,255,0.82)', marginTop: 10,
          animation: 'tg-rise .55s cubic-bezier(.22,1,.36,1) .16s both',
        }}>{e.reason}</span>
        {/* 진행 힌트 */}
        <span style={{
          fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginTop: 18,
          animation: 'tg-rise .55s cubic-bezier(.22,1,.36,1) .3s both',
        }}>결과 보기로 이동 중…</span>
      </div>
    </div>
  );
}
