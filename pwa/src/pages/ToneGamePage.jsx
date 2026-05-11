// 성조 빨리 찾기 미니게임 — Adaptive Speed 시스템
// 학생앱 공개 라우트(`/personal/:studentToken/game/tone`)에서 진입.
// 콤보가 쌓일수록 단어당 시간이 짧아짐 (7→3초). 시간 끝나면 정답 자동 공개.
//
// 애니메이션 정책:
//  - 카운트다운은 순수 CSS animation (setInterval setState 안 함)
//  - 시간 초과 감지는 setTimeout 1회만
//  - duration token 통일: 150ms (micro) / 220ms (state) / 360ms (enter)
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CaretLeftIcon,
  CaretRightIcon,
  ClockIcon,
  FlameIcon,
  ArrowClockwiseIcon,
  SparkleIcon,
  HouseIcon,
  BookOpenIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { fetchGameBest, submitGameResult } from '../api/gameApi.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import {
  PRIMARY,
  PRIMARY_DARK,
  PRIMARY_LIGHT,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  STATUS_ERROR_TEXT,
  BORDER_SUBTLE,
  BORDER_DEFAULT,
} from '../constants/theme.js';
import {
  TONES,
  ROUND_LENGTH,
  DIFFICULTIES,
  findTone,
} from '../constants/toneGameWords.js';

// 한자 전용 sans-serif(고딕) 스택 — KimjungchulGothic은 한자 미지원이라 명시적 fallback 필요.
// macOS=PingFang SC / Windows=Microsoft YaHei / Android=Noto Sans SC / iOS=PingFang SC.
const HANZI_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

