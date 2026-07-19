// 결과 화면 — 신기록 배지·축하 판다·점수(카운트업)·통계 2카드·코치·다시도전/난이도 바꾸기.
import { useState, useEffect } from 'react';
import { TrophyIcon, ArrowClockwiseIcon, LightningIcon, CheckCircleIcon, XCircleIcon, CaretRightIcon, HouseIcon, MedalIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, pickCelebratePanda, RADIUS, SPACE } from '../tgTokens.js';
import { useCountUp, FlameIcon } from '../tgWidgets.jsx';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble, ConfettiBurst, CrispFlash, LIGHT_CONFETTI } from './shared.jsx';
import { LoginNudgeModal } from './gameModals.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';

// 로그인 유도(게스트가 이전 기록 넘긴 순간) — game=유입 깔때기라 '성취 순간'에만 부드럽게. 세션 1회 + 닫으면 쿨다운(잔소리 방지).
let sessionNudged = false; // 앱 세션당 1회(리로드 시 리셋)
const NUDGE_COOLDOWN = 5 * 24 * 60 * 60 * 1000; // 닫은 뒤 5일
function nudgeAllowed() {
  if (sessionNudged) return false;
  try { const t = parseInt(localStorage.getItem('tg_login_nudge') || '0', 10); if (t && Date.now() - t < NUDGE_COOLDOWN) return false; } catch { /* noop */ }
  return true;
}

// 첫 결과 화면 코치마크 — 점수·통계·다음 액션. Reveal 등장 후 표시.
const RESULT_COACH = [
  { selector: '[data-coach="result-score"]', label: '이번 판 점수예요. 최고 기록을 넘기면 신기록! 🏆' },
  { selector: '[data-coach="result-stats"]', label: '최고 콤보와 평균 반응속도도 확인할 수 있어요.' },
  { selector: '[data-coach="result-actions"]', label: '다시 도전하거나, 홈으로 나갈 수 있어요.' },
];


