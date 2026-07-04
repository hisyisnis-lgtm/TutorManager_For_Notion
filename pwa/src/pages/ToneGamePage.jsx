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
import { track } from '../game/gameAnalytics.js';
import {
  resolveIdentity, fetchBests, submitResult, mergeGuestIntoStudent,
  pullMemberData, pushMemberData, mergeStudentIntoMember, logoutMember,
  loadMasteredSync, storeMasteredSync,
} from '../game/gameStore.js';
import { earTier, loadTierPeak, bumpTierPeak } from '../game/earProfile.js';
import { ROUND_LENGTH, DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';
import { TG, ensureGameFonts, haptic, shuffle, getTimeLimitForCombo, loadBest, saveBest } from '../game/tgTokens.js';
import {
  loadWordStats, saveWordStats, recordWordResult, subsetForPool, mergeStats,
  buildReviewList, masteredCount, buildRoundWords,
} from '../game/tgWordStats.js';
import { recordTone, loadToneStats, saveToneStats, weakestTone, toneAccuracy } from '../game/toneStats.js';
import { recordPlay, loadStreak, effectiveCurrent, dateKeyKST, loadFreezes } from '../game/streak.js';
import { syncAchievements, loadAchievements, achievementById, loadReviewMastered, addReviewMastered } from '../game/achievements.js';
import { initTts, speakWord } from '../game/tgTts.js';
import { initSfx, play as playSfx } from '../game/tgSfx.js';
import { initBgm, startBgm, stopBgm } from '../game/tgBgm.js';
import {
  GAMEKEY, getEndlessTimeLimit, computeScore, resolveEndOutcome, UNLOCK_THRESHOLD,
  loadEndlessBest, saveEndlessBest, headlineBest, isEndlessUnlocked,
} from '../game/gameLogic.js';
import { FigmaScreen, CountdownVisual, CdWaveEdge, GameToast, SettingsModal } from '../game/screens/shared.jsx';
import { SplashScreen } from '../game/screens/SplashScreen.jsx';
import { TitleScreen } from '../game/screens/TitleScreen.jsx';
import { LoadingTip } from '../game/screens/LoadingScreen.jsx';
import { HomeScreen } from '../game/screens/HomeScreen.jsx';
import { LoginScreen } from '../game/screens/LoginScreen.jsx';
import { ModeScreen } from '../game/screens/ModeScreen.jsx';
import { ParticleLab } from '../game/screens/_ParticleLab.jsx'; // [임시·DEV] 파티클 검수용 — 검수 후 삭제
import { SfxLab } from '../game/screens/_SfxLab.jsx'; // [임시·DEV] 효과음/배경음 검수용 — 검수 후 삭제
import { DifficultyScreen } from '../game/screens/DifficultyScreen.jsx';
import { ThemeScreen } from '../game/screens/ThemeScreen.jsx';
import { GameScreen } from '../game/screens/GameScreen.jsx';
import { ResultScreen } from '../game/screens/ResultScreen.jsx';
import { MasteryScreen } from '../game/screens/MasteryScreen.jsx';
import { AchievementsScreen } from '../game/screens/AchievementsScreen.jsx';
import { CelebrationOverlay } from '../game/screens/CelebrationOverlay.jsx';
import { GameOverBeat } from '../game/screens/GameOverBeat.jsx';
import { RankUpReveal } from '../game/screens/RankUpReveal.jsx';
import { ModeUnlockReveal } from '../game/screens/ModeUnlockReveal.jsx';

// [DEV] 미리보기 쿼리 단일 창구 — ?screen=·endless=1·practice=1 등 백도어 파라미터. 렌더마다 URLSearchParams를
// 새로 만들던 11곳을 대체(생성 반복 제거 + 백도어 파라미터 목록이 여기서 한눈에). search는 로드 시 고정(SPA).
const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const qs = (name) => QS.get(name);

// 초급 저조 판정 = 최고 콤보 기준. 점수는 오답을 다시 맞혀도 클리어 50점씩 쌓여(막 누르기≈800점대) '실력' 신호가 안 됨.
// 콤보는 '무실수 연속 정답'이라야 오르므로 막 누르기=거의 0~2. 3연속 클린도 못 하면(=maxCombo<3) 헤매는 중으로 봄.
const LOW_EASY_MAX_COMBO = 3; // 초급 노멀 런 최고 콤보가 이 미만이면 '저조' — 2연속 시 연습 모드 유도(코치마크)

// 성조별 레벨(최근 가중 정확도 EMA 기반) 파생 — 런 시작/종료 스냅샷 비교용. 홈 렌더의 밴드 로직과 동일 규칙.
// toneAccuracy = ema 우선(누적 폴백) — 시도가 쌓여도 최근 성과가 레벨에 반영되게(고착 방지).
function deriveToneLevels(toneStats) {
  const ts = toneStats || {}; const out = {};
  for (const t of [1, 2, 3, 4, 0]) {
    const e = ts[t]; const attempts = (e && e[1]) || 0; const acc = toneAccuracy(e);
    out[t] = attempts < 3 ? 1 : (acc < 0.5 ? 1 : acc < 0.65 ? 2 : acc < 0.8 ? 3 : acc < 0.92 ? 4 : 5);
  }
  return out;
}
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

// 미리보기(?screen=mastery)용 성조 레이더 샘플 — [정답, 시도] (DEV 검수 전용)
const PREVIEW_TONE = { 1: [27, 30], 2: [18, 30], 3: [25, 30], 4: [21, 30], 0: [24, 30] };

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
  // 학생 인증 게이트가 /personal/preview를 막으므로, 게스트 라우트(/game/tone?screen=)에서도 미리보기 허용(DEV 한정).
  const isPreview = import.meta.env.DEV && (identity.kind === 'preview'
    || (identity.kind === 'guest' && QS.has('screen')));
  const previewScreen = isPreview ? (qs('screen') || 'title') : 'title';
  const cdPreview = previewScreen === 'countdown'; // 카운트다운 미리보기는 난이도 위 오버레이로
  // 실제(비-미리보기) 진입 초기 화면: 첫 진입은 소개(스플래시 아래)부터, 소개를 이미 봤거나(신규 플래그)
  // 기존 온보딩 완료자(tg_onboarded — 구버전 사용자 재노출 방지)면 타이틀.
  const realStart = (() => { try { return (localStorage.getItem('tg_intro_seen') || localStorage.getItem('tg_onboarded')) ? 'title' : 'intro'; } catch { return 'intro'; } })();
  const initialScreen = cdPreview ? 'difficulty'
    : previewScreen === 'celebrate' ? 'home'   // celebrate는 홈 위에 오버레이로
    : previewScreen === 'settings' ? 'home'    // 설정 모달은 홈 위에 오버레이로
    : previewScreen === 'tonelevel' ? 'home'   // 성조 레벨 스포트라이트는 홈에서 재생
    : isPreview ? previewScreen                 // 그 외 미리보기는 지정 화면('gameover' 등)
    : realStart;                               // 실제 진입: 첫 방문=intro, 이후=title

  const [screen, setScreen] = useState(initialScreen); // start | difficulty | game | end | intro | tutorial
  const [paused, setPaused] = useState(false);
  const [words, setWords] = useState(() => (isPreview && (previewScreen === 'game' || previewScreen === 'gameover') ? PREVIEW_WORDS : []));
  const [cdPhase, setCdPhase] = useState(cdPreview ? 'run' : null); // 카운트다운 오버레이 단계: null|'in'|'run'|'out'
  const [cdNum, setCdNum] = useState(3);
  const [homeTx, setHomeTx] = useState(null); // 타이틀→홈 웨이브 전환: null|'in'(슬라이드 인)|'hold'(팁 강제노출)|'out'(슬라이드 아웃)
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
  const [gaugeOffsetMs, setGaugeOffsetMs] = useState(0); // 오답 패널티로 게이지 즉시 차감(애니메이션 음수 delay) + 타이머 재계산 트리거
  const [lowTime, setLowTime] = useState(false); // 시간 임박(남은시간 막바지) — 게이지 붉어짐·맥동 텐션 연출. 연습 제외.
  const [lives, setLives] = useState(3); // 하트 = 런당 '건너뛰기 예산' 3개(모든 모드 공통). 건너뛰기마다 -1, 0이면 스킵 불가(게임은 계속). 연습 모드는 미표시.
  const [suddenIntro, setSuddenIntro] = useState(false); // 무한 런 시작 시 '서든데스' 연출(≈2.2s) — 연출 중 타이머 정지·탭 차단
  const [endKind, setEndKind] = useState('complete'); // 종료 사유('complete'|'timeout'|'miss') — 게임오버 비트 헤드라인 + 결과 코치 멘트 분기
  const [wrongShakeKey, setWrongShakeKey] = useState(0); // 오답마다 +1 — 화면 셰이크 트리거(같은 버튼 연타·연속 오답도 매번 발동)
  // 게임오버 비트 — 결과화면 직전, 게임 화면 '위 오버레이'로 표시(전 종료 공통). 미리보기 ?screen=gameover면 시작부터 표시.
  const [showGameOverBeat, setShowGameOverBeat] = useState(() => isPreview && previewScreen === 'gameover');
  const [rankUp, setRankUp] = useState(null); // 등급 진행 연출 {prev, now} — 새 마스터 시 비트 다음·결과 전
  const masteredAtStartRef = useRef(0); // 판 시작 시 마스터 단어 수 스냅샷 — 종료 시 증가분 판정

  const wordTimeLimitRef = useRef(7000);
  const wordElapsedRef = useRef(0); // 현재 단어의 누적 '진행' 시간(일시정지·카운트다운 제외)
  const segStartRef = useRef(0);    // 현재 진행 구간 시작 시각
  const livesRef = useRef(3);        // lives 동기 읽기용(setState 비동기·연타 stale 방지)
  const [totalAnswerTime, setTotalAnswerTime] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTIES[0]);
  const [wordPoolByDiff, setWordPoolByDiff] = useState({});
  const [themeMode, setThemeMode] = useState(false); // 테마 모드(드라마·여행 등) — 난이도와 별개 축, 종료처리는 normal과 동일(gameKey만 테마 것)
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [wordPoolByTheme, setWordPoolByTheme] = useState({});
  const wordStatsRef = useRef({});  // 단어별 숙련도 글로벌(localStorage 동기화)
  const toneStatsRef = useRef({});  // 성조별 정답률(1·2·3·4·경성) — 성조 레이더/약점 진단(P1)
  const toneSnapRef = useRef(null); // 런 시작 시 성조별 정답수 스냅샷 → 홈 복귀 시 성장 축하 연출(D)
  const toneLevelSnapRef = useRef(null); // 런 시작 성조별 레벨 스냅샷 → 종료 시 비교(레벨 업/다운 연출)
  const [celebrateTone, setCelebrateTone] = useState(null); // 홈에서 성장 축하할 성조(점프+반짝)
  // 이번 판 성조 레벨 변화 [{tone, from, to, dir}] — 홈에서 하나씩 스포트라이트. 미리보기 ?screen=tonelevel
  const [toneLevelChanges, setToneLevelChanges] = useState(() => (isPreview && previewScreen === 'tonelevel'
    ? [{ tone: 2, from: 3, to: 4, dir: 'up' }, { tone: 3, from: 3, to: 2, dir: 'down' }] : []));
  // 모드 잠금해제 연출 {icon,label,desc,accent} — 결과 위 오버레이. 미리보기 ?screen=modeunlock
  const [modeUnlock, setModeUnlock] = useState(() => (isPreview && previewScreen === 'modeunlock'
    ? { icon: 'Infinity', label: '무한 모드', desc: '끝없이 이어지는 무한 모드가 열렸어요', accent: '#8B5CF6' } : null));
  const endHandledRef = useRef(false); // 결과화면 1회 처리 가드(다시하기로 score 리셋 시 재실행·중복 사운드 방지)
  const [reviewMode, setReviewMode] = useState(false); // 복습 모드(약한 단어 10개)
  const [suggestPractice, setSuggestPractice] = useState(false); // 초급 2연속 저조 → 모드선택서 연습 카드 코치마크 유도
  // 무한 모드(랜덤·가속·서든데스). 미리보기(?screen=game&endless=1)는 state까지 켜서 서든데스·상시코치 검수 가능(DEV 한정).
  const [endlessMode, setEndlessMode] = useState(() => isPreview && previewScreen === 'game' && qs('endless') === '1');
  const [practiceMode, setPracticeMode] = useState(() => isPreview && previewScreen === 'game' && qs('practice') === '1'); // 연습 모드(시간 무제한·기록 미반영·정답 보기). [DEV] ?screen=game&practice=1로 코치마크 검수
  // 듣기 문제 여부 = 라운드 시작 시 단어별로 미리 결정(listenRollsRef). 렌더에서 파생 → 예전 state 방식의
  // '새 단어 렌더 후 effect가 뒤늦게 set' 프레임(듣기→일반 순간전환 flicker) 제거. [i>0 && rand<0.35]
  const listenRollsRef = useRef([]);
  const [audioOff, setAudioOff] = useState(false); // '지금은 못 들어요' — 그 판 한정 듣기 문제 미출제(한자 공개·자동재생 중지)
  const audioOffRef = useRef(false); // word-start effect서 최신값 동기 읽기
  const [difficultyTarget, setDifficultyTarget] = useState('normal'); // 난이도 화면 진입 목적: 'normal'|'practice'
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
  // 업적 획득 축하 큐(P4) — 게임 종료 시 새로 달성한 업적 객체 배열. 1장씩 보여주고 shift. 미리보기는 샘플.
  const [celebrationQueue, setCelebrationQueue] = useState(() => (isPreview && previewScreen === 'celebrate'
    ? [achievementById('score-1000'), achievementById('unlock-normal')].filter(Boolean) : []));
  const [recordToBeat, setRecordToBeat] = useState(0); // 이번 런 시작 시점의 직전 최고기록(라이브 신기록 배너 기준, P4b). 연습·복습=0
  const [introPage, setIntroPage] = useState(() => (isPreview ? Number(qs('introPage') || 0) : 0)); // 소개 캐러셀 페이지 (0~2)

  const timersRef = useRef([]);
  const addTimer = (id) => { timersRef.current.push(id); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }; // 추적 타이머(점수 플로트·콤보·다음단어 진행) 일괄 정리

  useEffect(() => { ensureGameFonts(); initTts(); initSfx(); initBgm(); }, []);

  // 배경음 — 메뉴 화면에서만 재생, 실제 풀이(game) 중엔 정지. 스플래시·미리보기 제외.
  // (startBgm은 자체 음소거 상태를 존중하므로 여기선 화면 조건만 판단)
  useEffect(() => {
    if (isPreview) return undefined;
    if (!splash && screen !== 'game') startBgm();
    else stopBgm();
    return undefined;
  }, [screen, splash, isPreview]);

  // 언마운트 시 배경음 정지(페이지 이탈).
  useEffect(() => () => stopBgm(), []);

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
    THEMES.forEach((t) => {
      fetchToneWords(t.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByTheme((prev) => ({ ...prev, [t.id]: w })); }).catch(() => {});
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
      toneStatsRef.current = loadToneStats(studentToken);
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

    // 모드별 종료 판정(최고기록·신기록·효과음)은 순수함수 resolveEndOutcome에 모음.
    //  normal=난이도별 best · endless=무한 best · practice/review=기록 미반영(단어통계만).
    // 테마 모드는 난이도(normal)와 동일 메커니즘(난이도별 best) — gameKey·단어풀만 테마 것으로 치환.
    const mode = endlessMode ? 'endless' : practiceMode ? 'practice' : reviewMode ? 'review' : 'normal';
    const gameKey = themeMode ? selectedTheme.gameKey : selectedDifficulty.gameKey;
    const statsPool = themeMode ? (wordPoolByTheme[selectedTheme.id] || []) : (wordPoolByDiff[selectedDifficulty.id] || []);
    const prevRecord = mode === 'endless' ? loadEndlessBest(studentToken)
      : mode === 'normal' ? loadBest(studentToken, gameKey) : null;
    const outcome = resolveEndOutcome({ mode, prev: prevRecord, score, maxCombo, avgMs: avgMsVal });
    setIsNewBest(outcome.isNewBest);
    setPreviousBest(outcome.previousBest);

    if (!isPreview) {
      if (mode === 'endless') {
        // 무한 — 헤드라인 best. meta.eb로 영구화(고급 행에 얹음, best 비교엔 0 submit). 단어통계는 별도 동기화.
        const updated = { ...outcome.updated, updatedAt: Date.now() };
        saveEndlessBest(studentToken, updated);
        setBest(headlineBest(studentToken));
        syncWordStats();
        submitResult(identity, GAMEKEY.hard, { score: 0, maxCombo: 0, avgMs: 0, meta: { eb: updated.bestScore } }).catch(() => {});
      } else if (mode === 'normal') {
        // 난이도 — best 갱신 + 단어통계(meta.w)를 점수 submit에 함께 실어 한 번에 보낸다.
        const updated = { ...outcome.updated, updatedAt: Date.now() };
        saveBest(studentToken, gameKey, updated);
        setBest(headlineBest(studentToken)); // 헤드라인(무한 우선, 없으면 통합) 갱신
        const wSub = subsetForPool(wordStatsRef.current, statsPool);
        submitResult(identity, gameKey, { score, maxCombo, avgMs: avgMsVal, ...(Object.keys(wSub).length ? { meta: { w: wSub } } : {}) }).catch(() => {});
      } else {
        // 연습·복습 — 최고기록 미반영, 영향받은 난이도 단어통계만 동기화
        syncWordStats();
      }

      // ── 성취 레이어(P1) — 일일 스트릭 + 업적 평가. 로컬 저장(서버 동기화는 후속). 모든 모드 공통(플레이=출석) ──
      const streak = recordPlay(studentToken);
      // 보호권 알림 — 방어 성공(안도)·획득(보상). 압박 아닌 긍정 카피.
      if (streak.freezeUsed > 0) showToast(`❄️ 보호권이 빠진 하루를 지켜줬어요! 연속학습 ${streak.current}일 유지`);
      else if (streak.freezeEarned > 0) showToast(`🔥 ${streak.current}일 달성! 보호권 +1 (❄️${streak.freezes})`);
      const masteredN = (() => {
        const map = {};
        for (const d of DIFFICULTIES) for (const w of (wordPoolByDiff[d.id] || [])) map[w.hanzi] = w;
        return masteredCount(wordStatsRef.current, map);
      })();
      // 복습 성과 카운터 — 복습 런에서 새로 마스터된 단어 수 누적(업적 '복습의 힘'). 델타는 같은 공식(풀 기준)끼리 비교.
      if (mode === 'review') {
        const reviewDelta = masteredN - masteredAtStartRef.current;
        if (reviewDelta > 0) addReviewMastered(studentToken, reviewDelta);
      }
      // 마스터 수 last-writer 기록 — 등급은 이제 정직하게 오르내림(강등 전파). 트림 아티팩트 방어는 mc가 담당.
      // 최고 등급(peak)만 고수위로 보존 — 강등돼도 성취의 기억은 안 뺏음.
      storeMasteredSync(studentToken, masteredN);
      bumpTierPeak(studentToken, earTier(masteredN).idx);
      const bestByDiff = {
        easy: loadBest(studentToken, GAMEKEY.easy)?.bestScore || 0,
        normal: loadBest(studentToken, GAMEKEY.normal)?.bestScore || 0,
        hard: loadBest(studentToken, GAMEKEY.hard)?.bestScore || 0,
      };
      const endlessB = loadEndlessBest(studentToken)?.bestScore || 0;
      const playCount = ['easy', 'normal', 'hard'].reduce((n, k) => n + (loadBest(studentToken, GAMEKEY[k])?.playCount || 0), 0) + (loadEndlessBest(studentToken)?.playCount || 0);
      const maxComboEver = Math.max(maxCombo, // 콤보 업적은 이번 런 포함(기록 아니어도 달성)
        loadBest(studentToken, GAMEKEY.easy)?.bestMaxCombo || 0,
        loadBest(studentToken, GAMEKEY.normal)?.bestMaxCombo || 0,
        loadBest(studentToken, GAMEKEY.hard)?.bestMaxCombo || 0,
        loadEndlessBest(studentToken)?.bestMaxCombo || 0);
      // 점수 업적은 저장된 best 기준(연습/복습 점수로는 안 따짐 — best는 이미 위에서 갱신됨).
      // 새로 달성한 업적 id 반환 → 축하 오버레이 큐에 적재(P4). 잠금해제·마스터도 업적이라 함께 커버.
      const freshIds = syncAchievements(studentToken, {
        playCount,
        bestScoreAny: Math.max(bestByDiff.easy, bestByDiff.normal, bestByDiff.hard, endlessB),
        maxComboEver, bestByDiff, endlessBest: endlessB, masteredCount: masteredN,
        streakLongest: streak.longest, toneStats: toneStatsRef.current,
        reviewMastered: loadReviewMastered(studentToken),
      });
      // 업적 축하 — 단, 모드 잠금해제(unlock-*)는 아래 전용 연출이 담당하므로 제네릭 카드에서 제외(중복 방지)
      if (freshIds.length) setCelebrationQueue(freshIds.filter((id) => !id.startsWith('unlock-')).map(achievementById).filter(Boolean));

      // 모드 잠금해제 감지 — 이번 판에 그 모드 best가 1000을 처음 넘긴 경우 → 전용 연출(난이도·무한·테마 통합)
      if (mode === 'normal' && outcome.previousBest < UNLOCK_THRESHOLD && outcome.updated && outcome.updated.bestScore >= UNLOCK_THRESHOLD) {
        let mu = null;
        if (themeMode) { if (selectedTheme.id === 'drama') mu = { icon: 'MapPin', label: '여행 테마', desc: '여행 중국어 테마가 열렸어요', accent: '#7C5CFF' }; }
        else if (selectedDifficulty.id === 'easy') mu = { icon: 'Rocket', label: '중급 모드', desc: '중급 난이도에 도전할 수 있어요', accent: '#F2484C' };
        else if (selectedDifficulty.id === 'normal') mu = { icon: 'Crown', label: '고급 모드', desc: '고급 난이도에 도전할 수 있어요', accent: '#F0A91E' };
        else if (selectedDifficulty.id === 'hard') mu = { icon: 'Infinity', label: '무한 모드', desc: '끝없이 이어지는 무한 모드가 열렸어요', accent: '#8B5CF6' };
        if (mu) setModeUnlock(mu);
      }

      // 초급 노멀 저조 연속 감지 → 2연속이면 연습 모드 유도 플래그(모드선택 코치마크). 격려 톤(강요 아님).
      // 신호=최고 콤보(막 누르기 방어 — 점수는 오답 클리어 50점 누적으로 부풀어 실력 구분 불가).
      if (mode === 'normal' && !themeMode && selectedDifficulty.id === 'easy') {
        const lowKey = `game_easy_low_${studentToken}`;
        let lowN = 0; try { lowN = parseInt(localStorage.getItem(lowKey) || '0', 10) || 0; } catch { /* noop */ }
        lowN = maxCombo < LOW_EASY_MAX_COMBO ? lowN + 1 : 0;
        if (lowN >= 2) { setSuggestPractice(true); lowN = 0; } // 유도 1회 후 카운터 리셋(반복 잔소리 방지)
        try { localStorage.setItem(lowKey, String(lowN)); } catch { /* noop */ }
      }

      if (identity.kind === 'member') pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me) 통째 동기화
      // 측정: 런 종료(모드 라벨 + 점수) — 유입 깔때기의 '플레이' 카운트
      track('run_end', { m: mode === 'normal' ? (themeMode ? selectedTheme.id : selectedDifficulty.id) : mode, k: identity.kind, v: score });
    }
    playSfx(outcome.sfx);
  }, [screen, identity, studentToken, selectedDifficulty, score, maxCombo, answeredCount, totalAnswerTime, reviewMode, endlessMode, practiceMode, themeMode, selectedTheme, words, wordPoolByDiff, wordPoolByTheme, isPreview]);

  useEffect(() => () => clearTimers(), []);
  // 측정: 게임 진입 1회(유입 깔때기 상단) — 익명(신원 종류만)
  useEffect(() => { if (!isPreview) track('enter', { k: identity.kind }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 전역 버튼음 — 눌리는 버튼(.tg-press)엔 대부분 클릭음. data-nosfx로 개별 제외(예: 성조 답 버튼=자체 정답/오답음).
  useEffect(() => {
    const onDown = (e) => {
      const el = e.target && e.target.closest && e.target.closest('.tg-press:not([data-nosfx])');
      if (el) playSfx('button');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

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
  // 타이틀→홈 웨이브 전환: in(슬라이드 인, 420ms)→ 홈 마운트 + hold(팁 강제노출 2.6s)→ out(슬라이드 아웃, 420ms)→ 종료
  useEffect(() => {
    if (homeTx !== 'in') return undefined;
    const t = setTimeout(() => { setScreen('home'); setHomeTx('hold'); }, 420);
    return () => clearTimeout(t);
  }, [homeTx]);
  useEffect(() => {
    if (homeTx !== 'hold') return undefined;
    const t = setTimeout(() => setHomeTx('out'), 2600); // 팁 강제 노출(로딩할 게 없어도)
    return () => clearTimeout(t);
  }, [homeTx]);
  useEffect(() => {
    if (homeTx !== 'out') return undefined;
    const t = setTimeout(() => setHomeTx(null), 420);
    return () => clearTimeout(t);
  }, [homeTx]);

  useEffect(() => {
    if (screen !== 'game' || cdPhase) return; // 카운트다운 끝나야 타이머 시작
    const limit = practiceMode ? 0                                      // 연습: 시간 무제한(게이지 미표시·타임아웃 effect 비활성)
      : endlessMode ? getEndlessTimeLimit(answeredCount, combo)         // 무한: 클리어 램프 + 콤보 가속(둘 다)
      : reviewMode ? 30000                                              // 복습: 30초 고정(콤보 무관)
      : Math.max(4000, getTimeLimitForCombo(combo, (themeMode ? selectedTheme.timeMultiplier : selectedDifficulty.timeMultiplier))); // 난이도/테마: 콤보0 페이스, 콤보로 가속(하한 4초)
    wordElapsedRef.current = 0; // 새 단어 — 누적 진행시간 리셋
    segStartRef.current = Date.now(); // 진행 구간 시작 — 연습 모드는 타임아웃 effect가 안 도니 여기서 설정(answerTime 거대값 버그 방지)
    wordTimeLimitRef.current = limit;
    setWordTimeLimit(limit);
    setTimedOut(false);
    setLowTime(false); // 새 단어 — 텐션 연출 초기화
    setShowWrong(false); // 새 단어 — 코치 오답 메시지 초기화
    // 하트는 런당 예산이라 단어마다 회복하지 않음(리셋은 resetRunState에서만).
    // 듣기 문제 = 라운드 시작 시 미리 굴린 값(listenRollsRef) 사용. '지금은 못 들어요'면 미출제. 듣기면 소리 자동재생.
    // (렌더 파생과 동일 조건 — 여기선 자동재생 side-effect만 담당, wordIsListen state set은 없앰 → flicker 방지)
    const isListen = !practiceMode && !endlessMode && !audioOffRef.current && !!listenRollsRef.current[wordIndex];
    if (isListen && !isPreview) { const lw = words[wordIndex]; if (lw) addTimer(setTimeout(() => speakWord(lw), 240)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, screen, selectedDifficulty, cdPhase, runId]);

  useEffect(() => {
    if (screen !== 'game' || completed || paused || cdPhase || suddenIntro || practiceMode) return undefined; // 연습=시간 무제한(타임아웃 없음) · 서든데스 연출 중 정지
    // 남은 시간만큼만 카운트(일시정지 후 계속하기 시 처음부터 다시 세지 않음)
    segStartRef.current = Date.now();
    const remaining = Math.max(0, wordTimeLimitRef.current - wordElapsedRef.current);
    // 텐션 램프 — 막바지(마지막 ~2.5s, 짧은 단어는 한도의 40%) 진입 시 게이지 붉어짐·맥동 + 약한 햅틱 1회
    const lowZone = Math.min(2500, wordTimeLimitRef.current * 0.4);
    const enterLow = () => { setLowTime(true); haptic(20); };
    let lowTimer = null;
    if (remaining <= lowZone) setLowTime(true); // 재개 시 이미 막바지면 즉시(햅틱 없이 — 진입 순간만 울림)
    else { setLowTime(false); lowTimer = setTimeout(enterLow, remaining - lowZone); }
    const timer = setTimeout(() => {
      const word = words[wordIndex];
      if (!word) return;
      setTimedOut(true); setCompleted(true); setCombo(0); setEntered(word.tones);
      setEndKind('timeout');
      haptic([60, 30, 60]); playSfx('timeout');
      speakWord(word); // 시간초과 공개 → 올바른 발음 들려주기
      // 단어 숙련도 기록(시간초과 = 실패). 성조별 정답률은 탭 기준(handleTone)만 — 시간초과는 탭이 없어 미기록.
      if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: true, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
      addTimer(setTimeout(() => {
        if (endlessMode || wordIndex + 1 >= words.length) setShowGameOverBeat(true); // 무한: 첫 시간초과 = 종료
        else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
      }, 1700));
    }, remaining);
    return () => {
      clearTimeout(timer);
      if (lowTimer) clearTimeout(lowTimer);
      wordElapsedRef.current += Date.now() - segStartRef.current; // 이번 진행 구간을 누적
    };
  }, [screen, completed, paused, cdPhase, wordTimeLimit, gaugeOffsetMs, wordIndex, words, endlessMode, suddenIntro, practiceMode, isPreview, studentToken]);

  // 무한 서든데스 킥오프 연출 — 런이 라이브(카운트다운 종료)가 되는 순간 ≈2.2초 노출. 이 동안 위 타임아웃 effect가 suddenIntro로 정지 → 타이머 안 흐름.
  useEffect(() => {
    if (screen !== 'game' || !endlessMode || cdPhase) { setSuddenIntro(false); return undefined; }
    setSuddenIntro(true);
    const t = setTimeout(() => setSuddenIntro(false), 2350);
    return () => clearTimeout(t);
  }, [runId, screen, endlessMode, cdPhase]);

  // 현재 마스터한 단어 수(전 난이도 풀 기준) — 등급 진행 연출의 시작/종료 스냅샷용
  const currentMastered = () => {
    const map = {};
    for (const d of DIFFICULTIES) for (const w of (wordPoolByDiff[d.id] || [])) map[w.hanzi] = w;
    return masteredCount(wordStatsRef.current, map);
  };

  // ── 게임 런 상태 초기화(난이도/복습/무한 공통) — 단어1 재시작도 runId 증가로 타이머·게이지 리셋 ──
  const resetRunState = () => {
    clearTimers(); // 이전 런의 진행/플로트 타이머가 새 런에 끼어들지 않게(runId 가드 보강)
    setCelebrationQueue([]); // 이전 종료의 축하 큐 잔여 정리
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false); setStartTs(Date.now());
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    setEndKind('complete'); setWrongShakeKey(0); setShowGameOverBeat(false); // 게임오버 비트 헤드라인·셰이크·오버레이 초기화
    livesRef.current = 3; setLives(3); // 무한 하트 초기화
    audioOffRef.current = false; setAudioOff(false); // '지금은 못 들어요'는 그 판 한정 → 새 런마다 리셋(듣기 여부는 listenRollsRef, 각 start*가 설정)
    masteredAtStartRef.current = currentMastered(); setRankUp(null); // 등급 진행 연출 — 판 시작 마스터 수 스냅샷
    { const ts = toneStatsRef.current || {}, snap = {}; for (const t of [1, 2, 3, 4, 0]) snap[t] = (ts[t] && ts[t][0]) || 0; toneSnapRef.current = snap; } // 성조별 정답수 스냅샷(성장 축하용)
    toneLevelSnapRef.current = deriveToneLevels(toneStatsRef.current); setToneLevelChanges([]); setModeUnlock(null); // 성조 레벨 스냅샷(업/다운 연출용) + 모드해제 연출 초기화
    wordElapsedRef.current = 0; setGaugeOffsetMs(0); setRunId((n) => n + 1);
    setCdNum(3); setCdPhase('in'); // 카운트다운 오버레이 시작(현재 화면 위로 슬라이드 인 → 게임 전환 → 슬라이드 아웃)
  };

  // 게임 종료→홈 복귀 시: ①성조 레벨 변화(업/다운)를 홈에서 하나씩 스포트라이트, ②없으면 가장 많이 맞힌 성조 성장 축하(점프+반짝).
  useEffect(() => {
    if (screen !== 'home' || isPreview) return undefined;
    // ① 레벨 변화 → 홈 스포트라이트 시퀀스(HomeScreen이 재생)
    if (toneLevelSnapRef.current) {
      const before = toneLevelSnapRef.current, after = deriveToneLevels(toneStatsRef.current);
      toneLevelSnapRef.current = null;
      const ch = [];
      for (const t of [1, 2, 3, 4, 0]) { if (after[t] !== before[t]) ch.push({ tone: t, from: before[t], to: after[t], dir: after[t] > before[t] ? 'up' : 'down' }); }
      if (ch.length) { setToneLevelChanges(ch); toneSnapRef.current = null; return undefined; } // 레벨 연출이 있으면 성장 축하는 생략(중복 방지)
    }
    // ② 레벨 변화 없을 때만 성장 축하
    if (!toneSnapRef.current) return undefined;
    const ts = toneStatsRef.current || {}, snap = toneSnapRef.current; toneSnapRef.current = null;
    let best = null, bestGain = 0;
    for (const t of [1, 2, 3, 4, 0]) { const gain = (((ts[t] && ts[t][0]) || 0) - (snap[t] || 0)); if (gain > bestGain) { bestGain = gain; best = t; } }
    if (best == null) return undefined;
    setCelebrateTone(best);
    const id = setTimeout(() => setCelebrateTone(null), 2600);
    return () => clearTimeout(id);
  }, [screen, isPreview]);

  // 라운드 단어별 듣기문제 여부 미리 굴림(첫 단어 제외·약 35%). 일반·복습·테마만 사용(연습/무한=빈 배열).
  const rollListen = (arr) => (arr || []).map((_, i) => i > 0 && Math.random() < 0.35);
  // 라운드 설정 — words와 듣기 롤을 '항상 함께' 갱신(한쪽만 바꾸는 실수 방지). listen=false → 듣기 미출제(연습·무한).
  const setRound = (arr, { listen = true } = {}) => { setWords(arr); listenRollsRef.current = listen ? rollListen(arr) : []; };

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
    setReviewMode(false); setEndlessMode(false); setPracticeMode(false); setThemeMode(false);    setRecordToBeat(loadBest(studentToken, d.gameKey)?.bestScore || 0); // 라이브 신기록 기준(이 난이도 직전 최고)
    setRound(buildRoundWords(pool, wordStatsRef.current, ROUND_LENGTH)); // 교육적 가중 추첨(약점 우선·은은하게)
    if (!isPreview) track('run_start', { m: d.id, k: identity.kind });
    resetRunState();
  };

  // 연습 모드 — 난이도 선택 후 시간 무제한 학습. 기록 미반영, 숙련도만 반영. '정답 보기' 가능.
  const startPractice = (difficulty) => {
    const d = difficulty || selectedDifficulty;
    if (difficulty && difficulty.id !== selectedDifficulty.id) setSelectedDifficulty(d);
    const pool = wordPoolByDiff[d.id];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('difficulty');
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
      return;
    }
    setPracticeMode(true); setReviewMode(false); setEndlessMode(false); setThemeMode(false);    setRecordToBeat(0); // 연습=기록 미반영
    setRound(buildRoundWords(pool, wordStatsRef.current, ROUND_LENGTH), { listen: false }); // 연습=듣기문제 없음(자체 발음듣기)
    if (!isPreview) track('run_start', { m: 'practice', k: identity.kind });
    resetRunState();
  };

  // 복습 모드 — 약한 단어 N개로 게임. 최고기록 미반영, 단어 통계만 갱신.
  const startReview = (reviewWords) => {
    if (!reviewWords || reviewWords.length === 0) return;
    setReviewMode(true); setEndlessMode(false); setPracticeMode(false); setThemeMode(false);    setRecordToBeat(0); // 복습=기록 미반영
    setRound(reviewWords);
    if (!isPreview) track('run_start', { m: 'review', k: identity.kind });
    resetRunState();
  };

  // 무한 모드 — 전 난이도 랜덤 스트림. 점점 가속, 첫 시간초과 종료, 헤드라인 최고점.
  const startEndless = () => {
    const all = DIFFICULTIES.flatMap((d) => wordPoolByDiff[d.id] || []);
    if (all.length === 0) { message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
    let stream = [];
    for (let i = 0; i < 8; i++) stream = stream.concat(shuffle(all)); // 첫 초과로 끝나므로 충분히 길게
    setEndlessMode(true); setReviewMode(false); setPracticeMode(false); setThemeMode(false);    setRecordToBeat(loadEndlessBest(studentToken)?.bestScore || 0); // 라이브 신기록 기준(무한 직전 최고)
    setRound(stream, { listen: false }); // 무한=듣기문제 없음
    if (!isPreview) track('run_start', { m: 'endless', k: identity.kind });
    resetRunState();
  };

  // 테마 모드 — 테마별 단어풀로 게임. 난이도(normal)와 동일 메커니즘(테마별 best/리더보드), 타이머는 중급 페이스.
  const startTheme = (theme) => {
    const t = theme || selectedTheme;
    if (theme && theme.id !== selectedTheme.id) setSelectedTheme(t);
    const pool = wordPoolByTheme[t.id];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('theme');
      fetchToneWords(t.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByTheme((prev) => ({ ...prev, [t.id]: w })); }).catch(() => {});
      return;
    }
    setThemeMode(true); setReviewMode(false); setEndlessMode(false); setPracticeMode(false);    setRecordToBeat(loadBest(studentToken, t.gameKey)?.bestScore || 0); // 라이브 신기록 기준(이 테마 직전 최고)
    setRound(buildRoundWords(pool, wordStatsRef.current, ROUND_LENGTH)); // 교육적 가중 추첨(약점 우선·은은하게)
    if (!isPreview) track('run_start', { m: t.id, k: identity.kind });
    resetRunState();
  };

  const handleTone = useCallback((toneNum) => {
    if (completed || paused || cdPhase || suddenIntro) return; // 서든데스 연출 중 입력 무시
    const word = words[wordIndex];
    if (!word) return;
    const expected = word.tones[currentSyl];
    if (!isPreview) { recordTone(toneStatsRef.current, expected, toneNum === expected); saveToneStats(studentToken, toneStatsRef.current); } // 성조별 정답률(기대 성조 기준)
    if (toneNum === expected) {
      setShowWrong(false); // 정답 — 오답 메시지 해제
      const ne = [...entered, toneNum];
      setEntered(ne);
      if (ne.length === word.tones.length) {
        setCompleted(true); setEndKind('complete');
        speakWord(word); // 정답 완성 → 올바른 발음 자동 재생(성조 강화)
        const answerTime = wordElapsedRef.current + (Date.now() - segStartRef.current);
        const remaining = practiceMode ? 0 : Math.max(0, wordTimeLimitRef.current - answerTime); // 연습=시간보너스 없음
        let earned;
        if (!hasMistake) {
          const newCombo = combo + 1;
          earned = computeScore({ perfect: true, newCombo, remainingMs: remaining });
          setCombo(newCombo); setMaxCombo((m) => Math.max(m, newCombo));
          if (newCombo >= 2) { setComboFlash(true); addTimer(setTimeout(() => setComboFlash(false), 700)); }
          haptic([10, 20, 30]);
          // 콤보 피치 래더 — 연속 정답마다 음정 반음↑(1옥타브=12 캡). "쌓인다"는 손맛.
          const pitchRate = Math.pow(2, Math.min(newCombo - 1, 12) / 12);
          playSfx(newCombo >= 2 ? 'combo' : 'correct', undefined, pitchRate);
        } else { earned = computeScore({ perfect: false, remainingMs: remaining }); setCombo(0); haptic(15); playSfx('correct', 0.4); }
        setScore((s) => s + earned);
        setFloatScore(`+${earned}`);
        setTotalAnswerTime((t) => t + answerTime);
        setAnsweredCount((c) => c + 1);
        // 단어 숙련도 기록(무실수 클리어 여부 + 소요시간)
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: !hasMistake, timedOut: false, ms: answerTime }); saveWordStats(studentToken, wordStatsRef.current); }
        addTimer(setTimeout(() => setFloatScore(null), 1300));
        addTimer(setTimeout(() => {
          if (wordIndex + 1 >= words.length) setShowGameOverBeat(true);
          else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
        }, 1500));
      } else { haptic(8); playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      if (wrongBtn !== null) return; // 흔들림(450ms) 중 연타 — 하트 순삭·중복 패널티 방지(차감 없이 무시)
      setHasMistake(true); setCombo(0); setWrongBtn(toneNum); setShowWrong(true); setWrongShakeKey((k) => k + 1); haptic([40, 30, 40]); playSfx('wrong');
      addTimer(setTimeout(() => setWrongBtn(null), 450)); // 버튼 흔들림만 해제, 코치 메시지는 유지
      // 무한 = 서든데스: 오답 1번 = 즉시 종료(정답 공개 후 게임오버). 난타 방지 장치. 모르는 단어는 건너뛰기(하트)로 안전 통과.
      if (endlessMode) {
        setCompleted(true); setEntered(word.tones); setEndKind('miss');
        speakWord(word); // 정답 공개 → 올바른 발음 들려주기
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
        addTimer(setTimeout(() => setShowGameOverBeat(true), 1700)); // 정답 공개 후 게임오버 비트
        return; // 종료 — 시간 패널티 불필요
      }
      // 오답 0.5초 패널티(연습·미리보기 제외) — 경과시간에 500ms 더해 남은시간 차감. setGaugeOffsetMs가 게이지 재마운트(음수 delay)+타이머 effect 재실행 유발.
      if (!practiceMode && !isPreview) {
        const elapsed = Math.min(wordTimeLimitRef.current, wordElapsedRef.current + (Date.now() - segStartRef.current) + 500);
        wordElapsedRef.current = elapsed;
        segStartRef.current = Date.now();
        setGaugeOffsetMs(elapsed);
      }
    }
  }, [completed, paused, cdPhase, suddenIntro, words, wordIndex, currentSyl, entered, hasMistake, combo, practiceMode, isPreview, studentToken, endlessMode, wrongBtn]);

  // 건너뛰기 — 못 풀겠는 단어를 하트 1개 소모하고 넘김. 정답 공개+발음(학습) · 콤보 끊김 · 0점 · 숙련도 미반영.
  // 하트는 런당 3개 예산(모든 모드 공통). 0개면 버튼 비활성 → 스킵만 불가, 게임은 계속. 연습 모드는 자체 '정답 보기'라 미제공.
  const skipWord = useCallback(() => {
    if (completed || paused || cdPhase || practiceMode) return;
    if (livesRef.current <= 0) return; // 하트 소진 — 더 못 건너뜀
    const word = words[wordIndex];
    if (!word) return;
    const remain = livesRef.current - 1;
    livesRef.current = remain; setLives(remain);
    setCompleted(true); setEntered(word.tones); setCombo(0); setHasMistake(true); setShowWrong(false); setEndKind('complete');
    haptic(20); playSfx('wrong', 0.4); // 부드러운 '못 풀었어요' 큐(시간초과 버저보다 약하게)
    speakWord(word); // 올바른 발음 들려주기(학습 기회)
    if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
    addTimer(setTimeout(() => {
      if (!endlessMode && wordIndex + 1 >= words.length) setShowGameOverBeat(true); // 무한은 스트림이 길어 계속 진행
      else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
    }, 1200));
  }, [completed, paused, cdPhase, practiceMode, words, wordIndex, endlessMode, isPreview, studentToken]);

  // 연습 모드 '정답 보기' — 현재 단어 정답 공개(점수·콤보 없음, 무실수 아님 기록) 후 다음 단어로.
  const revealAnswer = useCallback(() => {
    if (completed || paused || cdPhase) return;
    const w = words[wordIndex];
    if (!w) return;
    setCompleted(true); setEntered(w.tones); setCombo(0); setHasMistake(true); setShowWrong(false); setEndKind('complete');
    speakWord(w);
    if (!isPreview) { recordWordResult(wordStatsRef.current, w.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
    setAnsweredCount((c) => c + 1);
    addTimer(setTimeout(() => {
      if (wordIndex + 1 >= words.length) setShowGameOverBeat(true);
      else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); }
    }, 1500));
  }, [completed, paused, cdPhase, words, wordIndex, isPreview, studentToken]);

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

  // 듣기 문제 여부 — 렌더에서 파생(미리 굴린 listenRollsRef + 현재 모드/audioOff). state 아님 → 새 단어 전환 시 flicker 없음.
  const wordIsListen = (!practiceMode && !endlessMode && !audioOff && !!listenRollsRef.current[wordIndex])
    || (isPreview && previewScreen === 'game' && qs('listen') === '1');

  const coach = (() => {
    if (timedOut) return { text: '시간 끝! 다시 도전해요', tone: 'danger' };
    if (completed && showWrong) return { text: '아쉬워요! 다음엔 맞혀봐요', tone: 'danger' }; // 무한 서든데스 오답 종료(강제 완료라 아래 성공 문구 방지)
    if (completed) return combo >= 2 ? { text: `콤보 ${combo}! 멋져요`, tone: 'success' } : { text: '정확해요! 잘했어요', tone: 'success' };
    if (showWrong) return { text: '앗! 다시 찾아봐', tone: 'danger' };
    if (wordIsListen && !audioOff) return { text: '잘 듣고 성조를 찾아봐요', tone: 'neutral' };
    if (practiceMode) return { text: '발음을 듣고 성조를 찾아봐요', tone: 'neutral' };
    if (endlessMode) return { text: '한 번 틀리면 끝! 모르면 건너뛰기', tone: 'neutral' }; // 서든데스 상시 안내
    return { text: '이건 무슨 성조일까?', tone: 'neutral' };
  })();

  const word = words[wordIndex];
  const avgMsForResult = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;

  if (error) return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TG.DANGER, fontSize: 14, background: TG.BG }}>정보를 불러오지 못했어요</div>;
  if (splash || !student) return <SplashScreen />; // 스플래시가 로딩 상태도 겸함

  // 온보딩 2단계 — 소개(tg_intro_seen: 스플래시 다음, 홈 앞)·튜토리얼(tg_onboarded: 홈 강제코치 다음, 게임 앞).
  const markIntroSeen = () => { try { localStorage.setItem('tg_intro_seen', '1'); } catch { /* noop */ } };
  const finishOnboard = () => { try { localStorage.setItem('tg_onboarded', '1'); } catch { /* noop */ } if (!isPreview) track('onboarding_done', { k: identity.kind }); setScreen('modeselect'); };
  // 홈에서 [게임시작] — 튜토리얼 미완이면 인게임 튜토리얼부터(소개는 홈 앞에서 이미 봄), 완료면 바로 모드선택.
  const goFromStart = () => {
    let done = false;
    try { done = !!localStorage.getItem('tg_onboarded'); } catch { /* noop */ }
    if (done) setScreen('modeselect'); else setScreen('tutorial');
  };

  // 단어 숙련도 뷰 데이터 (글로벌 stats + 풀 → 복습필요 리스트/마스터 수/복습단어)
  const masteryStats = (isPreview && previewScreen === 'mastery')
    ? (qs('empty') ? {} : PREVIEW_MASTERY.stats)
    : wordStatsRef.current;
  const masteryMap = (isPreview && previewScreen === 'mastery')
    ? PREVIEW_MASTERY.map
    : DIFFICULTIES.reduce((m, d) => { for (const w of (wordPoolByDiff[d.id] || [])) m[w.hanzi] = { ...w, diff: d.label }; return m; }, {});
  const masteryTones = (isPreview && previewScreen === 'mastery')
    ? (qs('empty') ? {} : PREVIEW_TONE)
    : toneStatsRef.current;
  const reviewRows = buildReviewList(masteryStats, masteryMap);
  // 등급 표시용 마스터 수 = max(현재 통계, 동기화 mc) — mc는 last-writer라 진짜 강등은 반영되고,
  // 트림된 동기화 사본(현재 통계가 부분집합인 기기)에서만 mc가 하한 역할(아티팩트 강등 방지).
  const masteredN = Math.max(masteredCount(masteryStats, masteryMap), isPreview ? 0 : loadMasteredSync(studentToken));
  // 최고 등급(내 등급 화면 '최고' 칩). [DEV] 미리보기 `?screen=mastery&peak=1` = 강등 상태(최고 4단계·현재 골드) 검수
  const tierPeakIdx = isPreview
    ? (qs('peak') ? 3 : 0)
    : loadTierPeak(studentToken);
  const reviewWords = reviewRows.slice(0, ROUND_LENGTH).map((r) => r.word);

  // 성취 표시 데이터(P3) — 시작/업적 화면에서만 localStorage 조회(게임 중 불필요). 미리보기는 샘플.
  const showStartData = screen === 'home' || screen === 'achievements';
  const startFreezes = !showStartData ? 0 : isPreview ? 1 : loadFreezes(studentToken);
  const startStreak = !showStartData ? 0 : isPreview ? 5 : effectiveCurrent(loadStreak(studentToken), dateKeyKST(), startFreezes);
  const startStreakLongest = !showStartData ? 0 : isPreview ? 12 : (loadStreak(studentToken)?.longest || 0);
  const startAchievements = !showStartData ? [] : isPreview ? ['first-play', 'score-1000', 'combo-10'] : loadAchievements(studentToken);
  // 성조별 레벨·상태 = **정확도 기준 통일**(2026-07-01, 사용자 결정: 강/약을 한눈에 → 정확도 낮으면 레벨/크기도 내려감).
  //  lv(1~5): 정확도 밴드(<.5=1·<.65=2·<.8=3·<.92=4·그이상=5). 게이지 prog=정확도 그대로. state는 lv에서 파생(1~2약·3중·4~5강).
  //  시도<3=데이터부족 → unknown(중립): lv1·게이지0·움직임 평온(약점 흔들 안 함). lv·게이지·크기·팔로워 모두 여기서 파생. 미리보기는 샘플.
  const PREVIEW_ACC = { 1: { acc: 0.48, attempts: 12 }, 2: { acc: 0.95, attempts: 20 }, 3: { acc: 0.72, attempts: 15 }, 4: { acc: 0, attempts: 1 }, 0: { acc: 0.84, attempts: 9 } };
  const toneLevels = {}, toneStatus = {};
  if (showStartData) {
    const src = isPreview ? PREVIEW_ACC : (() => { const ts = toneStatsRef.current || {}, o = {}; for (const t of [1, 2, 3, 4, 0]) { const e = ts[t]; o[t] = { acc: toneAccuracy(e), attempts: (e && e[1]) || 0 }; } return o; })();
    for (const t of [1, 2, 3, 4, 0]) {
      const { acc, attempts } = src[t];
      if (attempts < 3) { toneLevels[t] = { lv: 1, prog: 0 }; toneStatus[t] = { acc, attempts, state: 'unknown' }; continue; }
      const lv = acc < 0.5 ? 1 : acc < 0.65 ? 2 : acc < 0.8 ? 3 : acc < 0.92 ? 4 : 5;
      toneLevels[t] = { lv, prog: acc };
      toneStatus[t] = { acc, attempts, state: lv <= 2 ? 'weak' : lv === 3 ? 'mid' : 'strong' };
    }
  }
  // 첫 코치 안내가 가리킬 약점 성조(시도 3+ 중 정답률 최저). 없으면 null.
  const coachTone = !showStartData ? null : isPreview ? 1 : ((weakestTone(toneStatsRef.current || {}, 3) || {}).tone ?? null);

  // 화면별 본문 (카운트다운 오버레이/일시정지 모달은 아래에서 위에 덧댐)
  const exitGame = () => { if (identity.kind === 'student') navigate(`/personal/${identity.token}`); else window.location.href = '/'; };
  let content;
  if (isPreview && previewScreen === 'fx') { // [임시·DEV] 파티클 검수 랩 (?screen=fx) — 검수 후 이 분기 + _ParticleLab.jsx 삭제
    content = <ParticleLab onBack={exitGame} />;
  } else if (isPreview && previewScreen === 'sfxlab') { // [임시·DEV] 효과음/배경음 검수 랩 (?screen=sfxlab) — 검수 후 이 분기 + _SfxLab.jsx 삭제
    content = <SfxLab onBack={exitGame} />;
  } else if (screen === 'title') {
    content = <TitleScreen onStart={() => setHomeTx('in')} onClose={exitGame} />;
  } else if (screen === 'home') {
    content = <HomeScreen streak={startStreak} streakLongest={startStreakLongest} freezes={startFreezes} masteredN={masteredN} toneLevels={toneLevels}
      toneStatus={toneStatus} coachTone={coachTone} celebrateTone={celebrateTone}
      levelReveals={toneLevelChanges} onRevealsDone={() => setToneLevelChanges([])} revealHold={isPreview && previewScreen === 'tonelevel'}
      onPlay={goFromStart}
      onMastery={() => setScreen('mastery')} onAchievements={() => setScreen('achievements')}
      onHelp={() => { setIntroPage(0); setScreen('intro'); }}
      onLogin={identity.kind === 'guest' ? () => setScreen('login') : null}
      isMemberUser={identity.kind === 'member'} memberName={identity.memberUser?.nickname || null}
      onLogout={() => { logoutMember(); window.location.reload(); }} onExit={exitGame}
      studentToken={studentToken} onRefreshBest={() => setBest(headlineBest(studentToken))}
      homeReady={!homeTx}
      onDebugIntro={import.meta.env.DEV ? (() => {
        // 디버그 재시작 — 온보딩(소개·튜토리얼)+게임 코치마크(홈~결과) 플래그 초기화 후 소개부터: 전체 가이드 재현
        try {
          const m = JSON.parse(localStorage.getItem('tab_tips_v1') || '{}');
          ['game-home', 'game-mode', 'game-difficulty', 'game-play', 'game-result', 'game-skip-v1', 'game-hint-v1', 'game-practice'].forEach((k) => delete m[k]);
          localStorage.setItem('tab_tips_v1', JSON.stringify(m));
          localStorage.removeItem('tg_home_intro');
          localStorage.removeItem('tg_intro_seen');
          localStorage.removeItem('tg_onboarded');
        } catch { /* noop */ }
        setIntroPage(0); setScreen('intro');
      }) : undefined} />;
  } else if (screen === 'login') {
    content = <FigmaScreen><LoginScreen onBack={() => setScreen('home')} onSuccess={() => { track('login_success'); setTimeout(() => window.location.reload(), 500); }} /></FigmaScreen>;
  } else if (screen === 'mastery') {
    content = (
      <FigmaScreen>
        <MasteryScreen rows={reviewRows} masteredN={masteredN} toneStats={masteryTones} peakTierIdx={tierPeakIdx} onBack={() => setScreen('home')} onReview={() => startReview(reviewWords)} />
      </FigmaScreen>
    );
  } else if (screen === 'achievements') {
    content = (
      <FigmaScreen>
        <AchievementsScreen earned={startAchievements} onBack={() => setScreen('home')} onToast={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'intro') {
    content = (
      <FigmaScreen>
        <IntroScreen page={introPage}
          onNext={() => { if (introPage < 2) setIntroPage(introPage + 1); else { markIntroSeen(); setScreen('home'); } }}
          onSkip={() => { markIntroSeen(); setScreen('home'); }} />
      </FigmaScreen>
    );
  } else if (screen === 'tutorial') {
    content = <FigmaScreen><TutorialScreen onDone={finishOnboard} /></FigmaScreen>;
  } else if (screen === 'modeselect') {
    content = (
      <FigmaScreen>
        <ModeScreen endlessUnlocked={isPreview || isEndlessUnlocked(studentToken)} endlessBest={loadEndlessBest(studentToken)?.bestScore || 0} reviewCount={reviewWords.length}
          onDifficulty={() => { playSfx('button'); setDifficultyTarget('normal'); setScreen('difficulty'); }}
          onTheme={() => { playSfx('button'); setScreen('theme'); }}
          onEndless={() => { playSfx('button'); startEndless(); }}
          onPractice={() => { playSfx('button'); setSuggestPractice(false); setDifficultyTarget('practice'); setScreen('difficulty'); }}
          onReview={() => { playSfx('button'); startReview(reviewWords); }}
          highlightPractice={suggestPractice || (isPreview && qs('nudge') === '1')} onHighlightDone={() => setSuggestPractice(false)}
          onBack={() => setScreen('home')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'difficulty') {
    content = (
      <FigmaScreen>
        <DifficultyScreen selected={selectedDifficulty} studentToken={studentToken} onSelect={setSelectedDifficulty} onStart={difficultyTarget === 'practice' ? startPractice : startGame} onBack={() => setScreen('modeselect')} onLocked={showToast} forPractice={difficultyTarget === 'practice'} />
      </FigmaScreen>
    );
  } else if (screen === 'theme') {
    content = (
      <FigmaScreen>
        <ThemeScreen themes={THEMES} studentToken={studentToken}
          counts={THEMES.reduce((m, t) => { m[t.id] = (wordPoolByTheme[t.id] || []).length; return m; }, {})}
          onStart={startTheme} onBack={() => setScreen('modeselect')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'end') {
    content = (
      <FigmaScreen>
        <ResultScreen score={score} maxCombo={maxCombo} avgMs={avgMsForResult}
          isNewBest={(reviewMode || practiceMode) ? false : isNewBest} previousBest={(reviewMode || practiceMode) ? 0 : previousBest}
          suggestPractice={(suggestPractice && !practiceMode && !reviewMode && !endlessMode && !themeMode && selectedDifficulty.id === 'easy') || (isPreview && previewScreen === 'end' && qs('suggest') === '1')}
          coachReady={!showGameOverBeat && !rankUp && !modeUnlock && celebrationQueue.length === 0} /* 결과 코치+연습유도 둘 다 이 게이트 뒤에서만 */
          practice={practiceMode} endless={endlessMode} endKind={endKind}
          onRetry={practiceMode ? () => startPractice(selectedDifficulty) : endlessMode ? () => startEndless() : reviewMode ? () => startReview(reviewWords) : themeMode ? () => startTheme(selectedTheme) : () => startGame(selectedDifficulty)}
          onChangeDiff={endlessMode ? () => setScreen('modeselect') : reviewMode ? () => setScreen('mastery') : practiceMode ? () => { setDifficultyTarget('practice'); setScreen('difficulty'); } : themeMode ? () => setScreen('theme') : () => setScreen('difficulty')}
          onModeSelect={!endlessMode ? () => setScreen('modeselect') : undefined}
          retryLabel={practiceMode ? '한 번 더 연습' : reviewMode ? '한 번 더 복습' : undefined}
          changeLabel={endlessMode ? '모드 선택으로' : reviewMode ? '숙련도로 돌아가기' : themeMode ? '테마 바꾸기' : '난이도 바꾸기'} />
      </FigmaScreen>
    );
  } else { // game
    content = (
      <FigmaScreen>
        {word && (
          <GameScreen word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut}
            wordIndex={wordIndex} wordsLen={words.length} wordTimeLimit={wordTimeLimit} gaugeOffsetMs={gaugeOffsetMs} lowTime={lowTime} paused={paused || !!cdPhase || suddenIntro} endless={endlessMode || (isPreview && qs('endless') === '1')} lives={lives} showHearts={!practiceMode} showSudden={suddenIntro} runId={runId} recordToBeat={recordToBeat}
            combo={combo} comboFlash={comboFlash} floatScore={floatScore} score={score} coachText={coach.text}
            onTone={handleTone} wrongBtn={wrongBtn} wrongShakeKey={wrongShakeKey} onPause={() => setPaused(true)} playReveal={!cdPhase}
            practice={practiceMode} listen={wordIsListen} audioOff={audioOff}
            onReplay={() => word && speakWord(word)} onCantHear={() => { audioOffRef.current = true; setAudioOff(true); }}
            onHint={practiceMode ? undefined : () => { if (!word) return; speakWord(word); if (!hasMistake) { setHasMistake(true); setCombo(0); } }} hintUsed={hasMistake}
            onSkip={practiceMode ? undefined : skipWord}
            onSpeak={() => word && speakWord(word)} onReveal={revealAnswer}
            demoFx={isPreview ? qs('fx') : null} />
        )}
      </FigmaScreen>
    );
  }

  // 카운트다운 오버레이 — 직전 화면 위로 슬라이드 인 → 게임 위로 슬라이드 아웃 (레이어드 커버/리빌)
  const cdStyle = cdPhase === 'in' ? { animation: 'tg-cd-in .42s cubic-bezier(.4,0,.2,1) forwards' }
    : cdPhase === 'out' ? { animation: 'tg-cd-out .42s cubic-bezier(.4,0,.2,1) forwards' }
    : { transform: 'translateX(0)' };
  // 타이틀→홈 전환 오버레이 슬라이드(웨이브). hold=정지(팁 노출)
  const homeTxStyle = homeTx === 'in' ? { animation: 'tg-cd-in .42s cubic-bezier(.4,0,.2,1) forwards' }
    : homeTx === 'out' ? { animation: 'tg-cd-out .42s cubic-bezier(.4,0,.2,1) forwards' }
    : { transform: 'translateX(0)' };

  return (
    <>
      {content}
      {homeTx && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...homeTxStyle }}>
          {/* 게임 카운트다운과 동일한 물결·배경색(#f96c6e) */}
          <CdWaveEdge side="left" />
          <CdWaveEdge side="right" />
          <FigmaScreen bg="#f96c6e"><LoadingTip /></FigmaScreen>
        </div>
      )}
      {cdPhase && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...cdStyle }}>
          {/* 좌우 물결 가장자리 — 컨테이너 바깥쪽이라 가운데 정렬 시엔 화면 밖(비표시), 슬라이드 중에만 보임 */}
          <CdWaveEdge side="left" />
          <CdWaveEdge side="right" />
          <FigmaScreen bg="#f96c6e"><CountdownVisual n={cdNum} difficulty={themeMode ? selectedTheme : selectedDifficulty} /></FigmaScreen>
        </div>
      )}
      {paused && (
        <PauseModal score={score} combo={combo} onResume={() => setPaused(false)}
          onRestart={() => { setPaused(false); if (endlessMode) startEndless(); else if (reviewMode) startReview(reviewWords); else if (practiceMode) startPractice(selectedDifficulty); else if (themeMode) startTheme(selectedTheme); else startGame(selectedDifficulty); }}
          onQuit={() => { setPaused(false); setReviewMode(false); setEndlessMode(false); setPracticeMode(false); setThemeMode(false); setScreen('home'); }} />
      )}
      {toast && <GameToast key={toast.key} msg={toast.msg} />}
      {/* 게임오버 비트 — 게임 화면 위 오버레이(결과화면 직전). ~1.3초 후 결과('end')로 진행 */}
      {showGameOverBeat && (
        <GameOverBeat endKind={endKind}
          hold={isPreview && previewScreen === 'gameover'}
          onDone={() => {
            setShowGameOverBeat(false);
            const now = currentMastered();
            const prevN = masteredAtStartRef.current;
            // 새 마스터=진행 연출 / 등급(티어)이 실제로 내려간 판=하락 연출(RankUpReveal down 분기, 담백).
            // 마스터 수만 줄고 티어는 그대로면 조용히 결과로(잔소리 방지).
            if (!isPreview && (now > prevN || earTier(now).idx < earTier(prevN).idx)) setRankUp({ prev: prevN, now });
            else setScreen('end');
          }} />
      )}
      {/* 등급 진행/하락 연출 — 비트 다음·결과 전(새 마스터 또는 티어 하락 시). 미리보기 ?screen=rankup / ?screen=rankdown */}
      {(rankUp || (isPreview && (previewScreen === 'rankup' || previewScreen === 'rankdown'))) && (
        <RankUpReveal
          prev={rankUp ? rankUp.prev : (previewScreen === 'rankdown' ? 12 : 9)}
          now={rankUp ? rankUp.now : (previewScreen === 'rankdown' ? 8 : 12)}
          peakIdx={isPreview ? (previewScreen === 'rankdown' ? 3 : 0) : tierPeakIdx}
          hold={isPreview && (previewScreen === 'rankup' || previewScreen === 'rankdown')}
          onDone={() => { setRankUp(null); setScreen('end'); }} />
      )}
      {/* [DEV] 설정 모달 미리보기(?screen=settings) — 머지 전 백도어 제거 대상 */}
      {isPreview && previewScreen === 'settings' && <SettingsModal onClose={() => {}} />}
      {/* 모드 잠금해제 연출 — 결과 위, 업적보다 먼저. 미리보기 ?screen=modeunlock */}
      {modeUnlock && (
        <ModeUnlockReveal unlock={modeUnlock} hold={isPreview && previewScreen === 'modeunlock'}
          onDone={() => setModeUnlock(null)} />
      )}
      {/* 업적 획득 축하 오버레이(P4) — 큐 맨 앞 1장, 탭/CTA로 다음. 모드해제 연출 끝난 뒤 표시 */}
      {celebrationQueue.length > 0 && !modeUnlock && (
        <CelebrationOverlay achievement={celebrationQueue[0]} remaining={celebrationQueue.length - 1}
          onNext={() => setCelebrationQueue((q) => q.slice(1))} />
      )}
    </>
  );
}