// 햅틱: 모바일 한정. 비대응 환경에선 silent no-op.
function haptic(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 콤보 단계별 단어당 제한시간 (ms). 잘할수록 자동으로 빨라지고, 콤보 깨지면 회복됨.
// multiplier: 난이도별 시간 배수 (1.0=초급, 0.85=중급, 0.7=고급) → 어려울수록 짧아짐
function getTimeLimitForCombo(combo, multiplier = 1) {
  let base;
  if (combo >= 8) base = 3000;
  else if (combo >= 6) base = 3500;
  else if (combo >= 4) base = 4500;
  else if (combo >= 2) base = 5500;
  else base = 7000;
  return Math.round(base * multiplier);
}

// 인터랙티브 요소 공통 — 모바일 탭 지연 제거 + iOS tap highlight 끔
const TOUCH_OPT = {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

// 베스트 기록 — 학생 + 난이도별 localStorage 키 (PandaWidget 패턴, gameKey가 난이도 차별화)
// Notion DB가 single source of truth. localStorage는 빠른 표시용 캐시.
// gameKey 예: 'tone-easy', 'tone-normal', 'tone-hard' (DIFFICULTIES에서 정의)
function getBestKey(studentToken, gameKey) {
  return studentToken ? `game_best_${gameKey}_${studentToken}` : `game_best_${gameKey}`;
}
function loadBest(studentToken, gameKey) {
  try {
    const raw = localStorage.getItem(getBestKey(studentToken, gameKey));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveBest(studentToken, gameKey, data) {
  try { localStorage.setItem(getBestKey(studentToken, gameKey), JSON.stringify(data)); } catch { /* noop */ }
}

// Notion 응답(서버) → localStorage 캐시 형태(클라이언트) 변환
// 서버 필드명: bestScore/bestMaxCombo/bestAvgSec(초)/playCount/lastPlayedAt
// 캐시 필드명: bestScore/bestMaxCombo/bestAvgMs(밀리초)/playCount/updatedAt
function serverToCache(serverBest) {
  if (!serverBest) return null;
  return {
    bestScore: serverBest.bestScore || 0,
    bestMaxCombo: serverBest.bestMaxCombo || 0,
    bestAvgMs: (serverBest.bestAvgSec || 0) * 1000,
    playCount: serverBest.playCount || 0,
    updatedAt: serverBest.lastPlayedAt ? new Date(serverBest.lastPlayedAt).getTime() : Date.now(),
  };
}

// 성조 마크 SVG — 폰트별 두께 편차(Unicode modifier letters는 폰트마다 stroke 다름)를
// 제거하기 위해 모두 동일한 stroke-width로 직접 렌더링. currentColor로 부모 색 상속.
function ToneMark({ tone, size = 20 }) {
  const w = size;
  const h = Math.round(size * 0.5);
  const common = {
    width: w, height: h, viewBox: '0 0 24 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'block' },
  };
  switch (tone) {
    case 1: // 1성: 가로 직선 (ˉ)
      return <svg {...common}><line x1="3" y1="6" x2="21" y2="6" /></svg>;
    case 2: // 2성: 상승 (ˊ)
      return <svg {...common}><line x1="4" y1="10" x2="20" y2="2" /></svg>;
    case 3: // 3성: 하강 후 상승 (ˇ)
      return <svg {...common}><polyline points="3,3 12,9 21,3" /></svg>;
    case 4: // 4성: 하강 (ˋ)
      return <svg {...common}><line x1="4" y1="2" x2="20" y2="10" /></svg>;
    case 0: // 경성: 점 (·)
      return (
        <svg width={Math.round(size * 0.42)} height={Math.round(size * 0.42)}
             viewBox="0 0 12 12" aria-hidden="true" style={{ display: 'block' }}>
          <circle cx="6" cy="6" r="3" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

// 숫자 count-up 애니메이션 훅 — 0에서 target까지 ease-out cubic으로 부드럽게 카운트업.
// requestAnimationFrame 기반 → 60fps 부드러운 progression, 탭 비활성 시 자동 pause.
// decimals: 소수점 자릿수 (점수 0, 평균시간 1)
// delay: 시작 딜레이(ms) — 여러 값을 stagger 시키고 싶을 때 사용
function useCountUp(target, duration = 1200, decimals = 0, delay = 0) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let rafId;
    let startTs = null;
    const tick = (now) => {
      if (startTs === null) startTs = now;
      const elapsed = now - startTs - delay;
      if (elapsed < 0) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min(1, elapsed / duration);
      // ease-out cubic — 빠르게 시작 → 천천히 정착 (만족스러운 ticker 느낌)
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(target * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration, delay]);
  return decimals === 0 ? Math.round(current) : Number(current.toFixed(decimals));
}

export default function ToneGamePage() {
  const { studentToken } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState(false);

  const [screen, setScreen] = useState('start');
  const [words, setWords] = useState([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [entered, setEntered] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [startTs, setStartTs] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hasMistake, setHasMistake] = useState(false);
  const [shake, setShake] = useState(false);
  const [floatScore, setFloatScore] = useState(null);
  const [comboFlash, setComboFlash] = useState(false);
  const [wrongBtn, setWrongBtn] = useState(null);

  // 단어별 시간 제한 (CSS animation duration용)
  const [wordTimeLimit, setWordTimeLimit] = useState(7000);
  const [timedOut, setTimedOut] = useState(false);

  // 점수/통계 계산용 — re-render 트리거 안 함
  const wordStartTsRef = useRef(0);
  const wordTimeLimitRef = useRef(7000);

  // 결과 화면용 통계
  const [totalAnswerTime, setTotalAnswerTime] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  // 선택된 난이도 — StartScreen에서 선택, GameScreen/EndScreen으로 전파
  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTIES[0]);
  // 베스트 기록 (학생 + 난이도별, localStorage)
  const [best, setBest] = useState(null);
  // 신기록 여부 — EndScreen에서 NEW BEST 뱃지 표시용 (best가 갱신되기 전 비교 결과 보존)
  const [isNewBest, setIsNewBest] = useState(false);
  // 갱신 전 베스트 점수 — EndScreen 비교 표시용. best는 useEffect에서 갱신되어
  // 이전 값을 잃기 때문에 별도 state로 보존.
  const [previousBest, setPreviousBest] = useState(0);

  const timersRef = useRef([]);
  const addTimer = (id) => { timersRef.current.push(id); };

  useEffect(() => {
    if (!studentToken) { navigate(-1); return; }
    fetchStudentByToken(studentToken)
      .then(setStudent)
      .catch(() => setError(true));
  }, [studentToken, navigate]);

  // 베스트 로드 — 학생 + 난이도 변경 시마다 재실행.
  // 1. localStorage 캐시 즉시 표시 (빠른 반응)
  // 2. Notion에서 동기화 (gameKey가 Notion에 등록 안 된 난이도면 silent fail → localStorage만 사용)
  useEffect(() => {
    if (!studentToken) return;
    const gameKey = selectedDifficulty.gameKey;
    setBest(loadBest(studentToken, gameKey));
    fetchGameBest(studentToken, gameKey)
      .then((serverBest) => {
        const cached = serverToCache(serverBest);
        if (cached) {
          setBest(cached);
          saveBest(studentToken, gameKey, cached);
        }
      })
      .catch(() => { /* 네트워크/Worker 실패 시 캐시만 사용 — silent */ });
  }, [studentToken, selectedDifficulty]);

  // EndScreen 진입 시 베스트 갱신 + playCount 증가
  // 1. localStorage 즉시 갱신 (UI 즉시 반영)
  // 2. Worker로 fire-and-forget POST (Notion 동기화) — 실패해도 UX 영향 없음
  useEffect(() => {
    if (screen !== 'end' || !studentToken) return;
    const gameKey = selectedDifficulty.gameKey;
    const prev = loadBest(studentToken, gameKey) || { bestScore: 0, bestMaxCombo: 0, bestAvgMs: 0, playCount: 0 };
    const newBestFlag = score > (prev.bestScore || 0);
    setIsNewBest(newBestFlag);
    setPreviousBest(prev.bestScore || 0);
    const avgMs = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
    const updated = {
      bestScore: newBestFlag ? score : prev.bestScore,
      bestMaxCombo: newBestFlag ? maxCombo : (prev.bestMaxCombo || 0),
      bestAvgMs: newBestFlag ? avgMs : (prev.bestAvgMs || 0),
      playCount: (prev.playCount || 0) + 1,
      updatedAt: Date.now(),
    };
    saveBest(studentToken, gameKey, updated);
    setBest(updated);

    // Notion 저장 (fire-and-forget). 난이도별 gameKey가 Worker에 등록 안 된 경우 silent fail.
    submitGameResult(studentToken, gameKey, {
      score,
      maxCombo,
      avgMs,
    }).catch(() => { /* Worker 호출 실패해도 결과 화면 표시는 정상 — silent */ });
  }, [screen, studentToken, selectedDifficulty, score, maxCombo, answeredCount, totalAnswerTime]);

  // 모든 setTimeout 정리 — 화면 전환 중 stale 콜백으로 인한 상태 오염 방지
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // 누적 경과 시간 (결과 화면용, 200ms 간격이면 충분)
  useEffect(() => {
    if (screen !== 'game') return;
    const t = setInterval(() => setElapsed(Date.now() - startTs), 200);
    return () => clearInterval(t);
  }, [screen, startTs]);

  // 새 단어 시작 시 초기화 — wordIndex 변경 또는 game 진입에 트리거
  useEffect(() => {
    if (screen !== 'game') return;
    const limit = getTimeLimitForCombo(combo, selectedDifficulty.timeMultiplier);
    wordStartTsRef.current = Date.now();
    wordTimeLimitRef.current = limit;
    setWordTimeLimit(limit);
    setTimedOut(false);
    // combo는 의도적으로 deps 제외 — 입력 도중 콤보 변경(오답)으로 시간 재설정 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, screen, selectedDifficulty]);

  // 시간 초과 감지 — setTimeout 1회만 (카운트다운 시각화는 CSS가 담당)
  useEffect(() => {
    if (screen !== 'game' || completed) return;
    const timer = setTimeout(() => {
      const word = words[wordIndex];
      if (!word) return;
      setTimedOut(true);
      setCompleted(true);
      setCombo(0);
      setEntered(word.tones); // 정답 자동 공개
      haptic([60, 30, 60]);
      addTimer(setTimeout(() => {
        if (wordIndex + 1 >= words.length) {
          setScreen('end');
        } else {
          setWordIndex((i) => i + 1);
          setCurrentSyl(0);
          setEntered([]);
          setCompleted(false);
          setHasMistake(false);
        }
      }, 1500));
    }, wordTimeLimit);
    return () => clearTimeout(timer);
  }, [screen, completed, wordTimeLimit, wordIndex, words]);

  // difficulty arg를 받으면 즉시 적용(DifficultyScreen에서 호출).
  // 없으면 현재 selectedDifficulty 사용 (EndScreen 다시 도전 등).
  const startGame = (difficulty) => {
    const d = difficulty || selectedDifficulty;
    if (difficulty && difficulty.id !== selectedDifficulty.id) {
      setSelectedDifficulty(d);
    }
    setWords(shuffle(d.words).slice(0, ROUND_LENGTH));
    setWordIndex(0);
    setCurrentSyl(0);
    setEntered([]);
    setCompleted(false);
    setCombo(0);
    setMaxCombo(0);
    setScore(0);
    setHasMistake(false);
    setStartTs(Date.now());
    setElapsed(0);
    setTotalAnswerTime(0);
    setAnsweredCount(0);
    setIsNewBest(false);
    setPreviousBest(0);
    setScreen('game');
  };

  const handleTone = useCallback((toneNum) => {
    if (completed) return;
    const word = words[wordIndex];
    const expected = word.tones[currentSyl];

    if (toneNum === expected) {
      const ne = [...entered, toneNum];
      setEntered(ne);

      if (ne.length === word.tones.length) {
        setCompleted(true);
        const answerTime = Date.now() - wordStartTsRef.current;
        const remaining = Math.max(0, wordTimeLimitRef.current - answerTime);
        const timeBonus = Math.floor(remaining / 100); // 100ms당 1점
        let earned = 50;
        if (!hasMistake) {
          const newCombo = combo + 1;
          earned = 100 + newCombo * 20 + timeBonus;
          setCombo(newCombo);
          setMaxCombo((m) => Math.max(m, newCombo));
          if (newCombo >= 2) {
            setComboFlash(true);
            addTimer(setTimeout(() => setComboFlash(false), 700));
          }
          haptic([10, 20, 30]);
        } else {
          earned = 50 + Math.floor(timeBonus / 2);
          setCombo(0);
          haptic(15);
        }
        setScore((s) => s + earned);
        setFloatScore(`+${earned}`);
        setTotalAnswerTime((t) => t + answerTime);
        setAnsweredCount((c) => c + 1);
        addTimer(setTimeout(() => setFloatScore(null), 1300));

        addTimer(setTimeout(() => {
          if (wordIndex + 1 >= words.length) {
            setScreen('end');
          } else {
            setWordIndex((i) => i + 1);
            setCurrentSyl(0);
            setEntered([]);
            setCompleted(false);
            setHasMistake(false);
          }
        }, 1500));
      } else {
        haptic(8);
        setCurrentSyl((s) => s + 1);
      }
    } else {
      setShake(true);
      setHasMistake(true);
      setCombo(0);
      setWrongBtn(toneNum);
      haptic([40, 30, 40]);
      addTimer(setTimeout(() => {
        setShake(false);
        setWrongBtn(null);
      }, 450));
    }
  }, [completed, words, wordIndex, currentSyl, entered, hasMistake, combo]);

  // 키보드: 1~4 = 1~4성, 0 또는 5 = 경성
  useEffect(() => {
    if (screen !== 'game') return;
    const handler = (e) => {
      if (e.repeat) return;
      const map = { '1': 1, '2': 2, '3': 3, '4': 4, '0': 0, '5': 0 };
      const tone = map[e.key];
      if (tone === undefined) return;
      e.preventDefault();
      handleTone(tone);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, handleTone]);

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: STATUS_ERROR_TEXT, fontSize: 14 }}>
        정보를 불러오지 못했어요
      </div>
    );
  }
  if (!student) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      // 게임 몰입감을 위한 따뜻한 베이지 배경 — 페이지 한정 예외
      background: 'radial-gradient(ellipse at top, #FFF8F4 0%, #FAF6F1 45%, #F5EFE8 100%)',
    }}>
      <ToneGameStyles />

      {/* 헤더 — 뒤로가기 + 제목만 (다른 페이지와 일관성 유지) */}
      <div style={{
        flexShrink: 0,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: `1px solid ${BORDER_SUBTLE}`,
      }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          height: 56, display: 'flex', alignItems: 'center', padding: '0 16px',
        }}>
          <button
            onClick={() => {
              // 게임 플로우 내부에선 이전 화면으로, 그 외엔 PWA 히스토리 뒤로
              if (screen === 'difficulty') setScreen('start');
              else if (screen === 'countdown') setScreen('difficulty');
              else navigate(-1);
            }}
            aria-label="뒤로"
            className="active:scale-[0.96]"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, marginLeft: -8, padding: 0,
              border: 'none', background: 'none', cursor: 'pointer',
              color: TEXT_SECONDARY, flexShrink: 0,
              transitionProperty: 'scale, color',
              transitionDuration: '150ms',
              transitionTimingFunction: 'ease-out',
              ...TOUCH_OPT,
            }}
          >
            <CaretLeftIcon weight="bold" size={20} />
          </button>
          <h1 style={{
            fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, flex: 1,
            textWrap: 'balance',
          }}>
            성조 빨리 찾기
          </h1>
        </div>
      </div>

      {/* 콘텐츠 — 화면 전환 시 부드러운 fade */}
      <div key={screen} className="tg-screen-fade" style={{
        flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column',
      }}>
        {screen === 'start' && (
          <StartScreen onStart={() => setScreen('difficulty')} />
        )}
        {screen === 'difficulty' && (
          <DifficultyScreen
            studentToken={studentToken}
            currentId={selectedDifficulty.id}
            onChange={setSelectedDifficulty}
            onStart={() => setScreen('countdown')}
          />
        )}
        {screen === 'countdown' && (
          <CountdownScreen onComplete={() => startGame()} />
        )}
        {screen === 'game' && words[wordIndex] && (
          <GameScreen
            word={words[wordIndex]}
            wordIndex={wordIndex}
            totalWords={words.length}
            currentSyl={currentSyl}
            entered={entered}
            completed={completed}
            combo={combo}
            shake={shake}
            floatScore={floatScore}
            comboFlash={comboFlash}
            wrongBtn={wrongBtn}
            wordTimeLimit={wordTimeLimit}
            timedOut={timedOut}
            onTone={handleTone}
          />
        )}
        {screen === 'end' && (
          <EndScreen
            score={score}
            maxCombo={maxCombo}
            elapsed={elapsed}
            avgMs={answeredCount > 0 ? totalAnswerTime / answeredCount : 0}
            isNewBest={isNewBest}
            previousBest={previousBest}
            difficulty={selectedDifficulty}
            onReplay={startGame}
            onChangeDifficulty={() => setScreen('difficulty')}
            onBack={() => navigate(-1)}
          />
        )}
      </div>
    </div>
  );
}