export function ResultScreen({ score, maxCombo, avgMs, isNewBest, previousBest, onRetry, onHome, onExam = null, onNextLevel = null, onLogin = null, retryLabel = '다시 도전', practice = false, endKind = null, suggestPractice = false, coachReady = true }) {
  const animScore = useCountUp(score, 1100);
  // 로그인 유도 모달(게스트가 '이전 기록'을 실제로 넘긴 순간) — 마운트 때 1회 판정(세션·쿨다운).
  //  previousBest>0: 첫 판(항상 신기록·이전0) 코치마크와 안 겹치고, 재도전+향상=투자 있는 성취에만.
  //  신기록 축하(파티클·점수 카운트업)를 먼저 보이게 1.3s 뒤 등장. coachReady로 다른 오버레이와 겹침 방지.
  const [nudgeEligible] = useState(() => !!(onLogin && isNewBest && previousBest > 0 && !practice && nudgeAllowed()));
  const [nudgeOpen, setNudgeOpen] = useState(false);
  useEffect(() => {
    if (!nudgeEligible) return undefined;
    const t = setTimeout(() => { setNudgeOpen(true); sessionNudged = true; }, 1300);
    return () => clearTimeout(t);
  }, [nudgeEligible]);
  const dismissNudge = () => { setNudgeOpen(false); try { localStorage.setItem('tg_login_nudge', String(Date.now())); } catch { /* noop */ } };
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '-';
  const pandaSrc = pickCelebratePanda(isNewBest, maxCombo);
  const delta = score - previousBest;
  // 첫 결과 코치마크(1회) — 연습 결과는 제외(신기록/기록 개념이 다름).
  // ★coachReady 게이트는 훅이 아니라 아래 '오버레이 렌더 조건'에 건다. 훅에 걸면 레이스로 무력화:
  //   결과화면 마운트 시점엔 업적 큐가 아직 비어(end-effect가 렌더 후 실행) coachReady=true → visible=true로 시작,
  //   직후 큐가 차도 useTabTip은 visible을 되돌리지 않아 축하 연출과 겹쳤음(실기기 재현).
  const tip = useTabTip('game-result', !practice);
  return (
    <>
      {/* 신기록 축하 파티클 — 성취 순간만(실패/시간초과엔 미표시). 상단 판다/배지 위에서 색색 조각이 터져 낙하 */}
      {isNewBest && !practice && <CrispFlash color="rgba(255,255,255,0.6)" zIndex={7} />}
      {isNewBest && !practice && <ConfettiBurst count={32} power={1.35} size={10} zIndex={3} style={{ top: 150 }} />}
      {isNewBest && !practice && <ConfettiBurst colors={LIGHT_CONFETTI} count={16} power={1.3} size={6} zIndex={3} style={{ top: 150 }} />}
      {/* 신기록 배지 (중앙) */}
      {isNewBest && (
        <Reveal i={0} style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 16px', borderRadius: RADIUS.lg, background: 'linear-gradient(90deg, #ffd24d, #ff9f40)', boxShadow: '0px 6px 14px rgba(255,159,64,0.28)' }}>
          <TrophyIcon size={13} weight="fill" color="#fff" />
          <span style={{ ...TYPE.btnSm, color: '#fff', whiteSpace: 'nowrap' }}>신기록 달성!</span>
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
        <span style={{ ...TYPE.numHero, color: TG.CORAL_DK, lineHeight: 1, whiteSpace: 'nowrap' }}>{animScore.toLocaleString()}</span>
        {previousBest > 0 && (
          <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center', marginTop: SPACE.xxs }}>
            <span style={{ ...TYPE.sub, color: TG.SUB, whiteSpace: 'nowrap' }}>이전 최고 {previousBest.toLocaleString()}</span>
            {isNewBest && delta > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', borderRadius: RADIUS.md, background: 'rgba(54,201,141,0.16)' }}>
                <span style={{ ...TYPE.num, color: TG.SUCCESS, whiteSpace: 'nowrap' }}>▲ {delta.toLocaleString()}</span>
              </span>
            )}
          </div>
        )}
      </div>
      </Reveal>
      {/* 통계 2카드 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 312 }}>
      <div data-coach="result-stats" style={{ height: 128, display: 'flex', gap: SPACE.xl, alignItems: 'stretch' }}>
        {[
          { icon: <FlameIcon size={17} color={TG.CORAL_DK} />, ibg: 'rgba(255,107,107,0.14)', val: maxCombo, unit: '콤보', label: '최고 콤보' },
          { icon: <LightningIcon size={17} weight="fill" color="#4D8DFF" />, ibg: 'rgba(77,141,255,0.14)', val: avgSec, unit: avgSec === '-' ? '' : '초', label: '평균 반응속도' },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, minWidth: 0, background: '#fff', borderRadius: RADIUS.xxl, boxShadow: '0px 5px 14px rgba(43,39,48,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
            <div style={{ width: 40, height: 40, borderRadius: RADIUS.xl, background: s.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.xxs }}>
              <span style={{ ...TYPE.numLg, color: TG.INK }}>{s.val}</span>
              {s.unit && <span style={{ ...TYPE.label, color: TG.SUB }}>{s.unit}</span>}
            </div>
            <span style={{ ...TYPE.meta, color: TG.SUB }}>{s.label}</span>
          </div>
        ))}
      </div>
      </Reveal>
      {/* 코치 — 통계카드 하단과 CTA 사이 가용공간 세로중앙. (트레이닝 유도는 '홈으로 가기' 후 홈 모달로 — 결과화면은 안 어수선하게) */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 452, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
        <CoachBubble text={onExam ? '급을 다 깼어요! 이제 승급시험에 도전할 수 있어요 🎖️' : onNextLevel ? '다음 스테이지에 도전할 수 있어요! 🎉' : suggestPractice ? `${DIFFICULTIES[0].label} 단계가 어렵나요? 천천히 익혀봐요` : practice ? '잘했어요! 또 해볼까요?' : endKind === 'miss' ? '아쉽게 틀렸어요! 다시 도전해볼까요?' : '다시 도전해서 신기록을 깨볼까요?'} />
      </Reveal>
      {/* 메인 CTA (하단 고정) — 다음 스테이지가 열렸으면 [다시하기 | 다음 스테이지] 반반, 아니면 '다시 도전' 풀폭 */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      {(onExam || onNextLevel) ? (
        <div data-coach="result-actions" style={{ display: 'flex', gap: SPACE.lg }}>
          <button onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
            flex: 1, minWidth: 0, height: 62, borderRadius: RADIUS.xl, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
          }}>
            <ArrowClockwiseIcon size={18} weight="bold" color="#9a93a0" />
            <span style={{ ...TYPE.btn, color: TG.SUB, whiteSpace: 'nowrap' }}>다시하기</span>
          </button>
          {/* 급 5스테이지를 다 깼으면 다음은 '승급시험'(우선), 아니면 '다음 스테이지' */}
          <button onClick={() => { playSfx('button'); (onExam || onNextLevel)(); }} className="tg-press" style={{
            flex: 1, minWidth: 0, height: 62, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
            background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, ...TOUCH_OPT,
          }}>
            {onExam && <MedalIcon size={16} weight="fill" color="#fff" />}
            <span style={{ ...TYPE.btn, color: '#fff', whiteSpace: 'nowrap' }}>{onExam ? '승급시험' : '다음 스테이지'}</span>
            <CaretRightIcon size={16} weight="bold" color="#fff" />
          </button>
        </div>
      ) : (
        <button data-coach="result-actions" onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
          width: '100%', height: 62, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
          background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
        }}>
          <ArrowClockwiseIcon size={19} weight="bold" color="#fff" />
          <span style={{ ...TYPE.cta, color: '#fff' }}>{retryLabel}</span>
        </button>
      )}
      </Reveal>
      {/* 하단 — 홈으로 가기(은은한 단일 버튼). 다른 난이도·모드는 홈 허브에서 고른다. */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(22px + env(safe-area-inset-bottom))' }}>
        <button data-coach="result-home" onClick={() => { playSfx('button'); onHome(); }} className="tg-press" style={{
          width: '100%', height: 54, borderRadius: RADIUS.btn, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, ...TOUCH_OPT,
        }}>
          <HouseIcon size={16} weight="fill" color={TG.SUB} />
          <span style={{ ...TYPE.btnSm, color: TG.SUB }}>홈으로 가기</span>
        </button>
      </Reveal>
      <CoachMarkOverlay visible={tip.visible && coachReady} onDone={tip.dismiss} steps={RESULT_COACH} delay={260} showControls={false} />
      {/* (구 '초급 저조 유도' 강제 코치 오버레이 폐기 — 2026-07-19. 이제 유도는 코치 말풍선 아래 비강제 옵션 CTA로.) */}
      {/* 로그인 유도 모달 — 게스트 신기록(이전기록 넘김) 축하 뒤. 다른 축하 오버레이·코치와 겹치지 않게 coachReady 게이트. */}
      {nudgeOpen && coachReady && <LoginNudgeModal onLogin={onLogin} onClose={dismissNudge} />}
    </>
  );
}

// 승급 시험 결과 — 결과화면 디자인 재활용(판다·배지·통계·코치·버튼). 점수 대신 정답률(합격/불합격).
//  합격 축하 연출은 앞선 RankUpReveal이 담당 → 여긴 담백한 요약 + 홈/재도전.
export function ExamResultScreen({ correct = 0, total = 20, passed = false, canRetry = false, onRetry, onHome }) {
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const animCorrect = useCountUp(correct, 900);
  const animPct = useCountUp(pct, 900, 1); // 게이지 전용 — 정수 카운트업은 문제 1개당 5%씩 점프해서 소수로 따로 돌림
  const pandaSrc = pickCelebratePanda(passed, passed ? 5 : 0);
  const wrong = Math.max(0, total - correct);
  const needMore = Math.max(0, Math.ceil(total * 0.8) - correct); // 합격까지 더 맞혀야 하는 문제 수(80% 기준)
  return (
    <>
      {passed && <CrispFlash color="rgba(255,255,255,0.6)" zIndex={7} />}
      {passed && <ConfettiBurst count={30} power={1.3} size={10} zIndex={3} style={{ top: 150 }} />}
      {passed && <ConfettiBurst colors={LIGHT_CONFETTI} count={15} power={1.25} size={6} zIndex={3} style={{ top: 150 }} />}
      {/* 합격/불합격 배지 */}
      <Reveal i={0} style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 16px', borderRadius: RADIUS.lg,
          background: passed ? 'linear-gradient(90deg, #36C98D, #1fa86a)' : TG.BORDER,
          boxShadow: passed ? '0px 6px 14px rgba(31,168,106,0.28)' : 'none' }}>
          {passed && <TrophyIcon size={13} weight="fill" color="#fff" />}
          <span style={{ ...TYPE.btnSm, color: passed ? '#fff' : TG.SUB, whiteSpace: 'nowrap' }}>{passed ? '승급 시험 합격!' : '승급 시험 불합격'}</span>
        </div>
      </Reveal>
      {/* 축하/격려 판다 — 배지와 점수 사이 여백 위해 살짝 작게(겹침 방지) */}
      <Reveal i={1} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 88 }}>
        <img src={pandaSrc} alt="" width={120} height={120} style={{ display: 'block', objectFit: 'contain' }} />
      </Reveal>
      {/* 정답률(점수 자리) */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 234 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.xs }}>
            <span style={{ ...TYPE.numHero, color: passed ? TG.SUCCESS : TG.CORAL_DK, lineHeight: 1 }}>{animCorrect}</span>
            <span style={{ ...TYPE.num, fontSize: 30, color: TG.SUB }}>/ {total}</span>
          </div>
          {/* 합격선 게이지 — 채움은 카운트업과 동기. 합격 기준(80%)까지는 빨강, 넘어선 만큼만 초록(틱 없이 색 경계가 곧 합격선). */}
          {(() => {
            const fillPct = Math.min(100, animPct);
            const redFrac = fillPct > 0 ? (Math.min(80, fillPct) / fillPct) * 100 : 0; // 래퍼 내 빨강 비율 — 80% 경계를 트랙 좌표에 고정
            return (
              <div style={{ position: 'relative', width: '100%', height: 12, borderRadius: RADIUS.sm, background: TG.BORDER, marginTop: SPACE.x2, overflow: 'hidden' }}>
                {/* 채움 래퍼가 둥근 끝을 만들고(overflow hidden), 안의 빨강/초록 렉트를 클리핑 */}
                {fillPct > 0 && (
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fillPct}%`, borderRadius: RADIUS.sm, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${redFrac}%`, background: TG.CORAL_GRAD }} />
                    {fillPct > 80 && <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - redFrac}%`, background: 'linear-gradient(90deg, #36C98D, #1fa86a)' }} />}
                  </div>
                )}
              </div>
            );
          })()}
          <span style={{ ...TYPE.sub, color: TG.SUB, marginTop: SPACE.xl }}>정답률 {pct}% · 합격 기준 80%</span>
        </div>
      </Reveal>
      {/* 통계 2카드(맞힌/틀린 문제) — 일반 결과 화면과 동일 기하·카드 스타일(빈 화면 방지) */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 384 }}>
        <div style={{ height: 128, display: 'flex', gap: SPACE.xl, alignItems: 'stretch' }}>
          {[
            { icon: <CheckCircleIcon size={24} weight="fill" color="#1fa86a" />, ibg: 'rgba(54,201,141,0.16)', val: correct, label: '맞힌 문제' },
            { icon: <XCircleIcon size={24} weight="fill" color={TG.CORAL_DK} />, ibg: 'rgba(255,107,107,0.14)', val: wrong, label: '틀린 문제' },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, minWidth: 0, background: '#fff', borderRadius: RADIUS.xxl, boxShadow: '0px 5px 14px rgba(43,39,48,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
              <div style={{ width: 40, height: 40, borderRadius: RADIUS.xl, background: s.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.xxs }}>
                <span style={{ ...TYPE.numLg, color: TG.INK }}>{s.val}</span>
                <span style={{ ...TYPE.label, color: TG.SUB }}>개</span>
              </div>
              <span style={{ ...TYPE.meta, color: TG.SUB }}>{s.label}</span>
            </div>
          ))}
        </div>
      </Reveal>
      {/* 코치 */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 534, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
        <CoachBubble text={passed ? '축하해요! 등급이 한 단계 올랐어요 🎉' : (canRetry ? `합격까지 ${needMore}문제! 바로 다시 도전해봐요` : '조금만 더! 경험치를 더 채우면 다시 도전할 수 있어요')} />
      </Reveal>
      {/* 불합격 + 재응시 가능 시에만 '다시 도전' */}
      {!passed && canRetry && (
        <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
          <button onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
            width: '100%', height: 62, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
            background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
          }}>
            <ArrowClockwiseIcon size={19} weight="bold" color="#fff" />
            <span style={{ ...TYPE.cta, color: '#fff' }}>다시 도전</span>
          </button>
        </Reveal>
      )}
      {/* 홈으로 */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
        <button onClick={() => { playSfx('button'); onHome(); }} className="tg-press" style={{
          width: '100%', height: 54, borderRadius: RADIUS.btn, background: (!passed && canRetry) ? '#fff' : TG.CORAL_GRAD,
          border: (!passed && canRetry) ? '1.5px solid #ebe5de' : 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <span style={{ ...TYPE.btn, color: (!passed && canRetry) ? TG.SUB : '#fff' }}>홈으로</span>
        </button>
      </Reveal>
    </>
  );
}
