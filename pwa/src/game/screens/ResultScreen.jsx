// 결과 화면 — 신기록 배지·축하 판다·점수(카운트업)·통계 2카드·코치·다시도전/난이도 바꾸기.
import { TrophyIcon, ArrowClockwiseIcon, LightningIcon } from '@phosphor-icons/react';
import { TG, FONT_NUM, FONT_BODY, TOUCH_OPT, pickCelebratePanda } from '../tgTokens.js';
import { useCountUp, FlameIcon } from '../tgWidgets.jsx';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble } from './shared.jsx';

// 하단 보조 버튼 (흰 배경 아웃라인). flex:1로 단일=풀폭 / 2개=반반.
function SecBtn({ label, onClick }) {
  return (
    <button onClick={() => { playSfx('button'); onClick(); }} className="tg-press" style={{
      flex: 1, minWidth: 0, height: 54, borderRadius: 18, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 8px', ...TOUCH_OPT,
    }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#9a93a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}

export function ResultScreen({ score, maxCombo, avgMs, isNewBest, previousBest, onRetry, onChangeDiff, onModeSelect, retryLabel = '다시 도전', changeLabel = '난이도 바꾸기', practice = false, endReason = null }) {
  const animScore = useCountUp(score, 1100);
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '-';
  const pandaSrc = pickCelebratePanda(isNewBest, maxCombo);
  const delta = score - previousBest;
  return (
    <>
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
      <div style={{ height: 128, display: 'flex', gap: 12, alignItems: 'stretch' }}>
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
        <CoachBubble text={practice ? '잘했어요! 또 연습해볼까요?' : endReason === 'lives' ? '하트를 다 썼어요! 다시 도전해볼까요?' : '다시 도전해서 신기록을 깨볼까요?'} />
      </Reveal>
      {/* 다시 도전 (하단 고정) — 최하단 '난이도 바꾸기' 위 */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
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
        {onModeSelect && <SecBtn label="모드 선택" onClick={onModeSelect} />}
      </div>
      </Reveal>
    </>
  );
}
