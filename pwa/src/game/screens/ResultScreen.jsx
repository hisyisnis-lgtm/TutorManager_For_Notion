// 결과 화면 — 신기록 배지·축하 판다·점수(카운트업)·통계 2카드·코치·다시도전/난이도 바꾸기.
import { useState } from 'react';
import { TrophyIcon, ArrowClockwiseIcon, LightningIcon } from '@phosphor-icons/react';
import { TG, FONT_NUM, FONT_BODY, TOUCH_OPT, pickCelebratePanda } from '../tgTokens.js';
import { useCountUp, FlameIcon } from '../tgWidgets.jsx';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble, ConfettiBurst, CrispFlash, LIGHT_CONFETTI } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 첫 결과 화면 코치마크 — 점수·통계·다음 액션. Reveal 등장 후 표시.
const RESULT_COACH = [
  { selector: '[data-coach="result-score"]', label: '이번 판 점수예요. 최고 기록을 넘기면 신기록! 🏆' },
  { selector: '[data-coach="result-stats"]', label: '최고 콤보와 평균 반응속도도 확인할 수 있어요.' },
  { selector: '[data-coach="result-actions"]', label: '다시 도전하거나, 아래에서 다른 모드를 골라요.' },
];
// 초급 저조 시 연습 유도 코치마크 — '모드 선택' 버튼만 스포트라이트(조건부·결과화면 1회).
const SUGGEST_COACH = [
  { selector: '[data-coach="result-modeselect"]', label: "여기서 '연습 모드'를 골라 천천히 연습해봐요! 🐼" },
];

