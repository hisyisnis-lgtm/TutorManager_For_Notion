import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { PANDA_MOTION_DURATION, PANDA_STAGE_LABELS } from '../../constants/pandaMascot.js';
import { createPandaArmMorph } from '../../constants/pandaArmMorph.js';
import { PANDA_SLEEVE_GEOMETRY } from '../../constants/pandaSleeveGeometry.js';
import usePandaAmbientMotion from '../../hooks/usePandaAmbientMotion.js';
import PandaGrowthArtwork from './PandaGrowthArtwork.jsx';
import { normalizePandaWardrobe } from './PandaWardrobeArtwork.jsx';
import PandaPettingHand from './PandaPettingHand.jsx';
import './PandaMascot.css';
import './PandaAmbientMotion.css';

// User artwork shares a canvas but has different crown heights.
const HAND_OFFSET_Y = [130, 230, 215, 210, 90, 0];
// The shoulder stays inside the original arm/torso overlap. Bind angles are
// measured from that joint to the original rounded palm, not the SVG bbox.
const GREETING_JOINTS = {
  1: { x: 715, y: 868, bind: -32.1099 },
  3: { x: 735, y: 891, bind: -28.0255 },
  4: { x: 752, y: 854, bind: -26.8892 },
  5: { x: 730, y: 760, bind: -26.7316 },
  left: { x: 520, y: 760, bind: 26.7625 },
};
const GREETING_DURATION = 1800;
const smoothStep = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
// Both shape turns happen while the arm travels, never after it reaches idle.
const greetingShapeProgress = elapsed => smoothStep((elapsed - 116) / 200) * (1 - smoothStep((elapsed - 1466) / 200));

