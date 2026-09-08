// 결과 화면 — 신기록 배지·축하 판다·점수(카운트업)·통계 2카드·코치·다시도전/난이도 바꾸기.
import { useState, useEffect } from 'react';
import { Cup, Bolt } from '@solar-icons/react';
import { TG, TYPE, pickCelebratePanda, RADIUS, SPACE, TONE_COLORS } from '../tgTokens.js';
import { useCountUp, FlameIcon } from '../tgWidgets.jsx';
import { play as playSfx } from '../tgSfx.js';
import { EXAM_PASS_RATIO } from '../gameXp.js';
import { Reveal, ConfettiBurst, CrispFlash, LIGHT_CONFETTI, GameHeader, KeycapCta, StatCard } from './shared.jsx';
import { LoginNudgeModal } from './gameModals.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 로그인 유도(게스트가 이전 기록 넘긴 순간) — game=유입 깔때기라 '성취 순간'에만 부드럽게. 세션 1회 + 닫으면 쿨다운(잔소리 방지).
let sessionNudged = false; // 앱 세션당 1회(리로드 시 리셋)
const NUDGE_COOLDOWN = 5 * 24 * 60 * 60 * 1000; // 닫은 뒤 5일
function nudgeAllowed() {
  if (sessionNudged) return false;
  try { const t = parseInt(localStorage.getItem('tg_login_nudge') || '0', 10); if (t && Date.now() - t < NUDGE_COOLDOWN) return false; } catch { /* noop */ }
  return true;
}

// 첫 결과 화면 코치마크 — 점수·통계·다음 액션. Reveal 등장 후 표시.
//  마지막 문구는 화면에 실제로 있는 버튼을 따라간다(온보딩 첫 판은 '홈으로 가기' 하나뿐).
// 마지막 문구는 화면에 실제로 있는 버튼을 따라간다. 버튼 이름을 대괄호로 인용하지 말 것 —
//  설명서처럼 읽히고 문장이 겉돈다(2026-08-08 사용자: "어색하다"). 무엇을 하게 되는지를 말로 풀어 쓴다.
//  카피 원칙: 기능을 나열("~을 확인할 수 있어요")하지 말고 **무엇이 보이는지·다음에 뭘 하면 되는지**를 말한다.
//  지표 이름(최고 콤보·평균 반응속도)을 되읊는 대신 그게 무슨 뜻인지 풀어 쓴다 — 처음 보는 사람 기준.
const resultCoach = (homeOnly, homeHint) => [
  { selector: '[data-coach="result-score"]', label: '이번 판 점수예요. 다음엔 이 숫자를 넘어봐요! 🏆' },
  { selector: '[data-coach="result-stats"]', label: '연달아 몇 개나 맞혔는지, 한 문제에 얼마나 걸렸는지예요.' },
  { selector: '[data-coach="result-actions"]', label: homeOnly ? homeHint : '바로 한 판 더 해도 되고, 홈에서 쉬었다 와도 좋아요.' },
];


// 시안 12(2026-08-05) 값 — 버튼은 공용 KeycapCta로 통일(2026-08-31), 원오프 색만 상수로.
const RES_BADGE = TG.SUN;      // 신기록 배지(구 골드 그라데 → 단색)
// 흰 보조 키캡 공통 prop(다시하기·홈으로) — 주 키캡은 KeycapCta 기본값(TG.CTA) 그대로.
const WHITE_CAP = { bg: TG.CARD, edge: TG.KEY_EDGE, color: TG.STEEL };

// 결과 본문과 행동을 서로 다른 행에 배치. 짧은 화면은 본문만 스크롤한다.
// footer 높이를 계산하지 않아 온보딩(버튼 1개)과 일반/시험(2행)이 같은 규칙을 쓴다.
function ResultLayout({ title, children, actions }) {
  return (
    <>
      <GameHeader title={title} glass center />
      <div style={{ position: 'absolute', inset: '60px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div data-result-content tabIndex={0} role="region" aria-label="결과 요약" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ minHeight: '100%', padding: 'var(--tg-result-space, 24px) 24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--tg-result-space, 24px)' }}>
            {children}
          </div>
        </div>
        <div data-result-footer style={{ flexShrink: 0, padding: '16px 24px calc(24px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: SPACE.lg, background: TG.BG }}>
          {actions}
        </div>
      </div>
    </>
  );
}

function ResultHero({ pandaSrc, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.lg }}>
      <Reveal i={1}>
        <img src={pandaSrc} alt="" width={128} height={128} style={{ display: 'block', objectFit: 'contain', width: 'var(--tg-result-panda, 128px)', height: 'var(--tg-result-panda, 128px)' }} />
      </Reveal>
      {children}
    </div>
  );
}

// 배지는 배경과 무관하게 짙은 텍스트로 읽는다(노랑 위 흰 글씨 제거).
function ResultBadge({ children, success = false }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 16px', borderRadius: RADIUS.pill, background: success ? TG.SUCCESS_BG : RES_BADGE }}>
      <Cup size={16} weight="Bold" color={TG.INK} />
      <span style={{ ...TYPE.label, color: TG.INK, textAlign: 'center' }}>{children}</span>
    </div>
  );
}