// ── 스타일시트 ────────────────────────────────────────────────
function ToneGameStyles() {
  return (
    <style>{`
      @keyframes tg-shake {
        0%,100% { transform: translateX(0); }
        20% { transform: translateX(-9px); }
        40% { transform: translateX(8px); }
        60% { transform: translateX(-6px); }
        80% { transform: translateX(5px); }
      }
      @keyframes tg-pop {
        0% { transform: scale(1); }
        45% { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
      @keyframes tg-float-up {
        0% { opacity: 0; transform: translate(-50%, 0); }
        15% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, -70px); }
      }
      @keyframes tg-slide-down {
        0% { opacity: 0; transform: translateY(-8px); filter: blur(2px); }
        100% { opacity: 1; transform: translateY(0); filter: blur(0); }
      }
      @keyframes tg-glow-green {
        0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
        50% { box-shadow: 0 0 0 18px rgba(16,185,129,0); background-color: rgba(16,185,129,0.06); }
      }
      @keyframes tg-glow-red {
        0%,100% { box-shadow: 0 0 0 0 rgba(255,77,79,0); }
        50% { box-shadow: 0 0 0 18px rgba(255,77,79,0); background-color: rgba(255,77,79,0.05); }
      }
      @keyframes tg-combo-burst {
        0% { transform: scale(0.85) rotate(-3deg); opacity: 0; filter: blur(4px); }
        50% { transform: scale(1.15) rotate(2deg); opacity: 1; filter: blur(0); }
        100% { transform: scale(1) rotate(0); opacity: 1; filter: blur(0); }
      }
      @keyframes tg-stagger-in {
        0% { opacity: 0; transform: translateY(10px); filter: blur(4px); }
        100% { opacity: 1; transform: translateY(0); filter: blur(0); }
      }
      @keyframes tg-screen-fade-in {
        0% { opacity: 0; transform: translateY(6px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes tg-wrong-pulse {
        0%,100% { transform: scale(1); }
        50% { transform: scale(0.95); filter: brightness(0.8); }
      }
      @keyframes tg-current-pulse {
        0%,100% { opacity: 0.55; transform: scaleX(1); }
        50% { opacity: 1; transform: scaleX(1.25); }
      }
      @keyframes tg-deco-float {
        0%,100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      /* CTA 호흡: box-shadow만 펄스(active:scale과 충돌 X) + inset 하이라이트로 입체감.
         외부 글로우는 PRIMARY 컬러로 강하게 — 화면 전체에서 눈에 띄도록. */
      @keyframes tg-cta-pulse {
        0%,100% {
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.28),
            inset 0 -2px 0 rgba(0,0,0,0.12),
            0 6px 16px rgba(127,0,5,0.32),
            0 0 0 0 rgba(127,0,5,0);
        }
        50% {
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.28),
            inset 0 -2px 0 rgba(0,0,0,0.12),
            0 10px 28px rgba(127,0,5,0.5),
            0 0 0 6px rgba(127,0,5,0.08);
        }
      }
      .tg-cta-pulse {
        animation: tg-cta-pulse 2.2s ease-in-out 0.9s infinite;
      }
      /* 카운트다운: width + 색상 동시 변화 (단계별) */
      @keyframes tg-countdown {
        0%   { width: 100%; background-color: #7f0005; }
        50%  { background-color: #7f0005; }
        62%  { background-color: #faad14; }
        82%  { background-color: #ff4d4f; }
        100% { width: 0%; background-color: #ff4d4f; }
      }
      .tg-shake { animation: tg-shake 0.45s cubic-bezier(.36,.07,.19,.97); }
      .tg-pop { animation: tg-pop 0.55s ease-out; }
      .tg-float-up { animation: tg-float-up 1.3s ease-out forwards; }
      .tg-slide-down { animation: tg-slide-down 220ms cubic-bezier(0.2,0,0,1); }
      .tg-glow-green { animation: tg-glow-green 0.9s ease-out; }
      .tg-glow-red { animation: tg-glow-red 0.9s ease-out; }
      .tg-combo-burst { animation: tg-combo-burst 0.45s cubic-bezier(.2,.9,.3,1.2); }
      .tg-wrong { animation: tg-wrong-pulse 0.4s ease-out; }
      .tg-current-pulse { animation: tg-current-pulse 1.4s ease-in-out infinite; }
      .tg-deco-float-1 { animation: tg-deco-float 2.4s ease-in-out infinite; }
      .tg-deco-float-2 { animation: tg-deco-float 2.4s ease-in-out 0.6s infinite; }
      .tg-screen-fade {
        animation: tg-screen-fade-in 220ms cubic-bezier(0.2,0,0,1) both;
      }
      /* Stagger 진입 — duration token 360ms 통일 */
      .tg-stagger > * {
        opacity: 0;
        animation: tg-stagger-in 360ms cubic-bezier(0.2,0,0,1) forwards;
      }
      .tg-stagger > *:nth-child(1) { animation-delay: 40ms; }
      .tg-stagger > *:nth-child(2) { animation-delay: 120ms; }
      .tg-stagger > *:nth-child(3) { animation-delay: 200ms; }
      .tg-stagger > *:nth-child(4) { animation-delay: 280ms; }
      .tg-stagger > *:nth-child(5) { animation-delay: 360ms; }
      .tg-stagger > *:nth-child(6) { animation-delay: 440ms; }
      .tg-stagger > *:nth-child(7) { animation-delay: 520ms; }
      .tg-stagger > *:nth-child(8) { animation-delay: 600ms; }
      .tg-syllables > * {
        opacity: 0;
        animation: tg-stagger-in 360ms cubic-bezier(0.2,0,0,1) forwards;
      }
      .tg-syllables > *:nth-child(1) { animation-delay: 40ms; }
      .tg-syllables > *:nth-child(2) { animation-delay: 140ms; }
      .tg-syllables > *:nth-child(3) { animation-delay: 240ms; }
      .tg-syllables > *:nth-child(4) { animation-delay: 340ms; }

      /* 결과 진입 팡파레 — 3-레이어 중첩으로 위치/흔들림/회전 분리.
         각 레이어가 독립 애니메이션이라 파티클마다 다른 페이스로 흔들리고 돌면서 낙하.

         외부(rise-fall): 상승 → 정점 → 직선 낙하 (X에 노이즈 없음 → "멈춤" 느낌 X) */
      @keyframes tg-confetti-rise-fall {
        0% {
          opacity: 0;
          transform: translate3d(0, 20px, 0) scale(0.4);
          animation-timing-function: ease-out;
        }
        10% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          animation-timing-function: cubic-bezier(0.15, 0.85, 0.3, 1);
        }
        40% {
          opacity: 1;
          transform: translate3d(var(--tx-peak), var(--ty-peak), 0) scale(1);
          animation-timing-function: linear;
        }
        100% {
          opacity: 0;
          transform: translate3d(var(--tx), var(--ty), 0) scale(0.92);
        }
      }

      /* 중간(wobble): 좌우 흔들림 — 무한 반복, 각 파티클별 다른 amp/duration */
      @keyframes tg-confetti-wobble {
        0%   { transform: translate3d(0, 0, 0); }
        25%  { transform: translate3d(var(--wobble-a), 0, 0); }
        50%  { transform: translate3d(0, 0, 0); }
        75%  { transform: translate3d(var(--wobble-b), 0, 0); }
        100% { transform: translate3d(0, 0, 0); }
      }

      /* 내부(spin): 회전 — 무한 반복, 각 파티클별 duration/방향 다름 */
      @keyframes tg-confetti-spin {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* 결과 메시지 타이틀 — 작아지면서 등장 → 살짝 overshoot → 정착 (pop celebration) */
      @keyframes tg-celebrate-pop {
        0%   { transform: scale(0.6); opacity: 0; }
        55%  { transform: scale(1.1); opacity: 1; }
        80%  { transform: scale(0.97); }
        100% { transform: scale(1); opacity: 1; }
      }
      .tg-celebrate-pop {
        animation: tg-celebrate-pop 0.6s cubic-bezier(0.2, 1.4, 0.4, 1) 0.15s both;
        transform-origin: center bottom;
      }

      /* 신기록 뱃지 — 부드러운 호흡 (scale 1 ↔ 1.08, 1.8s 무한 반복) */
      @keyframes tg-newbest-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.08); }
      }
      .tg-newbest-pulse {
        animation: tg-newbest-pulse 1.8s ease-in-out infinite;
        transform-origin: center;
      }

      /* 게임 시작 카운트다운 (3 → 2 → 1) — 각 숫자는 작아진 상태에서 등장 → overshoot → 다시 작아지며 사라짐.
         react key가 count마다 바뀌므로 element가 remount되어 매 숫자마다 애니메이션 재실행 */
      @keyframes tg-countdown-pop {
        0%   { transform: scale(0.4); opacity: 0; }
        25%  { transform: scale(1.15); opacity: 1; }
        55%  { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.85); opacity: 0; }
      }
      .tg-countdown-pop {
        animation: tg-countdown-pop 0.85s cubic-bezier(0.2, 1.4, 0.4, 1) both;
      }

    `}</style>
  );
}

