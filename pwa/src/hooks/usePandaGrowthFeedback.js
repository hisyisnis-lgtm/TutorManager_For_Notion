import { useCallback, useEffect, useRef, useState } from 'react';
import { getPandaLevelInfo, PANDA_GROWTH_THRESHOLDS } from '../constants/pandaWardrobe.js';

const PULSE_DURATION = 850;
export const PANDA_FEED_PULSE_LIMIT = 8;
const CHARGE_DURATION = 1500;
const EVOLUTION_DURATION = 3260;
const EVOLUTION_EXIT_DURATION = 260;
const LEVEL_DURATION = 2200;
const LEVEL_EXIT_DURATION = 240;
const REDUCED_DURATION = 1000;
export const PANDA_GROWTH_FEEDBACK_DURATION = Object.freeze({
  pulse: PULSE_DURATION, charge: CHARGE_DURATION, evolution: EVOLUTION_DURATION,
  level: LEVEL_DURATION, reduced: REDUCED_DURATION, evolutionExit: EVOLUTION_EXIT_DURATION, levelExit: LEVEL_EXIT_DURATION,
});

const stageFor = fed => Math.max(0, PANDA_GROWTH_THRESHOLDS.findLastIndex(min => fed >= min));
const fedOf = value => typeof value === 'number' ? value : value?.fedTotal;
const begin = (event, reducedMotion) => event ? {
  ...event, phase: event.type === 'evolution' && !reducedMotion ? 'charge' : 'reveal',
} : null;

/** Leaf arrivals are decorative; only acknowledged feeds can celebrate growth. */
export default function usePandaGrowthFeedback({ fedTotal, reducedMotion = false }) {
  const [feedback, setFeedback] = useState({ pulses: [], celebration: null, queue: [] });
  const sequenceRef = useRef(0);
  const seenRef = useRef(new Set());
  const aliveRef = useRef(true);
  const pulseTimersRef = useRef(new Map());
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    aliveRef.current = true;
    const timers = pulseTimersRef.current;
    return () => {
      aliveRef.current = false;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const recordArrival = useCallback(() => {
    if (!aliveRef.current || reducedMotionRef.current) return;
    const pulse = { id: ++sequenceRef.current, count: 1 };
    setFeedback(current => ({ ...current, pulses: [...current.pulses, pulse].slice(-PANDA_FEED_PULSE_LIMIT) }));
  }, []);

  const recordFeed = useCallback((previous, next) => {
    const fromFed = fedOf(previous), toFed = fedOf(next);
    if (!aliveRef.current || !Number.isSafeInteger(fromFed) || !Number.isSafeInteger(toFed)
      || fromFed < 0 || toFed <= fromFed) return;
    const key = `${fromFed}:${toFed}`;
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    // Successful feeds only move forward; a small receipt window also absorbs retry replays.
    if (seenRef.current.size > 64) seenRef.current.delete(seenRef.current.values().next().value);
    const fromStage = stageFor(fromFed), toStage = stageFor(toFed);
    const fromLevel = getPandaLevelInfo(fromFed).level, toLevel = getPandaLevelInfo(toFed).level;
    const events = [];
    for (let stage = fromStage; stage < toStage; stage++) {
      events.push({
        id: ++sequenceRef.current, type: 'evolution', fromStage: stage, toStage: stage + 1,
        fromLevel: stage + 1, toLevel: stage + 1 === toStage ? toLevel : stage + 2,
      });
    }
    if (!events.length && toLevel > fromLevel) {
      events.push({ id: ++sequenceRef.current, type: 'level', fromStage, toStage, fromLevel, toLevel });
    }
    if (!events.length) return;
    setFeedback(current => {
      const queue = [...current.queue];
      events.forEach(event => {
        const waitingLevel = event.type === 'level' ? queue.findIndex(item => item.type === 'level') : -1;
        if (waitingLevel >= 0) queue[waitingLevel] = { ...queue[waitingLevel], toLevel: event.toLevel };
        else queue.push(event);
      });
      return {
        pulses: current.pulses,
        celebration: current.celebration || begin(queue.shift(), reducedMotionRef.current),
        queue,
      };
    });
  }, []);

  useEffect(() => {
    const timers = pulseTimersRef.current;
    const ids = new Set(feedback.pulses.map(pulse => pulse.id));
    timers.forEach((timer, id) => {
      if (reducedMotion || !ids.has(id)) { clearTimeout(timer); timers.delete(id); }
    });
    if (reducedMotion) {
      setFeedback(current => current.pulses.length ? { ...current, pulses: [] } : current);
      return;
    }
    feedback.pulses.forEach(({ id }) => {
      if (timers.has(id)) return;
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        if (aliveRef.current) setFeedback(current => ({ ...current, pulses: current.pulses.filter(pulse => pulse.id !== id) }));
      }, PULSE_DURATION));
    });
  }, [feedback.pulses, reducedMotion]);

  const activeId = feedback.celebration?.id;
  const activeType = feedback.celebration?.type;
  useEffect(() => {
    if (activeId === undefined) return undefined;
    const reveal = () => setFeedback(current => current.celebration?.id === activeId && current.celebration.phase !== 'reveal'
      ? { ...current, celebration: { ...current.celebration, phase: 'reveal' } } : current);
    // Changing the motion preference cancels both old timers. Never return to a former body.
    if (reducedMotion) reveal();
    const chargeTimer = !reducedMotion && activeType === 'evolution' ? setTimeout(reveal, CHARGE_DURATION) : null;
    const duration = reducedMotion ? REDUCED_DURATION : activeType === 'evolution' ? EVOLUTION_DURATION : LEVEL_DURATION;
    const exitDuration = activeType === 'evolution' ? EVOLUTION_EXIT_DURATION : LEVEL_EXIT_DURATION;
    const exitTimer = !reducedMotion ? setTimeout(() => {
      setFeedback(current => current.celebration?.id === activeId
        ? { ...current, celebration: { ...current.celebration, phase: 'out' } } : current);
    }, duration - exitDuration) : null;
    const finishTimer = setTimeout(() => {
      setFeedback(current => {
        if (current.celebration?.id !== activeId) return current;
        const [next, ...queue] = current.queue;
        // Advance directly to the next charge, without briefly displaying the latest profile body.
        return { ...current, celebration: begin(next, reducedMotionRef.current), queue };
      });
    }, duration);
    return () => { clearTimeout(chargeTimer); clearTimeout(exitTimer); clearTimeout(finishTimer); };
  }, [activeId, activeType, reducedMotion]);

  const celebration = feedback.celebration ? { ...feedback.celebration, continues: feedback.queue[0]?.type === 'evolution' } : null;
  const displayStage = celebration?.type === 'evolution'
    ? celebration.phase === 'charge' ? celebration.fromStage : celebration.toStage
    : stageFor(fedTotal);
  return { pulses: feedback.pulses, celebration, displayStage, busy: Boolean(celebration || feedback.queue.length), recordArrival, recordFeed };
}
