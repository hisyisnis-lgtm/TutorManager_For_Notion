import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import PandaFigure, { getPandaFigureGroundPoint } from './PandaFigure.jsx';
import PandaRoomBackdrop from './PandaRoomBackdrop.jsx';
import PandaFeedLeaf from './PandaFeedLeaf.jsx';
import { PANDA_FEED_PULSE_LIMIT, PANDA_GROWTH_FEEDBACK_DURATION } from '../../hooks/usePandaGrowthFeedback.js';
import { TIER_SPARK_POS } from '../../game/earProfile.js';
import { PANDA_STAGE_LABELS } from '../../constants/pandaMascot.js';
import { getPandaFeedingTarget } from '../../constants/pandaFeedMotion.js';
import { TG, TONE_COLORS } from '../../game/tgTokens.js';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';
import './PandaGrowthEffects.css';

const PAPER_COLORS = [TG.CTA, TG.SUN, TG.SUCCESS_GLOW, TONE_COLORS[4], TG.THEME];
const LIGHT_COLORS = ['var(--pg-card)', 'var(--pg-background)', 'var(--pg-action)'];
const FEED_LIGHT_COLORS = ['var(--pg-card)', 'var(--pg-action-edge)'];

// Tone attic's shared.jsx ConfettiBurst physics, scoped to this smaller stage.
// Keep gravity, drag, flutter/3D flips and wall-clock expiry; avoid importing its
// screen-wide styles, dictionaries and static reduced-motion cache into the pet.
function GrowthConfetti({ count, colors = PAPER_COLORS, power, size, lifetime, shape = 'paper' }) {
  const refs = useRef([]);
  const config = useRef(null);
  if (!config.current) config.current = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = (3 + Math.random() * 4.4) * power;
    return {
      x: 0, y: 0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (1.7 + Math.random() * 1.6) * power,
      rotation: Math.random() * 360, spin: (Math.random() - .5) * (shape === 'leaf' ? 6 : 30),
      sway: .5 + Math.random() * 1.9, swayPhase: Math.random() * Math.PI * 2, swaySpeed: .05 + Math.random() * .11,
      life: lifetime ? lifetime / 16.667 * (.75 + Math.random() * .25) : 48 + Math.random() * 32,
      age: 0, size: size * (shape === 'leaf' ? .8 + Math.random() * .4 : .6 + Math.random() * .85),
      leaf: shape === 'leaf', rectangular: shape !== 'leaf' && Math.random() < .62,
      color: colors[Math.floor(Math.random() * colors.length)], flip: 5 + Math.random() * 13,
    };
  });
  useLayoutEffect(() => {
    let frame;
    let alive = true;
    let previous = performance.now();
    const tick = now => {
      if (!alive) return;
      const elapsed = Math.max(0, now - previous);
      previous = now;
      const dt = Math.min(3, elapsed / 16.667);
      let remaining = false;
      config.current.forEach((piece, index) => {
        const node = refs.current[index];
        if (!node) return;
        piece.age += elapsed / 16.667;
        remaining ||= piece.age < piece.life;
        const drag = Math.pow(.985, dt);
        piece.vx *= drag;
        piece.vy = piece.vy * drag + .19 * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.rotation += piece.spin * dt;
        const progress = piece.age / piece.life;
        node.style.opacity = String(progress < .1 ? progress / .1 : Math.max(0, 1 - Math.pow((progress - .1) / .9, 1.7)));
        const flutter = Math.sin(piece.age * piece.swaySpeed + piece.swayPhase) * piece.sway;
        node.style.transform = `translate(${(piece.x + flutter).toFixed(1)}px, ${piece.y.toFixed(1)}px) rotate(${piece.rotation.toFixed(0)}deg)${piece.rectangular ? ` rotateX(${(piece.age * piece.flip).toFixed(0)}deg)` : ''}`;
      });
      if (remaining) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const kill = setTimeout(() => {
      alive = false;
      cancelAnimationFrame(frame);
      refs.current.forEach(node => { if (node) node.style.opacity = '0'; });
    }, lifetime ?? 1400);
    return () => { alive = false; cancelAnimationFrame(frame); clearTimeout(kill); };
  }, [lifetime]);
  return <div className="panda-growth-confetti">
    {config.current.map((piece, index) => <i key={index} ref={node => { refs.current[index] = node; }}
      style={{ width: piece.size, height: piece.rectangular ? piece.size * .55 : piece.size, background: piece.leaf ? undefined : piece.color, borderRadius: piece.rectangular ? 2 : '50%' }}>
      {piece.leaf && <PandaFeedLeaf />}
    </i>)}
  </div>;
}