// ── 시작 화면 ───────────────────────────────────────────────
// 통일 구조: 좌우 padding 20px (디자인 시스템) + maxWidth 480 + MIDDLE/BOTTOM 2-zone
// 시작하기 → DifficultyScreen으로 전환 (난이도/베스트는 다음 화면에서 표시)
function StartScreen({ onStart }) {
  return (
    <div className="tg-stagger" style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      maxWidth: 480, width: '100%', margin: '0 auto',
      padding: '0 20px',
    }}>
    {/* MIDDLE zone — 한자 타이틀 + 설명 + 성조표 + 베스트 카드 (수직 중앙) */}
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      paddingTop: 16, paddingBottom: 24,
    }}>
      <div style={{ position: 'relative', marginBottom: 28 }}>
        {/*
          한자 게임 로고 sticker — 두 레이어 + wrapper drop-shadow 패턴:
          [Wrapper]
            - filter: drop-shadow 3겹  ← sticker 전체(외곽선 포함)에 그림자가 떨어짐
            - position: relative + inline-block
            ├ [뒷 레이어] 흰색 글자 + 두꺼운 WebkitTextStroke(흰색)
            │            → 글리프 바깥으로 흰 외곽선 형성 (sticker 윤곽)
            └ [앞 레이어] 같은 글자, PRIMARY 그라데이션
                         → 안쪽을 덮어 흰 외곽선이 바깥으로만 보이게

          WebkitTextStroke는 center stroke이므로 실제 외곽선 너비는 stroke / 2.
          앞 레이어가 안쪽을 덮어주므로 사실상 outside-stroke 효과.
        */}
        <div style={{
          position: 'relative',
          display: 'inline-block',
          // sticker 전체에 떨어지는 단단한 hard shadow 1겹만
          filter: 'drop-shadow(0 4px 0 #000000)',
        }}>
          {/*
            한자 sticker SVG — paint-order="stroke"로 정확한 outside-only stroke 구현
            HTML <div> + WebkitTextStroke는 Chrome에서 paint-order 미지원이라 hole 영역까지
            stroke가 침범하던 문제를 SVG로 해결. SVG 텍스트는 paint-order 표준 지원.

            3 layer 모두 같은 위치에 겹침:
            1. 검정 외곽선 (가장 뒤)
            2. 흰 외곽선 (중간) — paint-order로 fill이 stroke 안쪽 영역 덮어 outside-only
            3. PRIMARY 그라데이션 (가장 앞)
          */}
          <svg
            aria-label="声调"
            viewBox="0 0 220 120"
            style={{ width: 220, height: 120, display: 'block', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="tg-hanzi-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY_LIGHT} />
                <stop offset="50%" stopColor={PRIMARY} />
                <stop offset="100%" stopColor={PRIMARY_DARK} />
              </linearGradient>
            </defs>

            {/* 가장 뒤 — 검정 외곽선 (stroke 16, paint-order stroke로 outside-only) */}
            <text
              x="50%" y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={HANZI_FONT}
              fontSize="104"
              fontWeight="700"
              letterSpacing="-3"
              fill="#000000"
              stroke="#000000"
              strokeWidth="16"
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              声调
            </text>

            {/* 중간 — 흰 외곽선 (stroke 12, paint-order stroke) */}
            <text
              x="50%" y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={HANZI_FONT}
              fontSize="104"
              fontWeight="700"
              letterSpacing="-3"
              fill="#ffffff"
              stroke="#ffffff"
              strokeWidth="12"
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              声调
            </text>

            {/* 가장 앞 — PRIMARY 그라데이션 한자 본체 */}
            <text
              x="50%" y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily={HANZI_FONT}
              fontSize="104"
              fontWeight="700"
              letterSpacing="-3"
              fill="url(#tg-hanzi-grad)"
            >
              声调
            </text>
          </svg>
        </div>
        {/*
          데코 마크 위치/크기 밸런스:
          - 한자 120px → 마크 48px (약 40%) — 게임의 메인 메카닉이 성조이므로 강조
          - 좌우 위치는 space-around로 한자 중심에 자연 정렬 (1/4, 3/4)
          - top -26: 한자 위로 더 띄움. tg-deco-float가 ±4px 움직여도 한자에 안 닿음
        */}
        <div style={{
          position: 'absolute', top: -26, left: 0, right: 0,
          display: 'flex', justifyContent: 'space-around',
          pointerEvents: 'none',
        }}>
          <span className="tg-deco-float-1" style={{ color: TONES[0].color, display: 'inline-flex' }}>
            <ToneMark tone={1} size={48} />
          </span>
          <span className="tg-deco-float-2" style={{ color: TONES[3].color, display: 'inline-flex' }}>
            <ToneMark tone={4} size={48} />
          </span>
        </div>
      </div>

      <h2 style={{
        fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY,
        margin: '0 0 8px', letterSpacing: '-0.3px',
        textWrap: 'balance', textAlign: 'center',
      }}>
        성조 빨리 찾기
      </h2>

      <p style={{
        fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.65,
        margin: '0 0 36px', textAlign: 'center', wordBreak: 'keep-all',
      }}>
        한자만 보고 성조를 순서대로 눌러주세요.<br />
        잘 맞힐수록 시간이 짧아져요.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 36 }}>
        {TONES.map((t) => (
          <div key={t.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: t.color,
              color: '#fff',
              boxShadow: 'var(--shadow-border)',
            }}>
              <ToneMark tone={t.num} size={28} />
            </div>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY, fontWeight: 600 }}>
              {t.name}
            </div>
          </div>
        ))}
      </div>

    </div>
    {/* /MIDDLE zone */}

    {/* BOTTOM zone — 시작하기 (다음 단계: 난이도 선택) */}
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      paddingBottom: 'max(64px, calc(env(safe-area-inset-bottom) + 40px))',
    }}>
      <button
        onClick={onStart}
        className="active:scale-[0.97] tg-cta-pulse"
        style={{
          width: '100%',
          height: 60, borderRadius: 16,
          border: 'none', cursor: 'pointer',
          background: `linear-gradient(180deg, ${PRIMARY_LIGHT} 0%, ${PRIMARY} 55%, ${PRIMARY_DARK} 100%)`,
          color: '#fff',
          fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '0 22px 0 24px',
          transitionProperty: 'scale',
          transitionDuration: '150ms',
          transitionTimingFunction: 'ease-out',
          ...TOUCH_OPT,
        }}
      >
        시작하기
        <CaretRightIcon weight="bold" size={20} />
      </button>

      <div style={{
        marginTop: 14, fontSize: 11, color: TEXT_TERTIARY, fontWeight: 500,
        textAlign: 'center',
      }}>
        총 {ROUND_LENGTH}문제 · 다음 단계에서 난이도 선택
      </div>
    </div>
    {/* /BOTTOM zone */}
    </div>
  );
}

