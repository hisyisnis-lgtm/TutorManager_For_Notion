// 수업 횟수에 따라 팬더가 성장하는 인터랙티브 위젯
import {
  useState,
  useRef,
  useEffect,
  useCallback } from 'react';
import PandaGameView from './PandaGameView.jsx';
import PandaWardrobe from './PandaWardrobe.jsx';
import PandaFeedLeaf from './PandaFeedLeaf.jsx';
import usePandaGame from '../../hooks/usePandaGame.js';
import { PANDA_ADULT_FED, PANDA_ADULT_LEVEL, PANDA_ADULT_LEVEL_FOOD, PANDA_GROWTH_THRESHOLDS, getPandaLevelInfo, getWearablePandaWardrobe, pandaEquippedToWardrobe } from '../../constants/pandaWardrobe.js';
import { PANDA_MOTION_DURATION } from '../../constants/pandaMascot.js';
import { PANDA_GAME_THEME } from '../../constants/pandaGameTheme.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';
import { createPandaFeedFlight, getPandaFeedingTarget, PANDA_FEED_FLIGHT_MS, PANDA_FEED_STAGGER_MS } from '../../constants/pandaFeedMotion.js';
import usePandaGrowthFeedback from '../../hooks/usePandaGrowthFeedback.js';

export const STAGES = [
  { label: '알', message: '곧 만날 날을 기다리고 있어요 🥚' },
  { label: '알에서 깨어나는 판다', message: '반가워요! 이제 막 깨어났어요 🌱' },
  { label: '아기 판다', message: '조금씩 쑥쑥 자라고 있어요 🍼' },
  { label: '어린이 판다', message: '함께 배우고 놀아요 🧩' },
  { label: '청소년 판다', message: '하루하루 더 자라고 있어요 📖' },
  { label: '다 자란 판다', message: '함께해서 멋지게 자랐어요 🌿' },
].map((stage, index) => ({ ...stage, min: PANDA_GROWTH_THRESHOLDS[index],
  max: (PANDA_GROWTH_THRESHOLDS[index + 1] ?? Infinity) - 1, nextAt: PANDA_GROWTH_THRESHOLDS[index + 1] ?? null }));

export function getStageInfo(fedTotal) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (fedTotal >= STAGES[i].min) return { stage: STAGES[i], idx: i };
  }
  return { stage: STAGES[0], idx: 0 };
}

// 옛 공통 키 — 학생 구분 없이 모든 학생의 EXP가 섞여 누적되던 버그가 있었음.
// 호환을 위해 export는 유지하되, 신규 호출부는 getPandaStorageKey(studentToken) 사용.
export const PANDA_FEED_KEY = 'panda_fed_total';

/**
 * 학생별 EXP 저장소 키. studentToken이 없으면 옛 공통 키로 fallback.
 * PandaPage·PersonalPage 등 학생 컨텍스트가 있는 곳은 반드시 이 헬퍼 사용.
 */
export function getPandaStorageKey(studentToken) {
  return studentToken ? `panda_fed_total_${studentToken}` : PANDA_FEED_KEY;
}

const DEFAULT_FEED_KEY = PANDA_FEED_KEY;
const FEED_PARTICLE_SIZE = 30;
let _pid = 0;

function makeBezierKeyframes(p1x, p1y, p2x, p2y, opacityFn, scaleFn, steps = 20) {
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = (2 * mt * t * p1x + t * t * p2x).toFixed(2);
    const y = (2 * mt * t * p1y + t * t * p2y).toFixed(2);
    const pct = (t * 100).toFixed(1);
    const opacity = Math.max(0, opacityFn(t)).toFixed(3);
    const scale = Math.max(0, scaleFn(t)).toFixed(3);
    frames.push(`${pct}%{transform:translate(${x}px,${y}px) scale(${scale});opacity:${opacity}}`);
  }
  return frames.join('');
}

function injectKeyframe(name, body) {
  const el = document.createElement('style');
  el.id = `kf-${name}`;
  el.textContent = `@keyframes ${name}{${body}}`;
  document.head.appendChild(el);
}