function FeedingBurst({ pulse, pandaRef }) {
  const originRef = useRef(null);
  useLayoutEffect(() => {
    const origin = originRef.current;
    const bounds = pandaRef?.current?.getBoundingClientRect();
    const stage = origin?.parentElement?.getBoundingClientRect();
    if (!origin || !bounds?.width || !stage) return;
    const target = getPandaFeedingTarget(pandaRef.current, bounds);
    origin.style.left = `${target.x - stage.left}px`;
    origin.style.top = `${target.y - stage.top}px`;
    origin.style.bottom = 'auto';
  }, [pandaRef]);
  return <div ref={originRef} className="panda-growth-field panda-growth-pulse" data-growth-pulse={pulse.id}>
    <GrowthConfetti shape="leaf" count={5} power={.82} size={18} lifetime={780} />
    <GrowthConfetti colors={FEED_LIGHT_COLORS} count={6} power={.95} size={5} lifetime={680} />
  </div>;
}

// RankUpReveal's white silhouette -> accelerating shake -> full-color reveal.
// Keep this node separate from the revealed figure so a late RAF cannot whiten it.
function ChargingFigure({ stage, reducedMotion }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (reducedMotion) return undefined;
    let raf;
    const started = performance.now();
    const tick = now => {
      const node = ref.current;
      if (!node) return;
      const p = Math.min(1, (now - started) / PANDA_GROWTH_FEEDBACK_DURATION.charge);
      const grow = .82 + Math.pow(p, 1.5) * .5;
      const amplitude = .5 + p * p * 8;
      const x = (Math.random() - .5) * 2 * amplitude;
      const y = (Math.random() - .5) * 2 * amplitude;
      const rotation = (Math.random() - .5) * 2 * (p * p * 9);
      node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${grow.toFixed(3)}) rotate(${rotation.toFixed(1)}deg)`;
      node.style.filter = `brightness(0) invert(1) drop-shadow(0 0 ${(8 + p * 24).toFixed(0)}px var(--pg-action))`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);
  return <div ref={ref} className="panda-evolution-silhouette"><PandaFigure width={176} stage={stage} motion="idle" decorative /></div>;
}

function CelebrationRoom({ stage, figureWidth, centerOffset }) {
  const ground = getPandaFigureGroundPoint(figureWidth, stage);
  const shadowScale = figureWidth / 160;
  return <div className="panda-celebration-surface">
    <PandaRoomBackdrop />
    <img className="panda-celebration-ground-shadow" src="/panda/ui/ground-shadow.svg" alt=""
      width={figureWidth} height={18 * shadowScale} style={{
        left: `calc(50% + ${ground.x - figureWidth / 2}px)`,
        // Same sole-to-shadow alignment as the main 160px figure. This belongs
        // to the room, never the hopping/scaling character wrapper.
        top: `calc(50% + ${ground.y - figureWidth * 1.36 / 2 + centerOffset + .4 * shadowScale}px)`,
      }} />
  </div>;
}

function EvolutionOverlay({ celebration, wardrobe, reducedMotion, portalTarget }) {
  const charging = celebration.phase === 'charge';
  const closing = celebration.phase === 'out';
  const stageName = PANDA_STAGE_LABELS[celebration.toStage]?.replace('판다', '랴오랴오');
  // Stay in the game root so the main room and this reveal inherit identical
  // room/theme tokens in both the full page and embedded widget.
  if (!portalTarget) return null;
  return createPortal(<div className="panda-evolution-overlay" aria-hidden="true"
    data-phase={celebration.phase} data-continuing={celebration.continues || undefined}>
    <div className="panda-evolution-dim" />
    <div className="panda-evolution-rings">
      {[542, 394, 246].map((diameter, index) => <i key={diameter} style={{ width: diameter, height: diameter,
        '--ring-in-delay': `${(2 - index) * 70}ms`, '--ring-idle-delay': `${380 + (2 - index) * 330}ms`, '--ring-out-delay': `${index * 85}ms` }} />)}
    </div>
    <div key={celebration.id} className="panda-evolution-stage" data-closing={closing || undefined}>
      <div className="panda-evolution-figure">
        {charging ? <>
          {!reducedMotion && TIER_SPARK_POS.map(([x, y], index) => <i key={index} className="panda-evolution-energy"
            style={{ '--energy-x': `${x * 1.7}px`, '--energy-y': `${y * 1.7}px`, '--energy-duration': `${.85 + index % 3 * .12}s`, '--energy-delay': `${index * .13}s` }} />)}
          <ChargingFigure key="charge" stage={celebration.fromStage} reducedMotion={reducedMotion} />
        </> : <>
          <CelebrationRoom stage={celebration.toStage} figureWidth={176} centerOffset={12} />
          {!reducedMotion && <>
            <i className="panda-evolution-flash" />
            <GrowthConfetti colors={PAPER_COLORS} count={26} power={1.25} size={9} />
            <GrowthConfetti colors={LIGHT_COLORS} count={14} power={1.05} size={5} />
          </>}
          <div key="reveal" className="panda-evolution-color"><PandaFigure width={176} stage={celebration.toStage} wardrobe={wardrobe} motion="idle" decorative /></div>
        </>}
      </div>
      {charging ? <p className="panda-evolution-hint">랴오랴오가 자라고 있어요…</p> : <div className="panda-evolution-caption">
        <span>진화했어요!</span>
        <strong>{stageName}</strong>
        <span className="panda-evolution-level">Lv.{celebration.toLevel}</span>
      </div>}
    </div>
  </div>, portalTarget);
}

function LevelOverlay({ celebration, wardrobe, reducedMotion, portalTarget }) {
  if (!portalTarget) return null;
  return createPortal(<div key={celebration.id} className="panda-level-overlay"
    aria-hidden="true" data-phase={celebration.phase}>
    <div className="panda-level-dim" />
    <div className="panda-level-stage">
      {!reducedMotion && ['left', 'right'].map(side => <div key={side} className={`panda-level-confetti panda-level-confetti--${side}`}>
        <GrowthConfetti colors={PAPER_COLORS} count={28} power={1.25} size={9} />
      </div>)}
      <div className="panda-level-figure">
        <CelebrationRoom stage={celebration.toStage} figureWidth={184} centerOffset={16} />
        <PandaFigure width={184} stage={celebration.toStage} wardrobe={wardrobe} motion="idle" decorative />
      </div>
      <div className="panda-level-caption">
        <strong>레벨 업!</strong>
        <span className="panda-level-number">Lv.{celebration.toLevel}</span>
      </div>
    </div>
  </div>, portalTarget);
}

/** Feedback never owns focus or transactions; previously queued feeds finish. */
export default function PandaGrowthEffects({ pulses = [], celebration = null, wardrobe, portalTarget, pandaRef }) {
  const reducedMotion = usePrefersReducedMotion();
  const evolution = celebration?.type === 'evolution';
  const revealed = celebration && celebration.phase !== 'charge';
  const stageName = PANDA_STAGE_LABELS[celebration?.toStage]?.replace('판다', '랴오랴오');
  const detail = celebration ? `Lv.${celebration.toLevel}${evolution && stageName ? ` · ${stageName}` : ''}` : '';
  const announcement = revealed ? `${evolution ? '진화했어요!' : '레벨 업!'} ${detail}` : '';

  return <>
    <div className="panda-growth-effects" aria-hidden="true">
      {!reducedMotion && pulses.slice(-PANDA_FEED_PULSE_LIMIT).map(pulse => <FeedingBurst key={pulse.id} pulse={pulse} pandaRef={pandaRef} />)}
    </div>
    {evolution && <EvolutionOverlay celebration={celebration} wardrobe={wardrobe} reducedMotion={reducedMotion} portalTarget={portalTarget} />}
    {celebration && !evolution && <LevelOverlay celebration={celebration} wardrobe={wardrobe} reducedMotion={reducedMotion} portalTarget={portalTarget} />}
    <span className="sr-only" role={announcement ? 'status' : undefined} aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
}