// ── 난이도 선택 화면 ────────────────────────────────────────
// StartScreen "시작하기" 후 진입. 3개 난이도 카드(토글) + 하단 시작하기 버튼.
// 카드 탭 = 선택만 (게임 시작 X), 하단 시작하기 버튼 탭 = countdown으로 전환.
function DifficultyScreen({ studentToken, currentId, onChange, onStart }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      maxWidth: 480, width: '100%', margin: '0 auto',
      padding: '0 20px',
    }}>
      {/* TOP zone — 헤딩 (디자인 시스템: Page Title 24/700/-0.3/lh1.17, Body 14/400/lh1.65) */}
      <div style={{ paddingTop: 24, textAlign: 'center' }}>
        <h2 style={{
          fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY,
          margin: '0 0 6px', lineHeight: 1.17, letterSpacing: '-0.3px',
        }}>
          난이도 선택
        </h2>
        <p style={{
          fontSize: 14, color: TEXT_SECONDARY, margin: 0,
          lineHeight: 1.65,
        }}>
          원하는 난이도를 골라주세요
        </p>
      </div>

      {/* MIDDLE zone — 3개 난이도 토글 카드 (수직 중앙) */}
      <div
        className="tg-stagger"
        role="radiogroup"
        aria-label="난이도 선택"
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          gap: 12,
          paddingTop: 8, paddingBottom: 24,
        }}
      >
        {DIFFICULTIES.map((d) => {
          const best = loadBest(studentToken, d.gameKey);
          const baseSec = Math.round((7 * d.timeMultiplier) * 10) / 10;
          const isSelected = d.id === currentId;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(d)}
              className="active:scale-[0.98]"
              style={{
                background: isSelected ? `linear-gradient(135deg, ${PRIMARY}08 0%, ${PRIMARY}14 100%)` : '#fff',
                // borderRadius 16 — 피처 카드(대형 정보 카드) 토큰
                borderRadius: 16,
                // 선택/비선택 모두 동일한 outer dimension 유지 — border 두께차 padding으로 보정
                padding: isSelected ? '17px 17px' : '18px 18px',
                // 선택 시 브랜드 톤 그림자(시스템 변수), 비선택은 일반 카드 그림자
                boxShadow: isSelected ? 'var(--shadow-brand-card)' : 'var(--shadow-card)',
                border: isSelected ? `2px solid ${PRIMARY}` : `1px solid ${BORDER_SUBTLE}`,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 14,
                textAlign: 'left',
                transitionProperty: 'scale, border-color, box-shadow, background',
                transitionDuration: '150ms',
                transitionTimingFunction: 'ease-out',
                ...TOUCH_OPT,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* 카드 라벨 — Section Heading 토큰: 20/600/-0.2/lh1.20 (PRIMARY로 색만 변형) */}
                <div style={{
                  fontSize: 20, fontWeight: 600, color: PRIMARY,
                  marginBottom: 4, lineHeight: 1.2, letterSpacing: '-0.2px',
                }}>
                  {d.label}
                </div>
                {/* 카드 desc — Caption Bold 토큰: 13/600/lh1.50 */}
                <div style={{
                  fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY,
                  lineHeight: 1.5,
                }}>
                  {d.desc} · 기본 {baseSec}초
                </div>
              </div>

              {best && best.bestScore > 0 && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {/* '최고' 라벨 — Micro 토큰 (11/400). 위계상 caption bold 600으로 살짝 강조 */}
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: TEXT_TERTIARY,
                  }}>
                    최고
                  </div>
                  <div className="tabular-nums" style={{
                    fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY,
                    letterSpacing: '-0.2px',
                  }}>
                    {best.bestScore}점
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* BOTTOM zone — 시작하기 (선택된 난이도로 countdown 시작) */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        paddingBottom: 'max(64px, calc(env(safe-area-inset-bottom) + 40px))',
      }}>
        <button
          onClick={onStart}
          className="active:scale-[0.97] tg-cta-pulse"
          style={{
            width: '100%',
            height: 60, borderRadius: 16,
            border: 'none', cursor: 'pointer',
            background: `linear-gradient(180deg, ${PRIMARY_LIGHT} 0%, ${PRIMARY} 55%, ${PRIMARY_DARK} 100%)`,
            color: '#fff',
            fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '0 22px 0 24px',
            transitionProperty: 'scale',
            transitionDuration: '150ms',
            transitionTimingFunction: 'ease-out',
            ...TOUCH_OPT,
          }}
        >
          시작하기
          <CaretRightIcon weight="bold" size={20} />
        </button>
      </div>
    </div>
  );
}