// 일반 결과·시험 결과가 같은 통계 컴포넌트를 공유한다.
function StatCards({ maxCombo, avgSec }) {
  return (
    <div data-coach="result-stats" style={{ height: 'var(--tg-result-stat-height, 128px)', display: 'flex', gap: SPACE.lg, alignItems: 'stretch' }}>
      {/* ★통계 아이콘엔 개별 등장 모션을 걸지 않는다 — 결과화면은 **매 판** 보는 자리라,
          아이콘마다 성격 있는 모션이 매번 재생되면 그게 곧 촌스러움이 된다(빈도 규칙).
          카드 자체의 Reveal만으로 충분. delight는 신기록 배지·비트처럼 드문 순간에만. */}
      {[
        { icon: <FlameIcon size={30} color={TG.CORAL_DK} />, val: maxCombo, unit: '콤보', label: '최고 콤보' },
        { icon: <Bolt size={30} weight="Bold" color={TONE_COLORS[4]} />, val: avgSec, unit: avgSec === '-' ? '' : '초', label: '반응 속도' },
      ].map((s) => <StatCard key={s.label} icon={s.icon} label={s.label} value={s.val} unit={s.unit} />)}
    </div>
  );
}

// cleared = 오답 복습에서 노트를 다 비운 판. 기록(신기록)이 없는 연습 결과화면에도 '해냈다'는 축하가 필요해
//  신기록과 같은 자리·같은 연출(파티클+배지)을 문구만 바꿔 재사용한다(2026-08-10).
export function ResultScreen({ score, maxCombo, avgMs, isNewBest, previousBest, onRetry, onHome, onExam = null, onNextLevel = null, onLogin = null, retryLabel = '다시하기', continueLabel = '계속하기', title = '', practice = false, cleared = false, coachReady = true, homeOnly = false, homeLabel = '홈으로 가기', homeHint = '홈에서 이어서 해요!' }) {
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
  const celebrate = (isNewBest && !practice) || cleared; // 축하 연출(파티클·배지)을 켤 판인가
  const pandaSrc = pickCelebratePanda(isNewBest || cleared, maxCombo);
  // 첫 결과 코치마크(1회) — 연습 결과는 제외(신기록/기록 개념이 다름).
  // ★coachReady 게이트는 훅이 아니라 아래 '오버레이 렌더 조건'에 건다. 훅에 걸면 레이스로 무력화:
  //   결과화면 마운트 시점엔 업적 큐가 아직 비어(end-effect가 렌더 후 실행) coachReady=true → visible=true로 시작,
  //   직후 큐가 차도 useTabTip은 visible을 되돌리지 않아 축하 연출과 겹쳤음(실기기 재현).
  const tip = useTabTip('game-result', !practice);
  return (
    <>
      {/* 신기록 축하 파티클 — 성취 순간만(실패/시간초과엔 미표시). 상단 판다/배지 위에서 색색 조각이 터져 낙하 */}
      {celebrate && <CrispFlash color="rgba(255,255,255,0.6)" zIndex={7} />}
      {celebrate && <ConfettiBurst count={32} power={1.35} size={10} zIndex={3} style={{ top: 150 }} />}
      {celebrate && <ConfettiBurst colors={LIGHT_CONFETTI} count={16} power={1.3} size={6} zIndex={3} style={{ top: 150 }} />}
      <ResultLayout title={title ? `${title} 결과` : '결과'} actions={
        <>
          {!homeOnly && (
            <Reveal i={4}>
              {(onExam || onNextLevel) ? (
                <div data-coach="result-actions" style={{ display: 'flex', gap: SPACE.lg }}>
                  <KeycapCta {...WHITE_CAP} label="다시하기" labelStyle={{ lineHeight: 1.25 }}
                    onClick={() => { playSfx('button'); onRetry(); }} style={{ flex: 1, minWidth: 0 }} />
                  <KeycapCta label={continueLabel} labelStyle={{ lineHeight: 1.25 }}
                    onClick={() => { playSfx('button'); (onExam || onNextLevel)(); }} style={{ flex: 1, minWidth: 0 }} />
                </div>
              ) : (
                <KeycapCta data-coach="result-actions" label={retryLabel}
                  onClick={() => { playSfx('button'); onRetry(); }} />
              )}
            </Reveal>
          )}
          <Reveal i={5}>
            {/* 첫 판은 실제 목적지를 안내하는 버튼 하나만 유지, 강제 코치도 함께 종료. */}
            <KeycapCta data-coach={homeOnly ? 'result-actions' : 'result-home'} {...(homeOnly ? null : WHITE_CAP)} label={homeLabel}
              onClick={() => { playSfx('button'); if (homeOnly && tip.visible) tip.dismiss(); onHome(); }} />
          </Reveal>
        </>
      }>
        <ResultHero pandaSrc={pandaSrc}>
          <Reveal i={2}>
            <div data-coach="result-score" style={{ textAlign: 'center' }}>
              <div style={{ ...TYPE.sub, color: TG.SUB, marginBottom: SPACE.sm }}>이번 판 점수</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: SPACE.sm }}>
                <span style={{ ...TYPE.numHero, fontSize: 'var(--tg-result-number, 60px)', color: TG.INK, lineHeight: 1 }}>{animScore.toLocaleString()}</span>
                <span style={{ ...TYPE.h1, color: TG.SUB }}>점</span>
              </div>
            </div>
          </Reveal>
          {(isNewBest || cleared) && <Reveal i={2}><ResultBadge>{cleared ? '오답 노트를 다 비웠어요!' : '신기록 달성!'}</ResultBadge></Reveal>}
        </ResultHero>
        <Reveal i={3}><StatCards maxCombo={maxCombo} avgSec={avgSec} /></Reveal>
      </ResultLayout>
      <CoachMarkOverlay visible={tip.visible && coachReady} onDone={tip.dismiss} steps={resultCoach(homeOnly, homeHint)} delay={260} showControls={false} forceLastStep={homeOnly} />
      {/* (구 '초급 저조 유도' 강제 코치 오버레이 폐기 — 2026-07-19. 이제 유도는 코치 말풍선 아래 비강제 옵션 CTA로.) */}
      {/* 로그인 유도 모달 — 게스트 신기록(이전기록 넘김) 축하 뒤. 다른 축하 오버레이·코치와 겹치지 않게 coachReady 게이트. */}
      {nudgeOpen && coachReady && <LoginNudgeModal onLogin={onLogin} onClose={dismissNudge} />}
    </>
  );
}

