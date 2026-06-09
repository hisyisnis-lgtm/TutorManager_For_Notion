// 성조 빨리 찾기 미니게임 — 상태머신/오케스트레이션.
// 학생앱 공개 라우트(`/personal/:studentToken/game/tone`) + 게스트 독립 진입(`/game/tone`)에서 진입.
// 플로우: 스플래시 → 시작 → (소개·튜토리얼) → 모드선택 → 난이도/무한 → 카운트다운 → 게임 → 결과.
// 화면 컴포넌트는 game/screens/* 로 분리, 순수 로직은 game/gameLogic.js, 디자인/저장은 game/* 모듈.
// 디자인 사양: 메모리 tone_game_redesign.md
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { fetchToneWords } from '../api/gameApi.js';
import {
  resolveIdentity, fetchBests, submitResult, mergeGuestIntoStudent,
  pullMemberData, pushMemberData, mergeStudentIntoMember, logoutMember,
} from '../game/gameStore.js';
import { ROUND_LENGTH, DIFFICULTIES } from '../constants/toneGameWords.js';
import { TG, ensureGameFonts, haptic, shuffle, getTimeLimitForCombo, loadBest, saveBest } from '../game/tgTokens.js';
import {
  loadWordStats, saveWordStats, recordWordResult, subsetForPool, mergeStats,
  buildReviewList, masteredCount,
} from '../game/tgWordStats.js';
import { initTts, speakWord } from '../game/tgTts.js';
import { initSfx, play as playSfx } from '../game/tgSfx.js';
import {
  UNLOCK_THRESHOLD, GAMEKEY, getEndlessTimeLimit, computeScore,
  loadEndlessBest, saveEndlessBest, headlineBest, isEndlessUnlocked,
} from '../game/gameLogic.js';
import { FigmaScreen, CountdownVisual, CdWaveEdge, GameToast } from '../game/screens/shared.jsx';
import { SplashScreen } from '../game/screens/SplashScreen.jsx';
import { StartScreen } from '../game/screens/StartScreen.jsx';
import { LoginScreen } from '../game/screens/LoginScreen.jsx';
import { ModeScreen } from '../game/screens/ModeScreen.jsx';
import { DifficultyScreen } from '../game/screens/DifficultyScreen.jsx';
import { GameScreen } from '../game/screens/GameScreen.jsx';
import { ResultScreen } from '../game/screens/ResultScreen.jsx';
import { MasteryScreen } from '../game/screens/MasteryScreen.jsx';
import { IntroScreen } from '../game/screens/IntroScreen.jsx';
import { TutorialScreen } from '../game/screens/TutorialScreen.jsx';
import { PauseModal } from '../game/screens/PauseModal.jsx';

// 미리보기 모드(?screen=game)에서 게임 화면 렌더용 샘플 단어 (DEV 검수 전용)
const PREVIEW_WORDS = [
  { hanzi: '老师', pinyin: ['lǎo', 'shī'], tones: [3, 1], meaning: '선생님' },
  { hanzi: '咖啡', pinyin: ['kā', 'fēi'], tones: [1, 1], meaning: '커피' },
];

// 미리보기(?screen=mastery)용 샘플 — 복습필요 3 + 마스터 12 (DEV 검수 전용)
const PREVIEW_MASTERY = (() => {
  const review = [
    { hanzi: '复杂', pinyin: ['fù', 'zá'], tones: [4, 2], meaning: '복잡하다', a: 20, p: 9, t: 52000 },
    { hanzi: '影响', pinyin: ['yǐng', 'xiǎng'], tones: [3, 3], meaning: '영향', a: 21, p: 13, t: 44100 },
    { hanzi: '严格', pinyin: ['yán', 'gé'], tones: [2, 2], meaning: '엄격하다', a: 10, p: 7, t: 19000 },
  ];
  const mastered = ['妈妈', '你好', '谢谢', '老师', '朋友', '时间', '学生', '中国', '咖啡', '文化', '健康', '经济'];
  const stats = {}, map = {};
  for (const w of review) { stats[w.hanzi] = [w.a, w.p, w.t, w.a]; map[w.hanzi] = { hanzi: w.hanzi, pinyin: w.pinyin, tones: w.tones, meaning: w.meaning }; }
  for (const hz of mastered) { stats[hz] = [4, 4, 4800, 4]; map[hz] = { hanzi: hz, pinyin: [], tones: [], meaning: '' }; }
  return { stats, map };
})();