// ── 카운트다운 화면 ─────────────────────────────────────────
// DifficultyScreen에서 시작하기 누른 후 3 → 2 → 1 → 게임 시작.
// 각 숫자는 ~850ms 동안 pop in/out (key 변경으로 매번 remount → 애니메이션 재실행).
function CountdownScreen({ onComplete }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count <= 0) {
      onComplete();
      return undefined;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 850);
    return () => clearTimeout(t);
  }, [count, onComplete]);

  return (
    // 헤더가 위쪽에 있어 시각 무게가 위로 쏠림 → paddingBottom으로 숫자를 위쪽으로 보정
    <div style={{
      flex: 1, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      paddingBottom: 80,
    }}>
      <div
        key={count}
        className="tg-countdown-pop tabular-nums"
        aria-live="polite"
        style={{
          fontSize: 96, fontWeight: 700,
          color: PRIMARY, lineHeight: 1,
          letterSpacing: '-0.05em',
          textShadow: '0 3px 10px rgba(127,0,5,0.18)',
        }}
      >
        {count}
      </div>
    </div>
  );
}

// ── 게임 화면 ───────────────────────────────────────────────
// 통일 구조: 좌우 padding 20px (디자인 시스템) + maxWidth 480 + TOP/MIDDLE/BOTTOM 3-zone
function GameScreen({
  word, wordIndex, totalWords, currentSyl, entered, completed,
  combo, shake, floatScore, comboFlash, wrongBtn, wordTimeLimit, timedOut, onTone,
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      maxWidth: 480, width: '100%', margin: '0 auto',
      padding: '0 20px',
    }}>
      {/* TOP zone — 카운터(중앙) + 콤보(우측) + 시간 게이지 */}
      <div style={{
        position: 'relative',
        padding: '16px 0 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 40,
      }}>
        <div role="status" aria-label={`${totalWords}문제 중 ${wordIndex + (completed ? 1 : 0)}번째`}>
          <span className="tabular-nums" style={{
            fontSize: 22, fontWeight: 800, color: TEXT_PRIMARY,
            letterSpacing: '-0.4px',
          }}>
            {wordIndex + (completed ? 1 : 0)}
          </span>
          <span className="tabular-nums" style={{
            fontSize: 18, fontWeight: 600, color: TEXT_TERTIARY,
            margin: '0 2px 0 4px',
          }}>
            / {totalWords}
          </span>
        </div>

        {/* 콤보 — 우측 상단 absolute. wrapper로 위치 분리 → 내부 burst 애니메이션의 transform과 충돌 X.
            outer가 horizontal padding 20을 처리하므로 right:0 = 디자인 시스템 우측 마진 정렬 */}
        <div
          style={{
            position: 'absolute', right: 0, top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
          role="status"
          aria-live="polite"
          aria-label={combo >= 2 ? `${combo}콤보` : ''}
        >
          {combo >= 2 && (
            <div
              key={combo}
              className={`tg-combo-burst${comboFlash ? ' tg-pop' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 999,
                background: 'linear-gradient(135deg, #F59E0B 0%, #E11D48 100%)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
              }}
            >
              <FlameIcon weight="fill" size={12} color="#fff" />
              <span className="tabular-nums" style={{
                color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: '-0.2px',
              }}>
                {combo} COMBO
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 시간 게이지 — 카운터 바로 아래 (outer padding이 horizontal 처리) */}
      <div>
        <div
          style={{
            width: '100%', height: 8, borderRadius: 999,
            background: 'rgba(0,0,0,0.06)', overflow: 'hidden',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
          }}
          role="progressbar"
          aria-label="남은 시간"
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            key={wordIndex}
            style={{
              height: '100%', width: '100%', borderRadius: 999,
              animationName: 'tg-countdown',
              animationDuration: `${wordTimeLimit}ms`,
              animationTimingFunction: 'linear',
              animationFillMode: 'forwards',
              animationPlayState: completed ? 'paused' : 'running',
              willChange: 'width, background-color',
            }}
          />
        </div>
      </div>

      {/* MIDDLE zone — 메인 카드 (게이지와 분리된 자체 영역).
          paddingTop으로 화면 상단 1/3 지점 배치(optical centering) */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 0 24px',
      }}>
        <div
          className={`${shake ? 'tg-shake' : ''} ${completed && !timedOut ? 'tg-glow-green' : ''} ${timedOut ? 'tg-glow-red' : ''}`}
          style={{ position: 'relative', width: '100%' }}
        >
          {/* +score 플로팅 — 카드 바깥(wrapper) 레벨에 배치.
              카드의 overflow:hidden에 마스킹되지 않고 카드 위쪽으로 자유롭게 떠오름. */}
          {floatScore && (
            <div className="tg-float-up tabular-nums" style={{
              position: 'absolute', left: '50%', top: 24, zIndex: 10,
              fontSize: 26, fontWeight: 800, color: '#10B981',
              letterSpacing: '-0.4px',
              textShadow: '0 2px 12px rgba(16,185,129,0.35), 0 0 1px rgba(255,255,255,0.8)',
              pointerEvents: 'none',
            }}>
              {floatScore}
            </div>
          )}

          <div style={{
            position: 'relative',
            background: '#fff', borderRadius: 16,
            padding: '40px 24px',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
          }}>
            {/* 의미 (완료 시) */}
            {completed && (
              <div className="tg-slide-down" style={{
                position: 'absolute', top: 18, left: 0, right: 0,
                textAlign: 'center', fontSize: 12, color: TEXT_TERTIARY, fontWeight: 500,
              }}>
                {word.meaning}
              </div>
            )}

            {/* 음절 셀들 — wordIndex 변경 시 stagger 재실행 */}
            <div
              key={wordIndex}
              className="tg-syllables"
              style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 12 }}
            >
              {word.hanzi.split('').map((char, idx) => {
                const isCurrent = idx === currentSyl && !completed;
                const isEntered = idx < entered.length;
                const tone = isEntered ? findTone(entered[idx]) : null;

                return (
                  <div key={idx} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 4, minWidth: 70,
                  }}>
                    {/* 성조 마크 슬롯 */}
                    <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {tone ? (
                        <div className="tg-slide-down" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 999,
                          backgroundColor: tone.color, color: '#fff',
                          fontWeight: 700, fontSize: 11,
                          boxShadow: `0 2px 6px ${tone.color}40`,
                        }}>
                          <ToneMark tone={tone.num} size={18} />
                          <span style={{ fontSize: 11, letterSpacing: '-0.2px' }}>
                            {tone.num === 0 ? '경' : tone.num}성
                          </span>
                        </div>
                      ) : isCurrent ? (
                        <div className="tg-current-pulse" style={{
                          width: 28, height: 4, borderRadius: 999,
                          backgroundColor: PRIMARY,
                          willChange: 'transform, opacity',
                        }} />
                      ) : (
                        <div style={{ width: 24, height: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.08)' }} />
                      )}
                    </div>

                    {/* 한자 — 시간 초과 시는 pop 안 함 (정답 느낌 방지) */}
                    <div
                      className={completed && !timedOut ? 'tg-pop' : ''}
                      style={{
                        fontFamily: HANZI_FONT,
                        fontSize: 68, fontWeight: 700, lineHeight: 1,
                        color: isCurrent ? PRIMARY : TEXT_PRIMARY,
                        letterSpacing: '-0.02em',
                        transform: isCurrent ? 'scale(1.06)' : 'scale(1)',
                        transitionProperty: 'transform, color',
                        transitionDuration: '220ms',
                        transitionTimingFunction: 'cubic-bezier(0.2,0,0,1)',
                        willChange: isCurrent ? 'transform' : 'auto',
                      }}
                    >
                      {char}
                    </div>

                    {/* 병음 (완료 시) */}
                    <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
                      {completed && (
                        <div className="tg-slide-down" style={{
                          fontSize: 15, fontWeight: 600,
                          color: tone?.color || TEXT_TERTIARY,
                        }}>
                          {word.pinyin[idx]}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 진행/결과 안내 — 카드 하단으로 이동 + 사이즈 확대.
                marginTop: 40으로 한자와 충분한 여백 → 카드 하단에 위치한 인상 */}
            <div style={{
              marginTop: 40, textAlign: 'center', minHeight: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {!completed ? (
                <span className="tabular-nums" style={{
                  fontSize: 16, color: TEXT_SECONDARY, fontWeight: 600,
                  letterSpacing: '-0.2px',
                }}>
                  {currentSyl + 1}번째 글자의 성조를 누르세요
                </span>
              ) : timedOut ? (
                <span className="tg-slide-down" style={{
                  fontSize: 18, fontWeight: 700, color: STATUS_ERROR_TEXT,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  letterSpacing: '-0.2px',
                }}>
                  <ClockIcon weight="fill" size={20} />
                  시간 초과! 정답을 기억해 두세요
                </span>
              ) : (
                <span className="tg-slide-down" style={{
                  fontSize: 18, fontWeight: 700, color: '#10B981',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  letterSpacing: '-0.2px',
                }}>
                  <SparkleIcon weight="fill" size={20} />
                  정답!
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM zone — 성조 버튼.
          horizontal padding은 outer가 처리. 하단 thumb-zone padding은 다른 화면(Start/End)과
          통일된 max(64, env+40) 사용 → 모든 CTA의 화면 하단 위치 일관성 확보. */}
      <div style={{
        padding: '8px 0 64px',
        paddingBottom: 'max(64px, calc(env(safe-area-inset-bottom) + 40px))',
      }}>
        <div style={{ display: 'flex', gap: 8, maxWidth: 448, margin: '0 auto' }}>
          {TONES.map((t) => {
            const isWrong = wrongBtn === t.num;
            const disabled = completed;
            return (
              <button
                key={t.num}
                onClick={() => onTone(t.num)}
                disabled={disabled}
                aria-label={t.name}
                className={`active:scale-95${isWrong ? ' tg-wrong' : ''}`}
                style={{
                  flex: 1, aspectRatio: '3 / 4',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4,
                  border: 'none', borderRadius: 16,
                  backgroundColor: t.color, color: '#fff',
                  fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
                  // disabled 시각: opacity + 채도 다운
                  opacity: disabled ? 0.45 : 1,
                  filter: disabled ? 'saturate(0.7)' : 'none',
                  boxShadow: `0 4px 12px ${t.color}55`,
                  transitionProperty: 'scale, opacity, box-shadow, filter',
                  transitionDuration: '220ms',
                  transitionTimingFunction: 'ease-out',
                  willChange: 'transform',
                  ...TOUCH_OPT,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 18 }}>
                  <ToneMark tone={t.num} size={28} />
                </div>
                <div style={{ fontSize: 18, lineHeight: 1 }}>{t.num === 0 ? '경' : t.num}</div>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, lineHeight: 1 }}>
                  {t.sample}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 종료 화면 ───────────────────────────────────────────────
// AI 클리셰 제거: 등급 메달(S/A/B/C), 무지개 그라데이션 뱃지, 다색 스탯 X
// 브랜드 톤: 흰 카드 + PRIMARY 단일 액센트 + 절제된 위계 (다른 페이지와 일관)

// 결과 진입 팡파레 — 브랜드 톤(레드/골드/화이트)으로 무지개 회피.
// 3-레이어 중첩: outer(rise-fall trajectory) > middle(좌우 wobble) > inner(회전).
// 각 레이어 독립 애니메이션이라 파티클마다 자기만의 페이스로 흔들리고 돌면서 낙하.
function ConfettiBurst() {
  const [particles] = useState(() => {
    const colors = [PRIMARY, PRIMARY_LIGHT, '#F59E0B', '#FCD34D', '#ffffff'];
    return Array.from({ length: 40 }, (_, i) => {
      const tx = (Math.random() - 0.5) * 480;
      const txPeak = tx * 0.5;
      // 정점 Y: 화면 상단 바깥까지 솟구침 (-760 ~ -1220) → 잠깐 가려졌다 낙하 재등장
      const tyPeak = -(760 + Math.random() * 460);
      // 종착 Y: 시작 위치 부근으로 거의 완전 낙하
      const ty = -(0 + Math.random() * 40);

      return {
        id: i,
        color: colors[i % colors.length],
        left: 50 + (Math.random() - 0.5) * 30,
        delay: Math.random() * 260,
        duration: 3000 + Math.random() * 2000, // 3.0~5.0초
        tx, txPeak, ty, tyPeak,
        // 좌우 흔들림 — 진폭/주기/페이즈 모두 독립 랜덤
        wobbleDuration: 700 + Math.random() * 900, // 0.7~1.6s 주기
        wobbleA: (Math.random() - 0.5) * 70,        // ±35px
        wobbleB: (Math.random() - 0.5) * 70,        // ±35px (별도 랜덤 → 비대칭 wobble)
        wobbleDelay: Math.random() * 500,           // 페이즈 오프셋
        // 회전 — 각 파티클 다른 속도/방향
        spinDuration: 600 + Math.random() * 1400,   // 0.6~2.0s 회전
        spinReverse: Math.random() > 0.5,           // 절반은 반대 방향
        // 시각 다양성
        width: Math.random() > 0.4 ? 8 : 6,
        height: Math.random() > 0.5 ? 10 : 4,
      };
    });
  });

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {particles.map((p) => (
        // OUTER — rise/fall trajectory (Y 위주, X는 직선 drift만)
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`, bottom: 0,
            animationName: 'tg-confetti-rise-fall',
            animationDuration: `${p.duration}ms`,
            animationDelay: `${p.delay}ms`,
            animationTimingFunction: 'linear', // 키프레임 내부 per-keyframe timing 사용
            animationFillMode: 'forwards',
            opacity: 0,
            willChange: 'transform, opacity',
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
            '--tx-peak': `${p.txPeak}px`,
            '--ty-peak': `${p.tyPeak}px`,
          }}
        >
          {/* MIDDLE — 좌우 wobble (무한 반복, 파티클별 독립) */}
          <div
            style={{
              animationName: 'tg-confetti-wobble',
              animationDuration: `${p.wobbleDuration}ms`,
              animationDelay: `${p.delay + p.wobbleDelay}ms`,
              animationIterationCount: 'infinite',
              animationTimingFunction: 'ease-in-out',
              willChange: 'transform',
              '--wobble-a': `${p.wobbleA}px`,
              '--wobble-b': `${p.wobbleB}px`,
            }}
          >
            {/* INNER — 회전 (무한 반복, 파티클별 독립) */}
            <div
              style={{
                width: p.width, height: p.height,
                backgroundColor: p.color,
                borderRadius: 1,
                animationName: 'tg-confetti-spin',
                animationDuration: `${p.spinDuration}ms`,
                animationDelay: `${p.delay}ms`,
                animationIterationCount: 'infinite',
                animationDirection: p.spinReverse ? 'reverse' : 'normal',
                animationTimingFunction: 'linear',
                willChange: 'transform',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// 결과 메시지만 — 메달 없이 한국어 카피로 톤 차별화.
function getResultMessage(maxCombo) {
  if (maxCombo === ROUND_LENGTH) return { title: '퍼펙트!', sub: '원어민 수준의 성조 감각이에요' };
  if (maxCombo >= 7) return { title: '훌륭해요', sub: '성조가 자리잡고 있어요' };
  if (maxCombo >= 4) return { title: '잘했어요', sub: '조금만 더 연습하면 돼요' };
  return { title: '수고하셨어요', sub: '성조는 반복이 답이에요' };
}

function EndScreen({ score, maxCombo, elapsed, avgMs, isNewBest, previousBest, difficulty, onReplay, onChangeDifficulty, onBack }) {
  const message = getResultMessage(maxCombo);
  const hasPreviousBest = previousBest > 0;

  // 모든 스탯에 count-up 애니메이션 — 약간씩 stagger해서 "결과 집계 → 발표" 흐름 형성.
  // 점수가 가장 먼저 시작(가장 prominent), 나머지는 차례로 따라옴.
  const animatedScore   = useCountUp(score,         1300, 0, 200);
  const animatedCombo   = useCountUp(maxCombo,      1100, 0, 350);
  const animatedAvgSec  = useCountUp(avgMs / 1000,  1100, 1, 500);
  const animatedElapsed = useCountUp(elapsed,       1200, 0, 650);

  return (
    // 통일 구조: 좌우 padding 20px (디자인 시스템) + maxWidth 480 + MIDDLE/BOTTOM 2-zone
    <div className="tg-stagger" style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      maxWidth: 480, width: '100%', margin: '0 auto',
      padding: '0 20px',
      position: 'relative', // ConfettiBurst absolute 기준점
      overflow: 'hidden', // 파티클이 좌우로 흩어져도 가로 스크롤 안 생김
    }}>
      {/* 결과 진입 팡파레 — 화면 mount 시 1회 burst */}
      <ConfettiBurst />

      {/* TOP zone — 현재 라운드 난이도(label + desc) + 문제 수 */}
      <div style={{ paddingTop: 20, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY,
          letterSpacing: '-0.2px',
        }}>
          <BookOpenIcon weight="fill" size={17} color={PRIMARY} />
          {difficulty.label} · {difficulty.desc} · {ROUND_LENGTH}문제
        </div>
      </div>

      {/* MIDDLE zone — 메시지 + 점수 카드 + 스탯 (수직 중앙).
          BOTTOM zone의 두 버튼이 TOP의 헤더 텍스트보다 시각적으로 무거우므로
          paddingBottom을 키워 컨텐츠를 위로 밀어 optical centering 적용. */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        paddingTop: 0, paddingBottom: 100,
        gap: 18,
      }}>

      {/* 1. 메시지 — 데코 없이 타이폴로지(크고/PRIMARY/bounce)로만 강조 */}
      <div style={{ textAlign: 'center' }}>
        <h2
          className="tg-celebrate-pop"
          style={{
            fontSize: 32, fontWeight: 700, color: PRIMARY,
            margin: '0 0 8px', lineHeight: 1.15, letterSpacing: '-0.5px',
          }}
        >
          {message.title}
        </h2>
        <p style={{
          fontSize: 14, color: TEXT_SECONDARY, margin: 0,
          lineHeight: 1.6,
        }}>
          {message.sub}
        </p>
      </div>

      {/* 2. 점수 카드 — 외부 20px padding 안에서 100% width (GameScreen 카드와 동일 폭) */}
      <div style={{
        width: '100%',
        background: '#fff', borderRadius: 16,
        padding: '24px 20px 22px',
        boxShadow: 'var(--shadow-card)',
        textAlign: 'center',
        position: 'relative',
      }}>
        {/* 신기록 — PRIMARY pill + 호흡 펄스로 시선 유도 */}
        {isNewBest && (
          <div className="tg-newbest-pulse" style={{
            position: 'absolute', top: 14, right: 14,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 999,
            background: PRIMARY, color: '#fff',
            fontSize: 11, fontWeight: 700,
          }}>
            <SparkleIcon weight="fill" size={11} />
            신기록
          </div>
        )}

        <div style={{
          fontSize: 12, fontWeight: 500, color: TEXT_TERTIARY,
          marginBottom: 6,
        }}>
          점수
        </div>
        <div className="tabular-nums" style={{
          fontSize: 52, fontWeight: 700, color: PRIMARY,
          lineHeight: 1, letterSpacing: '-0.04em',
        }}>
          {animatedScore}
        </div>

        {/* 최고 기록 비교 — 미세한 텍스트 한 줄 (뱃지/배경 없음) */}
        {hasPreviousBest && (
          <div style={{
            marginTop: 14, paddingTop: 14,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: 12, color: TEXT_SECONDARY, fontWeight: 500,
          }}>
            {isNewBest ? '이전 최고' : '최고 기록'}{' '}
            <span className="tabular-nums" style={{ color: TEXT_PRIMARY, fontWeight: 700 }}>
              {previousBest}점
            </span>
          </div>
        )}
      </div>

      {/* 3. 스탯 — 단일 카드 안 3 컬럼, divider만. 100% width (점수 카드와 동일 폭) */}
      <div style={{
        width: '100%',
        background: '#fff', borderRadius: 12,
        boxShadow: 'var(--shadow-border)',
        display: 'flex', alignItems: 'stretch',
        padding: '14px 4px',
      }}>
        <StatColumn label="최대 콤보" value={`x${animatedCombo}`} />
        <StatDivider />
        <StatColumn label="평균 시간" value={avgMs > 0 ? `${animatedAvgSec.toFixed(1)}초` : '—'} />
        <StatDivider />
        <StatColumn label="총 시간" value={formatTime(animatedElapsed)} />
      </div>
      </div>
      {/* /MIDDLE zone */}

      {/* BOTTOM zone — 다시 도전 (Primary CTA) + 홈으로 (Secondary, ghost 스타일).
          버튼 wrapper도 width 100% — 외부 20px padding이 좌우 마진 처리 */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8,
        paddingBottom: 'max(64px, calc(env(safe-area-inset-bottom) + 40px))',
      }}>
        {/* Primary CTA — PRIMARY 채움 + 호흡 pulse (StartScreen 시작 버튼과 동일 패턴) */}
        <div style={{ width: '100%' }}>
          <button
            onClick={onReplay}
            className="active:scale-[0.97] tg-cta-pulse"
            style={{
              width: '100%', height: 48, borderRadius: 12,
              border: 'none', cursor: 'pointer',
              backgroundColor: PRIMARY, color: '#fff',
              fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transitionProperty: 'scale',
              transitionDuration: '150ms',
              transitionTimingFunction: 'ease-out',
              ...TOUCH_OPT,
            }}
          >
            <ArrowClockwiseIcon weight="bold" size={16} />
            다시 도전
          </button>
        </div>

        {/* Secondary 1 — 난이도 선택 (디자인 시스템 Secondary 스펙: h44/r12/w500, #fff bg, BORDER_DEFAULT 테두리, TEXT_SECONDARY) */}
        <div style={{ width: '100%' }}>
          <button
            type="button"
            onClick={onChangeDifficulty}
            className="active:scale-[0.97]"
            style={{
              width: '100%', height: 44, borderRadius: 12,
              cursor: 'pointer',
              backgroundColor: '#fff',
              border: `1px solid ${BORDER_DEFAULT}`,
              color: TEXT_SECONDARY,
              fontSize: 14, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transitionProperty: 'scale, background-color',
              transitionDuration: '150ms',
              transitionTimingFunction: 'ease-out',
              ...TOUCH_OPT,
            }}
          >
            <SlidersHorizontalIcon weight="fill" size={14} />
            난이도 선택
          </button>
        </div>

        {/* Secondary 2 — 홈으로 (동일 Secondary 스펙) */}
        <div style={{ width: '100%' }}>
          <button
            type="button"
            onClick={onBack}
            className="active:scale-[0.97]"
            style={{
              width: '100%', height: 44, borderRadius: 12,
              cursor: 'pointer',
              backgroundColor: '#fff',
              border: `1px solid ${BORDER_DEFAULT}`,
              color: TEXT_SECONDARY,
              fontSize: 14, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transitionProperty: 'scale, background-color',
              transitionDuration: '150ms',
              transitionTimingFunction: 'ease-out',
              ...TOUCH_OPT,
            }}
          >
            <HouseIcon weight="fill" size={14} />
            홈으로 돌아가기
          </button>
        </div>
      </div>
      {/* /BOTTOM zone */}
    </div>
  );
}

// 스탯 컬럼 — 한 카드 안 단순 라벨/값 (개별 카드/색상 분리 X)
function StatColumn({ label, value }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '0 4px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
    }}>
      <div style={{ fontSize: 11, color: TEXT_TERTIARY, fontWeight: 500 }}>
        {label}
      </div>
      <div className="tabular-nums" style={{
        fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY,
        letterSpacing: '-0.2px', lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

function StatDivider() {
  return <div style={{ width: 1, alignSelf: 'center', height: 28, background: 'rgba(0,0,0,0.06)', flexShrink: 0 }} />;
}
