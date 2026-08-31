// 결과 화면 — 신기록 배지·축하 판다·점수(카운트업)·통계 2카드·코치·다시도전/난이도 바꾸기.
import { useState, useEffect } from 'react';
import { Cup, Bolt, Play } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, pickCelebratePanda, RADIUS, SPACE } from '../tgTokens.js';
import { useCountUp, FlameIcon } from '../tgWidgets.jsx';
import { play as playSfx } from '../tgSfx.js';
import { EXAM_PASS_RATIO } from '../gameXp.js';
import { Reveal, ConfettiBurst, CrispFlash, LIGHT_CONFETTI, GameHeader, KeycapCta } from './shared.jsx';
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
const RES_BADGE = '#FDBA28';      // 신기록 배지(구 골드 그라데 → 단색)
// 흰 보조 키캡 공통 prop(다시하기·홈으로) — 주 키캡은 KeycapCta 기본값(TG.CTA) 그대로.
const WHITE_CAP = { bg: '#fff', edge: TG.KEY_EDGE, color: TG.STEEL };

// 통계 2카드(최고 콤보·반응 속도) — 시안 12 결과 / 승급시험 결과 공통. 166×128 r20, 내부는 시안 절대좌표 그대로.
//  아이콘 y16(30) · 라벨 y52(19) · 수치행 y81(31, 단위는 +12). flex 중앙정렬로 두면 라인박스(라벨 25.1·값 40.9)가
//  자리를 밀어 상하 여백이 16이 아니라 8이 된다.
function StatCards({ maxCombo, avgSec }) {
  return (
    <div data-coach="result-stats" style={{ height: 128, display: 'flex', gap: SPACE.lg, alignItems: 'stretch' }}>
      {/* ★통계 아이콘엔 개별 등장 모션을 걸지 않는다 — 결과화면은 **매 판** 보는 자리라,
          아이콘마다 성격 있는 모션이 매번 재생되면 그게 곧 촌스러움이 된다(빈도 규칙).
          카드 자체의 Reveal만으로 충분. delight는 신기록 배지·비트처럼 드문 순간에만. */}
      {[
        { icon: <FlameIcon size={30} color={TG.CORAL_DK} />, val: maxCombo, unit: '콤보', label: '최고 콤보' },
        { icon: <Bolt size={30} weight="Bold" color="#4D8DFF" />, val: avgSec, unit: avgSec === '-' ? '' : '초', label: '반응 속도' },
      ].map((s) => (
        <div key={s.label} style={{ position: 'relative', flex: 1, minWidth: 0, background: '#fff', borderRadius: RADIUS.xl, boxShadow: '0px 4px 18px rgba(43,39,48,0.04)' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 16, display: 'flex', justifyContent: 'center' }}>{s.icon}</div>
          <span style={{ position: 'absolute', left: 0, right: 0, top: 52, textAlign: 'center', ...TYPE.h2, lineHeight: '19px', color: TG.SUB }}>{s.label}</span>
          {/* 값+단위는 시안대로 베이스라인 정렬(items-baseline) — marginTop으로 눈대중 맞추면 폰트마다 어긋난다 */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 81, height: 31, display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: SPACE.xxs }}>
            <span style={{ ...TYPE.numLg, lineHeight: '31px', color: TG.INK }}>{s.val}</span>
            {s.unit && <span style={{ ...TYPE.label, lineHeight: '17px', color: TG.SUB }}>{s.unit}</span>}
          </div>
        </div>
      ))}
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
      {/* 헤더 — 시안 12: 글래스 60 + 스테이지명 가운데(뒤로가기 없음. 이탈은 아래 '홈으로 가기'로) */}
      {/* ★"결과화면"이 아니라 "결과" — '화면'은 개발자 용어다(2026-08-12). 표시되는 값·레이아웃은 시안 12 그대로. */}
      <GameHeader title={title ? `${title} 결과` : '결과'} glass center />
      {/* 축하 판다 150×150 (가로 중앙, 시안 y90) */}
      <Reveal i={1} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 90 }}>
        <img src={pandaSrc} alt="" width={150} height={150} style={{ display: 'block', objectFit: 'contain', animation: 'tg-bob 3.4s ease-in-out infinite' }} />
      </Reveal>
      {/* 점수 — 시안 y254 · 50px */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 254 }}>
      <div data-coach="result-score" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ ...TYPE.numHero, fontSize: 50, fontWeight: 900, color: TG.CORAL_DK, lineHeight: 1, whiteSpace: 'nowrap' }}>{animScore.toLocaleString()}</span>
      </div>
      </Reveal>
      {/* 신기록 배지 — 시안 y312(점수 바로 아래). 오답 복습 클리어도 같은 자리·같은 배지에 문구만 바꿔 쓴다 */}
      {(isNewBest || cleared) && (
        <Reveal i={2} style={{ position: 'absolute', top: 312, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 16px', borderRadius: RADIUS.lg, background: RES_BADGE, boxShadow: '0px 4px 18px rgba(43,39,48,0.04)' }}>
          <Cup size={16} weight="Bold" color="#fff" style={{ animation: 'tg-ic-trophy .34s cubic-bezier(.22,1,.36,1) .06s both' }} />
          <span style={{ ...TYPE.btnSm, lineHeight: '17px', color: '#fff', whiteSpace: 'nowrap' }}>{cleared ? '오답 노트를 다 비웠어요!' : '신기록 달성!'}</span>
        </div>
        </Reveal>
      )}
      {/* 통계 2카드 — 시안 12: y365 · 166×128 · r20 · 간격10 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 365 }}>
        <StatCards maxCombo={maxCombo} avgSec={avgSec} />
      </Reveal>
      {/* 통계 카드 아래는 비워 둔다 — 별·'한 번에 맞힘 N/10'·해제 배지를 뒀다가 2026-08-07 사용자 요청으로 전부 제거.
          다음 칸이 열렸다는 사실은 주 CTA 라벨(continueLabel = "입문 2 도전")이 전한다. */}
      {/* (코치 말풍선은 시안 12에서 삭제됨 — 2026-08-05) */}
      {/* 메인 CTA — 시안 12: [다시하기 | 계속하기] 166×60 @bottom96. 다음 스테이지·승급시험이 없으면 다시하기가 풀폭(주 버튼).
          ★homeOnly(온보딩 첫 판)면 이 줄 자체를 뺀다 — 아래 '홈으로 가기' 하나만 남겨 온보딩 흐름
            (첫 판 → 닉네임 → 홈)을 벗어나지 않게 한다(2026-08-07 사용자). */}
      {!homeOnly && (
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {(onExam || onNextLevel) ? (
        <div data-coach="result-actions" style={{ display: 'flex', gap: SPACE.lg }}>
          <KeycapCta {...WHITE_CAP} label="다시하기" labelStyle={{ whiteSpace: 'nowrap' }}
            onClick={() => { playSfx('button'); onRetry(); }} style={{ flex: 1, minWidth: 0 }} />
          {/* 다음 목적지(승급시험 또는 다음 스테이지) — 라벨은 **목적지 이름**(예: "입문 2 도전").
              시안 라벨 '계속하기'는 어디로 가는지 안 알려줘서, 누르면 예고 없이 다음 스테이지가 시작됐다(2026-08-07 UX 검수).
              이름이 길어 버튼을 넘치면 기본값 '계속하기'로 폴백(continueLabel을 호출부가 판단). */}
          <KeycapCta label={continueLabel} labelStyle={{ whiteSpace: 'nowrap' }} Icon={Play}
            onClick={() => { playSfx('button'); (onExam || onNextLevel)(); }} style={{ flex: 1, minWidth: 0 }} />
        </div>
      ) : (
        <KeycapCta data-coach="result-actions" label={retryLabel} labelStyle={{ whiteSpace: 'nowrap' }}
          onClick={() => { playSfx('button'); onRetry(); }} />
      )}
      </Reveal>
      )}
      {/* 하단 — 홈으로 가기(시안 12: 342×60 @bottom26, 흰 키캡).
          homeOnly면 화면의 유일한 행동이므로 주 버튼(코랄)으로 올리고 코치 앵커도 여기로 옮긴다. */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        {/* ★homeOnly면 코치마크 마지막 단계가 이 버튼만 누를 수 있게 잠근다(forceLastStep) →
            버튼을 실제로 눌러야 진행되므로, 코치 종료도 여기서 직접 dismiss 해야 한다(홈 CTA와 같은 패턴). */}
        {/* 라벨은 **실제 목적지**를 말한다 — 온보딩 첫 판 뒤엔 닉네임 화면이 뜨므로 '홈으로 가기'는 거짓말이 된다(2026-08-08 사용자) */}
        <KeycapCta data-coach={homeOnly ? 'result-actions' : 'result-home'} {...(homeOnly ? null : WHITE_CAP)} label={homeLabel}
          onClick={() => { playSfx('button'); if (homeOnly && tip.visible) tip.dismiss(); onHome(); }} />
      </Reveal>
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
      <GameHeader title={title ? `${title} 결과` : '승급시험 결과'} glass center />
      {/* 판다 150×150 (시안 y90) */}
      <Reveal i={1} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 90 }}>
        <img src={pandaSrc} alt="" width={150} height={150} style={{ display: 'block', objectFit: 'contain', animation: 'tg-bob 3.4s ease-in-out infinite' }} />
      </Reveal>
      {/* 정답 수 / 총 문제 — 시안 y260(잉크) · 50 + 36, 베이스라인 정렬 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 254 }}>
        <div data-coach="result-score" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 5 }}>
          <span style={{ ...TYPE.numHero, fontSize: 50, fontWeight: 700, lineHeight: 1, color: passed ? TG.SUCCESS : TG.CORAL_DK }}>{animCorrect}</span>
          <span style={{ ...TYPE.numHero, fontSize: 36, fontWeight: 700, lineHeight: 1, color: TG.SUB }}>/{total}</span>
        </div>
      </Reveal>
      {/* 합격·불합격 배지 — 시안 y312 */}
      <Reveal i={2} style={{ position: 'absolute', top: 312, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 16px', borderRadius: RADIUS.lg,
          background: passed ? TG.SUCCESS : TG.BORDER, boxShadow: '0px 4px 18px rgba(43,39,48,0.04)' }}>
          {passed && <Cup size={16} weight="Bold" color="#fff" />}
          <span style={{ ...TYPE.btnSm, lineHeight: '17px', color: passed ? '#fff' : TG.SUB, whiteSpace: 'nowrap' }}>{passed ? '승급 시험 합격!' : '승급 시험 불합격'}</span>
        </div>
      </Reveal>
      {/* 합격 기준 캡션 — 시안 y355(잉크) */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 348, textAlign: 'center' }}>
        <span style={{ ...TYPE.label, fontWeight: 500, lineHeight: '25px', color: TG.SUB }}>합격 기준 - {need}문제 이상 정답</span>
      </Reveal>
      {/* 통계 2카드 — 시안 y385 */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 385 }}>
        <StatCards maxCombo={maxCombo} avgSec={avgSec} />
      </Reveal>
      {/* [다시하기 | 계속하기] — 합격이면 주 버튼이 사다리로.
          ★불합격이면 주 버튼은 '다시하기'가 아니라 **연습하고 오기**(트레이닝)다(2026-08-11 UX 검수):
            합격선이 20문제 중 80%라 곧장 재응시하면 대개 또 떨어진다. 회복 경로를 기본값으로 두되
            즉시 재도전은 흰 버튼으로 남긴다 — 보스 모델은 '언제든 재도전'이 원칙이라 막지 않는다.
          둘 다 없으면 다시하기가 풀폭. */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        {(onContinue || onPractice) ? (
          <div style={{ display: 'flex', gap: SPACE.lg }}>
            <KeycapCta {...WHITE_CAP} label="다시하기" labelStyle={{ whiteSpace: 'nowrap' }}
              onClick={() => { playSfx('button'); onRetry(); }} style={{ flex: 1, minWidth: 0 }} />
            <KeycapCta label={onContinue ? '계속하기' : '연습하고 오기'} labelStyle={{ whiteSpace: 'nowrap' }} Icon={Play}
              onClick={() => { playSfx('button'); (onContinue || onPractice)(); }} style={{ flex: 1, minWidth: 0 }} />
          </div>
        ) : (
          <KeycapCta label="다시하기" labelStyle={{ whiteSpace: 'nowrap' }} onClick={() => { playSfx('button'); onRetry(); }} />
        )}
      </Reveal>
      {/* 홈으로 가기 — 시안 342×60 @bottom26 */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(26px + env(safe-area-inset-bottom))' }}>
        <KeycapCta {...WHITE_CAP} label="홈으로 가기" onClick={() => { playSfx('button'); onHome(); }} />
      </Reveal>
    </>
  );
}
