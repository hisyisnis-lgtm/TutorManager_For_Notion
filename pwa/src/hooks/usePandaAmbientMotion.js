import { useEffect, useState } from 'react';

export const PANDA_AMBIENT_DURATION = Object.freeze({ greeting: 1800, ears: 700, look: 2400, pupils: 2200 });
const MOTIONS = Object.keys(PANDA_AMBIENT_DURATION);
const GROWING_MOTIONS = MOTIONS.filter(motion => motion !== 'greeting');

/** One idle scheduler prevents greeting, ear flicks and both kinds of looking around from overlapping. */
export default function usePandaAmbientMotion(enabled, stage, hand) {
  const [motion, setMotion] = useState(null);
  const active = enabled && stage > 0;
  useEffect(() => {
    if (!active) { setMotion(null); return undefined; }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const availableMotions = stage === 5 ? MOTIONS : GROWING_MOTIONS;
    let startTimer;
    let endTimer;
    let cancelled = false;
    const clear = () => { clearTimeout(startTimer); clearTimeout(endTimer); };
    const schedule = () => {
      clear();
      setMotion(null);
      if (cancelled || document.hidden || media?.matches) return;
      startTimer = setTimeout(() => {
        if (cancelled || document.hidden || media?.matches) return;
        const next = availableMotions[Math.min(availableMotions.length - 1, Math.floor(Math.random() * availableMotions.length))];
        setMotion(next);
        endTimer = setTimeout(schedule, PANDA_AMBIENT_DURATION[next]);
      }, 12000 + Math.random() * 10000);
    };
    document.addEventListener('visibilitychange', schedule);
    media?.addEventListener('change', schedule);
    schedule();
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener('visibilitychange', schedule);
      media?.removeEventListener('change', schedule);
    };
  }, [active, stage, hand]);
  // Do not expose the previous adult greeting while the stage-change effect resets.
  return active && (motion !== 'greeting' || stage === 5) ? motion : null;
}