// 하단 보조 버튼 (흰 배경 아웃라인). flex:1로 단일=풀폭 / 2개=반반.
function SecBtn({ label, onClick, coachId }) {
  return (
    <button onClick={() => { playSfx('button'); onClick(); }} className="tg-press" data-coach={coachId} style={{
      flex: 1, minWidth: 0, height: 54, borderRadius: 18, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', ...TOUCH_OPT,
    }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#9a93a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}

export function ResultScreen({ score, maxCombo, avgMs, isNewBest, previousBest, onRetry, onChangeDiff, onModeSelect, retryLabel = '다시 도전', changeLabel = '난이도 바꾸기', practice = false, endKind = null, suggestPractice = false, coachReady = true }) {
  const animScore = useCountUp(score, 1100);
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '-';
  const pandaSrc = pickCelebratePanda(isNewBest, maxCombo);
  const delta = score - previousBest;
  // 첫 결과 코치마크(1회) — 연습 결과는 제외(신기록/기록 개념이 다름).
  // ★coachReady 게이트는 훅이 아니라 아래 '오버레이 렌더 조건'에 건다. 훅에 걸면 레이스로 무력화:
  //   결과화면 마운트 시점엔 업적 큐가 아직 비어(end-effect가 렌더 후 실행) coachReady=true → visible=true로 시작,
  //   직후 큐가 차도 useTabTip은 visible을 되돌리지 않아 축하 연출과 겹쳤음(실기기 재현).
  const tip = useTabTip('game-result', !practice);
  // 초급 저조 연습 유도 스포트라이트 — 첫 결과 코치가 끝난 뒤(안 겹치게)·결과화면당 1회. 전역 플래그는 안 건드림(모드선택 유도도 이어져야 함).
  const [suggestSeen, setSuggestSeen] = useState(false);
  return (
    <>
      {/* 신기록 축하 파티클 — 성취 순간만(실패/시간초과엔 미표시). 상단 판다/배지 위에서 색색 조각이 터져 낙하 */}
      {isNewBest && !practice && <CrispFlash color="rgba(255,255,255,0.6)" zIndex={7} />}
      {isNewBest && !practice && <ConfettiBurst count={32} power={1.35} size={10} zIndex={3} style={{ top: 150 }} />}
      {isNewBest && !practice && <ConfettiBurst colors={LIGHT_CONFETTI} count={16} power={1.3} size={6} zIndex={3} style={{ top: 150 }} />}
      {/* 신기록 배지 (중앙) */}
      {isNewBest && (
        <Reveal i={0} style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 16, background: 'linear-gradient(90deg, #ffd24d, #ff9f40)', boxShadow: '0px 6px 14px rgba(255,159,64,0.28)' }}>
          <TrophyIcon size={13} weight="fill" color="#fff" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#fff', whiteSpace: 'nowrap' }}>신기록 달성!</span>
        </div>
        </Reveal>
      )}
      {/* 축하 판다 150×150 (가로 중앙) */}
      <Reveal i={1} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 64 }}>
        <img src={pandaSrc} alt="" width={150} height={150} style={{ display: 'block', objectFit: 'contain' }} />
      </Reveal>
      {/* 점수 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 196 }}>
      <div data-coach="result-score" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 60, color: '#f2484c', lineHeight: 1, whiteSpace: 'nowrap' }}>{animScore.toLocaleString()}</span>
        {previousBest > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0', whiteSpace: 'nowrap' }}>이전 최고 {previousBest.toLocaleString()}</span>
            {isNewBest && delta > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', borderRadius: 10, background: 'rgba(54,201,141,0.16)' }}>
                <span style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 12, color: '#1fa86a', whiteSpace: 'nowrap' }}>▲ {delta.toLocaleString()}</span>
              </span>
            )}
          </div>
        )}
      </div>
      </Reveal>
      {/* 통계 2카드 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 312 }}>
      <div data-coach="result-stats" style={{ height: 128, display: 'flex', gap: 12, alignItems: 'stretch' }}>
        {[
          { icon: <FlameIcon size={17} color={TG.CORAL_DK} />, ibg: 'rgba(255,107,107,0.14)', val: maxCombo, unit: '콤보', label: '최고 콤보' },
          { icon: <LightningIcon size={17} weight="fill" color="#4D8DFF" />, ibg: 'rgba(77,141,255,0.14)', val: avgSec, unit: avgSec === '-' ? '' : '초', label: '평균 반응속도' },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, minWidth: 0, background: '#fff', borderRadius: 22, boxShadow: '0px 5px 14px rgba(43,39,48,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: s.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
              <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 26, color: '#2b2730' }}>{s.val}</span>
              {s.unit && <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#9a93a0' }}>{s.unit}</span>}
            </div>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0' }}>{s.label}</span>
          </div>
        ))}
      </div>
      </Reveal>
      {/* 코치 — 통계카드 하단(440)과 다시 도전 CTA 사이 가용공간에 가두고 세로 중앙(짧은 화면·사파리 툴바서도 통계·CTA 양쪽과 겹침 방지) */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 452, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
        <CoachBubble text={suggestPractice ? '초급이 어렵나요? 천천히 익혀봐요' : practice ? '잘했어요! 또 연습해볼까요?' : endKind === 'miss' ? '아쉽게 틀렸어요! 다시 도전해볼까요?' : '다시 도전해서 신기록을 깨볼까요?'} />
      </Reveal>
      {/* 다시 도전 (하단 고정) — 최하단 '난이도 바꾸기' 위 */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <button data-coach="result-actions" onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
        width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
      }}>
        <ArrowClockwiseIcon size={19} weight="bold" color="#fff" />
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{retryLabel}</span>
      </button>
      </Reveal>
      {/* 하단 보조 — onModeSelect 있으면 [변경 | 모드 선택] 2분할, 없으면 단일(풀폭) */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <SecBtn label={changeLabel} onClick={onChangeDiff} />
        {onModeSelect && <SecBtn label="모드 선택" onClick={onModeSelect} coachId="result-modeselect" />}
      </div>
      </Reveal>
      <CoachMarkOverlay visible={tip.visible && coachReady} onDone={tip.dismiss} steps={RESULT_COACH} delay={260} showControls={false} />
      {/* 초급 저조 유도 — '모드 선택' 버튼 스포트라이트. 업적/모드해제 연출(coachReady)과 첫 결과 코치가 끝난 뒤에만·1회.
          ★coachReady 없으면 tip이 게이트로 묶여 있는 동안(!tip.visible) 이 오버레이가 축하 연출 위에 겹쳐 뜸.
          forceLastStep: 주변 탭 흡수 → '모드 선택'을 실제로 눌러야만 진행(버튼 onClick=onModeSelect가 화면 전환). */}
      <CoachMarkOverlay visible={suggestPractice && coachReady && !!onModeSelect && !tip.visible && !suggestSeen} onDone={() => setSuggestSeen(true)} steps={SUGGEST_COACH} delay={500} showControls={false} forceLastStep />
    </>
  );
}
