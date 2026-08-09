// 매일매일 성조키우기(구 성조 빨리 찾기) 미니게임 — 상태머신/오케스트레이션.
// 학생앱 공개 라우트(`/personal/:studentToken/game/tone`) + 게스트 독립 진입(`/game/tone`)에서 진입.
// 플로우: 스플래시 → 시작 → (소개·튜토리얼) → 모드선택 → 난이도/무한 → 카운트다운 → 게임 → 결과.
// 화면 컴포넌트는 game/screens/* 로 분리, 순수 로직은 game/gameLogic.js, 디자인/저장은 game/* 모듈.
// 디자인 사양: 메모리 tone_game_redesign.md
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { App } from 'antd';
import { fetchToneWords, fetchGameMe, takeTokenFromHash } from '../api/gameApi.js';
import { track } from '../game/gameAnalytics.js';
import {
  resolveIdentity,
  pullMemberData, pushMemberData, loginMember, mergeGuestIntoMember, logoutMember,
  getMemberSession, loadMasteredSync, storeMasteredSync,
} from '../game/gameStore.js';
import { loadTierPeak } from '../game/earProfile.js';
import { gameXpGain, loadXp, saveXp, addXp, seedXpIfMissing, loadRank, saveRank, seedRankIfMissing, examPassed, EXAM_QUESTIONS } from '../game/gameXp.js';
import { ROUND_LENGTH, DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';
import { TG, HOME, BG_MESH, DIFF_COLORS, ensureGameFonts, haptic, shuffle, getTimeLimitForCombo, loadBest, saveBest, isMeaningHidden, isPinyinHidden } from '../game/tgTokens.js';
import {
  loadWordStats, saveWordStats, recordWordResult,
  buildReviewList, masteredCount, buildRoundWords,
} from '../game/tgWordStats.js';
import { recordTone, loadToneStats, saveToneStats, weakestTone, toneAccuracy } from '../game/toneStats.js';
import { findLianyin, findToneSandhi } from '../game/lianyin.js';
import { recordPlay, loadStreak, effectiveCurrent, dateKeyKST, loadFreezes } from '../game/streak.js';
import { syncAchievements, loadAchievements, achievementById, loadReviewMastered, addReviewMastered, markAchievementsSeen, hasUnseenAchievements } from '../game/achievements.js';
import { loadGuestNickname, saveGuestNickname } from '../game/nickname.js';
import { initTts, speakWord, preloadTts } from '../game/tgTts.js';
import { initSfx, play as playSfx } from '../game/tgSfx.js';
import { initBgm, startBgm, stopBgm } from '../game/tgBgm.js';
import {
  getEndlessTimeLimit, computeScore, resolveEndOutcome,
  loadEndlessBest, saveEndlessBest, headlineBest, isEndlessUnlocked,
  ENDLESS_UNLOCK_REVEAL, STAGES, stageRoundPool, saveStageScore, unlockedTrainingPool, isStageUnlocked,
  stageScoreOf, stageOutcome, migrateRankForBoss, isTierCleared, perfectStageCount, JUDGE_RATIO, rankUpperBound, saveBossPeak, BOSSES, clearOrphanThemeBests,
} from '../game/gameLogic.js';
import { FigmaScreen, CountdownVisual, TxLayer, GameStage, GameToast, BeatDim } from '../game/screens/shared.jsx';
import { SplashScreen } from '../game/screens/SplashScreen.jsx';
import { TitleScreen } from '../game/screens/TitleScreen.jsx';
import { LoadingTip } from '../game/screens/LoadingScreen.jsx';
import { HomeScreen } from '../game/screens/HomeScreen.jsx';
import { LoginScreen } from '../game/screens/LoginScreen.jsx';
import { NicknameScreen } from '../game/screens/NicknameScreen.jsx';
import { NicknameEditModal } from '../game/screens/NicknameEditModal.jsx';
import { ModeScreen } from '../game/screens/ModeScreen.jsx';
import { initGameAds, onRoundEnd } from '../game/gameAds.js'; // 웹 전면 광고(기본 OFF·게임 전용)
import { ParticleLab } from '../game/screens/_ParticleLab.jsx'; // [임시·DEV] 파티클 검수용 — 검수 후 삭제
import { SfxLab } from '../game/screens/_SfxLab.jsx'; // [임시·DEV] 효과음/배경음 검수용 — 검수 후 삭제
import { DifficultyScreen } from '../game/screens/DifficultyScreen.jsx';
import { ThemeScreen } from '../game/screens/ThemeScreen.jsx';
import { GameScreen } from '../game/screens/GameScreen.jsx';
import { ResultScreen, ExamResultScreen } from '../game/screens/ResultScreen.jsx';
import { MasteryScreen } from '../game/screens/MasteryScreen.jsx';
import { AchievementsScreen } from '../game/screens/AchievementsScreen.jsx';
import { PlayScreen } from '../game/screens/PlayScreen.jsx';
import { LinkHubScreen } from '../game/screens/LinkHubScreen.jsx';
import { CelebrationOverlay } from '../game/screens/CelebrationOverlay.jsx';
import { GameOverBeat } from '../game/screens/GameOverBeat.jsx';
import { NewRecordBeat } from '../game/screens/NewRecordBeat.jsx';
import { RankUpReveal } from '../game/screens/RankUpReveal.jsx';
import { ExamIntroReveal } from '../game/screens/ExamIntroReveal.jsx';
import { TutorialDoneBeat } from '../game/screens/TutorialDoneBeat.jsx';
import { XpGainReveal } from '../game/screens/XpGainReveal.jsx';
import { ModeUnlockReveal } from '../game/screens/ModeUnlockReveal.jsx';

// [DEV] 미리보기 쿼리 단일 창구 — ?screen=·endless=1·practice=1 등 백도어 파라미터. 렌더마다 URLSearchParams를
// 새로 만들던 11곳을 대체(생성 반복 제거 + 백도어 파라미터 목록이 여기서 한눈에). search는 로드 시 고정(SPA).
const QS = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const qs = (name) => QS.get(name);

// 초급 저조 판정 = 점수 500 이하. 유도는 '2연속 저조'일 때만(한 번 낮은 건 무시) + 쿨다운(매번 안 뜨게).
const LOW_EASY_SCORE = 500;       // 초급 노멀 런 점수가 이 이하면 '저조'
const LOW_EASY_STREAK = 2;        // 저조가 이만큼 '연속'이면 트레이닝 유도
// 트레이닝 유도 빈도 제한 — 한 번 유도하면 쿨다운(계속 고전해도 매번 안 뜨게). 로그인 넛지와 동일 패턴.
const TRAIN_NUDGE_COOLDOWN = 3 * 24 * 60 * 60 * 1000; // 3일
function trainNudgeAllowed() { try { const t = parseInt(localStorage.getItem('tg_train_nudge') || '0', 10); return !(t && Date.now() - t < TRAIN_NUDGE_COOLDOWN); } catch { return true; } }
function markTrainNudge() { try { localStorage.setItem('tg_train_nudge', String(Date.now())); } catch { /* noop */ } }

// 성조 레벨 밴드(정확도→1~5) — 스냅샷 파생(deriveToneLevels)과 홈 렌더가 공유하는 단일 규칙(중복 하드코딩 금지).
const toneLevelBand = (acc) => (acc < 0.5 ? 1 : acc < 0.65 ? 2 : acc < 0.8 ? 3 : acc < 0.92 ? 4 : 5);
// 성조별 레벨(최근 가중 정확도 EMA 기반) 파생 — 런 시작/종료 스냅샷 비교용.
// toneAccuracy = ema 우선(누적 폴백) — 시도가 쌓여도 최근 성과가 레벨에 반영되게(고착 방지).
function deriveToneLevels(toneStats) {
  const ts = toneStats || {}; const out = {};
  for (const t of [1, 2, 3, 4, 0]) {
    const e = ts[t]; const attempts = (e && e[1]) || 0;
    out[t] = attempts < 3 ? 1 : toneLevelBand(toneAccuracy(e));
  }
  return out;
}

// 업적 화면 진행도 스냅샷 — 저장된 베스트/통계에서 집계(종료 이펙트 스냅샷과 같은 필드, 런 무관 저장값만).
// 난이도·테마·무한 전 기록을 DIFFICULTIES/THEMES에서 파생(하드코딩 없음). 각 업적 progress(snapshot)이 이 필드를 읽음.
function buildAchSnapshot(token, masteredN, toneStats, streakLongest) {
  const bestByDiff = {}; let playCount = 0; let maxComboEver = 0;
  for (const d of DIFFICULTIES) { const b = loadBest(token, d.gameKey); bestByDiff[d.id] = b?.bestScore || 0; playCount += b?.playCount || 0; maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0); }
  const themeRecs = THEMES.map((t) => loadBest(token, t.gameKey));
  for (const b of themeRecs) { playCount += b?.playCount || 0; maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0); }
  const eb = loadEndlessBest(token); const endlessBest = eb?.bestScore || 0;
  playCount += eb?.playCount || 0; maxComboEver = Math.max(maxComboEver, eb?.bestMaxCombo || 0);
  // 승급(rank)·완벽런 스테이지 수 — 2026-08-08 신규 업적(실전/고수 승급, 완벽한 한 판)의 근거.
  //  둘 다 이미 저장돼 있는 값이라 추적 로직 추가 없이 읽기만 한다.
  const perfectStages = DIFFICULTIES.reduce((n, d) => n + perfectStageCount(token, d.id), 0);
  return {
    playCount, maxComboEver, bestByDiff, endlessBest, masteredCount: masteredN,
    bestScoreAny: Math.max(...Object.values(bestByDiff), endlessBest, ...themeRecs.map((b) => b?.bestScore || 0)),
    streakLongest: streakLongest || 0, toneStats: toneStats || {}, reviewMastered: loadReviewMastered(token),
    rank: loadRank(token) || 0, perfectStages,
  };
}
import { IntroScreen } from '../game/screens/IntroScreen.jsx';
import { TutorialScreen } from '../game/screens/TutorialScreen.jsx';
import { PauseModal } from '../game/screens/PauseModal.jsx';
import { HelpStartModal, TrainingNudgeModal, ExamPromptModal } from '../game/screens/gameModals.jsx';

// 미리보기 모드(?screen=game)에서 게임 화면 렌더용 샘플 단어 (DEV 검수 전용)
const PREVIEW_WORDS = [
  { hanzi: '老师', pinyin: ['lǎo', 'shī'], tones: [3, 1], meaning: '선생님', audioUrl: '/game/tts/laoshi_31.mp3' },
  { hanzi: '妈妈', pinyin: ['mā', 'ma'], tones: [1, 0], meaning: '엄마', audioUrl: '/game/tts/mama_10.mp3' }, // 경성 포함 — 그리기 모드 자동통과 검수용
  { hanzi: '咖啡', pinyin: ['kā', 'fēi'], tones: [1, 1], meaning: '커피', audioUrl: '/game/tts/kafei_11.mp3' },
];

// 미리보기(?screen=game&lianyin=1)용 — 연음(3성+2성) 각인 마크 검수 전용
const PREVIEW_LIANYIN = [
  { hanzi: '美国', pinyin: ['měi', 'guó'], tones: [3, 2], meaning: '미국' },
  { hanzi: '可能', pinyin: ['kě', 'néng'], tones: [3, 2], meaning: '아마도' },
];