/** 사용자 SVG의 도형·겹침 순서를 보존하고 별도 그룹에만 동작을 적용한다. */
export default function PandaMascot({
  stage = 5, motion = 'idle', actionId = 0, size = 220,
  decorative = false, label, className, style, wardrobe = null, ambient = false,
}) {
  const svgRef = useRef(null);
  const instanceId = useId();
  const prefix = 'panda-' + instanceId.replace(/:/g, '');
  const stageIndex = Number.isFinite(Number(stage)) ? Math.max(0, Math.min(5, Math.floor(Number(stage)))) : 5;
  const activeMotion = motion === 'eating' || motion === 'petting' ? motion : 'idle';
  const activeWardrobe = stageIndex === 5 ? normalizePandaWardrobe(wardrobe) : null;
  const scheduledAmbientMotion = usePandaAmbientMotion(ambient && stageIndex > 0 && activeMotion === 'idle', stageIndex, activeWardrobe?.hand);
  const ambientMotion = scheduledAmbientMotion === 'greeting' && stageIndex !== 5 ? null : scheduledAmbientMotion;
  const greeting = ambientMotion === 'greeting';
  // The bottle uses both arms. Other growing stages hold their prop on the left;
  // adult hand accessories use the right arm, so wave with its free left arm.
  const waveSide = stageIndex === 2 ? 'none' : activeWardrobe?.hand ? 'left' : 'right';
  const waveJoint = waveSide === 'left' ? GREETING_JOINTS.left : GREETING_JOINTS[stageIndex];

  useLayoutEffect(() => {
    // The greeting arm uses its fixed shoulder for idle as well. Keep the other
    // growing arm's original fill-box pivot stable when its child is wrapped.
    if (stageIndex === 5) return;
    for (const arm of svgRef.current?.querySelectorAll('.panda-mascot__arm-idle--left') || []) {
      const box = arm.getBBox?.();
      if (!box || !Number.isFinite(box.width) || !box.width) continue;
      arm.style.transformBox = 'view-box';
      arm.style.transformOrigin = `${box.x + box.width / 2}px ${box.y + box.height * .12}px`;
    }
  }, [stageIndex]);

  useLayoutEffect(() => {
    if (!greeting || !waveJoint) return undefined;
    const wave = svgRef.current?.querySelector('.panda-mascot__arm-wave--' + waveSide);
    if (!wave) return undefined;
    const options = { shoulder: { x: waveJoint.x, y: waveJoint.y }, normalizeAngle: -waveJoint.bind };
    const curves = [...wave.querySelectorAll('[data-part="arm-' + waveSide + '"] path')].map(node => {
      const original = node.getAttribute('d');
      return { node, original, morph: createPandaArmMorph(original, options) };
    });
    // Only the transient drawing is inline. The real wardrobe component mounts
    // once, preserving its image load barrier and equipment flash lifecycle.
    const sleeve = wave.querySelector('[data-part="accessory-sleeve-' + waveSide + '"]');
    const sleevePaths = PANDA_SLEEVE_GEOMETRY[activeWardrobe?.costume]?.[waveSide];
    let sleeveOverlay;
    const sleeveVisibility = sleeve?.style.visibility;
    if (sleeve && sleevePaths?.length) {
      sleeveOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      sleeveOverlay.setAttribute('class', 'panda-mascot__sleeve-morph');
      sleeveOverlay.setAttribute('aria-hidden', 'true');
      sleeveOverlay.setAttribute('pointer-events', 'none');
      for (const geometry of sleevePaths) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        node.setAttribute('d', geometry.d);
        node.setAttribute('fill', geometry.fill);
        sleeveOverlay.append(node);
        curves.push({ node, original: geometry.d, morph: createPandaArmMorph(geometry.d, options) });
      }
      sleeve.after(sleeveOverlay);
      sleeve.style.visibility = 'hidden';
    }
    let frame;
    const started = performance.now();
    const draw = () => {
      const animation = wave.getAnimations?.().find(item => item.animationName === 'panda-mascot-wave');
      const elapsed = animation?.currentTime ?? performance.now() - started;
      const progress = greetingShapeProgress(elapsed);
      for (const { node, original, morph } of curves) node.setAttribute('d', progress === 0 ? original : morph.interpolate(progress));
      wave.dataset.morphProgress = progress.toFixed(3);
      if (elapsed < GREETING_DURATION) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      curves.forEach(({ node, original }) => node.setAttribute('d', original));
      sleeveOverlay?.remove();
      if (sleeve) sleeve.style.visibility = sleeveVisibility;
      delete wave.dataset.morphProgress;
    };
  }, [greeting, stageIndex, waveSide, waveJoint, activeWardrobe?.costume]);

  useLayoutEffect(() => {
    // Equipping a separated rear hat / hand prop during idle must join the body's
    // running animation, rather than starting its own breathing or arm cycle at zero.
    const svg = svgRef.current;
    const head = svg?.querySelector('[data-part="head"]');
    const rearHat = svg?.querySelector('[data-motion-part="hat-back"]');
    const rightArm = svg?.querySelector('[data-part="arm-right"]');
    const hand = svg?.querySelector('[data-motion-part="hand-prop"]');
    const sync = (source, target) => {
      const sourceAnimations = source?.getAnimations?.() || [];
      for (const animation of target?.getAnimations?.() || []) {
        const original = sourceAnimations.find(item => item.animationName === animation.animationName);
        if (!original) continue;
        if (Number.isFinite(original.playbackRate)) animation.playbackRate = original.playbackRate;
        // A newly mounted CSS animation may still be pending. Copying elapsed time
        // would let it resume on the next frame and drift from the existing part.
        // Share the absolute document-timeline start whenever it is resolved.
        if (original.startTime != null) animation.startTime = original.startTime;
        else if (original.currentTime != null) animation.currentTime = original.currentTime;
      }
    };
    sync(head?.closest('.panda-mascot__head-action'), rearHat);
    sync(head?.closest('.panda-mascot__head-breath'), rearHat?.parentElement);
    sync(rightArm?.closest('.panda-mascot__arm-idle'), hand);
    if (activeMotion === 'idle') {
      // Idle runs continuously outside the separate greeting wrapper. Only a
      // newly mounted part or a motion change needs to join the breathing clock.
      const clock = head?.closest('.panda-mascot__head-breath')?.getAnimations?.()
        .find(animation => /^panda-mascot-(adult-)?breathe$/.test(animation.animationName));
      if (clock) for (const arm of svg.querySelectorAll('.panda-mascot__arm-idle')) {
        for (const animation of arm.getAnimations?.() || []) {
          if (!/^panda-mascot-(adult-)?idle-(left|right)$/.test(animation.animationName)) continue;
          if (Number.isFinite(clock.playbackRate)) animation.playbackRate = clock.playbackRate;
          if (clock.startTime != null) animation.startTime = clock.startTime;
          else if (clock.currentTime != null) animation.currentTime = clock.currentTime;
        }
      }
    }
  }, [stageIndex, activeMotion, activeWardrobe?.hat, activeWardrobe?.hand]);

  useEffect(() => {
    if (activeMotion === 'idle') return;
    // Every feed starts the whole reaction together, including a continuing meal.
    // Keep the existing artwork mounted so clothes and edited paths stay intact.
    svgRef.current?.querySelectorAll('.panda-mascot__action,.panda-mascot__arm-idle,.panda-mascot__leg-action').forEach((part) => {
      part.getAnimations?.().forEach((animation) => { animation.currentTime = 0; });
    });
  }, [activeMotion, actionId]);

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1254 1254"
      width={size}
      height={size}
      className={cn('panda-mascot', className)}
      style={{ '--panda-eating-duration': PANDA_MOTION_DURATION.eating + 'ms', '--panda-petting-duration': PANDA_MOTION_DURATION.petting + 'ms',
        ...(waveJoint ? { '--panda-wave-shoulder': `${waveJoint.x}px ${waveJoint.y}px`, '--panda-arm-bind': waveJoint.bind + 'deg', '--panda-arm-normalize': -waveJoint.bind + 'deg' } : {}), ...style }}
      data-stage={stageIndex}
      data-motion={activeMotion}
      data-action-id={actionId}
      data-ambient={ambientMotion || undefined}
      data-wave-side={waveSide}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : prefix + '-title'}
      focusable="false"
    >
      {!decorative && <title id={prefix + '-title'}>{label || PANDA_STAGE_LABELS[stageIndex]}</title>}
      <g className="panda-mascot__body-idle">
        <g data-part="artwork" className="panda-mascot__body-action panda-mascot__action"><PandaGrowthArtwork stage={stageIndex} prefix={prefix} wardrobe={activeWardrobe} /></g>
      </g>
      <PandaPettingHand offsetY={HAND_OFFSET_Y[stageIndex]} />
    </svg>
  );
}