// ════════════════════════════════════════════════════════
export default function ToneGamePage() {
  const { studentToken: routeToken } = useParams();
  // 정체성 추상화: 학생(토큰)/게스트(로컬UUID·독립진입)/프리뷰를 동일 처리. 로컬 저장키=identity.id, 서버호출은 identity로 게이팅.
  const identity = useMemo(() => resolveIdentity(routeToken), [routeToken]);
  const studentToken = identity.id; // 로컬 저장 키(학생토큰/게스트ID/'preview'). 서버 호출은 fetchBests/submitResult(identity)로.
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState(false);

  // 로컬 시안 검수용 미리보기 모드 (token='preview', ?screen=로 초기화면 지정)
  // ⚠️ import.meta.env.DEV 게이트 — dev(작업 브랜치·localhost)에서만 동작, 프로덕션 빌드에선 항상 false로 비활성(백도어 자동 제거).
  const isPreview = import.meta.env.DEV && identity.kind === 'preview';
  const previewScreen = isPreview ? (new URLSearchParams(window.location.search).get('screen') || 'start') : 'start';
  const cdPreview = previewScreen === 'countdown'; // 카운트다운 미리보기는 난이도 위 오버레이로
  const initialScreen = cdPreview ? 'difficulty' : previewScreen;

  const [screen, setScreen] = useState(initialScreen); // start | difficulty | game | end | intro | tutorial
  const [paused, setPaused] = useState(false);
  const [words, setWords] = useState(() => (isPreview && previewScreen === 'game' ? PREVIEW_WORDS : []));
  const [cdPhase, setCdPhase] = useState(cdPreview ? 'run' : null); // 카운트다운 오버레이 단계: null|'in'|'run'|'out'
  const [cdNum, setCdNum] = useState(3);
  const [wordIndex, setWordIndex] = useState(0);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [entered, setEntered] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [startTs, setStartTs] = useState(0);
  const [hasMistake, setHasMistake] = useState(false);
  const [floatScore, setFloatScore] = useState(null);
  const [comboFlash, setComboFlash] = useState(false);
  const [wrongBtn, setWrongBtn] = useState(null); // 오답 버튼 흔들림(450ms 단발)
  const [showWrong, setShowWrong] = useState(false); // 코치 오답 메시지 지속(다음 시도/단어까지) — wrongBtn과 분리
  const [wordTimeLimit, setWordTimeLimit] = useState(7000);
  const [timedOut, setTimedOut] = useState(false);

  const wordTimeLimitRef = useRef(7000);
  const wordElapsedRef = useRef(0); // 현재 단어의 누적 '진행' 시간(일시정지·카운트다운 제외)
  const segStartRef = useRef(0);    // 현재 진행 구간 시작 시각
  const [totalAnswerTime, setTotalAnswerTime] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTIES[0]);
  const [wordPoolByDiff, setWordPoolByDiff] = useState({});
  const wordStatsRef = useRef({});  // 단어별 숙련도 글로벌(localStorage 동기화)
  const endHandledRef = useRef(false); // 결과화면 1회 처리 가드(다시하기로 score 리셋 시 재실행·중복 사운드 방지)
  const [reviewMode, setReviewMode] = useState(false); // 복습 모드(약한 단어 10개)
  const [endlessMode, setEndlessMode] = useState(false); // 무한 모드(랜덤·가속·첫초과종료)
  const [runId, setRunId] = useState(0); // 게임 시작 시마다 증가 — 같은 단어1로 재시작해도 타이머·게이지 리셋용
  const [splash, setSplash] = useState(isPreview ? previewScreen === 'splash' : true); // 진입 스플래시(실제 진입만, 미리보기는 ?screen=splash)
  const [toast, setToast] = useState(null); // 중앙 토스트(잠금 안내 등)
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    if (!msg) return;
    setToast({ msg, key: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1700);
  }, []);
  const [best, setBest] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [previousBest, setPreviousBest] = useState(0);
  const [introPage, setIntroPage] = useState(() => (isPreview ? Number(new URLSearchParams(window.location.search).get('introPage') || 0) : 0)); // 소개 캐러셀 페이지 (0~2)

  const timersRef = useRef([]);
  const addTimer = (id) => { timersRef.current.push(id); };

  useEffect(() => { ensureGameFonts(); initTts(); initSfx(); }, []);

  // 스플래시 자동 해제(실제 진입만 1.6초; 미리보기 splash는 검수용으로 유지)
  useEffect(() => {
    if (!splash || isPreview) return undefined;
    const t = setTimeout(() => setSplash(false), 1600);
    return () => clearTimeout(t);
  }, [splash, isPreview]);

  useEffect(() => {
    if (isPreview) { setStudent({ name: '미리보기' }); return; }
    if (identity.kind === 'member') { setStudent({ name: identity.memberUser?.nickname || '회원' }); return; } // 회원: token이 게임유저 JWT라 학생 조회 X(데이터는 pullMemberData)
    if (identity.kind === 'guest') { setStudent({ name: '플레이어' }); return; } // 게스트 독립 진입 — 학생 조회 없음
    fetchStudentByToken(identity.token).then(setStudent).catch(() => setError(true));
  }, [identity, isPreview]);

  useEffect(() => {
    DIFFICULTIES.forEach((d) => {
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
    });
  }, []);

  // 게스트→학생 1회 병합(같은 기기) → 통합 최고점수·숙련도 로컬 로드 → 서버(학생만) 동기화. 게스트는 로컬만.
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    (async () => {
      await mergeGuestIntoStudent(identity).catch(() => {}); // 학생 진입 시 게스트 로컬 기록을 학생 쪽에 병합(학생일 때만 동작)
      if (cancelled) return;
      if (identity.kind === 'member') {
        await pullMemberData(identity).catch(() => {}); // 회원: 서버(/game/me) → 로컬 머지
        if (cancelled) return;
        // 연결된 학생(예약코드)의 GAME_BEST 기록을 회원 로컬에 max 흡수 → 학생→회원 이관(점수 높은 쪽 보존). 흡수 시 서버 gameData에도 반영.
        const absorbed = await mergeStudentIntoMember(identity).catch(() => false);
        if (cancelled) return;
        if (absorbed) pushMemberData(identity).catch(() => {});
      }
      wordStatsRef.current = loadWordStats(studentToken);
      setBest(headlineBest(studentToken)); // 즉시 캐시 기반 헤드라인(무한 우선)
      const bests = await fetchBests(identity).catch(() => null); // 서버 베스트(학생만, 게스트=null)
      if (cancelled || !bests) return;
      // 서버 meta.eb(무한 최고) 복구 → 캐시에 반영
      let eb = 0;
      for (const b of bests) { if (b?.meta?.eb) eb = Math.max(eb, Number(b.meta.eb) || 0); }
      if (eb > (loadEndlessBest(studentToken)?.bestScore || 0)) saveEndlessBest(studentToken, { ...(loadEndlessBest(studentToken) || {}), bestScore: eb, updatedAt: Date.now() });
      setBest(headlineBest(studentToken));
      // 단어 통계 병합
      let merged = wordStatsRef.current;
      for (const b of bests) { if (b?.meta?.w) merged = mergeStats(merged, b.meta.w); }
      wordStatsRef.current = merged;
      saveWordStats(studentToken, merged);
    })();
    return () => { cancelled = true; };
  }, [identity, isPreview]);

  useEffect(() => {
    if (screen !== 'end') { endHandledRef.current = false; return; } // 결과화면 벗어나면 가드 해제
    if (!studentToken) return;
    if (endHandledRef.current) return; // 이미 이 결과 처리함 — 다시하기로 score=0 리셋돼도 재실행·중복 사운드 방지
    endHandledRef.current = true;
    const avgMsVal = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
    // 영향받은 난이도 단어통계 동기화(복습·무한 공용)
    const syncWordStats = () => {
      const affected = new Set();
      for (const w of words) { for (const d of DIFFICULTIES) { if ((wordPoolByDiff[d.id] || []).some((x) => x.hanzi === w.hanzi)) affected.add(d.id); } }
      for (const id of affected) {
        const d = DIFFICULTIES.find((x) => x.id === id);
        const sub = subsetForPool(wordStatsRef.current, wordPoolByDiff[id] || []);
        submitResult(identity, d.gameKey, { score: 0, maxCombo: 0, avgMs: 0, meta: { w: sub } }).catch(() => {});
      }
    };

    // 무한 모드 — 헤드라인 최고기록(별도). meta.eb로 영구화(고급 행에 얹음, best 비교엔 0 submit).
    if (endlessMode) {
      const prev = loadEndlessBest(studentToken) || { bestScore: 0, bestMaxCombo: 0, bestAvgMs: 0, playCount: 0 };
      const newBestFlag = score > (prev.bestScore || 0);
      setIsNewBest(newBestFlag); setPreviousBest(prev.bestScore || 0);
      const updated = {
        bestScore: newBestFlag ? score : prev.bestScore, bestMaxCombo: newBestFlag ? maxCombo : (prev.bestMaxCombo || 0),
        bestAvgMs: newBestFlag ? avgMsVal : (prev.bestAvgMs || 0), playCount: (prev.playCount || 0) + 1, updatedAt: Date.now(),
      };
      if (!isPreview) {
        saveEndlessBest(studentToken, updated);
        setBest(headlineBest(studentToken));
        syncWordStats();
        submitResult(identity, GAMEKEY.hard, { score: 0, maxCombo: 0, avgMs: 0, meta: { eb: updated.bestScore } }).catch(() => {});
        if (identity.kind === 'member') pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me) 통째 동기화
      }
      playSfx(newBestFlag ? 'win' : 'gameover');
      return;
    }

    // 복습 모드 — 최고기록 미반영, 단어 통계만 영구화(영향받은 난이도 meta.w 동기화)
    if (reviewMode) {
      setIsNewBest(false); setPreviousBest(0);
      if (!isPreview) { syncWordStats(); if (identity.kind === 'member') pushMemberData(identity).catch(() => {}); }
      playSfx('gameover'); // 복습은 신기록 개념 없음 → 신기록 아님 규칙대로 게임오버
      return;
    }

    // 일반(난이도) 모드 — 난이도별 최고기록 갱신 + 단어 통계(meta.w) 동기화
    const gameKey = selectedDifficulty.gameKey;
    const prev = loadBest(studentToken, gameKey) || { bestScore: 0, bestMaxCombo: 0, bestAvgMs: 0, playCount: 0 };
    const newBestFlag = score > (prev.bestScore || 0);
    setIsNewBest(newBestFlag);
    setPreviousBest(prev.bestScore || 0);
    const updated = {
      bestScore: newBestFlag ? score : prev.bestScore,
      bestMaxCombo: newBestFlag ? maxCombo : (prev.bestMaxCombo || 0),
      bestAvgMs: newBestFlag ? avgMsVal : (prev.bestAvgMs || 0),
      playCount: (prev.playCount || 0) + 1, updatedAt: Date.now(),
    };
    saveBest(studentToken, gameKey, updated);
    setBest(headlineBest(studentToken)); // 헤드라인(무한 우선, 없으면 통합) 갱신
    // 효과음: 다음 단계가 새로 열렸으면 '잠금해제', 신기록이면 '승리', 아니면 '게임오버'
    const justUnlocked = (prev.bestScore || 0) < UNLOCK_THRESHOLD && updated.bestScore >= UNLOCK_THRESHOLD;
    playSfx(justUnlocked ? 'unlock' : (newBestFlag ? 'win' : 'gameover'));
    const wSub = isPreview ? null : subsetForPool(wordStatsRef.current, wordPoolByDiff[selectedDifficulty.id] || []);
    submitResult(identity, gameKey, { score, maxCombo, avgMs: avgMsVal, ...(wSub && Object.keys(wSub).length ? { meta: { w: wSub } } : {}) }).catch(() => {});
    if (identity.kind === 'member' && !isPreview) pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me) 통째 동기화
  }, [screen, identity, studentToken, selectedDifficulty, score, maxCombo, answeredCount, totalAnswerTime, reviewMode, endlessMode, words, wordPoolByDiff, isPreview]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }, []);

  // 카운트다운 오버레이 단계 진행: in(슬라이드 인)→run(3·2·1)→out(슬라이드 아웃)
  useEffect(() => {
    if (cdPhase !== 'in') return undefined;
    const t = setTimeout(() => { setScreen('game'); setCdPhase('run'); }, 420);
    return () => clearTimeout(t);
  }, [cdPhase]);
  useEffect(() => {
    if (cdPhase !== 'run' || isPreview) return undefined;
    if (cdNum <= 0) { playSfx('go'); setCdPhase('out'); return undefined; }
    playSfx('count');
    const t = setTimeout(() => setCdNum((v) => v - 1), 850);
    return () => clearTimeout(t);
  }, [cdPhase, cdNum, isPreview]);
  useEffect(() => {
    if (cdPhase !== 'out') return undefined;
    const t = setTimeout(() => setCdPhase(null), 420);
    return () => clearTimeout(t);
  }, [cdPhase]);

  useEffect(() => {
    if (screen !== 'game' || cdPhase) return; // 카운트다운 끝나야 타이머 시작
    const limit = endlessMode
      ? getEndlessTimeLimit(answeredCount)                              // 무한: 누적 클리어 수로 점점 가속(하한)
      : getTimeLimitForCombo(combo, reviewMode ? 0.85 : selectedDifficulty.timeMultiplier);
    wordElapsedRef.current = 0; // 새 단어 — 누적 진행시간 리셋
    wordTimeLimitRef.current = limit;
    setWordTimeLimit(limit);
    setTimedOut(false);
    setShowWrong(false); // 새 단어 — 코치 오답 메시지 초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, screen, selectedDifficulty, cdPhase, runId]);

  useEffect(() => {
    if (screen !== 'game' || completed || paused || cdPhase) return undefined;
    // 남은 시간만큼만 카운트(일시정지 후 계속하기 시 처음부터 다시 세지 않음)
    segStartRef.current = Date.now();
    const remaining = Math.max(0, wordTimeLimitRef.current - wordElapsedRef.current);
    const timer = setTimeout(() => {
      const word = words[wordIndex];
      if (!word) return;
      setTimedOut(true); setCompleted(true); setCombo(0); setEntered(word.tones);
      haptic([60, 30, 60]); playSfx('timeout');
      speakWord(word); // 시간초과 공개 → 올바른 발음 들려주기
      // 단어 숙련도 기록(시간초과 = 실패)
      if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: true, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
      addTimer(setTimeout(() => {
        if (endlessMode || wordIndex + 1 >= words.length) setScreen('end'); // 무한: 첫 시간초과 = 종료
        else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); }
      }, 1700));
    }, remaining);
    return () => {
      clearTimeout(timer);
      wordElapsedRef.current += Date.now() - segStartRef.current; // 이번 진행 구간을 누적
    };
  }, [screen, completed, paused, cdPhase, wordTimeLimit, wordIndex, words, endlessMode, isPreview, studentToken]);

  // ── 게임 런 상태 초기화(난이도/복습/무한 공통) — 단어1 재시작도 runId 증가로 타이머·게이지 리셋 ──
  const resetRunState = () => {
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false); setStartTs(Date.now());
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    wordElapsedRef.current = 0; setRunId((n) => n + 1);
    setCdNum(3); setCdPhase('in'); // 카운트다운 오버레이 시작(현재 화면 위로 슬라이드 인 → 게임 전환 → 슬라이드 아웃)
  };

  const startGame = (difficulty) => {
    const d = difficulty || selectedDifficulty;
    if (difficulty && difficulty.id !== selectedDifficulty.id) setSelectedDifficulty(d);
    const pool = wordPoolByDiff[d.id];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('difficulty');
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
      return;
    }
    setReviewMode(false); setEndlessMode(false);
    setWords(shuffle(pool).slice(0, ROUND_LENGTH));
    resetRunState();
  };

  // 복습 모드 — 약한 단어 N개로 게임. 최고기록 미반영, 단어 통계만 갱신.
  const startReview = (reviewWords) => {
    if (!reviewWords || reviewWords.length === 0) return;
    setReviewMode(true); setEndlessMode(false);
    setWords(reviewWords);
    resetRunState();
  };

  // 무한 모드 — 전 난이도 랜덤 스트림. 점점 가속, 첫 시간초과 종료, 헤드라인 최고점.
  const startEndless = () => {
    const all = DIFFICULTIES.flatMap((d) => wordPoolByDiff[d.id] || []);
    if (all.length === 0) { message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
    let stream = [];
    for (let i = 0; i < 8; i++) stream = stream.concat(shuffle(all)); // 첫 초과로 끝나므로 충분히 길게
    setEndlessMode(true); setReviewMode(false);
    setWords(stream);
    resetRunState();
  };

  const handleTone = useCallback((toneNum) => {
    if (completed || paused || cdPhase) return;
    const word = words[wordIndex];
    if (!word) return;
    const expected = word.tones[currentSyl];
    if (toneNum === expected) {
      setShowWrong(false); // 정답 — 오답 메시지 해제
      const ne = [...entered, toneNum];
      setEntered(ne);
      if (ne.length === word.tones.length) {
        setCompleted(true);
        speakWord(word); // 정답 완성 → 올바른 발음 자동 재생(성조 강화)
        const answerTime = wordElapsedRef.current + (Date.now() - segStartRef.current);
        const remaining = Math.max(0, wordTimeLimitRef.current - answerTime);
        let earned;
        if (!hasMistake) {
          const newCombo = combo + 1;
          earned = computeScore({ perfect: true, newCombo, remainingMs: remaining });
          setCombo(newCombo); setMaxCombo((m) => Math.max(m, newCombo));
          if (newCombo >= 2) { setComboFlash(true); addTimer(setTimeout(() => setComboFlash(false), 700)); }
          haptic([10, 20, 30]); playSfx(newCombo >= 2 ? 'combo' : 'correct');
        } else { earned = computeScore({ perfect: false, remainingMs: remaining }); setCombo(0); haptic(15); playSfx('correct', 0.4); }
        setScore((s) => s + earned);
        setFloatScore(`+${earned}`);
        setTotalAnswerTime((t) => t + answerTime);
        setAnsweredCount((c) => c + 1);
        // 단어 숙련도 기록(무실수 클리어 여부 + 소요시간)
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: !hasMistake, timedOut: false, ms: answerTime }); saveWordStats(studentToken, wordStatsRef.current); }
        addTimer(setTimeout(() => setFloatScore(null), 1300));
        addTimer(setTimeout(() => {
          if (wordIndex + 1 >= words.length) setScreen('end');
          else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); }
        }, 1500));
      } else { haptic(8); playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      setHasMistake(true); setCombo(0); setWrongBtn(toneNum); setShowWrong(true); haptic([40, 30, 40]); playSfx('wrong');
      addTimer(setTimeout(() => setWrongBtn(null), 450)); // 버튼 흔들림만 해제, 코치 메시지는 유지
    }
  }, [completed, paused, cdPhase, words, wordIndex, currentSyl, entered, hasMistake, combo, isPreview, studentToken]);

  useEffect(() => {
    if (screen !== 'game') return;
    const handler = (e) => {
      if (e.repeat) return;
      const map = { '1': 1, '2': 2, '3': 3, '4': 4, '0': 0, '5': 0 };
      const tone = map[e.key];
      if (tone === undefined) return;
      e.preventDefault(); handleTone(tone);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, handleTone]);

  const coach = (() => {
    if (timedOut) return { text: '시간 끝! 다시 도전해요', tone: 'danger' };
    if (completed) return combo >= 2 ? { text: `콤보 ${combo}! 멋져요`, tone: 'success' } : { text: '정확해요! 잘했어요', tone: 'success' };
    if (showWrong) return { text: '앗! 다시 찾아봐', tone: 'danger' };
    return { text: '이건 무슨 성조일까?', tone: 'neutral' };
  })();

  const word = words[wordIndex];
  const avgMsForResult = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;

  if (error) return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TG.DANGER, fontSize: 14, background: TG.BG }}>정보를 불러오지 못했어요</div>;
  if (splash || !student) return <SplashScreen />; // 스플래시가 로딩 상태도 겸함

  // 온보딩(소개·튜토리얼) 1회만 — localStorage 플래그
  const finishOnboard = () => { try { localStorage.setItem('tg_onboarded', '1'); } catch { /* noop */ } setScreen('modeselect'); };
  const goFromStart = () => {
    let seen = false;
    try { seen = !!localStorage.getItem('tg_onboarded'); } catch { /* noop */ }
    if (seen) { setScreen('modeselect'); } else { setIntroPage(0); setScreen('intro'); }
  };

  // 단어 숙련도 뷰 데이터 (글로벌 stats + 풀 → 복습필요 리스트/마스터 수/복습단어)
  const masteryStats = (isPreview && previewScreen === 'mastery')
    ? (new URLSearchParams(window.location.search).get('empty') ? {} : PREVIEW_MASTERY.stats)
    : wordStatsRef.current;
  const masteryMap = (isPreview && previewScreen === 'mastery')
    ? PREVIEW_MASTERY.map
    : DIFFICULTIES.reduce((m, d) => { for (const w of (wordPoolByDiff[d.id] || [])) m[w.hanzi] = { ...w, diff: d.label }; return m; }, {});
  const reviewRows = buildReviewList(masteryStats, masteryMap);
  const masteredN = masteredCount(masteryStats, masteryMap);
  const reviewWords = reviewRows.slice(0, ROUND_LENGTH).map((r) => r.word);

  // 화면별 본문 (카운트다운 오버레이/일시정지 모달은 아래에서 위에 덧댐)
  let content;
  if (screen === 'start') {
    content = <StartScreen best={best} bestLabel={best?.label || selectedDifficulty.label} onStart={goFromStart} onClose={() => { if (identity.kind === 'student') navigate(`/personal/${identity.token}`); else window.location.href = '/'; }} onDebugIntro={import.meta.env.DEV ? (() => { setIntroPage(0); setScreen('intro'); }) : undefined} onMastery={() => setScreen('mastery')} studentToken={studentToken} onRefreshBest={() => setBest(headlineBest(studentToken))}
      onLogin={identity.kind === 'guest' ? () => setScreen('login') : null}
      isMemberUser={identity.kind === 'member'} memberName={identity.memberUser?.nickname || null}
      onLogout={() => { logoutMember(); window.location.reload(); }} />;
  } else if (screen === 'login') {
    content = <FigmaScreen><LoginScreen onBack={() => setScreen('start')} onSuccess={() => { setTimeout(() => window.location.reload(), 500); }} /></FigmaScreen>;
  } else if (screen === 'mastery') {
    content = (
      <FigmaScreen>
        <MasteryScreen rows={reviewRows} masteredN={masteredN} onBack={() => setScreen('start')} onReview={() => startReview(reviewWords)} />
      </FigmaScreen>
    );
  } else if (screen === 'intro') {
    content = (
      <FigmaScreen>
        <IntroScreen page={introPage}
          onNext={() => { if (introPage < 2) setIntroPage(introPage + 1); else setScreen('tutorial'); }}
          onSkip={finishOnboard} />
      </FigmaScreen>
    );
  } else if (screen === 'tutorial') {
    content = <FigmaScreen><TutorialScreen onDone={finishOnboard} /></FigmaScreen>;
  } else if (screen === 'modeselect') {
    content = (
      <FigmaScreen>
        <ModeScreen endlessUnlocked={isEndlessUnlocked(studentToken)}
          onDifficulty={() => { playSfx('button'); setScreen('difficulty'); }} onEndless={() => { playSfx('button'); startEndless(); }} onBack={() => setScreen('start')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'difficulty') {
    content = (
      <FigmaScreen>
        <DifficultyScreen selected={selectedDifficulty} studentToken={studentToken} onSelect={setSelectedDifficulty} onStart={startGame} onBack={() => setScreen('modeselect')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'end') {
    content = (
      <FigmaScreen>
        <ResultScreen score={score} maxCombo={maxCombo} avgMs={avgMsForResult} isNewBest={reviewMode ? false : isNewBest} previousBest={reviewMode ? 0 : previousBest}
          endless={endlessMode}
          onRetry={endlessMode ? () => startEndless() : reviewMode ? () => startReview(reviewWords) : () => startGame(selectedDifficulty)}
          onChangeDiff={endlessMode ? () => setScreen('modeselect') : reviewMode ? () => setScreen('mastery') : () => setScreen('difficulty')}
          retryLabel={reviewMode ? '한 번 더 복습' : undefined}
          changeLabel={endlessMode ? '모드 선택으로' : reviewMode ? '숙련도로 돌아가기' : undefined} />
      </FigmaScreen>
    );
  } else { // game
    content = (
      <FigmaScreen>
        {word && (
          <GameScreen word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut}
            wordIndex={wordIndex} wordsLen={words.length} wordTimeLimit={wordTimeLimit} paused={paused || !!cdPhase} endless={endlessMode} runId={runId}
            combo={combo} comboFlash={comboFlash} floatScore={floatScore} score={score} coachText={coach.text}
            onTone={handleTone} wrongBtn={wrongBtn} onPause={() => setPaused(true)} playReveal={!cdPhase} />
        )}
      </FigmaScreen>
    );
  }

  // 카운트다운 오버레이 — 직전 화면 위로 슬라이드 인 → 게임 위로 슬라이드 아웃 (레이어드 커버/리빌)
  const cdStyle = cdPhase === 'in' ? { animation: 'tg-cd-in .42s cubic-bezier(.4,0,.2,1) forwards' }
    : cdPhase === 'out' ? { animation: 'tg-cd-out .42s cubic-bezier(.4,0,.2,1) forwards' }
    : { transform: 'translateX(0)' };

  return (
    <>
      {content}
      {cdPhase && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...cdStyle }}>
          {/* 좌우 물결 가장자리 — 컨테이너 바깥쪽이라 가운데 정렬 시엔 화면 밖(비표시), 슬라이드 중에만 보임 */}
          <CdWaveEdge side="left" />
          <CdWaveEdge side="right" />
          <FigmaScreen bg="#f96c6e"><CountdownVisual n={cdNum} difficulty={selectedDifficulty} /></FigmaScreen>
        </div>
      )}
      {paused && (
        <PauseModal score={score} combo={combo} onResume={() => setPaused(false)}
          onRestart={() => { setPaused(false); if (endlessMode) startEndless(); else if (reviewMode) startReview(reviewWords); else startGame(selectedDifficulty); }}
          onQuit={() => { setPaused(false); setReviewMode(false); setEndlessMode(false); setScreen('start'); }} />
      )}
      {toast && <GameToast key={toast.key} msg={toast.msg} />}
    </>
  );
}
