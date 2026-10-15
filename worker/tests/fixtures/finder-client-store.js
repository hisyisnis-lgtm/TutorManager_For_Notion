// 성조우체국 전용 기록. 성조다락방의 저장 키나 닉네임을 읽거나 변경하지 않는다.
const STORAGE_PREFIX = 'tf_post_profile_v1:';
const MAX_RUNS = 200;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const time = (value) => typeof value === 'string' ? Date.parse(value) : NaN;
const dayAt = (value) => new Date(new Date(value).getTime() + KST_OFFSET).toISOString().slice(0, 10);
const isDay = (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)));
const isRunSummary = (run) => isObject(run) && typeof run.id === 'string'
  && ['normal', 'review'].includes(run.mode) && ['complete', 'timeout'].includes(run.reason)
  && ['completedStages', 'correct', 'mistakes', 'hints', 'elapsedMs', 'xp'].every((key) => isCount(run[key]))
  && run.completedStages <= 16 && Number.isFinite(time(run.completedAt));

export const FINDER_RANKS = ['입문', '실전', '고수'];
export const FINDER_ACHIEVEMENTS = [
  { id: 'first-mail', title: '첫 뒤집기', description: '첫 세트 완료' },
  { id: 'route-eight', title: '동네 우체부', description: '8단계까지 배달을 마쳤어요' },
  { id: 'postmaster', title: '성조 우체국장', description: '16단계를 모두 완료했어요' },
  { id: 'perfect-mail', title: '완벽한 배달', description: '오답과 힌트 없이 16단계를 완료했어요' },
  { id: 'review-graduate', title: '다시 만난 친구', description: '오답 카드 한 장을 졸업했어요' },
  { id: 'three-days', title: '꾸준한 발걸음', description: '3일 연속 우체국을 방문해 배달했어요' },
];

export function freshFinderProfile() {
  return {
    version: 1, nickname: '카드친구', onboarded: false,
    xp: 0, rank: 0, level: 1, bestStage: 0,
    runs: [], mistakes: {}, achievements: [],
    settings: { sfx: true, bgm: true, haptic: true, pinyin: false, autoSpeak: false },
    totals: { correct: 0, mistakes: 0, normalRuns: 0, reviewRuns: 0, graduates: 0 },
    daily: { day: null, correct: 0, mistakes: 0, bestStage: 0 },
    lastPlayedDay: null, streak: 0,
    processedRunIds: [], discardedResultThrough: null, resetAt: null,
  };
}

function validateProfile(profile) {
  if (!isObject(profile) || profile.version !== 1 || typeof profile.nickname !== 'string'
    || !profile.nickname.trim() || [...profile.nickname].length > 12 || typeof profile.onboarded !== 'boolean'
    || !isCount(profile.xp) || !isCount(profile.rank) || profile.rank > 2
    || !isCount(profile.level) || profile.level < 1 || !isCount(profile.bestStage) || profile.bestStage > 16
    || !Array.isArray(profile.runs) || profile.runs.length > MAX_RUNS || !profile.runs.every(isRunSummary)
    || !Array.isArray(profile.achievements) || !profile.achievements.every((id) => typeof id === 'string')
    || !isObject(profile.mistakes) || !Object.entries(profile.mistakes).every(([hanzi, record]) => /^\p{Script=Han}$/u.test(hanzi)
      && isObject(record) && isCount(record.remaining) && record.remaining >= 1 && record.remaining <= 3
      && Number.isFinite(time(record.lastAt)) && Array.isArray(record.tones) && record.tones.every((tone) => [1, 2, 3, 4].includes(tone)))
    || !isObject(profile.settings)
    || !['sfx', 'bgm', 'haptic', 'pinyin', 'autoSpeak'].every((key) => typeof profile.settings[key] === 'boolean')
    || !isObject(profile.totals) || !['correct', 'mistakes', 'normalRuns', 'reviewRuns', 'graduates'].every((key) => isCount(profile.totals[key]))
    || !isObject(profile.daily) || !['correct', 'mistakes', 'bestStage'].every((key) => isCount(profile.daily[key]))
    || profile.daily.bestStage > 16 || !isDay(profile.daily.day) || !isDay(profile.lastPlayedDay)
    || !isCount(profile.streak) || !Array.isArray(profile.processedRunIds)
    || profile.processedRunIds.length > MAX_RUNS || !profile.processedRunIds.every((id) => typeof id === 'string')
    || ![profile.discardedResultThrough, profile.resetAt].every((value) => value === null || Number.isFinite(time(value)))) {
    throw new Error('성조우체국 저장 기록을 읽을 수 없어요. 기존 기록은 그대로 보관했어요.');
  }
  return profile;
}