// 승급 시험 결과 — 시안(757:12)에서 일반 결과화면과 완전히 같은 레이아웃으로 통일.
//  점수 자리에 '정답수 / 총문제'(합격=초록·불합격=코랄) + 합격/불합격 배지 + 합격 기준 캡션 + 통계 2카드 + 3버튼.
//  합격 축하 연출은 앞선 RankUpReveal이 담당 → 여긴 담백한 요약.
export function ExamResultScreen({ correct = 0, total = 20, passed = false, onRetry, onContinue = null, onPractice = null, onHome, maxCombo = 0, avgMs = 0, title = '' }) {
  const animCorrect = useCountUp(correct, 900);
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '-';
  const pandaSrc = pickCelebratePanda(passed, passed ? 5 : 0);
  const need = Math.ceil(total * EXAM_PASS_RATIO); // 합격 기준 문제 수(20문제 기준 16)
  return (
    <>
      {passed && <CrispFlash color="rgba(255,255,255,0.6)" zIndex={7} />}
      {passed && <ConfettiBurst count={30} power={1.3} size={10} zIndex={3} style={{ top: 150 }} />}
      {passed && <ConfettiBurst colors={LIGHT_CONFETTI} count={15} power={1.25} size={6} zIndex={3} style={{ top: 150 }} />}
      <ResultLayout title={title ? `${title} 결과` : '승급시험 결과'} actions={
        <>
          <Reveal i={4}>
            {(onContinue || onPractice) ? (
              <div style={{ display: 'flex', gap: SPACE.lg }}>
                <KeycapCta {...WHITE_CAP} label="다시하기" labelStyle={{ lineHeight: 1.25 }}
                  onClick={() => { playSfx('button'); onRetry(); }} style={{ flex: 1, minWidth: 0 }} />
                <KeycapCta label={onContinue ? '계속하기' : '연습하고 오기'} labelStyle={{ lineHeight: 1.25 }}
                  onClick={() => { playSfx('button'); (onContinue || onPractice)(); }} style={{ flex: 1, minWidth: 0 }} />
              </div>
            ) : (
              <KeycapCta label="다시하기" onClick={() => { playSfx('button'); onRetry(); }} />
            )}
          </Reveal>
          <Reveal i={5}>
            <KeycapCta {...WHITE_CAP} label="홈으로 가기" onClick={() => { playSfx('button'); onHome(); }} />
          </Reveal>
        </>
      }>
        <ResultHero pandaSrc={pandaSrc}>
          <Reveal i={2}>
            <div data-coach="result-score" style={{ textAlign: 'center' }}>
              <div style={{ ...TYPE.sub, color: TG.SUB, marginBottom: SPACE.sm }}>맞힌 문제</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: SPACE.sm }}>
                <span style={{ ...TYPE.numHero, fontSize: 'var(--tg-result-number, 60px)', lineHeight: 1, color: TG.INK }}>{animCorrect}</span>
                <span style={{ ...TYPE.numLg, color: TG.SUB }}>/ {total}</span>
              </div>
            </div>
          </Reveal>
          <Reveal i={2}>
            {passed ? <ResultBadge success>승급 시험 합격!</ResultBadge>
              : <span style={{ ...TYPE.h2, color: TG.INK }}>승급 시험 불합격</span>}
          </Reveal>
          <span style={{ ...TYPE.sub, color: TG.SUB, textAlign: 'center' }}>합격 기준 · {need}문제 이상 정답</span>
        </ResultHero>
        <Reveal i={3}><StatCards maxCombo={maxCombo} avgSec={avgSec} /></Reveal>
      </ResultLayout>
    </>
  );
}