function makeFeedParticle(srcX, srcY, destX, destY, particleDelay = 0) {
  const pid = ++_pid;
  const kfName = `panda-feed-${pid}`;
  const frames = createPandaFeedFlight({ from: { x: srcX, y: srcY }, to: { x: destX, y: destY }, viewportWidth: window.innerWidth });
  const body = frames.map(({ offset, x, y, rotation, scale, opacity }) =>
    `${(offset * 100).toFixed(2)}%{transform:translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)});opacity:${opacity.toFixed(3)}}`).join('');
  injectKeyframe(kfName, body);
  return { id: pid, type: 'feed', x: srcX - FEED_PARTICLE_SIZE / 2, y: srcY - FEED_PARTICLE_SIZE / 2,
    size: FEED_PARTICLE_SIZE, kfName, delay: particleDelay };
}

function makeHeartParticle(pRect, index) {
  const startX = pRect.left + 14 + Math.random() * (pRect.width - 28);
  const startY = pRect.top + 18 + Math.random() * (pRect.height * 0.5);
  const p2x = (Math.random() - 0.5) * 44;
  const p2y = -(62 + Math.random() * 28);
  const p1x = (Math.random() - 0.5) * 72;
  const p1y = -(26 + Math.random() * 26);
  const size = 14 + Math.floor(Math.random() * 10);
  const delay = index * 88;
  const pid = ++_pid;
  const kfName = `panda-heart-${pid}`;
  const body = makeBezierKeyframes(
    p1x, p1y, p2x, p2y,
    t => { if (t < 0.1) return t / 0.1; if (t < 0.62) return 1; return 1 - (t - 0.62) / 0.38; },
    t => { if (t < 0.13) return (t / 0.13) * 1.22; if (t < 0.24) return 1.22 - ((t - 0.13) / 0.11) * 0.22; return 1 - (t - 0.24) * 0.58; },
    18,
  );
  injectKeyframe(kfName, body);
  return { id: pid, type: 'heart', x: startX - size / 2, y: startY - size / 2, kfName, size, delay };
}

/**
 * foodSources: 먹이 공급원 배열
 * 각 항목: { key: string, label: string, count: number }
 * 예시:
 *   [
 *     { key: 'sessions', label: '완료 수업', count: 12 },
 *     { key: 'hw_submit', label: '숙제 제출', count: 3 },
 *   ]
 * 총 먹이 = foodSources의 count 합계
 */
export default function PandaWidget({ storageKey = DEFAULT_FEED_KEY, ...props }) {
  // 학생이 바뀌면 진행 중인 먹이 타이머와 착장을 함께 초기화한다.
  return <PandaWidgetContent key={storageKey} storageKey={storageKey} {...props} />;
}

