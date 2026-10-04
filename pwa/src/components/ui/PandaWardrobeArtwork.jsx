import { useLayoutEffect, useRef, useState } from 'react';
import { PANDA_ART_VIEWBOX, PANDA_PART_LAYERS, PANDA_WARDROBE_SETS, PANDA_WARDROBE_SLOTS } from '../../constants/pandaWardrobe.js';
import './PandaWardrobeArtwork.css';

const SETS = new Set(PANDA_WARDROBE_SETS.map(({ id }) => id));
const SLOTS = PANDA_WARDROBE_SLOTS.map(({ id }) => id);
const PART_SLOT = Object.fromEntries(Object.entries(PANDA_PART_LAYERS).flatMap(([slot, layers]) => layers.map(layer => [layer, slot])));
const EQUIP_FLASH_DURATION = 300;
// Costume and sleeves live in separate motion groups. Their load barrier belongs
// to this SVG instance, never to another preview or a thumbnail of the same item.
const pendingFlashes = new WeakMap();
let flashSequence = 0;

function registerFlash(svg, logicalSlot, set, layer, notify, loaded) {
  let slots = pendingFlashes.get(svg);
  if (!slots) { slots = new Map(); pendingFlashes.set(svg, slots); }
  let job = slots.get(logicalSlot);
  if (job && job.set !== set) { job.cancel(); job = null; }
  if (!job) {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    job = { set, entries: new Map(), frame: null, timer: null, active: true };
    const onMotionPreference = event => { if (event.matches) job.cancel(); };
    job.cancel = () => {
      if (!job.active) return;
      job.active = false;
      if (job.frame !== null) cancelAnimationFrame(job.frame);
      clearTimeout(job.timer);
      media?.removeEventListener('change', onMotionPreference);
      job.entries.forEach(entry => entry.notify(null));
      job.entries.clear();
      if (slots.get(logicalSlot) === job) slots.delete(logicalSlot);
    };
    job.reducedMotion = () => media?.matches;
    media?.addEventListener('change', onMotionPreference);
    slots.set(logicalSlot, job);
  }
  const entry = { notify, loaded };
  job.entries.set(layer, entry);
  const startWhenReady = () => {
    if (!job.active || job.frame !== null || job.entries.size !== PANDA_PART_LAYERS[logicalSlot].length
      || [...job.entries.values()].some(part => !part.loaded)) return;
    job.frame = requestAnimationFrame(() => {
      if (!job.active) return;
      if (job.reducedMotion()) { job.cancel(); return; }
      const flash = { set, id: ++flashSequence, phase: 'revealing' };
      job.entries.forEach(part => part.notify(flash));
      job.timer = setTimeout(job.cancel, EQUIP_FLASH_DURATION);
    });
  };
  startWhenReady();
  return {
    loaded() { entry.loaded = true; startWhenReady(); },
    failed() { job.cancel(); },
    release() {
      // Do not update the component whose effect is already being cleaned up.
      if (job.entries.get(layer) === entry) job.entries.delete(layer);
      job.cancel();
    },
  };
}

// Persisted wardrobe values cannot choose arbitrary asset paths or hide the default scarf.
export function normalizePandaWardrobe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const wardrobe = Object.fromEntries(SLOTS.map(slot => [slot, SETS.has(value[slot]) ? value[slot] : null]));
  return SLOTS.some(slot => wardrobe[slot]) ? wardrobe : null;
}

/** Each exported SVG retains the user's full Illustrator canvas and its own paint definitions. */
export default function PandaWardrobeArtwork({ wardrobe, slot, motion }) {
  const candidate = wardrobe?.[PART_SLOT[slot]];
  const set = SETS.has(candidate) ? candidate : null;
  const href = set ? '/panda/wardrobe/' + set + '-' + slot + '.svg' : null;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const imageRef = useRef(null);
  const flashImageRef = useRef(null);
  const previousSetRef = useRef(set);
  const loadedImageRef = useRef(null);
  const loadedFlashImageRef = useRef(null);
  const registrationRef = useRef(null);
  const [flash, setFlash] = useState(null);
  // Guard the very first render of an incoming item, before any layout effect or
  // image load: only its opaque white silhouette may be painted until reveal.
  const incoming = set && previousSetRef.current !== set && !reducedMotion;
  const visibleFlash = !reducedMotion && (flash?.set === set ? flash : incoming ? { set, phase: 'waiting' } : null);

  useLayoutEffect(() => {
    const changed = previousSetRef.current !== set;
    previousSetRef.current = set;
    const svg = imageRef.current?.ownerSVGElement;
    if (!changed || !set || !svg || reducedMotion) { setFlash(null); return undefined; }
    setFlash({ set, phase: 'waiting' });
    const loaded = loadedImageRef.current === imageRef.current && loadedFlashImageRef.current === flashImageRef.current;
    const registration = registerFlash(svg, PART_SLOT[slot], set, slot, setFlash, loaded);
    registrationRef.current = registration;
    return () => {
      if (registrationRef.current === registration) registrationRef.current = null;
      registration.release();
    };
  }, [set, slot, href, reducedMotion]);

  if (!set) return null;
  const loaded = (event, white) => {
    if (white) loadedFlashImageRef.current = event.currentTarget;
    else loadedImageRef.current = event.currentTarget;
    if (flashImageRef.current && loadedImageRef.current === imageRef.current && loadedFlashImageRef.current === flashImageRef.current) {
      registrationRef.current?.loaded();
    }
  };
  const artwork = (
    <><image
      key={href}
      ref={imageRef}
      data-part={'accessory-' + slot}
      data-wardrobe-set={set}
      className={visibleFlash?.phase === 'waiting' ? 'panda-wardrobe-equip-pending' : undefined}
      href={href}
      x={PANDA_ART_VIEWBOX[0]} y={PANDA_ART_VIEWBOX[1]} width={PANDA_ART_VIEWBOX[2]} height={PANDA_ART_VIEWBOX[3]}
      aria-hidden="true"
      pointerEvents="none"
      onLoad={event => loaded(event, false)}
      onError={() => registrationRef.current?.failed()}
    />{visibleFlash && <image
      key={'flash-' + href}
      ref={flashImageRef}
      data-equip-flash={slot}
      data-flash-id={visibleFlash.id}
      data-flash-phase={visibleFlash.phase}
      className={'panda-wardrobe-equip-flash' + (visibleFlash.phase === 'waiting' ? ' is-waiting' : '')}
      href={href}
      x={PANDA_ART_VIEWBOX[0]} y={PANDA_ART_VIEWBOX[1]} width={PANDA_ART_VIEWBOX[2]} height={PANDA_ART_VIEWBOX[3]}
      aria-hidden="true"
      pointerEvents="none"
      style={{ '--panda-equip-flash-duration': EQUIP_FLASH_DURATION + 'ms' }}
      onLoad={event => loaded(event, true)}
      onError={() => registrationRef.current?.failed()}
    />}</>
  );
  if (motion === 'head') {
    return <g className="panda-mascot__head-breath">
      <g className="panda-mascot__head-action panda-mascot__action" data-motion-part="hat-back">
        {artwork}
      </g>
    </g>;
  }
  if (motion === 'arm-right') {
    return <g className="panda-mascot__arm-idle panda-mascot__arm-idle--right" data-motion-part="hand-prop">
      {artwork}
    </g>;
  }
  return artwork;
}