export function loadFinderProfile(identity = 'guest') {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${identity}`);
  if (raw === null) return freshFinderProfile();
  // 깨진 JSON/저장 접근 실패를 호출부가 알 수 있게 전달한다. 빈 기록으로 덮어쓰지 않는다.
  return validateProfile(JSON.parse(raw));
}

export function saveFinderProfile(profile, identity = 'guest') {
  try {
    validateProfile(profile);
    localStorage.setItem(`${STORAGE_PREFIX}${identity}`, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

function validResult(result) {
  return isObject(result) && typeof result.id === 'string' && result.id.length > 0
    && ['normal', 'review', 'tutorial'].includes(result.mode)
    && ['complete', 'timeout'].includes(result.reason)
    && isCount(result.completedStages) && result.completedStages <= (result.mode === 'review' ? 4 : 16)
    && isCount(result.elapsedMs) && Number.isFinite(time(result.completedAt))
    && Array.isArray(result.answers) && result.answers.every((answer) => isObject(answer)
      && /^\p{Script=Han}$/u.test(answer.hanzi) && [1, 2, 3, 4].includes(answer.tone)
      && typeof answer.correct === 'boolean' && typeof answer.assisted === 'boolean');
}

function accuracy(correct, mistakes) {
  return correct + mistakes ? Math.round(correct / (correct + mistakes) * 100) : null;
}

/** 결과를 한 번만 정산한다. 중도 포기는 result를 생성하지 않으며 보상도 없다. */
export function recordFinderResult(profile, result) {
  if (!validResult(result) || result.mode === 'tutorial') return profile;
  if (profile.processedRunIds.includes(result.id) || profile.runs.some((run) => run.id === result.id)) return profile;
  const completedTime = time(result.completedAt);
  if ((profile.resetAt && completedTime <= time(profile.resetAt))
    || (profile.discardedResultThrough && completedTime <= time(profile.discardedResultThrough))) return profile;

  const correct = result.answers.filter((answer) => answer.correct && !answer.assisted).length;
  const mistakeCount = result.answers.filter((answer) => !answer.correct).length;
  const hints = Math.max(isCount(result.hints) ? result.hints : 0, result.answers.filter((answer) => answer.assisted).length);
  const normal = result.mode === 'normal';
  const complete = result.reason === 'complete' && result.completedStages === (normal ? 16 : 4);
  const perfect = complete && mistakeCount === 0 && hints === 0;
  const xp = normal
    ? result.completedStages * 8 + correct * 2 + (perfect ? 20 : 0)
    : correct + (complete ? 15 : 0);

  const mistakes = Object.fromEntries(Object.entries(profile.mistakes).map(([hanzi, record]) => [hanzi, { ...record, tones: [...record.tones] }]));
  const touched = new Map();
  for (const answer of result.answers) {
    const entry = touched.get(answer.hanzi) || { failed: false, correct: false, tones: new Set() };
    entry.failed ||= !answer.correct || answer.assisted;
    entry.correct ||= answer.correct && !answer.assisted;
    entry.tones.add(answer.tone);
    touched.set(answer.hanzi, entry);
  }
  // 힌트만 보고 시간이 끝난 경우에도 배움이 필요한 카드로 남긴다.
  for (const hint of (Array.isArray(result.hintedCards) ? result.hintedCards : [])) {
    if (!/^\p{Script=Han}$/u.test(hint?.hanzi) || ![1, 2, 3, 4].includes(hint?.tone)) continue;
    const entry = touched.get(hint.hanzi) || { failed: false, correct: false, tones: new Set() };
    entry.failed = true;
    entry.tones.add(hint.tone);
    touched.set(hint.hanzi, entry);
  }
  let graduates = 0;
  for (const [hanzi, entry] of touched) {
    const previous = mistakes[hanzi];
    if (entry.failed) {
      mistakes[hanzi] = {
        remaining: 3, lastAt: result.completedAt,
        tones: [...new Set([...(previous?.tones || []), ...entry.tones])].sort(),
      };
    } else if (!normal && complete && entry.correct && previous) {
      // 다성자를 여러 단계에서 맞혀도 한 번의 복습에서는 한 번만 감소한다.
      if (previous.remaining <= 1) { delete mistakes[hanzi]; graduates += 1; }
      else mistakes[hanzi] = { ...previous, remaining: previous.remaining - 1, lastAt: result.completedAt };
    }
  }

  const playedDay = dayAt(result.completedAt);
  const hasPlay = result.completedStages > 0 || correct + mistakeCount > 0 || hints > 0;
  let streak = profile.streak;
  let lastPlayedDay = profile.lastPlayedDay;
  if (hasPlay && (!lastPlayedDay || playedDay > lastPlayedDay)) {
    const consecutive = lastPlayedDay && (Date.parse(playedDay) - Date.parse(lastPlayedDay)) / DAY_MS === 1;
    streak = consecutive ? streak + 1 : 1;
    lastPlayedDay = playedDay;
  }
  const bestStage = normal ? Math.max(profile.bestStage, result.completedStages) : profile.bestStage;
  const rank = Math.max(profile.rank, bestStage >= 16 ? 2 : bestStage >= 8 ? 1 : 0);
  const totals = {
    correct: profile.totals.correct + correct, mistakes: profile.totals.mistakes + mistakeCount,
    normalRuns: profile.totals.normalRuns + (normal ? 1 : 0),
    reviewRuns: profile.totals.reviewRuns + (normal ? 0 : 1),
    graduates: profile.totals.graduates + graduates,
  };
  const daily = profile.daily.day && profile.daily.day >= playedDay
    ? { ...profile.daily }
    : { day: playedDay, correct: 0, mistakes: 0, bestStage: 0 };
  if (daily.day === playedDay) {
    daily.correct += correct;
    daily.mistakes += mistakeCount;
    if (normal) daily.bestStage = Math.max(daily.bestStage, result.completedStages);
  }

  const achievements = new Set(profile.achievements);
  if (bestStage >= 4) achievements.add('first-mail');
  if (bestStage >= 8) achievements.add('route-eight');
  if (bestStage >= 16) achievements.add('postmaster');
  if (normal && perfect) achievements.add('perfect-mail');
  if (totals.graduates > 0) achievements.add('review-graduate');
  if (streak >= 3) achievements.add('three-days');

  const run = {
    id: result.id, mode: result.mode, reason: result.reason,
    completedStages: result.completedStages, correct, mistakes: mistakeCount, hints,
    elapsedMs: result.elapsedMs, completedAt: result.completedAt, xp,
  };
  const runs = [...profile.runs, run].sort((a, b) => time(a.completedAt) - time(b.completedAt));
  let discardedResultThrough = profile.discardedResultThrough;
  while (runs.length > MAX_RUNS) {
    const discarded = runs.shift();
    if (!discardedResultThrough || time(discarded.completedAt) > time(discardedResultThrough)) discardedResultThrough = discarded.completedAt;
  }
  return {
    ...profile, xp: profile.xp + xp, level: Math.floor((profile.xp + xp) / 100) + 1,
    rank, bestStage, runs, mistakes, achievements: [...achievements],
    totals, daily, lastPlayedDay, streak,
    processedRunIds: [...profile.processedRunIds, result.id].slice(-MAX_RUNS), discardedResultThrough,
  };
}

export function resetFinderProgress(profile) {
  return {
    ...freshFinderProfile(), nickname: profile.nickname, onboarded: profile.onboarded,
    settings: { ...profile.settings }, processedRunIds: [...profile.processedRunIds],
    discardedResultThrough: profile.discardedResultThrough, resetAt: new Date().toISOString(),
  };
}

export function finderSummary(profile, now = new Date()) {
  const today = dayAt(now);
  const daily = profile.daily.day === today ? profile.daily : { correct: 0, mistakes: 0, bestStage: 0 };
  const yesterday = dayAt(new Date(new Date(now).getTime() - DAY_MS));
  return {
    accuracy: accuracy(profile.totals.correct, profile.totals.mistakes),
    todayAccuracy: accuracy(daily.correct, daily.mistakes), todayBest: daily.bestStage,
    bestStage: profile.bestStage, xp: profile.xp, level: profile.level, rank: profile.rank,
    streak: profile.lastPlayedDay === today || profile.lastPlayedDay === yesterday ? profile.streak : 0,
  };
}