function PandaWidgetContent({ foodSources = [], storageKey, fullscreen = false, studentToken, serverEnabled, onOpenHelp, speechPaused = false }) {
  const totalFood = foodSources.reduce((sum, source) => sum + Math.max(0, Math.floor(source.count || 0)), 0);
  const game = usePandaGame({ storageKey, earnedTotal: totalFood, studentToken, serverEnabled });
  const { profile, available } = game;
  const [feedDisplay, setFeedDisplay] = useState(null);
  const [revealedFed, setRevealedFed] = useState(profile.fedTotal);
  const reducedMotion = usePrefersReducedMotion();
  const growth = usePandaGrowthFeedback({ fedTotal: revealedFed, reducedMotion });
  const celebrating = Boolean(growth.celebration);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  const [namingMode, setNamingMode] = useState('edit');
  const [namingPending, setNamingPending] = useState(false);
  const [wardrobeGuideOpen, setWardrobeGuideOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [wardrobeHandoff, setWardrobeHandoff] = useState(null);
  const [notice, setNotice] = useState('');
  const [particles, setParticles] = useState([]);
  const [isFeeding, setIsFeeding] = useState(false);
  const [reservedFood, setReservedFood] = useState(0);
  const [action, setAction] = useState({ motion: 'idle', id: 0 });
  const pandaRef = useRef(null);
  const feedBtnRef = useRef(null);
  const feedAllBtnRef = useRef(null);
  const wardrobeTriggerRef = useRef(null);
  const wardrobeGuideConsumedRef = useRef(false);
  const actionTimerRef = useRef(null);
  const feedingRef = useRef(false);
  const timersRef = useRef(new Set());
  const keyframesRef = useRef(new Set());
  const feedQueueRef = useRef([]);
  const drainingFeedRef = useRef(false);
  const reservedFoodRef = useRef(0);
  const chewingRef = useRef(false);
  const confirmedChewUntilRef = useRef(0);
  const feedDisplayRef = useRef(null);
  const mealStartRef = useRef(null);
  const mealResultRef = useRef(null);
  const finishMealRef = useRef(null);
  const aliveRef = useRef(true);
  const gameRef = useRef(game);
  const balanceRef = useRef({ profile, available });
  const availableRef = useRef(available);
  const committedProfileRef = useRef(profile);
  gameRef.current = game;
  // Keep a synchronous balance between an acknowledged commit and React's next render.
  if (balanceRef.current.profile !== profile || balanceRef.current.available !== available) {
    balanceRef.current = { profile, available };
    availableRef.current = available;
    committedProfileRef.current = profile;
  }

  const schedule = useCallback((callback, delay) => {
    const timer = setTimeout(() => { timersRef.current.delete(timer); callback(); }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const cancelTimer = useCallback(timer => {
    clearTimeout(timer);
    timersRef.current.delete(timer);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current, keyframes = keyframesRef.current, feedQueue = feedQueueRef.current;
    return () => {
      aliveRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
      keyframes.forEach(name => document.getElementById('kf-' + name)?.remove());
      keyframes.clear();
      // A submitted remote request may still commit; only unsent work is abandoned here.
      feedQueue.splice(0).forEach(entry => entry.resolve(false));
      reservedFoodRef.current = 0;
    };
  }, []);

  const playAction = useCallback((motion, duration = PANDA_MOTION_DURATION[motion], restart = true) => {
    cancelTimer(actionTimerRef.current);
    chewingRef.current = motion === 'eating';
    setAction(prev => !restart && prev.motion === motion ? prev : { motion, id: prev.id + 1 });
    actionTimerRef.current = schedule(() => {
      setAction(prev => ({ ...prev, motion: 'idle' }));
      if (motion === 'eating') {
        chewingRef.current = false;
        finishMealRef.current?.();
      }
    }, duration);
  }, [cancelTimer, schedule]);

  const spawnParticles = useCallback((list, lifetime) => {
    list.forEach(p => { if (p.kfName) keyframesRef.current.add(p.kfName); });
    setParticles(prev => [...prev, ...list]);
    const ids = list.map(p => p.id);
    return schedule(() => {
      setParticles(prev => prev.filter(p => !ids.includes(p.id)));
      list.forEach(p => {
        if (!p.kfName) return;
        document.getElementById('kf-' + p.kfName)?.remove();
        keyframesRef.current.delete(p.kfName);
      });
    }, lifetime + Math.max(0, ...list.map(p => p.delay || 0)));
  }, [schedule]);

  // A leaf can fill EXP optimistically, but only a confirmed meal can reveal
  // a new body, level, or wardrobe. Keep those changes on the same reveal frame.
  const stageIdx = growth.displayStage;
  const stage = STAGES[stageIdx];
  const visibleLevel = growth.celebration
    ? growth.celebration.phase === 'charge' ? growth.celebration.fromLevel : growth.celebration.toLevel
    : getPandaLevelInfo(revealedFed).level;
  const levelMin = visibleLevel < PANDA_ADULT_LEVEL ? PANDA_GROWTH_THRESHOLDS[visibleLevel - 1]
    : PANDA_ADULT_FED + (visibleLevel - PANDA_ADULT_LEVEL) * PANDA_ADULT_LEVEL_FOOD;
  const levelInfo = getPandaLevelInfo(levelMin);
  const fedTotal = Math.max(levelInfo.min, Math.min(feedDisplay?.fedTotal ?? profile.fedTotal, levelInfo.nextAt));
  const equipped = getWearablePandaWardrobe(pandaEquippedToWardrobe(profile.equipped), stageIdx < PANDA_ADULT_LEVEL - 1 ? 0 : revealedFed);
  const progress = Math.round((fedTotal - levelInfo.min) / (levelInfo.nextAt - levelInfo.min) * 100);
  const transitionPending = Boolean(game.transition && !game.transition.noticeSeen);

  useEffect(() => {
    if (!feedQueueRef.current.length && !feedDisplayRef.current) setRevealedFed(profile.fedTotal);
  }, [profile.fedTotal]);

  useEffect(() => {
    if (!transitionPending) { setTransitionOpen(false); return; }
    // Once open, an offline response must not dismiss the unacknowledged notice.
    if (game.serverReady && !speechPaused && !wardrobeOpen && !wardrobeGuideOpen && !namingOpen && !isFeeding && !growth.busy) setTransitionOpen(true);
  }, [transitionPending, game.serverReady, speechPaused, wardrobeOpen, wardrobeGuideOpen, namingOpen, isFeeding, growth.busy]);

  useEffect(() => {
    if (!namingPending || transitionPending || speechPaused || wardrobeOpen || wardrobeGuideOpen || namingOpen || isFeeding || growth.busy || game.busy || game.loading) return;
    setNamingPending(false);
    setNamingMode('first');
    setNamingOpen(true);
  }, [namingPending, transitionPending, speechPaused, wardrobeOpen, wardrobeGuideOpen, namingOpen, isFeeding, growth.busy, game.busy, game.loading]);

  useEffect(() => {
    if (!wardrobeHandoff || wardrobeHandoff.ready) return;
    const markReady = () => setWardrobeHandoff(current => current === wardrobeHandoff ? { ...current, ready: true } : current);
    if (reducedMotion) { markReady(); return; }
    const timer = schedule(markReady, Math.max(0, Number.parseFloat(PANDA_GAME_THEME.motionExit) || 0));
    return () => cancelTimer(timer);
  }, [wardrobeHandoff, reducedMotion, schedule, cancelTimer]);

  useEffect(() => {
    if (!wardrobeHandoff?.ready || transitionPending || speechPaused || wardrobeOpen || namingOpen || namingPending || isFeeding || growth.busy || game.busy || game.loading) return;
    setWardrobeHandoff(null);
    if (wardrobeHandoff.target === 'wardrobe') setWardrobeOpen(true);
    else {
      wardrobeGuideConsumedRef.current = true;
      setWardrobeGuideOpen(true);
    }
  }, [wardrobeHandoff, transitionPending, speechPaused, wardrobeOpen, namingOpen, namingPending, isFeeding, growth.busy, game.busy, game.loading]);

  function acknowledgeGrowth(previous, next) {
    if (!aliveRef.current || !next) return;
    growth.recordFeed(previous, next);
    if (previous.fedTotal < PANDA_ADULT_FED && next.fedTotal >= PANDA_ADULT_FED && !previous.namingPromptSeen) {
      setNamingPending(true);
    }
  }

  function finishMeal() {
    if (!aliveRef.current || chewingRef.current || feedQueueRef.current.some(entry => entry.status !== 'confirmed' || entry.arrived < entry.count)) return;
    feedQueueRef.current.splice(0);
    const previous = mealStartRef.current, next = mealResultRef.current;
    mealStartRef.current = null;
    mealResultRef.current = null;
    feedDisplayRef.current = null;
    setFeedDisplay(null);
    setRevealedFed(committedProfileRef.current.fedTotal);
    feedingRef.current = false;
    setIsFeeding(false);
    if (previous && next) acknowledgeGrowth(previous, next);
  }
  finishMealRef.current = finishMeal;

  function arriveFeed(entry, count = 1, pulse = true) {
    if (!aliveRef.current || entry.canceled) return;
    entry.arrived += count;
    const current = feedDisplayRef.current;
    if (current) {
      const next = { fedTotal: current.fedTotal + count, available: Math.max(0, current.available - count) };
      feedDisplayRef.current = next;
      setFeedDisplay(next);
    }
    if (pulse) growth.recordArrival();
    if (!reducedMotion) {
      entry.chewUntil = Date.now() + PANDA_MOTION_DURATION.eating;
      if (entry.status === 'confirmed') confirmedChewUntilRef.current = Math.max(confirmedChewUntilRef.current, entry.chewUntil);
      // Continuing leaves extend the meal without rewinding the reaction to 0.
      playAction('eating', PANDA_MOTION_DURATION.eating, !chewingRef.current);
    }
    finishMeal();
  }

  function cancelQueuedFeeds() {
    const canceled = feedQueueRef.current.splice(0);
    const ids = new Set(canceled.flatMap(entry => entry.particles.map(p => p.id)));
    canceled.forEach(entry => {
      entry.canceled = true;
      entry.arrivalTimers.forEach(cancelTimer);
      cancelTimer(entry.particleTimer);
      entry.particles.forEach(p => {
        document.getElementById('kf-' + p.kfName)?.remove();
        keyframesRef.current.delete(p.kfName);
      });
      entry.resolve(false);
    });
    reservedFoodRef.current = 0;
    setReservedFood(0);
    setParticles(current => current.filter(p => !ids.has(p.id)));
    // Roll back provisional EXP/balance, preserving any earlier confirmed meal.
    feedDisplayRef.current = null;
    setFeedDisplay(null);
    // Discard chewing added by failed arrivals, but preserve an earlier success.
    const remainingChew = confirmedChewUntilRef.current - Date.now();
    if (remainingChew > 0) playAction('eating', remainingChew, false);
    else {
      cancelTimer(actionTimerRef.current);
      chewingRef.current = false;
      setAction(current => ({ ...current, motion: 'idle' }));
      finishMeal();
    }
  }

  async function drainFeedQueue() {
    if (drainingFeedRef.current || !aliveRef.current) return;
    drainingFeedRef.current = true;
    try {
      let entry;
      while (aliveRef.current && (entry = feedQueueRef.current.find(item => item.status === 'queued'))) {
        entry.status = 'saving';
        const next = await gameRef.current.transact({ type: 'feed', count: entry.count });
        if (!aliveRef.current) return;
        if (!next) {
          // Leave the hook's unresolved request intact for an idempotent retry.
          cancelQueuedFeeds();
          break;
        }
        entry.status = 'confirmed';
        entry.next = next;
        availableRef.current = balanceRef.current.profile === next
          ? balanceRef.current.available : Math.max(0, availableRef.current - entry.count);
        committedProfileRef.current = next;
        mealResultRef.current = next;
        reservedFoodRef.current -= entry.count;
        setReservedFood(reservedFoodRef.current);
        confirmedChewUntilRef.current = Math.max(confirmedChewUntilRef.current, entry.chewUntil);
        // Receipt processing never starts or extends a visual reaction. A slow
        // response may confirm growth after chewing has already finished.
        entry.resolve(true);
        finishMeal();
      }
    } finally {
      drainingFeedRef.current = false;
      if (aliveRef.current) {
        feedingRef.current = feedQueueRef.current.length > 0 || chewingRef.current;
        setIsFeeding(feedingRef.current);
      }
    }
  }

  async function handleFeed(count = 1) {
    // Growth reveals block new input, not already accepted queue entries.
    if (celebrating || transitionPending) return false;
    const currentGame = gameRef.current;
    const ownFeedInFlight = drainingFeedRef.current && currentGame.busy;
    if (!aliveRef.current || currentGame.loading || (!currentGame.canTransact && !ownFeedInFlight)) return false;
    if (!Number.isSafeInteger(count) || count < 1 || count > availableRef.current - reservedFoodRef.current) {
      setNotice('먹이가 부족해요. 수량을 확인해 주세요.');
      return false;
    }
    setNotice('');
    if (!mealStartRef.current) {
      mealStartRef.current = committedProfileRef.current;
      mealResultRef.current = null;
      confirmedChewUntilRef.current = 0;
      feedDisplayRef.current = { fedTotal: committedProfileRef.current.fedTotal, available: availableRef.current };
      setFeedDisplay(feedDisplayRef.current);
    }
    feedingRef.current = true;
    setIsFeeding(true);
    reservedFoodRef.current += count;
    setReservedFood(reservedFoodRef.current);
    if (!chewingRef.current) {
      cancelTimer(actionTimerRef.current);
      setAction(prev => ({ ...prev, motion: 'idle' }));
    }
    return new Promise(resolve => {
      const entry = { count, resolve, status: 'queued', arrived: 0, canceled: false, chewUntil: 0, particles: [], arrivalTimers: [], particleTimer: null };
      feedQueueRef.current.push(entry);
      const from = (count > 1 ? feedAllBtnRef : feedBtnRef).current?.getBoundingClientRect();
      const bounds = pandaRef.current?.getBoundingClientRect();
      if (from && bounds && !reducedMotion) {
        const target = getPandaFeedingTarget(pandaRef.current, bounds);
        const dots = Math.min(count, 5);
        entry.particles = Array.from({ length: dots }, (_, index) =>
          makeFeedParticle(from.left + from.width / 2, from.top + from.height / 2, target.x, target.y, index * PANDA_FEED_STAGGER_MS));
        entry.particleTimer = spawnParticles(entry.particles, 850);
        entry.arrivalTimers = Array.from({ length: dots }, (_, index) => schedule(() => {
          arriveFeed(entry, index === dots - 1 ? count - dots + 1 : 1);
        }, PANDA_FEED_FLIGHT_MS + index * PANDA_FEED_STAGGER_MS));
      } else arriveFeed(entry, count, false);
      // Hide network latency inside the flight instead of waiting for it.
      void drainFeedQueue();
    });
  }

  function handlePet() {
    if (feedingRef.current || growth.busy || game.busy || game.hasProfile === false || transitionPending) return;
    playAction('petting');
    const bounds = pandaRef.current?.getBoundingClientRect();
    if (bounds && !reducedMotion) spawnParticles(Array.from({ length: 7 }, (_, i) => makeHeartParticle(bounds, i)), 1100);
  }

  function finishNaming() {
    if (!aliveRef.current) return false;
    setNamingOpen(false);
    // Only the first adulthood flow in this session offers the new wardrobe.
    // Loading an adult profile or editing a saved name never schedules it.
    if (namingMode === 'first' && !wardrobeGuideConsumedRef.current) {
      setWardrobeHandoff({ target: 'guide', ready: false });
    } else {
      setWardrobeHandoff(current => current ? { ...current, ready: false } : null);
    }
    return true;
  }

  async function handleSaveName(nickname) {
    if (feedingRef.current) return false;
    const next = await game.transact({ type: 'nickname', nickname });
    if (!next) return false;
    return finishNaming();
  }

  async function handleDismissName() {
    if (game.busy) return false;
    if (namingMode === 'first' && !profile.namingPromptSeen) {
      if (!await game.transact({ type: 'dismiss-naming' })) return false;
    }
    return finishNaming();
  }

  function handleDismissWardrobeGuide() {
    wardrobeGuideConsumedRef.current = true;
    setWardrobeGuideOpen(false);
    setWardrobeHandoff(null);
  }

  function handleStartWardrobeGuide() {
    if (!wardrobeGuideOpen) return;
    handleDismissWardrobeGuide();
    setNotice('');
    setWardrobeHandoff({ target: 'wardrobe', ready: false });
  }

  function handleOpenWardrobe() {
    if (transitionPending || game.hasProfile === false) return;
    wardrobeGuideConsumedRef.current = true;
    setNotice('');
    setWardrobeGuideOpen(false);
    if (wardrobeGuideOpen || namingOpen) setWardrobeHandoff({ target: 'wardrobe', ready: false });
    else if (wardrobeHandoff) setWardrobeHandoff(current => ({ ...current, target: 'wardrobe' }));
    else setWardrobeOpen(true);
  }

  async function handleWardrobeAction(nextAction) {
    if (feedingRef.current) return false;
    const next = await game.transact(nextAction);
    return Boolean(next);
  }

  async function handleRetry() {
    if (feedQueueRef.current.length || gameRef.current.busy) return null;
    const before = gameRef.current.profile;
    const result = await game.retry?.();
    if (!aliveRef.current) return null;
    const next = result?.profile;
    if (next && result.action?.type === 'nickname') {
      finishNaming();
    }
    if (result?.action?.type === 'feed' && next?.fedTotal > before.fedTotal) {
      setRevealedFed(next.fedTotal);
      acknowledgeGrowth(before, next);
    }
    return next;
  }

  const savingFeed = isFeeding && game.busy && action.motion === 'idle'
    && feedQueueRef.current.every(entry => entry.arrived >= entry.count);
  const wardrobeProfile = (isFeeding || growth.busy) && profile.fedTotal >= levelInfo.nextAt
    ? { ...profile, fedTotal: levelInfo.nextAt - 1 } : profile;

  return (
    <>
      {particles.map(p => (
        <div key={p.id} data-particle={p.type} aria-hidden="true" style={{
          position: 'fixed', zIndex: 45, pointerEvents: 'none', left: p.x, top: p.y,
          ...(p.type === 'heart' ? { fontSize: p.size, lineHeight: 1 } : {
            width: p.size, height: p.size,
          }),
          animationName: p.kfName, animationDuration: p.type === 'heart' ? '1.05s' : `${PANDA_FEED_FLIGHT_MS}ms`,
          animationTimingFunction: 'linear', animationFillMode: 'both', animationDelay: (p.delay || 0) + 'ms',
        }}>{p.type === 'heart' ? '❤️' : <PandaFeedLeaf />}</div>
      ))}
      <PandaGameView stage={stage} stageIdx={stageIdx} levelInfo={levelInfo} fedTotal={fedTotal}
        available={feedDisplay?.available ?? available} feedingAvailable={Math.max(0, available - reservedFood)} progress={progress} remaining={levelInfo.nextAt - fedTotal}
        equipped={equipped} nickname={profile.nickname} fullscreen={fullscreen} speechPaused={speechPaused || wardrobeOpen || transitionPending}
        hasProfile={game.hasProfile !== false}
        isFeeding={isFeeding} isBusy={game.busy} canTransact={game.canTransact} loading={game.loading}
        canFeed={!celebrating && !transitionPending && (game.canTransact || (drainingFeedRef.current && game.busy && !game.loading))}
        action={action}
        growthPulses={growth.pulses} celebration={growth.celebration} displayStage={growth.displayStage}
        pandaRef={pandaRef} feedBtnRef={feedBtnRef} feedAllBtnRef={feedAllBtnRef} wardrobeTriggerRef={wardrobeTriggerRef}
        onFeed={handleFeed} onPet={handlePet} onOpenWardrobe={handleOpenWardrobe}
        onOpenName={() => { if (!transitionPending && game.hasProfile !== false && !feedingRef.current && !growth.busy && !wardrobeGuideOpen) { setNotice(''); setNamingMode('edit'); setNamingOpen(true); } }}
        namingOpen={namingOpen} namingMode={namingMode} onSaveName={handleSaveName} onDismissName={handleDismissName}
        wardrobeGuideOpen={wardrobeGuideOpen} onDismissWardrobeGuide={handleDismissWardrobeGuide} onStartWardrobeGuide={handleStartWardrobeGuide}
        transitionOpen={transitionOpen && !speechPaused} transition={game.transition}
        onConfirmTransition={async () => Boolean(await game.transact({ type: 'dismiss-transition' }))}
        notice={savingFeed ? '성장 기록을 저장하고 있어요…' : notice} noticePending={savingFeed}
        error={game.error} onRetry={game.retry ? handleRetry : null} foodSources={foodSources} />
      <PandaWardrobe open={wardrobeOpen} onOpenChange={setWardrobeOpen}
        returnFocusRef={wardrobeTriggerRef}
        profile={wardrobeProfile} available={available} busy={game.busy || game.loading || isFeeding} blocked={!game.canTransact}
        onAction={handleWardrobeAction} notice={game.error || notice} onHelp={onOpenHelp} onRetry={game.retry ? handleRetry : null} />
    </>
  );
}