// 미리보기(?screen=game&sandhi=1)용 — 3성 변조(3+3 → 앞 3성이 발음상 2성) 모프 연출 검수 전용
const PREVIEW_SANDHI = [
  { hanzi: '你好', pinyin: ['nǐ', 'hǎo'], tones: [3, 3], meaning: '안녕' },
  { hanzi: '老虎', pinyin: ['lǎo', 'hǔ'], tones: [3, 3], meaning: '호랑이' },
  { hanzi: '水果', pinyin: ['shuǐ', 'guǒ'], tones: [3, 3], meaning: '과일' },
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
  // 정체성 추상화: 게스트(로컬UUID·독립진입)/회원(소셜)/프리뷰를 동일 처리. 로컬 저장키=identity.id. (학생·Notion 분리, 2026-07-12)
  const identity = useMemo(() => resolveIdentity(routeToken), [routeToken]);
  const studentToken = identity.id; // 로컬 저장 키(게스트ID/회원ID/'preview'). 게임은 Notion 분리 — 서버 베스트 호출 없음.
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
    : previewScreen === 'tonelevel' ? 'home'   // 성조 레벨 스포트라이트는 홈에서 재생
    : isPreview ? previewScreen                 // 그 외 미리보기는 지정 화면('gameover' 등)
    : realStart;                               // 실제 진입: 첫 방문=intro, 이후=title

  const [screen, setScreen] = useState(initialScreen); // start | difficulty | game | end | intro | tutorial
  const [paused, setPaused] = useState(false);
  const [words, setWords] = useState(() => (
    isPreview && qs('sandhi') === '1' ? PREVIEW_SANDHI
      : isPreview && qs('lianyin') === '1' ? PREVIEW_LIANYIN
      : isPreview && (previewScreen === 'game' || previewScreen === 'gameover') ? PREVIEW_WORDS : []));
  const [cdPhase, setCdPhase] = useState(cdPreview ? 'run' : null); // 카운트다운 오버레이 단계: null|'in'|'run'|'out'
  const [cdNum, setCdNum] = useState(3);
  const [homeTx, setHomeTx] = useState(null); // '오늘의 팁' 웨이브 전환: null|'in'(슬라이드 인)|'hold'(팁 강제노출)|'out'(슬라이드 아웃). 타이틀→홈 + 인게임→아웃게임 이탈 공용
  const [txTarget, setTxTarget] = useState('home'); // 전환 도착 화면(홈·모드선택·난이도·테마 등). homeTx 'in'이 이 화면으로 setScreen
  const [wordIndex, setWordIndex] = useState(0);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [entered, setEntered] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
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
  const [rankUp, setRankUp] = useState(null); // 등급 상승 연출 {prevIdx, nowIdx} — XP 임계 넘겨 승급 시 비트 다음·결과 전
  const masteredAtStartRef = useRef(0); // 판 시작 시 마스터 단어 수 스냅샷 — 종료 시 증가분 판정
  const pullOkRef = useRef(false);      // 회원 서버 pull 성공 여부 — pull 성공 전엔 push 보류(빈/구 로컬로 서버 덮어쓰기 방지, 2026-07-21)

  const wordTimeLimitRef = useRef(7000);
  const wordElapsedRef = useRef(0); // 현재 단어의 누적 '진행' 시간(일시정지·카운트다운 제외)
  const segStartRef = useRef(0);    // 현재 진행 구간 시작 시각
  const livesRef = useRef(3);        // lives 동기 읽기용(setState 비동기·연타 stale 방지)
  const completedRef = useRef(false); // completed 동기 읽기용 — 같은 tick 더블탭(멀티터치·연타) 재진입 방지. setState는 비동기라 stale.
  const enteredRef = useRef([]);      // entered 동기 읽기용 — 더블탭 시 currentSyl/entered desync·점수 이중가산 방지(입력마다 한 슬롯만 전진)
  const hintUsedRef = useRef(false);  // 이 단어에서 발음 힌트(보기=발음힌트 / 연습=발음듣기)를 써서 정답 발음을 들었는지 — 들었으면 성조 정확도(recordTone) 미반영(단어별, 전진 시 리셋). 듣기 문제의 정당한 청취는 제외.
  const [totalAnswerTime, setTotalAnswerTime] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [practiceKind, setPracticeKind] = useState('training'); // practice 엔진의 용도: 'training'(모드선택) | 'review'(오답 노트)

  const [selectedDifficulty, setSelectedDifficulty] = useState(STAGES[0]); // 스테이지 객체(티어+밴드) — 난이도처럼 gameKey·timeMultiplier 보유
  const [wordPoolByDiff, setWordPoolByDiff] = useState({});
  const wordPoolByDiffRef = useRef({}); wordPoolByDiffRef.current = wordPoolByDiff; // 배치테스트 지연 콜백(addPausable)이 stale 클로저로 옛 풀을 읽어 엉뚱한 난이도가 나오는 것 방지 — 항상 최신 풀
  // 런 모드 단일 enum — 'normal'(난이도)|'practice'|'review'|'endless'|'theme'.
  // (기존 4-불리언 플래그가 시작/종료/그만두기마다 수동 동기화 필요 → 한 곳 빠뜨리면 기록 오염. enum 단일화로 원천 차단)
  // 미리보기(?screen=game&endless=1 / &practice=1)는 state까지 켜서 서든데스·코치마크 검수 가능(DEV 한정).
  const [gameMode, setGameMode] = useState(() => (
    isPreview && previewScreen === 'game' && qs('endless') === '1' ? 'endless'
      : isPreview && previewScreen === 'game' && qs('practice') === '1' ? 'practice' : 'normal'));
  const endlessMode = gameMode === 'endless';   // 무한(랜덤·가속·서든데스)
  const practiceMode = gameMode === 'practice'; // 트레이닝(열린 스테이지 범위·약점가중·시간 무제한·기록 미반영)
  const themeMode = gameMode === 'theme';       // 테마(드라마·여행 등) — 종료처리는 normal과 동일(gameKey만 테마 것)
  const examMode = gameMode === 'exam'; // 승급시험 UX(재시도 없음·타이머·정답 카운트·showGameOverBeat 종료판정)
  const examModeRef = useRef(false); examModeRef.current = examMode; // handleTone 등 useCallback 클로저에서 최신 모드 참조
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [wordPoolByTheme, setWordPoolByTheme] = useState({});
  // 보조바퀴(뜻·병음 숨김) 컨텍스트 키 — 스테이지/보스/무한/트레이닝/테마별 저장. 단어카드·인게임 설정이 이 값을 사용.
  const crutchCtx = gameMode === 'exam' ? `${selectedDifficulty?.id}-boss`
    : gameMode === 'endless' ? 'endless'
    : gameMode === 'practice' ? 'training'
    : gameMode === 'theme' ? `th-${selectedTheme?.id}`
    : (selectedDifficulty?.id || STAGES[0].id); // normal = 스테이지 id(easy-1 등)
  const hideMeaning = isMeaningHidden(crutchCtx);
  const hidePinyin = isPinyinHidden(crutchCtx);
  const wordStatsRef = useRef({});  // 단어별 숙련도 글로벌(localStorage 동기화)
  const toneStatsRef = useRef({});  // 성조별 정답률(1·2·3·4·경성) — 성조 레이더/약점 진단(P1)
  const toneSnapRef = useRef(null); // 런 시작 시 성조별 정답수 스냅샷 → 홈 복귀 시 성장 축하 연출(D)
  const toneLevelSnapRef = useRef(null); // 런 시작 성조별 레벨 스냅샷 → 종료 시 비교(레벨 업/다운 연출)
  const [celebrateTone, setCelebrateTone] = useState(null); // 홈에서 성장 축하할 성조(점프+반짝)
  // 이번 판 성조 레벨 변화 [{tone, from, to, dir}] — 홈에서 하나씩 스포트라이트. 미리보기 ?screen=tonelevel
  const [toneLevelChanges, setToneLevelChanges] = useState(() => (isPreview && previewScreen === 'tonelevel'
    ? [{ tone: 2, from: 3, to: 4, dir: 'up' }, { tone: 3, from: 3, to: 2, dir: 'down' }] : []));
  // 모드 잠금해제 연출 {icon,label,fill,edge} — 결과 위 오버레이. 미리보기 ?screen=modeunlock
  const [modeUnlock, setModeUnlock] = useState(() => (isPreview && previewScreen === 'modeunlock'
    ? ENDLESS_UNLOCK_REVEAL : null));
  // 승급시험 진입 연출 {tier,tierLabel} — 시험 런이 라이브(카운트다운 후)가 되면 인게임 오버레이로 노출, 탭/자동으로 첫 문제 시작. 미리보기 ?screen=examintro&tier=easy|normal|hard
  const [examIntro, setExamIntro] = useState(() => {
    if (!(isPreview && previewScreen === 'examintro')) return null;
    const d = DIFFICULTIES.find((x) => x.id === (qs('tier') || 'easy')) || DIFFICULTIES[0];
    const tgt = DIFFICULTIES[DIFFICULTIES.indexOf(d) + 1] || d; // 표시=다음 급 승급시험
    return { tier: tgt.id, tierLabel: tgt.label };
  });
  const endHandledRef = useRef(false); // 결과화면 1회 처리 가드(다시하기로 score 리셋 시 재실행·중복 사운드 방지)
  const beatSfxRef = useRef(false);   // 신기록 비트가 축하 효과음을 이미 울렸는지 — end-effect의 중복 재생 방지(런마다 resetRunState서 리셋)
  const [suggestPractice, setSuggestPractice] = useState(false); // 초급 2연속 저조 → 결과화면 옵션 CTA + 모드선택 트레이닝 카드 하이라이트
  const easyLowStreakRef = useRef(0); // 초급 노멀 연속 저조 횟수(500 넘기면 리셋). 세션 한정.
  // 듣기 문제 여부 = 라운드 시작 시 단어별로 미리 결정(listenRollsRef). 렌더에서 파생 → 예전 state 방식의
  // '새 단어 렌더 후 effect가 뒤늦게 set' 프레임(듣기→일반 순간전환 flicker) 제거. [i>0 && rand<0.35]
  const listenRollsRef = useRef([]);
  // 그리기 문제 여부 = 라운드 시작 시 단어별로 미리 결정(drawRollsRef). 듣기와 상호배타·더 드물게(≈16%).
  // '그려서 답하기' — 성조버튼 대신 그리기 패드로 입력, classifyStroke가 판별해 handleTone에 투입.
  const drawRollsRef = useRef([]);
  const [audioOff, setAudioOff] = useState(false); // '지금은 못 들어요' — 그 판 한정 듣기 문제 미출제(한자 공개·자동재생 중지)
  const audioOffRef = useRef(false); // word-start effect서 최신값 동기 읽기
  const [runId, setRunId] = useState(0); // 게임 시작 시마다 증가 — 같은 단어1로 재시작해도 타이머·게이지 리셋용
  const [splash, setSplash] = useState(isPreview ? previewScreen === 'splash' : true); // 진입 스플래시(실제 진입만, 미리보기는 ?screen=splash)
  const [toast, setToast] = useState(null); // 중앙 토스트(잠금 안내 등)
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg, kind = 'lock') => {
    if (!msg) return;
    setToast({ msg, kind, key: Date.now() });
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
  const [tutorialFromHelp, setTutorialFromHelp] = useState(false); // 메뉴 '게임 방법'으로 튜토리얼 진입 — 완료 시 온보딩(모드선택) 대신 홈 복귀·플래그 미변경
  const [helpOpen, setHelpOpen] = useState(false); // 메뉴 '게임 방법' 확인 팝업
  // 소셜 로그인 직후 닉네임 설정 게이트 — {token}. 닉네임 없을 때만 홈 대신 이 화면을 띄운다.
  const [savingNick, setSavingNick] = useState(false);
  // 온보딩 닉네임 화면의 프리필 — 화면 진입 때 랜덤으로 1회 고정(리렌더마다 바뀌지 않게). 저장된 이름이 있으면 그걸 쓴다.
  const onboardNickRef = useRef(null);
  // 이번 런이 **튜토리얼 직후 입문 1**인가 — 이 판은 '인게임 튜토리얼의 연장선'이라 성조 정확도에 반영하지 않는다
  //  (2026-08-08 사용자). resetRunState가 매 런 false로 내리고, afterTutorial만 다시 세운다.
  const onboardingRunRef = useRef(false);
  const onboardingRunPendingRef = useRef(false); // 완료 비트를 거쳐 시작될 런이 그 온보딩 판인지(비트 onDone에서 소비)
  // 튜토리얼 → 첫 실전 사이의 완료 비트 {stageLabel,total}|null. 미리보기 ?screen=tutorialdone
  const [tutorialDone, setTutorialDone] = useState(() => (
    isPreview && previewScreen === 'tutorialdone' ? { stageLabel: STAGES[0].label, total: ROUND_LENGTH } : null));
  const finishOnboardRef = useRef(() => {});
  // 회원 표시 닉네임 — 세션값으로 시작하고, 홈 메뉴 '닉네임 변경'에서 즉시 갱신(reload 없이 반영).
  const [memberNick, setMemberNick] = useState(identity.memberUser?.nickname || null);
  // 게스트 표시 닉네임 — 로컬에 한 번 뽑아 저장(수정 불가, 로그인하면 회원 닉네임으로 대체).
  const [guestNick, setGuestNick] = useState(() => (identity.kind === 'guest' ? loadGuestNickname() : null));
  // 누적 경험치(등급 산정) — 최초 1회 마이그레이션 시딩(현재 마스터/최고 등급 보존 → 0으로 리셋 방지), 이후 저장값.
  const [xp, setXp] = useState(() => (isPreview
    ? Number(qs('xp') || 0)
    : seedXpIfMissing(studentToken, loadTierPeak(studentToken))));
  // 등급(rank) — XP와 분리(승급 시험·배치로만 오름). 키 없으면 0 시딩, 이후 보스/배치로만.
  const [rank, setRank] = useState(() => {
    if (isPreview) return (qs('rank') != null ? Number(qs('rank')) : 0);
    // 보스 사다리: 기존 rank에 급클리어 승계를 1회 반영(개편 전 연 급 유지). 이후엔 보스로만 오름.
    const seeded = seedRankIfMissing(studentToken);
    const migrated = migrateRankForBoss(studentToken, seeded);
    // ★rank는 정당히 통과한 급 수(rankUpperBound=스테이지클리어 or 승급시험통과)를 넘을 수 없음 — 안 깬·안 통과한 급은 못 염.
    //  구 seedRankIfMissing이 rank를 'XP 등급'으로 시딩해 부풀리던 버그 자가치유(2026-07-20). 배치고사 통과분은 bossPeak로 보존(2026-07-22).
    const corrected = Math.min(migrated, rankUpperBound(studentToken));
    if (corrected !== seeded) saveRank(studentToken, corrected);
    return corrected;
  });
  const [examResult, setExamResult] = useState(null); // 승급 시험 결과 {correct,total,passed}
  // 승급시험 유도 모달 {tierIdx}|null — 고득점(완벽 3별 2스테이지↑) + 다음 급 미개방(rank<=tierIdx) 시 결과화면 위로. 급별 1회. 프리뷰 ?examprompt=1
  const [examPrompt, setExamPrompt] = useState(() => (isPreview && qs('examprompt') === '1') ? { tierIdx: qs('tier') === 'normal' ? 1 : 0 } : null);
  const [xpGain, setXpGain] = useState(null); // 이번 판 XP 획득 연출용 {gained, prevXp, newXp} (결과화면)
  const examCorrectRef = useRef(0); // 시험 중 무실수 정답 수(무실수+힌트미사용 완성만)
  const examEndedRef = useRef(false); // 시험 종료 판정 1회 가드
  const examTierRef = useRef(0);      // 이번 시험이 어느 급 승급시험인지(tierIdx) — 합격 시 rank=max(rank,tierIdx+1) 세팅용

  const timersRef = useRef([]);
  const addTimer = (id) => { timersRef.current.push(id); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; pendingResumeRef.current = []; }; // 추적 타이머(점수 플로트·콤보·다음단어 진행)+일시정지 보류 액션 일괄 정리
  // ── 일시정지 인지 타이머 — 단어 전환·듣기 자동재생 같은 '진행' 액션은 일시정지 중 발화하면 안 됨.
  //    발화 시점에 일시정지면 보류 큐에 넣고, 계속하기 후 짧은 여유(350ms) 뒤 실행. (그만두기/새 런은 clearTimers가 큐도 비움)
  const pausedRef = useRef(false);
  const pendingResumeRef = useRef([]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const addPausable = (fn, ms) => { addTimer(setTimeout(() => { if (pausedRef.current) pendingResumeRef.current.push(fn); else fn(); }, ms)); };
  useEffect(() => {
    if (paused) return undefined;
    const q = pendingResumeRef.current;
    if (!q.length) return undefined;
    pendingResumeRef.current = [];
    const t = setTimeout(() => q.forEach((f) => f()), 350);
    return () => clearTimeout(t);
  }, [paused]);

  useEffect(() => { ensureGameFonts(); initTts(); initSfx(); initBgm(); }, []);

  // 게임 동안만 브라우저 크롬·페이지 바탕을 게임 배경색(크림)으로 — iOS Safari/인앱 브라우저는 theme-color로
  //  상·하단 툴바 뒤를 칠하고, 툴바가 접히는 순간 그 색이 화면 아래에 그대로 드러난다(브랜드 레드가 남아 보이던 문제, 2026-08-06).
  //  나갈 때 원래 값(#7f0005 등)으로 되돌려 앱 나머지 화면의 브랜딩은 그대로 둔다.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = meta ? meta.getAttribute('content') : null;
    const prevBody = document.body.style.backgroundColor;
    const prevHtml = document.documentElement.style.backgroundColor;
    if (meta) meta.setAttribute('content', TG.BG);
    document.body.style.backgroundColor = TG.BG;
    document.documentElement.style.backgroundColor = TG.BG;
    return () => {
      if (meta && prevTheme != null) meta.setAttribute('content', prevTheme);
      document.body.style.backgroundColor = prevBody;
      document.documentElement.style.backgroundColor = prevHtml;
    };
  }, []);

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

  // 스플래시 자동 해제(실제 진입만 2.7초 = 브랜드 컷 1.1s + 게임 로고; 미리보기 splash는 검수용으로 유지)
  useEffect(() => {
    if (!splash || isPreview) return undefined;
    const t = setTimeout(() => setSplash(false), 2700);
    return () => clearTimeout(t);
  }, [splash, isPreview]);

  useEffect(() => {
    if (isPreview) { setStudent({ name: '미리보기' }); return; }
    if (identity.kind === 'member') { setStudent({ name: identity.memberUser?.nickname || '회원' }); return; } // 회원: token이 게임유저 JWT라 학생 조회 X(데이터는 pullMemberData)
    if (identity.kind === 'guest') { setStudent({ name: '플레이어' }); return; } // 게스트 독립 진입
    // 게임은 학생과 완전 분리(2026-07-12) — resolveIdentity는 preview/member/guest만 반환. 학생 토큰 조회 경로 없음.
    setStudent({ name: '플레이어' }); // 방어(미래 kind 추가 대비) — 로딩 게이트(!student)가 안 걸리게 항상 설정
  }, [identity, isPreview]);

  // 탭 파비콘을 게임용으로 교체. 서비스워커가 /game/tone에 index.html(메인 파비콘)을 서빙하므로
  // 정적 HTML(/game/tone.html)이 아니라 클라이언트에서 직접 바꿔야 실사용자 탭에 게임 파비콘이 뜬다.
  // ?v=버전으로 브라우저 파비콘 캐시 무력화. 게임 이탈 시 원래 파비콘 복원.
  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']");
    if (!link) return undefined;
    const prev = link.getAttribute('href');
    link.setAttribute('href', `/favicon-game.png?v=${__APP_VERSION__}`);
    return () => { if (prev != null) link.setAttribute('href', prev); };
  }, []);

  useEffect(() => {
    DIFFICULTIES.forEach((d) => {
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
    });
    THEMES.forEach((t) => {
      fetchToneWords(t.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByTheme((prev) => ({ ...prev, [t.id]: w })); }).catch(() => {});
    });
  }, []);

  // 소셜 로그인 복귀 — Worker 콜백이 현재 주소에 #token=… 을 붙여 되돌려보낸다.
  // 토큰이 있으면 회원 세션을 세우고 게스트 로컬 기록을 흡수한다. 닉네임이 아직 없을 때만 설정 화면으로,
  // 이미 있으면(재로그인·제공자 제공) 건너뛰고 바로 회원으로 재초기화(매 로그인 반복 프롬프트 방지).
  useEffect(() => {
    const token = takeTokenFromHash();
    if (!token) return undefined;
    let done = false;
    (async () => {
      let hasNickname = false;
      try {
        loginMember(token, {});                    // 임시 세션(닉네임은 닉네임 화면에서 확정)
        const { user } = await fetchGameMe(token);
        loginMember(token, user || {});
        hasNickname = !!(user && user.nickname && String(user.nickname).trim()); // 이미 닉네임 있는 계정?
        const idn = resolveIdentity(undefined);     // 회원 신원
        mergeGuestIntoMember(idn);                   // 게스트 로컬 → 회원 로컬 1회 병합
        // ★ 서버 기존 데이터를 로컬에 max 병합한 뒤 push해야 다른 기기 데이터를 안 덮어쓴다.
        //   (이 pull이 빠져 있어 새 기기 로그인이 서버를 그 기기의 적은 로컬로 덮어쓰던 데이터손실 버그)
        //   pull 실패 시 push 보류 — 게스트/구 로컬로 서버 완본을 덮어쓰지 않게(신규 계정은 pull이 빈 데이터로 성공하므로 정상 push).
        let pulled = false;
        try { await pullMemberData(idn); pulled = true; pullOkRef.current = true; } catch { /* noop */ }
        // ★닉네임 = 온보딩에서 사용자가 직접 정한 로컬 이름 우선(A안 2026-08-07). 없을 때만 제공자 이름.
        //  구글 name은 실명인 경우가 많아 그대로 승격시키지 않는다.
        if (pulled) await pushMemberData(idn, loadGuestNickname() || user?.nickname).catch(() => {}); // 로컬(게스트∪서버) → 서버
        track('login_success');
      } catch { /* noop */ }
      if (done) return;
      // 닉네임은 온보딩에서 이미 정했으므로(2026-08-07) 로그인 후 별도 질문 없이 회원으로 재초기화.
      window.location.reload();
    })();
    return () => { done = true; };
  }, []);

  // 홈 메뉴 '닉네임 변경' → 세션·서버에 저장 + 화면 즉시 갱신(reload 없이). 회원만.
  const editNickname = async (nick) => {
    const clean = (nick || '').trim();
    if (!clean) return;
    const sess = getMemberSession();
    loginMember(identity.token, { ...((sess && sess.user) || {}), nickname: clean }); // 세션 갱신
    setMemberNick(clean);                                                              // 홈 표시 즉시 반영
    // ★push 전 pull — 다른 기기 진행분을 로컬에 max 병합. pull 실패 시 push 보류(구 로컬로 서버 덮어쓰기 방지 — 닉네임 저장은 다음 성공 세션에 반영).
    let pulled = false;
    try { await pullMemberData(identity); pulled = true; pullOkRef.current = true; } catch { /* noop */ }
    if (pulled) await pushMemberData(identity, clean).catch(() => {});                 // 서버(game_users.nickname) 저장
  };

  // 온보딩 닉네임 확정(2026-08-07) — 게스트·회원 공통. 게스트는 로컬만, 회원이면 세션·서버까지 저장.
  //  ★이 이름이 '이 기기에서 쓰는 이름'의 단일 출처 — 나중에 로그인해도 이 이름을 계정에 승계한다(A안).
  const submitOnboardNick = async (nick) => {
    if (savingNick) return;
    const clean = (nick || '').trim();
    if (!clean) return;
    setSavingNick(true);
    saveGuestNickname(clean);
    setGuestNick(clean);
    try { localStorage.setItem('tg_nick_set', '1'); localStorage.removeItem('tg_nick_pending'); } catch { /* noop */ }
    if (identity.kind === 'member') {
      setMemberNick(clean);
      const sess = getMemberSession();
      loginMember(identity.token, { ...((sess && sess.user) || {}), nickname: clean });
      let pulled = false;
      try { await pullMemberData(identity); pulled = true; pullOkRef.current = true; } catch { /* noop */ }
      if (pulled) await pushMemberData(identity, clean).catch(() => {});
    }
    setSavingNick(false);
    finishOnboardRef.current();
  };

  // 진입 시: 회원이면 게스트 로컬 병합 + 서버(/game/me) pull, 그다음 로컬 통계·헤드라인 로드. 게스트/프리뷰는 로컬만.
  // (게임은 Notion·학생과 완전 분리 — 학생 서버 베스트(GAME_BEST_DB) 복원 경로 제거, 2026-07-12. 회원은 /game/me JSON으로 기기간 동기화)
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    (async () => {
      if (identity.kind === 'member') {
        // 게스트→회원 병합은 멱등(max·합집합) — 로그인 콜백에서 fetchGameMe가 실패해 병합을 못 했어도 다음 진입에서 흡수.
        mergeGuestIntoMember(identity);
        // ★pull 성공 시에만 이후 push 허용 — pull 실패(네트워크 등) 상태로 push하면 빈/구 로컬이 서버 완본을 덮어써 유실(2026-07-21).
        try { await pullMemberData(identity); pullOkRef.current = true; } catch { /* pull 실패 — pullOkRef=false 유지, 이번 세션 push 보류 */ }
        if (cancelled) return;
        // pull이 서버 rank/xp/스테이지점수를 로컬에 병합했으니 React 상태도 재동기화 — 안 하면 마운트 시점(pull 전) 값에 고착돼 상위 급이 잠긴 채로 보임.
        setXp(loadXp(studentToken) ?? 0);
        const r = Math.min(loadRank(studentToken) ?? 0, rankUpperBound(studentToken)); // 클램프 불변식 유지(스테이지 점수·bossPeak 복원 후 재산정)
        saveRank(studentToken, r); setRank(r);
      }
      clearOrphanThemeBests(studentToken); // 체인상 잠긴 테마의 유령 best(옛 '전부 오픈' 시절 기록 등) 정리 — 진입마다 멱등
      wordStatsRef.current = loadWordStats(studentToken);
      toneStatsRef.current = loadToneStats(studentToken);
      setBest(headlineBest(studentToken)); // 캐시 기반 헤드라인(무한 우선)
    })();
    return () => { cancelled = true; };
  }, [identity, isPreview]);

  useEffect(() => { initGameAds(); }, []); // 웹 전면 광고 — 켜져 있을 때만 스크립트 로드(기본 OFF)

  useEffect(() => {
    if (screen !== 'end') { endHandledRef.current = false; return; } // 결과화면 벗어나면 가드 해제
    if (!studentToken) return;
    if (endHandledRef.current) return; // 이미 이 결과 처리함 — 다시하기로 score=0 리셋돼도 재실행·중복 사운드 방지
    endHandledRef.current = true;
    onRoundEnd(); // 한 판 종료 — 3판마다 전면(광고 OFF면 무동작)
    const avgMsVal = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;

    // 모드별 종료 판정(최고기록·신기록·효과음)은 순수함수 resolveEndOutcome에 모음.
    //  normal=난이도별 best · endless=무한 best · practice/review=기록 미반영(단어통계만).
    // 테마 모드는 난이도(normal)와 동일 메커니즘(난이도별 best) — gameKey·단어풀만 테마 것으로 치환.
    const mode = themeMode ? 'normal' : gameMode;
    const gameKey = themeMode ? selectedTheme.gameKey : selectedDifficulty.gameKey;
    const prevRecord = mode === 'endless' ? loadEndlessBest(studentToken)
      : mode === 'normal' ? loadBest(studentToken, gameKey) : null;
    const outcome = resolveEndOutcome({ mode, prev: prevRecord, score, maxCombo, avgMs: avgMsVal });
    // 신기록/이전최고 표시는 스테이지 단위(입문4는 입문4끼리). 티어 best(outcome)는 저장·업적·무한해제엔 그대로 쓰고, display/사운드만 덮어씀.
    const isStagePlay = mode === 'normal' && !themeMode && selectedDifficulty.bandIndex != null;
    const eff = isStagePlay ? stageOutcome(studentToken, selectedDifficulty, outcome, score) : outcome;
    // ★튜토리얼 직후 입문 1(온보딩 판)은 **기록에 남기지 않는다** — 그 판은 인게임 튜토리얼의 연장선이라
    //   실제 입문 1의 점수·별·해제·신기록을 건드리면 안 된다(2026-08-08 사용자).
    const onboardingRun = onboardingRunRef.current;
    setIsNewBest(onboardingRun ? false : eff.isNewBest);
    setPreviousBest(onboardingRun ? 0 : eff.previousBest);

    if (!isPreview) {
      const endlessWasUnlocked = isEndlessUnlocked(studentToken, rank); // 무한 해제 연출용 스냅샷(무한=고수5 클리어. 이번 판으로 고수5를 처음 깨면 아래에서 해제 연출)
      if (mode === 'endless') {
        // 무한 — 헤드라인 best. meta.eb로 로컬 영구화. 회원은 아래 pushMemberData로 서버(/game/me) 동기화.
        const updated = { ...outcome.updated, updatedAt: Date.now() };
        saveEndlessBest(studentToken, updated);
        setBest(headlineBest(studentToken));
      } else if (mode === 'normal' && !onboardingRun) {
        // 난이도 — 티어 best 로컬 갱신(gameKey=티어). 회원은 아래 pushMemberData로 서버(/game/me) 동기화.
        //  ★온보딩 판(튜토리얼 연장선)은 이 블록을 통째로 건너뛴다 — best·스테이지 점수·별·해제 전부 미반영.
        const updated = { ...outcome.updated, updatedAt: Date.now() };
        saveBest(studentToken, gameKey, updated);
        // 스테이지별 최고점 별도 저장(별·순차해제용) — 테마 아니고 스테이지(bandIndex)일 때만.
        if (!themeMode && selectedDifficulty.bandIndex != null) {
          saveStageScore(studentToken, selectedDifficulty.id, score);
          // 승급시험 유도 모달 — 고득점(완벽 3별 2스테이지↑) + 다음 급 미개방(rank<=tierIdx, 승급시험 있는 급) 시 급별 1회.
          const eti = DIFFICULTIES.findIndex((d) => d.id === selectedDifficulty.tier);
          if (eti >= 0 && eti < BOSSES.length && rank <= eti && perfectStageCount(studentToken, selectedDifficulty.tier) >= 2) {
            const pk = `tg_examprompt_${studentToken}_${selectedDifficulty.tier}`;
            let shown = false; try { shown = !!localStorage.getItem(pk); } catch { /* noop */ }
            if (!shown) { try { localStorage.setItem(pk, '1'); } catch { /* noop */ } setExamPrompt({ tierIdx: eti }); }
          }
        }
        setBest(headlineBest(studentToken)); // 헤드라인(무한 우선, 없으면 통합) 갱신
      }
      // 트레이닝(else)은 최고기록 미반영 — 로컬 단어통계는 플레이 중 이미 저장됨(별도 동기화 불필요).

      // ── 성취 레이어(P1) — 일일 스트릭 + 업적 평가. 로컬 저장(서버 동기화는 후속). 모든 모드 공통(플레이=출석) ──
      const streak = recordPlay(studentToken);
      // 보호권 알림 — 방어 성공(안도)·획득(보상). 압박 아닌 긍정 카피.
      if (streak.freezeUsed > 0) showToast(`❄️ 보호권이 빠진 하루를 지켜줬어요! 연속학습 ${streak.current}일 유지`, 'info');
      else if (streak.freezeEarned > 0) showToast(`🔥 ${streak.current}일 달성! 보호권 +1 (❄️${streak.freezes})`, 'info');
      const masteredN = (() => {
        const map = {};
        for (const d of DIFFICULTIES) for (const w of (wordPoolByDiff[d.id] || [])) map[w.hanzi] = w;
        return masteredCount(wordStatsRef.current, map);
      })();
      // 복습 성과 카운터 — 트레이닝 런에서 새로 마스터된 단어 수 누적(업적 '복습의 힘'). 델타는 같은 공식(풀 기준)끼리 비교.
      if (mode === 'practice') {
        const reviewDelta = masteredN - masteredAtStartRef.current;
        if (reviewDelta > 0) addReviewMastered(studentToken, reviewDelta);
      }
      // 마스터 수 last-writer 기록 — 복습·약점 학습 통계(mc)로 계속 동기화. 등급은 XP로 분리됨(gameXp).
      storeMasteredSync(studentToken, masteredN);
      // 업적 스냅샷 집계 — 난이도·테마·무한 전 기록을 DIFFICULTIES/THEMES에서 파생(하드코딩 없음).
      // 테마 기록도 포함: 테마 1,500점이 '천 점 클럽'에 안 잡히던 불일치 해소.
      const bestByDiff = {}; let playCount = 0; let maxComboEver = maxCombo; // 콤보 업적은 이번 런 포함(기록 아니어도 달성)
      for (const d of DIFFICULTIES) {
        const b = loadBest(studentToken, d.gameKey);
        bestByDiff[d.id] = b?.bestScore || 0;
        playCount += b?.playCount || 0;
        maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0);
      }
      const themeRecs = THEMES.map((t) => loadBest(studentToken, t.gameKey));
      for (const b of themeRecs) { playCount += b?.playCount || 0; maxComboEver = Math.max(maxComboEver, b?.bestMaxCombo || 0); }
      const endlessRec = loadEndlessBest(studentToken);
      const endlessB = endlessRec?.bestScore || 0;
      playCount += endlessRec?.playCount || 0;
      maxComboEver = Math.max(maxComboEver, endlessRec?.bestMaxCombo || 0);
      // 점수 업적은 저장된 best 기준(연습/복습 점수로는 안 따짐 — best는 이미 위에서 갱신됨).
      // 새로 달성한 업적 id 반환 → 축하 오버레이 큐에 적재(P4). 잠금해제·마스터도 업적이라 함께 커버.
      const freshIds = syncAchievements(studentToken, {
        playCount,
        bestScoreAny: Math.max(...Object.values(bestByDiff), endlessB, ...themeRecs.map((b) => b?.bestScore || 0)),
        maxComboEver, bestByDiff, endlessBest: endlessB, masteredCount: masteredN,
        streakLongest: streak.longest, toneStats: toneStatsRef.current,
        reviewMastered: loadReviewMastered(studentToken),
      });
      // 업적 축하 — 단, 모드 잠금해제(unlock-*)는 아래 전용 연출이 담당하므로 제네릭 카드에서 제외(중복 방지)
      if (freshIds.length) setCelebrationQueue(freshIds.filter((id) => !id.startsWith('unlock-')).map(achievementById).filter(Boolean));

      // 모드 잠금해제 감지 — 연출 데이터는 전부 THEMES/DIFFICULTIES에서 파생(새 테마·난이도 추가 시 코드 수정 불필요).
      if (mode === 'normal' && outcome.updated) {
        let mu = null;
        if (themeMode) {
          // 이번 테마 점수로 열리는 다른 테마 — unlock 메타(byGameKey·score) 기준으로 '이번에 처음' 넘겼는지 판정.
          const t = THEMES.find((x) => x.unlock && x.unlock.byGameKey === gameKey
            && outcome.previousBest < x.unlock.score && outcome.updated.bestScore >= x.unlock.score);
          mu = t?.unlockReveal || null;
        } else if (selectedDifficulty.bandIndex != null && !endlessWasUnlocked && isEndlessUnlocked(studentToken, rank)) {
          // 무한 게이트=고수 마지막 스테이지(고수5) 클리어. 이번 판으로 고수5를 처음 깨면(별1+) 무한 모드 해제 연출.
          mu = ENDLESS_UNLOCK_REVEAL;
        }
        if (mu) setModeUnlock(mu);
      }

      // 초급 노멀 '연속 저조'(2연속 500 이하)일 때만 트레이닝 유도 — 격려 톤·비강제·쿨다운.
      //  한 번 낮은 건 무시(누구나 실수), 500 넘긴 판이 나오면 연속 카운터 리셋. 쿨다운으로 매번 안 뜨게.
      if (mode === 'normal' && !themeMode && (selectedDifficulty.tier || selectedDifficulty.id) === 'easy') {
        if (score <= LOW_EASY_SCORE) {
          easyLowStreakRef.current += 1;
          if (easyLowStreakRef.current >= LOW_EASY_STREAK && trainNudgeAllowed()) {
            setSuggestPractice(true); markTrainNudge(); easyLowStreakRef.current = 0;
          }
        } else {
          easyLowStreakRef.current = 0; setSuggestPractice(false); // 회복(>500)하면 대기 중 유도 취소
        }
      }

      if (identity.kind === 'member' && pullOkRef.current) pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me). pull 성공했을 때만(빈 로컬로 서버 덮어쓰기 방지)
      // 측정: 런 종료(모드 라벨 + 점수) — 유입 깔때기의 '플레이' 카운트.
      //  트레이닝은 내부 모드가 'practice'지만 run_start와 라벨을 맞춰 'training'으로(깔때기 시작↔종료 정합).
      track('run_end', { m: mode === 'normal' ? (themeMode ? selectedTheme.id : selectedDifficulty.id) : mode === 'practice' ? 'training' : mode, k: identity.kind, v: score });
    }
    // 신기록 비트가 이미 축하음(win/unlock)을 울렸으면 여기서 재생 안 함(2.3초 전 비트에서 울림). 아니면(게임오버 등) 여기서 재생.
    if (!beatSfxRef.current) playSfx(eff.sfx);
  }, [screen, identity, studentToken, selectedDifficulty, score, maxCombo, answeredCount, totalAnswerTime, gameMode, selectedTheme, words, wordPoolByDiff, wordPoolByTheme, isPreview]);

  useEffect(() => () => clearTimers(), []);

  // ── 신기록 비트 사전 판정 ─────────────────────────────
  // 게임오버 비트가 뜰 때(showGameOverBeat) 이번 판이 신기록인지 미리 계산 → 신기록이면 축하 비트, 아니면 기존 게임오버 비트.
  //  ★타이밍 안전: setShowGameOverBeat(true)는 항상 addPausable(1.2~1.7s) 안에서 호출돼, 비트가 뜨는 이 시점 score/maxCombo는 최종값(settled).
  //  resolveEndOutcome은 순수함수라 end-effect와 동일 결과(중복 계산이지만 저렴 — 부수효과 없음).
  const beatOutcome = useMemo(() => {
    if (!showGameOverBeat || isPreview || practiceMode || examMode) return null;
    const m = themeMode ? 'normal' : gameMode;
    if (m !== 'normal' && m !== 'endless') return null;
    const gk = themeMode ? selectedTheme?.gameKey : selectedDifficulty?.gameKey;
    if (m === 'normal' && !gk) return null;
    const prevRecord = m === 'endless' ? loadEndlessBest(studentToken) : loadBest(studentToken, gk);
    const avgMsVal = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
    const oc = resolveEndOutcome({ mode: m, prev: prevRecord, score, maxCombo, avgMs: avgMsVal });
    // 비트(신기록 밝은/게임오버 어두운)·비트 사운드도 스테이지 단위 판정과 일치시킴.
    const res = (m === 'normal' && !themeMode && selectedDifficulty?.bandIndex != null)
      ? stageOutcome(studentToken, selectedDifficulty, oc, score) : oc;
    // 온보딩 판은 기록에 안 남으므로 신기록도 아님 → 밝은 '신기록!' 비트 대신 일반 게임오버 비트로 간다.
    return onboardingRunRef.current ? { ...res, isNewBest: false } : res;
  }, [showGameOverBeat, isPreview, practiceMode, themeMode, gameMode, selectedTheme, selectedDifficulty, studentToken, answeredCount, totalAnswerTime, score, maxCombo]);
  const beatRecord = !!beatOutcome?.isNewBest;
  // 승급 시험 종료 — 20문제가 끝나 showGameOverBeat가 서면(examMode) 비트 없이 즉시 판정. examEndedRef로 1회만.
  useEffect(() => {
    if (!showGameOverBeat || !examMode || examEndedRef.current) return undefined;
    examEndedRef.current = true;
    setShowGameOverBeat(false);
    const correct = examCorrectRef.current;
    const total = words.length || EXAM_QUESTIONS;
    const passed = examPassed(correct, total);
    // 승급시험도 최고 점수를 남긴다 — 난이도 카드가 스테이지와 같은 '점수' 표기를 쓰기 위함(2026-08-03). 키 = 보스 id(스테이지 점수 맵 공유, max로만 갱신).
    if (!isPreview) {
      const boss = BOSSES.find((b) => b.tierIdx === examTierRef.current);
      if (boss) saveStageScore(studentToken, boss.id, score);
    }
    if (passed) {
      const prevIdx = rank, nowIdx = Math.max(rank, examTierRef.current + 1);
      saveBossPeak(studentToken, nowIdx);                   // 정당히 통과한 급 기록 — 클램프가 이 rank를 안 깎게
      saveRank(studentToken, nowIdx); setRank(nowIdx);      // 등급 = max(현재, 통과한 급+1)
      setExamResult({ correct, total, passed: true });
      setRankUp({ prevIdx, nowIdx });                       // 합격 연출(RankUpReveal 재활용) → onDone에서 결과화면
    } else {
      // 사다리 승급시험 불합격 — 페널티 없음, 결과화면에서 재도전(2026-07-19 사용자 결정).
      setExamResult({ correct, total, passed: false });
      setScreen('examresult');
    }
    if (!isPreview && identity.kind === 'member' && pullOkRef.current) pushMemberData(identity).catch(() => {}); // 회원: 등급/XP 서버 동기화(pull 성공 시만)
    if (!isPreview) track('exam_end', { m: DIFFICULTIES[Math.min(rank, DIFFICULTIES.length - 1)]?.id, k: identity.kind, v: correct });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGameOverBeat, examMode]);
  // 신기록 비트 등장 순간 축하 효과음(win/unlock)을 여기서 1회 재생 → 결과화면 도착까지 기다리지 않고 비트와 소리를 동기화.
  //  end-effect는 beatSfxRef 가드로 같은 소리를 재생하지 않음(중복 방지). 게임오버(비신기록)는 비트가 소리를 안 울리므로 end-effect가 담당.
  useEffect(() => {
    if (beatRecord && !beatSfxRef.current) { beatSfxRef.current = true; playSfx(beatOutcome.sfx); }
  }, [beatRecord]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // 웨이브가 화면을 덮은 시점에 목적 화면 전환 + 런 모드 리셋(인게임 이탈 시 뒤 화면 모드 깜빡임 방지). 타이틀→홈은 이미 normal이라 무해.
    const t = setTimeout(() => {
      let target = txTarget;
      // 온보딩 첫 판을 마치고 처음 홈으로 나가는 순간 = 닉네임 묻는 자리(2026-08-07 사용자 지정 순서).
      //  ★플래그는 afterTutorial이 세운 localStorage(tg_nick_pending) — 새로고침/앱 종료로 런이 끊겨도
      //   다음 홈 진입에서 다시 잡힌다. 기존 사용자(닉네임 미설정 레거시)는 이 플래그가 없어 안 걸린다.
      let pendingNick = false;
      try { pendingNick = !!localStorage.getItem('tg_nick_pending') && !localStorage.getItem('tg_nick_set'); } catch { /* noop */ }
      if (target === 'home' && pendingNick) {
        if (!onboardNickRef.current) onboardNickRef.current = loadGuestNickname();
        target = 'nickname';
      }
      setScreen(target); setGameMode('normal'); setHomeTx('hold');
    }, 420);
    return () => clearTimeout(t);
  }, [homeTx, txTarget]);
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
    const limit = practiceMode ? 0                                      // 트레이닝: 시간 무제한(게이지 미표시·타임아웃 effect 비활성)
      : endlessMode ? getEndlessTimeLimit(answeredCount, combo)         // 무한: 클리어 램프 + 콤보 가속(둘 다)
      : Math.max(4000, getTimeLimitForCombo(combo, (themeMode ? selectedTheme.timeMultiplier : selectedDifficulty.timeMultiplier))); // 난이도/테마: 콤보0 페이스, 콤보로 가속(하한 4초)
    wordElapsedRef.current = 0; // 새 단어 — 누적 진행시간 리셋
    setLowTime(false);          // 이전 단어의 '시간부족' 상태가 새 단어 시작 프레임에 남지 않게(타이머 effect가 다시 판정)
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
    if (isListen && !isPreview) { const lw = words[wordIndex]; if (lw) addPausable(() => speakWord(lw), 240); } // 일시정지 중 발음 재생 방지
    // TTS 프리로드 — 현재 단어(듣기 자동재생·완성 발음)와 다음 단어 mp3를 미리 받아, 재생 시점 fetch 지연으로
    // 타이머가 깎이는 불공정 제거(듣기 문제는 소리가 문제 그 자체).
    preloadTts(words[wordIndex]);
    if (words[wordIndex + 1]) preloadTts(words[wordIndex + 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, screen, selectedDifficulty, cdPhase, runId]);

  useEffect(() => {
    if (screen !== 'game' || completed || paused || cdPhase || suddenIntro || examIntro || practiceMode) return undefined; // 연습=시간 무제한(타임아웃 없음) · 서든데스/승급시험 연출 중 정지
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
      completedRef.current = true; enteredRef.current = word.tones; // 동기 가드 — 시간초과 순간 입력 재진입 차단
      setTimedOut(true); setCompleted(true); setCombo(0); setEntered(word.tones);
      setEndKind('timeout');
      haptic([60, 30, 60]); playSfx('timeout');
      speakWord(word); // 시간초과 공개 → 올바른 발음 들려주기
      // 단어 숙련도 기록(시간초과 = 실패). 성조별 정답률은 탭 기준(handleTone)만 — 시간초과는 탭이 없어 미기록.
      if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: true, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
      addPausable(() => {
        const end = endlessMode || wordIndex + 1 >= words.length;
        if (end) setShowGameOverBeat(true); // 무한: 첫 시간초과 = 종료
        else { enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
      }, 1700);
    }, remaining);
    return () => {
      clearTimeout(timer);
      if (lowTimer) clearTimeout(lowTimer);
      wordElapsedRef.current += Date.now() - segStartRef.current; // 이번 진행 구간을 누적
    };
  }, [screen, completed, paused, cdPhase, wordTimeLimit, gaugeOffsetMs, wordIndex, words, endlessMode, suddenIntro, examIntro, practiceMode, isPreview, studentToken]);

  // 무한 서든데스 킥오프 연출 — 런이 라이브(카운트다운 종료)가 되는 순간 ≈2.2초 노출. 이 동안 위 타임아웃 effect가 suddenIntro로 정지 → 타이머 안 흐름.
  useEffect(() => {
    if (screen !== 'game' || !endlessMode || cdPhase) { setSuddenIntro(false); return undefined; }
    setSuddenIntro(true);
    const t = setTimeout(() => setSuddenIntro(false), 2350);
    return () => clearTimeout(t);
  }, [runId, screen, endlessMode, cdPhase]);

  // 승급시험 킥오프 연출 — 시험 런이 라이브(카운트다운 종료)가 되는 순간 인게임 노출. 이 동안 위 타임아웃 effect가 examIntro로 정지 → 타이머 안 흐름. 해제는 오버레이 onDone(탭/자동)이 담당. (미리보기는 seed 유지)
  useEffect(() => {
    if (isPreview) return undefined;
    if (screen !== 'game' || !examMode || cdPhase) { setExamIntro(null); return undefined; }
    // 시험 이름/색 = 통과 시 승급하는 '다음 급'(examTierRef=출발 급 idx → +1). "실전 승급시험" 등.
    const srcIdx = Math.min(examTierRef.current, BOSSES.length - 1);
    const tgt = DIFFICULTIES[srcIdx + 1] || DIFFICULTIES[srcIdx];
    setExamIntro({ tier: tgt.id, tierLabel: tgt.label });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, screen, examMode, cdPhase]);

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
    onboardingRunRef.current = false; // 기본은 '일반 런' — 온보딩 첫 판만 afterTutorial이 다시 세운다
    completedRef.current = false; enteredRef.current = []; hintUsedRef.current = false; // 동기 가드·힌트 플래그 초기화(새 런)
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false);
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    setEndKind('complete'); setWrongShakeKey(0); setShowGameOverBeat(false); beatSfxRef.current = false; // 게임오버 비트 헤드라인·셰이크·오버레이 + 신기록 비트 축하음 가드 초기화
    // ★오답 잔상 리셋 — clearTimers()가 wrongBtn 자동 해제 타이머(450ms)를 죽이므로 여기서 직접 초기화하지 않으면
    //   오답 직후 재시작 시 wrongBtn이 non-null로 고착 → handleTone 연타 가드가 모든 오답 입력을 영구 무시(치팅 버그).
    setWrongBtn(null); setShowWrong(false); setFloatScore(null); setComboFlash(false);
    livesRef.current = 3; setLives(3); // 무한 하트 초기화
    audioOffRef.current = false; setAudioOff(false); // '지금은 못 들어요'는 그 판 한정 → 새 런마다 리셋(듣기 여부는 listenRollsRef, 각 start*가 설정)
    masteredAtStartRef.current = currentMastered(); setRankUp(null); // 등급 진행 연출 — 판 시작 마스터 수 스냅샷
    { const ts = toneStatsRef.current || {}, snap = {}; for (const t of [1, 2, 3, 4, 0]) snap[t] = (ts[t] && ts[t][0]) || 0; toneSnapRef.current = snap; } // 성조별 정답수 스냅샷(성장 축하용)
    toneLevelSnapRef.current = deriveToneLevels(toneStatsRef.current); setToneLevelChanges([]); setModeUnlock(null); // 성조 레벨 스냅샷(업/다운 연출용) + 모드해제 연출 초기화
    wordElapsedRef.current = 0; setGaugeOffsetMs(0); setRunId((n) => n + 1);
    setLowTime(false); // ★직전 판이 막바지에 끝났으면 lowTime이 true로 남아, 새 판 카운트다운 동안 '시간부족'(붉은 맥동)이 번쩍인다
    setXpGain(null); // 새 런 — 이전 판 XP 획득 연출 정리
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
  // 그리기문제 롤 — 듣기와 상호배타(듣기로 뽑힌 칸 제외)·첫 단어 제외·더 드물게(≈16%).
  // 경성(0)이 섞인 단어도 출제 — 경성 음절은 곡선으로 그리기 애매하므로 DrawPad에서 자동 정답 처리(그리기 불필요).
  const rollDraw = (arr, listenRolls) => (arr || []).map((_, i) => (
    i > 0 && !listenRolls[i] && Math.random() < 0.16
  ));
  // 라운드 설정 — words·듣기롤·그리기롤을 '항상 함께' 갱신(한쪽만 바꾸는 실수 방지). listen=false → 듣기·그리기 미출제(연습·무한).
  const setRound = (arr, { listen = true } = {}) => {
    setWords(arr);
    const lr = listen ? rollListen(arr) : [];
    listenRollsRef.current = lr;
    drawRollsRef.current = listen ? rollDraw(arr, lr) : [];
  };

  const startGame = (difficulty) => {
    const d = difficulty || selectedDifficulty;
    if (difficulty && difficulty.id !== selectedDifficulty.id) setSelectedDifficulty(d);
    const poolId = d.tier || d.id; // 스테이지는 티어 풀 참조(밴드로 슬라이스), 일반 난이도는 자기 풀
    const pool = wordPoolByDiff[poolId];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('difficulty');
      fetchToneWords(poolId).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [poolId]: w })); }).catch(() => {});
      return;
    }
    setGameMode('normal');    setRecordToBeat(d.bandIndex != null ? stageScoreOf(studentToken, d.id) : (loadBest(studentToken, d.gameKey)?.bestScore || 0)); // 라이브 신기록 기준 = 스테이지 최고(스테이지면), 아니면 티어 최고
    const roundPool = d.bandIndex != null ? stageRoundPool(pool, d.bandIndex) : pool; // 스테이지=난이도 밴드(부족분 인접 보충)
    setRound(buildRoundWords(roundPool, wordStatsRef.current, ROUND_LENGTH)); // 교육적 가중 추첨(약점 우선·은은하게)
    if (!isPreview) track('run_start', { m: d.id, k: identity.kind });
    resetRunState();
  };

  // 연습 모드 — 난이도 선택 후 시간 무제한 학습. 기록 미반영, 숙련도만 반영. '정답 보기' 가능.
  // 트레이닝 모드 — 열린 스테이지 범위에서 약점가중 추첨. 시간 무제한·기록 미반영, 단어통계만 갱신.
  //   난이도(스테이지) 선택 없음: 범위=내 진행도(입문1만 열렸으면 입문1 단어). 진도 오르면 자동 확장.
  const startTraining = () => {
    const pool = unlockedTrainingPool(studentToken, wordPoolByDiff, rank);
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('modeselect');
      fetchToneWords('easy').then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, easy: w })); }).catch(() => {});
      return;
    }
    setGameMode('practice');    setRecordToBeat(0); // 트레이닝=기록 미반영(내부 모드는 practice=무제한 타이머 공유)
    // 무한 트레이닝 — 약점가중 배치를 여러 번 이어붙여 긴 스트림(사실상 끝나지 않음; '종료' 버튼·그만두기로 끝냄).
    let stream = [];
    while (stream.length < 200) stream = stream.concat(buildRoundWords(pool, wordStatsRef.current, ROUND_LENGTH));
    setRound(stream, { listen: false }); // 듣기문제 없음(자체 발음듣기)
    setPracticeKind('training');
    if (!isPreview) track('run_start', { m: 'training', k: identity.kind });
    resetRunState();
  };

  // 오답 복습 — 오답 노트의 [복습 하기]. **그 화면에 나열된 약점 단어만** 돈다.
  //  (구: startTraining을 그대로 불러 열린 스테이지 전체 풀이 나왔다 → "틀린 문제를 복습해봐요!"라는
  //   화면 카피·목록과 첫 단어부터 어긋났음. 2026-08-07 UX 검수)
  //  트레이닝과 같은 practice 엔진(시간 무제한·기록 미반영·정답보기 가능), 단어 출처만 다르다.
  const startReview = (rows) => {
    const pool = (rows || []).map((r) => r.word).filter(Boolean);
    if (pool.length === 0) { startTraining(); return; } // 복습할 게 없으면 트레이닝으로 폴백
    setGameMode('practice');    setRecordToBeat(0);
    // 짧은 목록이라 그대로 두면 금방 끝난다 → 매 사이클 섞어 이어붙인 긴 스트림('종료' 버튼으로 끝냄).
    let stream = [];
    while (stream.length < 60) stream = stream.concat(shuffle(pool));
    setRound(stream, { listen: false }); // 듣기문제 없음(카드의 자체 발음듣기로 충분)
    setPracticeKind('review');
    if (!isPreview) track('run_start', { m: 'review', k: identity.kind });
    resetRunState();
  };
  // 인게임(문제풀이·결과화면) → 아웃게임 이탈은 '오늘의 팁' 웨이브 전환으로 목적 화면 진입. 잔존 타이머·오버레이 정리(기록 오염 방지)
  //   후 트리거. gameMode 리셋은 homeTx 'in'이 전환이 화면을 덮는 시점에 처리(뒤 화면 모드 깜빡임 방지).
  const tipTransitionTo = (target) => { clearTimers(); setShowGameOverBeat(false); setPaused(false); setTxTarget(target); setHomeTx('in'); };
  const endTraining = () => tipTransitionTo('home'); // 트레이닝 종료(무한) — 결과화면 없이 홈 허브로

  // 무한 모드 — 전 난이도 랜덤 스트림. 점점 가속, 첫 시간초과 종료, 헤드라인 최고점.
  const startEndless = () => {
    const all = DIFFICULTIES.flatMap((d) => wordPoolByDiff[d.id] || []);
    if (all.length === 0) { message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
    let stream = [];
    for (let i = 0; i < 8; i++) stream = stream.concat(shuffle(all)); // 첫 초과로 끝나므로 충분히 길게
    setGameMode('endless');    setRecordToBeat(loadEndlessBest(studentToken)?.bestScore || 0); // 라이브 신기록 기준(무한 직전 최고)
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
    setGameMode('theme');    setRecordToBeat(loadBest(studentToken, t.gameKey)?.bestScore || 0); // 라이브 신기록 기준(이 테마 직전 최고)
    setRound(buildRoundWords(pool, wordStatsRef.current, ROUND_LENGTH)); // 교육적 가중 추첨(약점 우선·은은하게)
    if (!isPreview) track('run_start', { m: t.id, k: identity.kind });
    resetRunState();
  };

  // 승급 시험 — 게이지 만땅(examReady) 시 응시. 현재 등급 난이도 풀에서 무작위 20문제(순수 성조 식별).
  // 일반 라운드 메커니즘 재활용(타이머·하트·힌트 그대로). '정답' = 무실수+힌트미사용 완성(handleTone에서 집계).
  // 20문제 끝 → 비트 없이 판정(examEnd effect): 합격 등급+1·상승 연출 / 불합격 페널티 없음. 기록·XP적립·스트릭 미반영.
  // 승급시험 시작. targetTierIdx = 어느 급의 승급시험(기본=현재 rank의 급).
  //  승급시험은 급 사이(입문·실전)에만 있으니 tierIdx는 0..BOSSES.length-1. 숙련자가 상위 급으로 가는 유일한 통로.
  const startExam = (targetTierIdx = rank) => {
    const tIdx = Math.min(Math.max(0, targetTierIdx), BOSSES.length - 1);
    if (targetTierIdx < 0 || targetTierIdx >= BOSSES.length) return; // 보스 없는 급(고수) 방어
    const d = DIFFICULTIES[tIdx];
    const pool = wordPoolByDiff[d.id];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
      return;
    }
    examTierRef.current = tIdx;
    setSelectedDifficulty(d); // 시험 타이머 페이스 = 해당 등급 난이도
    setGameMode('exam');    setRecordToBeat(0);
    examCorrectRef.current = 0; examEndedRef.current = false; setExamResult(null);
    setRound(shuffle(pool).slice(0, EXAM_QUESTIONS), { listen: false }); // 시험=듣기/그리기 미출제(순수 성조 식별)
    if (!isPreview) track('run_start', { m: 'exam', k: identity.kind });
    resetRunState();
  };

  const handleTone = useCallback((toneNum) => {
    if (completedRef.current || paused || cdPhase || suddenIntro || examIntro) return; // 완성/전환 중(동기 가드) — 같은 tick 더블탭·멀티터치 재진입 차단
    const word = words[wordIndex];
    if (!word) return;
    const cur = enteredRef.current;            // 동기 소스 — 이 tick에서 이미 전진했으면 다음 슬롯을 본다(stale state 미참조)
    const expected = word.tones[cur.length];
    // 오답 흔들림(450ms) 중 연타 — 하트 순삭·중복 패널티 방지(무시). 가벼운 햅틱만(무반응이면 "안 눌렸나?" 체감).
    // ★통계(recordTone)보다 먼저 가드 — 무시하는 연타가 성조 정답률(EMA)에 오답으로 쌓이던 비일관 제거.
    if (toneNum !== expected && wrongBtn !== null) { haptic(10); return; }
    // 성조별 정답률(기대 성조 기준) = 홈 성조 캐릭터의 레벨·약점 진단 소스.
    //  ★트레이닝은 미반영(2026-08-07 사용자 결정) — 시간 제한·기록이 없는 연습이라 캐릭터 레벨을 움직이면 안 된다.
    //   (단어 숙련도 recordWordResult는 트레이닝에서도 계속 쌓는다 — 약점 가중 출제의 근거라 필요)
    //  ★발음 힌트를 써서 정답 발음을 들은 단어도 미반영 — 힌트 후 정답이 실력으로 오인돼 정확도가 부풀던 것 방지.
    //  ★튜토리얼 직후 입문 1(onboardingRun)도 미반영 — 그 판은 **인게임 튜토리얼의 연장선**이라
    //   처음 만져보는 사람의 헤맴이 성조 캐릭터 레벨·약점 진단에 남으면 안 된다(2026-08-08 사용자).
    //   (단어 숙련도 recordWordResult는 그대로 쌓는다 — 못 맞힌 단어는 실제로 복습 대상이라 오답 노트에 남는 게 맞다)
    if (!isPreview && !practiceMode && !onboardingRunRef.current && !hintUsedRef.current) { recordTone(toneStatsRef.current, expected, toneNum === expected); saveToneStats(studentToken, toneStatsRef.current); }
    if (toneNum === expected) {
      setShowWrong(false); // 정답 — 오답 메시지 해제
      const ne = [...cur, toneNum];
      enteredRef.current = ne; setEntered(ne);
      if (ne.length === word.tones.length) {
        completedRef.current = true; setCompleted(true); setEndKind('complete');
        speakWord(word); // 정답 완성 → 올바른 발음 자동 재생(성조 강화)
        const answerTime = wordElapsedRef.current + (Date.now() - segStartRef.current);
        const remaining = practiceMode ? 0 : Math.max(0, wordTimeLimitRef.current - answerTime); // 연습=시간보너스 없음
        let earned;
        if (!hasMistake) {
          // 승급 시험 정답 집계 — 무실수 완성 + 힌트 미사용만 '정답'(공정성). 시험은 점수 대신 정답률로 판정.
          if (examModeRef.current && !hintUsedRef.current) examCorrectRef.current += 1;
          const newCombo = combo + 1;
          earned = computeScore({ perfect: true, newCombo, remainingMs: remaining });
          setCombo(newCombo); setMaxCombo((m) => Math.max(m, newCombo));
          if (newCombo >= 2) { setComboFlash(true); addTimer(setTimeout(() => setComboFlash(false), 700)); }
          haptic(newCombo >= 8 ? [16, 24, 52] : newCombo >= 4 ? [12, 22, 40] : [10, 20, 30]); // 콤보 고조 시 완성 진동도 묵직하게
          // 콤보 피치 래더 — 연속 정답마다 음정 반음↑(1옥타브=12 캡). "쌓인다"는 손맛.
          const pitchRate = Math.pow(2, Math.min(newCombo - 1, 12) / 12);
          playSfx(newCombo >= 2 ? 'combo' : 'correct', undefined, pitchRate);
        } else { earned = computeScore({ perfect: false, remainingMs: remaining }); setCombo(0); haptic(15); playSfx('correct', 0.4); }
        setScore((s) => s + earned);
        // 정답 판정 3단계 — 남은시간 비율(=시간보너스)로 완벽!/훌륭!/좋아!. 무실수 정답만(실수 클리어는 판정 없이 점수만).
        const tRatio = (!hasMistake && wordTimeLimitRef.current > 0) ? remaining / wordTimeLimitRef.current : -1;
        const judge = tRatio < 0 ? null : tRatio >= JUDGE_RATIO.best ? 'best' : tRatio >= JUDGE_RATIO.mid ? 'mid' : 'base';
        setFloatScore({ n: earned, judge });
        setTotalAnswerTime((t) => t + answerTime);
        setAnsweredCount((c) => c + 1);
        // 단어 숙련도 기록(무실수 클리어 여부 + 소요시간)
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: !hasMistake, timedOut: false, ms: answerTime }); saveWordStats(studentToken, wordStatsRef.current); }
        addTimer(setTimeout(() => setFloatScore(null), 1300));
        // 교육 단어(3성 변조·연음)는 마크·모프 연출을 충분히 볼 수 있게 완성 후 더 오래 머문 뒤 넘김.
        const teachDwell = (word && (findToneSandhi(word.tones) >= 0 || findLianyin(word.tones) >= 0)) ? 2400 : 1500;
        addPausable(() => {
          const end = !practiceMode && wordIndex + 1 >= words.length;
          if (end) setShowGameOverBeat(true); // 트레이닝(무한)은 스트림 끝에서 순환 → 종료화면 없음
          else { enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => practiceMode ? (i + 1) % words.length : i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
        }, teachDwell);
      } else { haptic(8); playSfx('tap'); setCurrentSyl(ne.length); }
    } else {
      setHasMistake(true); setCombo(0); setWrongBtn(toneNum); setShowWrong(true); setWrongShakeKey((k) => k + 1); haptic([40, 30, 40]); playSfx('wrong');
      addTimer(setTimeout(() => setWrongBtn(null), 450)); // 버튼 흔들림만 해제, 코치 메시지는 유지
      // 무한 = 서든데스: 오답 1번 = 즉시 종료(정답 공개 후 게임오버). 난타 방지 장치. 모르는 단어는 건너뛰기(하트)로 안전 통과.
      if (endlessMode) {
        completedRef.current = true; enteredRef.current = word.tones; // 동기 가드 — 서든데스 종료 순간 재진입 차단
        setCompleted(true); setEntered(word.tones); setEndKind('miss');
        speakWord(word); // 정답 공개 → 올바른 발음 들려주기
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
        addPausable(() => setShowGameOverBeat(true), 1700); // 정답 공개 후 게임오버 비트
        return; // 종료 — 시간 패널티 불필요
      }
      // 승급 시험 = 오답 즉시 확정: 무실수 완성만 정답 집계라 이 문제는 이미 오답 — 재시도 없이 정답 공개 후 다음 문제로.
      if (examModeRef.current) {
        completedRef.current = true; enteredRef.current = word.tones; // 동기 가드 — 확정 순간 입력 재진입 차단
        setCompleted(true); setEntered(word.tones);
        speakWord(word); // 정답 공개 → 올바른 발음 들려주기
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
        addPausable(() => {
          const end = wordIndex + 1 >= words.length;
          if (end) setShowGameOverBeat(true); // 마지막 문제 → examEnd effect가 판정
          else { enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
        }, 1500);
        return; // 다음 문제로 — 시간 패널티 불필요
      }
      // 오답 0.5초 패널티(연습·미리보기 제외) — 경과시간에 500ms 더해 남은시간 차감. setGaugeOffsetMs가 게이지 재마운트(음수 delay)+타이머 effect 재실행 유발.
      if (!practiceMode && !isPreview) {
        const elapsed = Math.min(wordTimeLimitRef.current, wordElapsedRef.current + (Date.now() - segStartRef.current) + 500);
        wordElapsedRef.current = elapsed;
        segStartRef.current = Date.now();
        setGaugeOffsetMs(elapsed);
      }
    }
  }, [completed, paused, cdPhase, suddenIntro, examIntro, words, wordIndex, currentSyl, entered, hasMistake, combo, practiceMode, isPreview, studentToken, endlessMode, wrongBtn]);

  // 건너뛰기 — 못 풀겠는 단어를 하트 1개 소모하고 넘김. 정답 공개+발음(학습) · 콤보 끊김 · 0점 · 숙련도 미반영.
  // 하트는 런당 3개 예산(모든 모드 공통). 0개면 버튼 비활성 → 스킵만 불가, 게임은 계속. 연습 모드는 자체 '정답 보기'라 미제공.
  const skipWord = useCallback(() => {
    if (completedRef.current || paused || cdPhase || practiceMode) return; // 동기 가드 — 건너뛰기 더블탭 시 패스 이중소모·단어 2칸 이동 방지
    if (livesRef.current <= 0) return; // 하트 소진 — 더 못 건너뜀
    const word = words[wordIndex];
    if (!word) return;
    const remain = livesRef.current - 1;
    livesRef.current = remain; setLives(remain);
    completedRef.current = true; enteredRef.current = word.tones; // 동기 가드 세팅
    setCompleted(true); setEntered(word.tones); setCombo(0); setHasMistake(true); setShowWrong(false); setEndKind('complete');
    haptic(20); playSfx('wrong', 0.4); // 부드러운 '못 풀었어요' 큐(시간초과 버저보다 약하게)
    speakWord(word); // 올바른 발음 들려주기(학습 기회)
    if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
    addPausable(() => {
      const end = !endlessMode && wordIndex + 1 >= words.length;
      if (end) setShowGameOverBeat(true); // 무한은 스트림이 길어 계속 진행
      else { enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
    }, 1200);
  }, [completed, paused, cdPhase, practiceMode, words, wordIndex, endlessMode, isPreview, studentToken]);

  // 연습 모드 '정답 보기' — 현재 단어 정답 공개(점수·콤보 없음, 무실수 아님 기록) 후 다음 단어로.
  const revealAnswer = useCallback(() => {
    if (completedRef.current || paused || cdPhase) return; // 동기 가드
    const w = words[wordIndex];
    if (!w) return;
    completedRef.current = true; enteredRef.current = w.tones; // 동기 가드 세팅
    setCompleted(true); setEntered(w.tones); setCombo(0); setHasMistake(true); setShowWrong(false); setEndKind('reveal'); // reveal=정답보기: 축하 연출(히트스톱·펀치) 없이 차분히 공개
    speakWord(w);
    if (!isPreview) { recordWordResult(wordStatsRef.current, w.hanzi, { perfect: false, timedOut: false, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
    setAnsweredCount((c) => c + 1);
    addPausable(() => {
      // 트레이닝(무한 스트림)은 끝에서 순환. **일반·테마 모드는 건너뛰기를 대체한 기능이라 마지막 단어면 판이 끝나야 한다**
      //  (2026-08-04: 정답보기를 일반 모드에도 노출 → 순환하면 판이 영영 안 끝나는 버그. 건너뛰기와 동일한 종료 판정으로 통일)
      if (practiceMode) {
        enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => (i + 1) % words.length); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false);
        return;
      }
      const end = !endlessMode && wordIndex + 1 >= words.length;
      if (end) setShowGameOverBeat(true); // 무한은 스트림이 길어 계속 진행
      else { enteredRef.current = []; completedRef.current = false; hintUsedRef.current = false; setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); setGaugeOffsetMs(0); }
    }, 1500);
  }, [completed, paused, cdPhase, practiceMode, endlessMode, words, wordIndex, isPreview, studentToken]);

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
  // 그리기 문제 여부 — 렌더 파생(미리 굴린 drawRollsRef). 듣기와 상호배타. DEV 미리보기는 ?draw=1.
  const wordIsDraw = (!practiceMode && !endlessMode && !!drawRollsRef.current[wordIndex])
    || (isPreview && previewScreen === 'game' && qs('draw') === '1');

  // ── 인게임 이탈 방어 ①: 앱이 백그라운드로 가면 자동 일시정지 ──────────────
  // 전화·알림·홈버튼으로 잠깐 나갔다 오면 그동안 단어 타이머가 흘러 '시간 초과'로 끝나 있었다.
  //  visibilitychange는 **숨겨지는 시점에 즉시** 발화하므로, 여기서 paused를 세우면 타이머 effect의
  //  cleanup이 '숨기 직전까지'만 경과로 누적한다(그 뒤 시간은 안 먹음). iOS Safari 대비 pagehide도 함께.
  useEffect(() => {
    if (screen !== 'game' || isPreview) return undefined;
    const pause = () => { if (!showGameOverBeat) setPaused(true); };
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', pause);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', pause);
    };
  }, [screen, isPreview, showGameOverBeat]);

  // ── 인게임 이탈 방어 ②: 브라우저/기기 뒤로가기를 일시정지로 받기 ──────────
  // 게임 내부 화면 전환은 history를 쓰지 않아, 인게임에서 뒤로가기 하면 판이 통째로 날아간 채 앱 밖으로 나갔다.
  //  → 인게임 진입 시 가드 엔트리를 하나 쌓아두고, 뒤로가기가 그걸 소비하면 **일시정지 모달**로 받은 뒤 가드를 재장전한다.
  //  URL은 그대로(pushState에 같은 경로)라 라우터는 영향 없음. 정상 종료 시 cleanup에서 가드를 되돌린다.
  useEffect(() => {
    if (screen !== 'game' || isPreview) return undefined;
    const GUARD = { tgBackGuard: true };
    window.history.pushState(GUARD, '');
    const onPop = () => { setPaused(true); window.history.pushState(GUARD, ''); }; // 재장전 — 연속 뒤로가기도 계속 막힘
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // 게임을 정상적으로 벗어났으면 우리가 넣은 가드 엔트리를 스택에서 되돌린다(뒤로가기 기록 오염 방지)
      if (window.history.state && window.history.state.tgBackGuard) window.history.back();
    };
  }, [screen, isPreview]);

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

  // 단어 숙련도 뷰 데이터 (글로벌 stats + 풀 → 복습필요 리스트/마스터 수/복습단어).
  // ★useMemo — 예전엔 매 렌더마다 전 단어 spread 복제+정렬+localStorage 파싱이 무조건 실행(게임 중 탭 하나에도 수백 객체 재생성).
  //   게임 중엔 안 쓰는 데이터라 화면 전환(screen)·풀 로드 시에만 재계산. wordStatsRef는 ref(비반응)지만
  //   통계가 바뀐 뒤 이 데이터를 읽는 경로(런 종료→end→홈/숙련도/모드선택)가 전부 screen 전환을 동반해 항상 신선하다.
  const { reviewRows, masteredN, achDot } = useMemo(() => {
    const pv = isPreview && previewScreen === 'mastery';
    const stats = pv ? (qs('empty') ? {} : PREVIEW_MASTERY.stats) : wordStatsRef.current;
    const map = pv ? PREVIEW_MASTERY.map
      : DIFFICULTIES.reduce((m, d) => { for (const w of (wordPoolByDiff[d.id] || [])) m[w.hanzi] = { ...w, diff: d.label }; return m; }, {});
    const rows = buildReviewList(stats, map);
    return {
      masteryTones: pv ? (qs('empty') ? {} : PREVIEW_TONE) : toneStatsRef.current,
      reviewRows: rows, // 숙련도 화면 약점 리스트 표시용

      // 등급 표시용 마스터 수 = max(현재 통계, 동기화 mc) — mc는 last-writer라 진짜 강등은 반영되고,
      // 트림된 동기화 사본(현재 통계가 부분집합인 기기)에서만 mc가 하한 역할(아티팩트 강등 방지).
      masteredN: Math.max(masteredCount(stats, map), isPreview ? 0 : loadMasteredSync(studentToken)),
      achDot: isPreview ? qs('achdot') === '1' : hasUnseenAchievements(studentToken), // 홈 '업적' 레드닷(미확인 획득)

    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, wordPoolByDiff, isPreview, previewScreen, studentToken]);

  const word = words[wordIndex];
  const avgMsForResult = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
  // practice 엔진의 화면 표기 — 모드선택에서 온 '트레이닝'과 오답 노트에서 온 '오답 복습'을 구분(엔진은 동일).
  const practiceLabel = practiceKind === 'review' ? '오답 복습' : '트레이닝';
  // 연음(반3성) 각인 — 3성+2성 단어면 완성 순간 두 글자 위에 마크 표시. 일반·테마·복습만(연습·무한 제외).
  const wordLianyin = (word && !practiceMode && !endlessMode) ? findLianyin(word.tones) : -1;
  const wordSandhi = (word && !practiceMode && !endlessMode) ? findToneSandhi(word.tones) : -1;

  if (error) return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TG.DANGER, fontSize: 14, background: TG.BG }}>정보를 불러오지 못했어요</div>;
  if (splash || !student) return <SplashScreen />; // 스플래시가 로딩 상태도 겸함

  // ── 온보딩 순서(2026-08-07 UX 검수 · 사용자 지정) ──────────────────────────
  //   소개 → 튜토리얼 → **입문 1 한 판** → 닉네임 → 홈(코치마크) → 모드/난이도(각 화면 코치마크)
  //   핵심: "게임을 해보기 전에는 아무것도 설명하지 않는다". 닉네임도 재미를 느낀 뒤에 묻는다.
  const markIntroSeen = () => { try { localStorage.setItem('tg_intro_seen', '1'); } catch { /* noop */ } };
  const markOnboarded = () => { try { localStorage.setItem('tg_onboarded', '1'); } catch { /* noop */ } };
  const needsOnboardNick = () => { try { return !localStorage.getItem('tg_nick_set'); } catch { return false; } };
  // ★닉네임 대기 상태는 **localStorage**에 남긴다 — ref로만 들고 있으면 온보딩 입문 1 도중 새로고침/앱 종료 시
  //   플래그가 사라져 닉네임 화면을 영영 못 본다(게스트는 나중에 닉네임 변경 경로도 없음). 2026-08-08 발견.
  //   기존 사용자(닉네임 미설정 레거시)는 이 플래그가 없으므로 붙잡히지 않는다 — ref를 썼던 원래 의도는 그대로 유지.
  const NICK_PENDING = 'tg_nick_pending';
  const markNickPending = () => { try { localStorage.setItem(NICK_PENDING, '1'); } catch { /* noop */ } };
  // 온보딩 마무리(닉네임 저장 후) → **홈**. 홈 코치마크가 여기서 처음 돈다(구: 모드선택으로 직행).
  const finishOnboard = () => { markOnboarded(); if (!isPreview) track('onboarding_done', { k: identity.kind }); setScreen('home'); };
  finishOnboardRef.current = finishOnboard;
  // 튜토리얼 완료 → **완료 비트** → 입문 1 한 판. 여기서 tg_onboarded를 세워 새로고침 시 튜토리얼이 반복되지 않게 한다.
  //  ★비트를 거치는 이유: 튜토리얼 끝 0.2초 만에 카운트다운 웨이브가 덮쳐 "너무 갑작스럽다"(2026-08-07 사용자).
  //   비트가 마무리 + 무엇이 시작되는지를 알린 뒤 카운트다운으로 넘긴다. (닉네임은 이 판 끝나고 홈으로 나갈 때)
  const afterTutorial = () => {
    markOnboarded();
    if (needsOnboardNick()) markNickPending();           // 이 판을 끝내고 홈으로 나갈 때 닉네임을 묻는다(새로고침에도 살아남음)
    onboardingRunPendingRef.current = true;             // 비트 뒤 시작될 입문 1을 '튜토리얼 연장선'으로 표시
    setTutorialDone({ stageLabel: STAGES[0].label, total: ROUND_LENGTH });
  };
  // 홈에서 [게임시작] — 튜토리얼 미완이면 인게임 튜토리얼부터(소개는 홈 앞에서 이미 봄), 완료면 바로 모드선택.
  const goFromStart = () => {
    let done = false;
    try { done = !!localStorage.getItem('tg_onboarded'); } catch { /* noop */ }
    if (done) setScreen('modeselect'); else setScreen('tutorial');
  };

  // 성취 표시 데이터(P3) — 시작/업적 화면에서만 localStorage 조회(게임 중 불필요). 미리보기는 샘플.
  // 공통 탭바 내비(2026-07-27 리디자인) — 탭 전환 = 화면 교체. 업적 진입 시 미확인 획득 확인 처리 유지.
  const tabNav = (k) => {
    playSfx('button');
    if (k === 'home') setScreen('home');
    else if (k === 'mastery') setScreen('mastery');
    else if (k === 'ach') { if (!isPreview) markAchievementsSeen(studentToken, loadAchievements(studentToken)); setScreen('achievements'); }
    else if (k === 'play') setScreen('play');
    else if (k === 'hub') setScreen('linkhub');
  };
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
      const lv = toneLevelBand(acc); // 밴드 규칙은 toneLevelBand 단일 출처(스냅샷 파생과 동일)
      toneLevels[t] = { lv, prog: acc };
      toneStatus[t] = { acc, attempts, state: lv <= 2 ? 'weak' : lv === 3 ? 'mid' : 'strong' };
    }
  }
  // 첫 코치 안내가 가리킬 약점 성조(시도 3+ 중 정답률 최저). 없으면 null.
  const coachTone = !showStartData ? null : isPreview ? 1 : ((weakestTone(toneStatsRef.current || {}, 3) || {}).tone ?? null);

  // 업적 화면 진행도 스냅샷 — 업적 화면에서만 집계(다른 화면 렌더 비용 0). 미리보기는 샘플.
  const achSnapshot = screen !== 'achievements' ? null
    : isPreview
      ? { playCount: 8, maxComboEver: 13, bestByDiff: { easy: 1350, normal: 600, hard: 0 }, endlessBest: 0, masteredCount: 12, bestScoreAny: 1350, streakLongest: 5, toneStats: PREVIEW_TONE, reviewMastered: 2 }
      : buildAchSnapshot(studentToken, masteredN, toneStatsRef.current, startStreakLongest);

  // 화면별 본문 (카운트다운 오버레이/일시정지 모달은 아래에서 위에 덧댐)
  const exitGame = () => { window.location.href = '/'; }; // 게임은 독립 — 항상 게임 홈으로(학생앱 복귀 경로 폐기, 2026-07-12)
  let content;
  if (isPreview && previewScreen === 'fx') { // [임시·DEV] 파티클 검수 랩 (?screen=fx) — 검수 후 이 분기 + _ParticleLab.jsx 삭제
    content = <ParticleLab onBack={exitGame} />;
  } else if (isPreview && previewScreen === 'sfxlab') { // [임시·DEV] 효과음/배경음 검수 랩 (?screen=sfxlab) — 검수 후 이 분기 + _SfxLab.jsx 삭제
    content = <SfxLab onBack={exitGame} />;
  } else if (screen === 'title') {
    content = <TitleScreen onStart={() => tipTransitionTo('home')} />;
  } else if (screen === 'home') {
    // 공통 탭바 내비 — 홈·등급·업적·놀러가기·하늘하늘(2026-07-27 리디자인). 아래 mastery/achievements/play/linkhub 분기와 공유.
    content = (
      // 홈도 다른 탭과 **같은 자리**에서 같은 FigmaScreen으로 — 탭 전환 시 remount(진입 페이드 재생 → 탭바 깜빡임) 방지
      <FigmaScreen bg={HOME.FLOOR} enter>
      <HomeScreen streak={startStreak} streakLongest={startStreakLongest} freezes={startFreezes} xp={xp} rank={rank} onExam={() => startExam()}
      toneLevels={toneLevels}
      toneStatus={toneStatus} coachTone={coachTone} celebrateTone={celebrateTone}
      levelReveals={toneLevelChanges} onRevealsDone={() => setToneLevelChanges([])} revealHold={isPreview && previewScreen === 'tonelevel'}
      onPlay={goFromStart}
      onNavTab={tabNav}
      onHelp={() => setHelpOpen(true)}
      onLogin={identity.kind === 'guest' ? () => setScreen('login') : null}
      isMemberUser={identity.kind === 'member'} memberName={identity.kind === 'member' ? memberNick : null}
      nickname={isPreview ? (qs('nick') || '하늘') : identity.kind === 'member' ? memberNick : guestNick}
      onEditNickname={identity.kind === 'member' ? editNickname : null}
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
          localStorage.removeItem('tg_nick_set'); localStorage.removeItem('tg_nick_pending'); // 닉네임 단계까지 포함해 온보딩 전체를 재현
        } catch { /* noop */ }
        setScreen('intro');
      }) : undefined} />
      </FigmaScreen>
    );
  } else if (screen === 'nickname') { // 온보딩 마지막 — 튜토리얼 뒤 이름 정하기(게스트 포함 전원 1회)
    content = (
      <FigmaScreen enter>
        <NicknameScreen defaultName={isPreview ? (qs('nick') || onboardNickRef.current || '') : (onboardNickRef.current || '')}
          saving={savingNick} onSubmit={isPreview ? () => {} : submitOnboardNick} />
      </FigmaScreen>
    );
  } else if (isPreview && previewScreen === 'nickedit') { // [DEV] 닉네임 변경 모달 미리보기(?screen=nickedit&nick=…)
    content = <FigmaScreen bg={TG.BG}><NicknameEditModal current={qs('nick') || '졸린토끼'} onSave={() => {}} onClose={() => {}} /></FigmaScreen>;
  } else if (screen === 'login') {
    content = <FigmaScreen enter><LoginScreen onBack={() => setScreen('home')} /></FigmaScreen>;
  } else if (screen === 'mastery') {
    content = (
      <FigmaScreen enter>
        <MasteryScreen rows={reviewRows} onReview={() => startReview(reviewRows)} onPlay={goFromStart} tabNav={tabNav} />
      </FigmaScreen>
    );
  } else if (screen === 'achievements') {
    content = (
      <FigmaScreen enter>
        <AchievementsScreen earned={startAchievements} snapshot={achSnapshot} onToast={showToast} tabNav={tabNav} />
      </FigmaScreen>
    );
  } else if (screen === 'play') { // 놀러가기 탭 화면(구 PlayModal)
    content = <FigmaScreen bg={TG.BG} enter><PlayScreen tabNav={tabNav} /></FigmaScreen>;
  } else if (screen === 'linkhub') { // 하늘하늘 탭 화면(구 플로팅 허브 오버레이)
    content = <FigmaScreen bg={TG.BG} enter><LinkHubScreen tabNav={tabNav} /></FigmaScreen>;
  } else if (screen === 'intro') {
    content = (
      <FigmaScreen enter>
        {/* 소개 다음은 **바로 튜토리얼** — 구버전은 홈을 먼저 보여주고 코치마크 4개를 돌렸는데,
            게임을 한 번도 안 해본 상태에서 등급·연속학습을 설명하는 셈이라 첫 한자까지 탭이 13번이었다.
            홈 코치마크는 첫 판을 끝내고 홈에 도착할 때 돈다(2026-08-07 UX 검수 · 사용자 지정 순서). */}
        <IntroScreen onNext={() => { markIntroSeen(); setScreen('tutorial'); }} />
      </FigmaScreen>
    );
  } else if (screen === 'tutorial') {
    // 온보딩 경로면 완료 시 모드선택(finishOnboard) · 메뉴 '게임 방법' 경로면 홈 복귀(플래그 미변경)
    content = <FigmaScreen enter><TutorialScreen onDone={tutorialFromHelp ? () => { setTutorialFromHelp(false); setScreen('home'); } : afterTutorial} /></FigmaScreen>;
  } else if (screen === 'modeselect') {
    content = (
      <FigmaScreen enter>
        <ModeScreen endlessUnlocked={isPreview ? qs('locked') !== '1' : isEndlessUnlocked(studentToken, rank)} endlessBest={loadEndlessBest(studentToken)?.bestScore || 0}
          onDifficulty={() => { playSfx('button'); setScreen('difficulty'); }}
          onTheme={() => { playSfx('button'); setScreen('theme'); }}
          onEndless={() => { playSfx('button'); startEndless(); }}
          onTraining={() => { playSfx('button'); setSuggestPractice(false); startTraining(); }}
          highlightPractice={suggestPractice || (isPreview && qs('nudge') === '1')} onHighlightDone={() => setSuggestPractice(false)}
          onBack={() => setScreen('home')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'difficulty') {
    content = (
      <FigmaScreen enter>
        <DifficultyScreen selected={selectedDifficulty} studentToken={studentToken} rank={rank} onSelect={setSelectedDifficulty} onStart={(item) => (item && item.kind === 'boss' ? startExam(item.tierIdx) : startGame(item))} onBack={() => setScreen('modeselect')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'theme') {
    content = (
      <FigmaScreen enter>
        <ThemeScreen themes={THEMES} studentToken={studentToken}
          counts={THEMES.reduce((m, t) => { m[t.id] = (wordPoolByTheme[t.id] || []).length; return m; }, {})}
          onStart={startTheme} onBack={() => setScreen('modeselect')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'end') {
    // 난이도(스테이지) 모드 — 다음 스테이지가 '해제 상태'면 결과화면에 바로 도전 버튼. 스테이지 점수는 종료 이펙트에서 저장돼 이 시점 해제상태는 최신.
    const ci = STAGES.findIndex((s) => s.id === selectedDifficulty.id);
    const nextStage = (!practiceMode && !endlessMode && !themeMode && selectedDifficulty.bandIndex != null && ci >= 0) ? STAGES[ci + 1] : null;
    const canNextStage = !!(nextStage && isStageUnlocked(studentToken, nextStage));
    // 결과화면 '승급시험' 버튼 — 급 5스테이지 다 깼고(isTierCleared) 아직 그 급 승급시험 미통과(rank<=tierIdx, 승급시험 있는 급=입문·실전).
    //  고득점 조기 유도는 여기(결과 버튼) 대신 승급시험 유도 '모달'이 담당(2026-07-23). 승급시험 자체는 사다리에서 상시 응시.
    const tierIdx = (!practiceMode && !endlessMode && !themeMode && selectedDifficulty.tier) ? DIFFICULTIES.findIndex((d) => d.id === selectedDifficulty.tier) : -1;
    const examReady = tierIdx >= 0 && tierIdx < BOSSES.length && rank <= tierIdx && isTierCleared(studentToken, selectedDifficulty.tier);
    // 온보딩 첫 판(튜토리얼 직후 입문 1)인가 — 이 판의 결과화면은 **'홈으로 가기' 하나만** 둔다.
    //  다시하기·다음 스테이지를 열어두면 닉네임·홈 코치마크를 건너뛴 채 계속 플레이하게 되어 온보딩이 끊긴다(2026-08-07 사용자).
    //  ref는 첫 홈 진입에서 소비되므로 이 화면이 떠 있는 동안에만 true.
    const onboardingRun = onboardingRunRef.current;
    // 이 판을 마치면 실제로 닉네임 화면이 뜨는가 — 그때만 버튼 라벨을 '닉네임 설정하기'로 바꾼다.
    //  (닉네임이 이미 있는 채로 온보딩을 다시 도는 경우엔 곧장 홈이라 '홈으로 가기'가 맞다)
    const nickNext = onboardingRun && (() => {
      try { return !!localStorage.getItem('tg_nick_pending') && !localStorage.getItem('tg_nick_set'); } catch { return false; }
    })();
    // 다음 목적지 라벨 — 승급시험이 우선(examReady), 아니면 다음 스테이지 이름.
    //  ★"다음 칸이 열렸다"는 신호는 이 라벨이 전부 담당한다(별·정답수·해제 배지는 2026-08-07 사용자 요청으로 제거).
    const continueLabel = examReady ? `${BOSSES[tierIdx]?.nextLabel || ''} 승급시험`.trim()
      : (canNextStage && nextStage) ? `${nextStage.label} 도전` : '계속하기';
    content = (
      <FigmaScreen enter>
        <ResultScreen score={score} maxCombo={maxCombo} avgMs={avgMsForResult}
          title={practiceMode ? practiceLabel : endlessMode ? '무한 모드' : themeMode ? (selectedTheme?.label || '테마') : (selectedDifficulty?.label || '')} /* 시안 12: 헤더 "{스테이지} 결과화면" */
          onExam={(examReady || (isPreview && previewScreen === 'end' && qs('exam') === '1')) ? () => startExam(tierIdx >= 0 ? tierIdx : rank) : undefined}
          onNextLevel={canNextStage ? () => startGame(nextStage) : undefined}
          isNewBest={practiceMode ? false : (isNewBest || (isPreview && qs('newbest') === '1'))} previousBest={practiceMode ? 0 : (isPreview && qs('newbest') === '1' ? 800 : previousBest)}
          suggestPractice={(suggestPractice && !practiceMode && !endlessMode && !themeMode && (selectedDifficulty.tier || selectedDifficulty.id) === 'easy') || (isPreview && previewScreen === 'end' && qs('suggest') === '1')}
          coachReady={!showGameOverBeat && !rankUp && !modeUnlock && celebrationQueue.length === 0} /* 결과 코치+트레이닝유도 둘 다 이 게이트 뒤에서만 */
          practice={practiceMode} endless={endlessMode} endKind={endKind}
          onRetry={practiceMode ? (practiceKind === 'review' ? () => startReview(reviewRows) : () => startTraining()) : endlessMode ? () => startEndless() : themeMode ? () => startTheme(selectedTheme) : () => startGame(selectedDifficulty)}
          onHome={() => tipTransitionTo('home')}
          onLogin={identity.kind === 'guest' ? () => setScreen('login') : null}
          continueLabel={continueLabel}
          homeOnly={onboardingRun || (isPreview && previewScreen === 'end' && qs('homeonly') === '1')}
          homeLabel={(nickNext || (isPreview && qs('nicknext') === '1')) ? '닉네임 설정하기' : '홈으로 가기'}
          homeHint={(nickNext || (isPreview && qs('nicknext') === '1')) ? '이제 이름만 정하면 돼요!' : '홈에서 이어서 해요!'}
          retryLabel={practiceMode ? `한 번 더 ${practiceLabel}` : undefined} />
      </FigmaScreen>
    );
  } else if (screen === 'examresult') {
    // [DEV] 미리보기 ?screen=examresult&pass=1&correct=18 로 합격/불합격 화면 검수
    const er = examResult || (isPreview
      ? { correct: qs('correct') != null ? Number(qs('correct')) : (qs('pass') === '1' ? 18 : 12), total: EXAM_QUESTIONS, passed: qs('pass') === '1' }
      : { correct: 0, total: EXAM_QUESTIONS, passed: false });
    content = (
      <FigmaScreen enter>
        <ExamResultScreen correct={er.correct} total={er.total} passed={er.passed}
          title={(BOSSES[examTierRef.current] || BOSSES[0])?.label} /* 예: "실전 승급시험" — 통과 시 승급하는 다음 급 이름 */
          maxCombo={isPreview ? (Number(qs('combo')) || 4) : maxCombo}
          avgMs={isPreview ? (Number(qs('avgms')) || 700) : avgMsForResult}
          onRetry={() => startExam(examTierRef.current)} /* 보스 모델: 불합격해도 언제든 재도전(XP 게이트 없음) */
          onContinue={er.passed ? () => setScreen('difficulty') : null} /* 합격 → 새로 열린 급 확인(사다리) */
          onHome={() => tipTransitionTo('home')} /> {/* 승급시험 결과(인게임) → 홈(아웃게임): 팁 전환 */}
      </FigmaScreen>
    );
  } else { // game
    // 시안 09: 배경은 크림 단색 + 들판 일러스트뿐 — 구 컬러 블롭 메시(BG_MESH) 제거(2026-08-04)
    // 헤더 스테이지명 — ★승급시험은 BOSSES 라벨("실전 승급시험"). startExam이 타이머 페이스용으로
    //  selectedDifficulty를 '출발 급'(입문)으로 덮어써서, 그대로 쓰면 시험 내내 그냥 "입문"으로 보인다
    //  → 20문제 시험인지 일반 10문제 판인지 구별이 안 됐다(2026-08-07 UX 검수).
    const gameTitle = examMode ? (BOSSES[examTierRef.current]?.label || '승급시험')
      : practiceMode ? practiceLabel
      : endlessMode ? '무한 모드'
      : themeMode ? (selectedTheme?.label || '테마')
      : (selectedDifficulty?.label || '');
    content = (
      <FigmaScreen>
        {word && (
          <GameScreen title={gameTitle} word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut}
            wordIndex={wordIndex} wordsLen={words.length} wordTimeLimit={wordTimeLimit} gaugeOffsetMs={gaugeOffsetMs} lowTime={lowTime} paused={paused || !!cdPhase || suddenIntro || !!examIntro} endless={endlessMode || (isPreview && qs('endless') === '1')} lives={lives} showSudden={suddenIntro} runId={runId} recordToBeat={recordToBeat}
            combo={combo} comboFlash={comboFlash} floatScore={floatScore} score={score} coachText={coach.text}
            onTone={handleTone} wrongBtn={wrongBtn} wrongShakeKey={wrongShakeKey} onPause={() => setPaused(true)} onEndTraining={endTraining} endLabel={`${practiceLabel} 종료`} playReveal={!cdPhase}
            practice={practiceMode} endKind={endKind} listen={wordIsListen} audioOff={audioOff}
            draw={wordIsDraw} drawExpectedTone={word ? word.tones[currentSyl] : undefined} onDraw={handleTone} drawResetKey={`${runId}-${wordIndex}-${currentSyl}`} lianyinAt={wordLianyin} sandhiAt={wordSandhi}
            onReplay={() => word && speakWord(word)} onCantHear={() => { audioOffRef.current = true; setAudioOff(true); }}
            onHint={(practiceMode || examMode) ? undefined : () => { if (!word) return; hintUsedRef.current = true; speakWord(word); if (!hasMistake) { setHasMistake(true); setCombo(0); } }} hintUsed={hasMistake}
            onSkip={practiceMode || examMode ? undefined : skipWord}
            onSpeak={() => { if (!word) return; hintUsedRef.current = true; speakWord(word); }} onReveal={revealAnswer}
            hideMeaning={hideMeaning} hidePinyin={hidePinyin}
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
    // 게임 전체를 9:16 가운데 컬럼에 가둔다 — 모달·전환·코치마크(fixed)까지 이 영역 밖으로 안 나감
    <GameStage>
      {content}
      {/* 화면전환은 항상 최상단 — 코치마크(500)·토스트/축하(300)·비트(120~135)까지 모두 덮음.
          슬라이드는 게임 컬럼(9:16) 안에서만 일어난다(TxLayer) — 창 전체가 밀리던 문제 수정(2026-08-03) */}
      {homeTx && <TxLayer style={homeTxStyle}><LoadingTip /></TxLayer>}
      {cdPhase && (
        <TxLayer style={cdStyle}>
          <CountdownVisual n={cdNum} />
        </TxLayer>
      )}
      {paused && (
        // onQuit=인게임 이탈 → 홈: '오늘의 팁' 웨이브 전환. tipTransitionTo가 clearTimers로 보류 큐까지 비워 기록 오염(2026-07-07 버그) 방지.
        <PauseModal score={score} combo={combo} crutchCtx={crutchCtx} onResume={() => setPaused(false)}
          onRestart={() => { setPaused(false); if (endlessMode) startEndless(); else if (practiceMode) startTraining(); else if (themeMode) startTheme(selectedTheme); else startGame(selectedDifficulty); }}
          onQuit={() => tipTransitionTo('home')} />
      )}
      {toast && <GameToast key={toast.key} msg={toast.msg} kind={toast.kind} />}
      {/* 게임 방법 확인 팝업 — 확인 시 인게임 튜토리얼로(완료 후 홈 복귀) */}
      {helpOpen && <HelpStartModal onStart={() => { setHelpOpen(false); setTutorialFromHelp(true); setScreen('tutorial'); }} onClose={() => setHelpOpen(false)} />}
      {/* 트레이닝 유도 — 초급 연속 저조 후 '홈으로 가기'로 나오면 홈(전환 끝난 뒤)에서 비강제 모달로 제안. 미리보기 ?screen=home&nudge=1 */}
      {screen === 'home' && !homeTx && (suggestPractice || (isPreview && qs('nudge') === '1')) && (
        <TrainingNudgeModal onStart={() => { setSuggestPractice(false); startTraining(); }} onClose={() => setSuggestPractice(false)} />
      )}
      {/* 비트 공용 딤 — 종료 체인(게임오버/신기록 → XP → 등급승급 → 모드해제)이 **하나라도** 떠 있는 동안 유지.
          비트마다 자기 딤을 갖고 있던 구조에선 비트가 교대하는 사이 딤이 잠깐 걷혀 깜빡였다(2026-08-08 사용자 지적). */}
      <BeatDim active={
        (showGameOverBeat && !examMode)
        || !!(xpGain && !isPreview && screen === 'game')
        || !!rankUp || !!modeUnlock
        || (isPreview && ['gameover', 'xpgain', 'rankup', 'modeunlock'].includes(previewScreen))
      } />
      {/* 게임오버 비트 — 게임 화면 위 오버레이(결과화면 직전). ~2초 후 결과('end')로 진행.
          신기록 판이면 어두운 게임오버 대신 밝은 '신기록!' 축하 비트로 교체(정확한 인지 + 기분좋게). onDone 로직은 공통. */}
      {showGameOverBeat && !examMode && (() => {
        const finishBeat = () => {
          setShowGameOverBeat(false);
          // XP 적립 — 일반·무한·테마만(beatOutcome이 그 외엔 null). 게이지만 채움: 등급 승급은 승급 시험 합격으로만(자동승급 없음).
          //  결과화면(screen 'end') 이펙트는 이 시점 이후라, 여기서 먼저 적립해야 회원 동기화가 최신 XP를 본다.
          if (!isPreview && beatOutcome) {
            const gained = gameXpGain({ score, correct: answeredCount, isNewBest: beatOutcome.isNewBest });
            const prevXp = loadXp(studentToken) ?? 0;
            const newXp = addXp(studentToken, gained);
            setXp(newXp);
            // (구 XP기반 '승급 시험 권유'는 폐기 — 승급은 사다리 보스로만. XP는 레벨을 채움.)
            if (gained > 0) {
              // XP 획득 연출(등급업 연출 자리) — 요소 하나씩 '쾅' + 게이지 차오름 → onDone에서 결과화면.
              setXpGain({ gained, prevXp, newXp, score, correct: answeredCount, isNewBest: beatOutcome.isNewBest });
              return;
            }
          }
          setScreen('end');
        };
        // 미리보기: ?screen=gameover&newbest=1 로 신기록 비트 확인(샘플 812 / 이전 800).
        const previewNewBest = isPreview && previewScreen === 'gameover' && qs('newbest') === '1';
        const hold = isPreview && previewScreen === 'gameover';
        if (beatRecord || previewNewBest) {
          return (
            <NewRecordBeat
              score={previewNewBest ? 812 : score}
              previousBest={previewNewBest ? 800 : (beatOutcome?.previousBest ?? 0)}
              hold={hold} onDone={finishBeat} />
          );
        }
        return <GameOverBeat endKind={endKind} hold={hold} onDone={finishBeat} />;
      })()}
      {/* 튜토리얼 완료 비트 — 튜토리얼 화면 위에 떴다가 onDone에서 입문 1 시작(카운트다운은 그 뒤). 미리보기 ?screen=tutorialdone */}
      {tutorialDone && (
        <TutorialDoneBeat
          stageLabel={tutorialDone.stageLabel} total={tutorialDone.total}
          hold={isPreview && previewScreen === 'tutorialdone'}
          onDone={() => {
            setTutorialDone(null);
            startGame(STAGES[0]);
            // startGame → resetRunState가 플래그를 내리므로 **그 뒤에** 세운다(성조 정확도 미반영 표시)
            onboardingRunRef.current = onboardingRunPendingRef.current;
            onboardingRunPendingRef.current = false;
          }} />
      )}
      {/* 승급시험 진입 연출 — 시험 런이 라이브가 되면(카운트다운 후) 인게임 오버레이로 노출 → onDone(탭/자동)에서 첫 문제 시작. 미리보기 ?screen=examintro&tier= */}
      {examIntro && (
        <ExamIntroReveal
          tier={examIntro.tier}
          tierLabel={examIntro.tierLabel}
          total={EXAM_QUESTIONS}
          hold={isPreview && previewScreen === 'examintro'}
          onDone={() => setExamIntro(null)} />
      )}
      {/* 등급 상승 연출 — 비트 다음·결과 전(누적 XP가 다음 등급 임계를 넘겼을 때). 강등 없음. 미리보기 ?screen=rankup */}
      {(rankUp || (isPreview && previewScreen === 'rankup')) && (
        <RankUpReveal
          prevIdx={rankUp ? rankUp.prevIdx : 1}
          nowIdx={rankUp ? rankUp.nowIdx : 2}
          hold={isPreview && previewScreen === 'rankup'}
          onDone={() => { setRankUp(null); setScreen(examResult ? 'examresult' : 'end'); }} />
      )}
      {/* 경험치 획득 연출 — 비트 다음·결과 전. 요소 하나씩 '쾅' + 게이지 차오름. 미리보기 ?screen=xpgain */}
      {((xpGain && !isPreview && screen === 'game') || (isPreview && previewScreen === 'xpgain')) && (() => {
        const g = isPreview
          ? { gained: Number(qs('xpgain') || 936), prevXp: Number(qs('xp') || 3000), newXp: Number(qs('xp') || 3000) + Number(qs('xpgain') || 936), score: Number(qs('score') || 800), correct: Number(qs('correct') || 12), isNewBest: qs('newbest') === '1' }
          : xpGain;
        return <XpGainReveal gained={g.gained} prevXp={g.prevXp} newXp={g.newXp} score={g.score} correct={g.correct} isNewBest={g.isNewBest}
          rank={isPreview ? Number(qs('rank') || 0) : rank} onDone={() => { if (!isPreview) setScreen('end'); }} />;
      })()}
      {/* [DEV] 설정 모달 미리보기(?screen=settings) — 머지 전 백도어 제거 대상 */}
      {/* 모드 잠금해제 연출 — 결과 위, 업적보다 먼저. 미리보기 ?screen=modeunlock */}
      {modeUnlock && (
        <ModeUnlockReveal unlock={modeUnlock} hold={isPreview && previewScreen === 'modeunlock'}
          onDone={() => setModeUnlock(null)} />
      )}
      {/* 업적 획득 축하 오버레이(P4) — 큐 맨 앞 1장, 탭/CTA로 다음. 모드해제 연출 끝난 뒤 표시 */}
      {celebrationQueue.length > 0 && !modeUnlock && (
        <CelebrationOverlay achievement={celebrationQueue[0]}
          onNext={() => setCelebrationQueue((q) => q.slice(1))} />
      )}
      {/* 승급시험 유도 모달 — 고득점(완벽2)+다음급 미개방 시 결과화면 위로(다른 연출 끝난 뒤). 프리뷰 ?screen=home&examprompt=1 */}
      {examPrompt && !rankUp && !modeUnlock && celebrationQueue.length === 0 && (screen === 'end' || isPreview) && (
        <ExamPromptModal
          nextLabel={DIFFICULTIES[examPrompt.tierIdx + 1]?.label || ''}
          onStart={() => { const t = examPrompt.tierIdx; setExamPrompt(null); startExam(t); }}
          onClose={() => setExamPrompt(null)} />
      )}
    </GameStage>
  );
}
