import { useId, useLayoutEffect, useRef } from 'react';
import { Content as DialogContent } from '@radix-ui/react-dialog';
import {
  ArchiveIcon, CheckCircleIcon, CloudArrowUpIcon, FileMagnifyingGlassIcon,
  FileTextIcon, TrashIcon,
} from '@phosphor-icons/react';
import { Dialog, DialogPortal, DialogOverlay, DialogTitle, DialogDescription } from '../shadcn/dialog';
import { BG_CARD } from '../../constants/theme.js';
import './HomeworkProgressOverlay.css';

const IN_MS = 620;
const OUT_MS = 320;
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const out = (value) => 1 - (1 - clamp(value)) ** 3;
const span = (time, start, end) => clamp((time - start) / (end - start));

const PAGE = 'M208 88 152 32H56a8 8 0 0 0-8 8v176a8 8 0 0 0 8 8h144a8 8 0 0 0 8-8Z';
const FOLD = 'M152 32v56h56';
const FILE_PARTS = [
  { role: 'page', path: PAGE }, { role: 'fold', path: FOLD },
  { role: 'line', path: 'M96 136h64' }, { role: 'line', path: 'M96 168h64' },
];
const GLYPHS = {
  checking: { Icon: FileMagnifyingGlassIcon, parts: [
    { role: 'page', path: PAGE }, { role: 'fold', path: FOLD },
    { role: 'lens', path: 'M152 148a28 28 0 1 1-56 0 28 28 0 1 1 56 0' },
    { role: 'handle', path: 'M144 168l16 16' },
  ] },
  preparing: { Icon: FileTextIcon, parts: FILE_PARTS },
  compressing: { Icon: ArchiveIcon, parts: [
    { role: 'body', path: 'M40 96v96a8 8 0 0 0 8 8h160a8 8 0 0 0 8-8V96' },
    { role: 'lid', path: 'M32 56h192a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V64a8 8 0 0 1 8-8Z' },
    { role: 'grip', path: 'M104 136h48' },
  ] },
  uploading: { Icon: CloudArrowUpIcon, parts: [
    { role: 'cloud', path: 'M112 208H72a56 56 0 1 1 9.92-111.12' },
    { role: 'cloud', path: 'M80 128a80 80 0 1 1 112 73.32' },
    { role: 'stem', path: 'M152 208v-80' }, { role: 'arrow', path: 'M120 160l32-32 32 32' },
  ] },
  saving: { Icon: FileTextIcon, parts: FILE_PARTS },
  deleting: { Icon: TrashIcon, parts: [
    { role: 'body', path: 'M56 56v152a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8V56' },
    { role: 'lid', path: 'M40 56h176M88 56V40a16 16 0 0 1 16-16h48a16 16 0 0 1 16 16v16' },
    { role: 'line', path: 'M104 104v64' }, { role: 'line', path: 'M152 104v64' },
  ] },
  complete: { Icon: CheckCircleIcon, parts: [
    { role: 'circle', path: 'M224 128a96 96 0 1 1-192 0 96 96 0 1 1 192 0' },
    { role: 'check', path: 'M88 136l24 24 56-56' },
  ] },
};

const MESSAGES = {
  checking: '파일 용량을 확인하고 있어요', preparing: '파일을 준비하고 있어요',
  compressing: '파일 용량을 줄이고 있어요', uploading: '파일을 올리고 있어요',
  saving: '저장을 마무리하고 있어요', deleting: '파일을 삭제하고 있어요',
  complete: '완료되었어요',
};

const freshParts = (stage) => GLYPHS[stage].parts.map((part, index) => ({
  ...part, index, end: 1, dx: 0, dy: 0, sx: 1, sy: 1, ox: 128, oy: 128, alpha: 1,
}));

function incoming(stage, time) {
  return freshParts(stage).map((p) => {
    if (stage === 'checking') {
      const delay = { page: 0, fold: 100, lens: 210, handle: 390 }[p.role];
      p.end = out(span(time, delay, delay + (p.role === 'page' ? 420 : 230)));
      if (p.role === 'lens' || p.role === 'handle') {
        p.sx = p.sy = 0.72 + 0.28 * out(span(time, 210, 590)); p.ox = 124; p.oy = 148;
      }
    } else if (stage === 'compressing') {
      if (p.role === 'body') { p.end = out(time / 390); p.dy = 16 * (1 - out(time / 460)); }
      if (p.role === 'lid') {
        const t = span(time, 65, 580);
        const spring = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
        p.dy = -40 * (1 - spring); p.end = out(span(time, 65, 370));
      }
      if (p.role === 'grip') p.end = out(span(time, 330, 600));
    } else if (stage === 'uploading') {
      if (p.role === 'cloud') p.end = out(span(time, p.index * 50, 470));
      else {
        p.end = out(span(time, p.role === 'stem' ? 180 : 320, 600));
        p.dy = 16 * (1 - out(span(time, 170, 620)));
      }
    } else if (stage === 'complete') {
      p.end = out(span(time, p.role === 'circle' ? 0 : 250, p.role === 'circle' ? 400 : 610));
    } else {
      const delay = p.role === 'page' || p.role === 'body' ? 0 : p.role === 'fold' || p.role === 'lid' ? 100 : 170 + (p.index - 2) * 95;
      p.end = out(span(time, delay, delay + (p.role === 'page' || p.role === 'body' ? 390 : 240)));
    }
    return p;
  });
}

function idle(stage, time) {
  return freshParts(stage).map((p) => {
    if (stage === 'checking' && (p.role === 'lens' || p.role === 'handle')) {
      const t = time / 2100 * Math.PI * 2; p.dx = Math.sin(t) * 7; p.dy = (1 - Math.cos(t)) * 1.7;
    } else if (stage === 'compressing') {
      const pressure = Math.sin(time / 1900 * Math.PI) ** 2;
      if (p.role === 'lid') p.dy = 7 * pressure;
      else { p.oy = 200; p.sy = 1 - 0.065 * pressure; }
    } else if (stage === 'uploading' && p.role !== 'cloud') {
      const t = (time / 1750 + 0.5) % 1;
      p.dy = 24 * (1 - 2 * ease(t)); p.alpha = Math.min(1, t / 0.17, (1 - t) / 0.17);
    } else if ((stage === 'saving' || stage === 'preparing') && p.role === 'line') {
      const local = time % 1800;
      if (p.index === Math.floor(local / 900) + 2) p.end = 1 - 0.4 * Math.sin(local % 900 / 900 * Math.PI) ** 2;
    } else if (stage === 'deleting' && p.role === 'lid') {
      p.dy = -6 * Math.sin(time / 1800 * Math.PI) ** 2;
    }
    return p;
  });
}

function outgoing(stage, parts, time) {
  const t = clamp(time / OUT_MS);
  return parts.map((source) => {
    const p = { ...source };
    let progress = out(t);
    if (stage === 'checking') {
      progress = p.role === 'lens' || p.role === 'handle' ? out(t / 0.72) : out((t - 0.12) / 0.88);
      p.dy -= 7 * ease(t);
    } else if (stage === 'compressing' || stage === 'deleting') {
      if (p.role === 'lid') p.dy -= 24 * ease(t);
      else { p.oy = 200; p.sy *= 1 - 0.1 * ease(t); }
    } else if (stage === 'uploading' && p.role !== 'cloud') {
      p.dy -= 32 * ease(t); p.alpha *= 1 - ease(t);
    } else if (p.role === 'page') progress = out((t - 0.13) / 0.87);
    p.end = source.end * (1 - progress);
    return p;
  });
}

/** Phosphor 원형은 유지하고 부위별 마스크로 선을 그리거나 지운다. */
function ProgressGlyph({ stage }) {
  const id = useId().replaceAll(':', '');
  const areaRef = useRef(null);
  const nodesRef = useRef({});
  const controllerRef = useRef(null);
  const latestStage = useRef(stage);
  latestStage.current = stage;

  useLayoutEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reduced = media?.matches ?? false;
    let current = latestStage.current;
    let next = null;
    let mode = reduced ? 'idle' : 'in';
    let elapsed = 0;
    let lastTime = null;
    let frame = null;
    let active = true;
    let lastParts = incoming(current, 0);
    let outParts = [];

    const draw = () => {
      if (!active) return;
      const parts = reduced ? freshParts(current) : mode === 'in' ? incoming(current, elapsed) : mode === 'out' ? outgoing(current, outParts, elapsed) : idle(current, elapsed);
      lastParts = parts;
      areaRef.current.dataset.stage = current;
      areaRef.current.dataset.motion = mode;
      Object.entries(nodesRef.current).forEach(([key, nodes]) => {
        nodes.group.style.display = key === current ? '' : 'none';
      });
      parts.forEach((p, index) => {
        const node = nodesRef.current[current].parts[index];
        node.mask.setAttribute('stroke-dashoffset', String(1 - p.end));
        node.group.setAttribute('opacity', String(p.alpha));
        node.group.setAttribute('transform', `translate(${p.dx + p.ox} ${p.dy + p.oy}) scale(${p.sx} ${p.sy}) translate(${-p.ox} ${-p.oy})`);
      });
    };
    const enter = (target) => { current = target; next = null; mode = reduced ? 'idle' : 'in'; elapsed = 0; };
    const request = (target) => {
      if (reduced) { enter(target); draw(); return; }
      if (mode === 'out') { next = target; return; }
      if (target === current) return;
      if (lastParts.every((p) => p.end < 0.002 || p.alpha < 0.002)) { enter(target); draw(); return; }
      next = target; outParts = lastParts; mode = 'out'; elapsed = 0; draw();
    };
    const tick = (now) => {
      if (!active) return;
      let delta = lastTime === null ? 0 : now - lastTime;
      lastTime = now;
      if (!document.hidden) {
        for (let pass = 0; pass < 3; pass += 1) {
          const duration = mode === 'in' ? IN_MS : mode === 'out' ? OUT_MS : Infinity;
          const step = Math.min(delta, Math.max(0, duration - elapsed));
          elapsed += step; delta -= step;
          if (elapsed < duration) break;
          if (mode === 'out') enter(next ?? current);
          else { mode = 'idle'; elapsed = 0; }
          if (delta <= 0) break;
        }
        draw();
      }
      // 완료 아이콘이 정착했거나 움직임 줄이기 설정이면 RAF를 멈춘다.
      frame = !reduced && !(current === 'complete' && mode === 'idle') ? requestAnimationFrame(tick) : null;
    };
    const start = () => { if (!reduced && frame === null) frame = requestAnimationFrame(tick); };
    const changeMotion = () => {
      reduced = media.matches;
      if (reduced) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null; enter(next ?? latestStage.current); draw();
      } else { lastTime = null; start(); }
    };
    const visibility = () => { lastTime = null; };
    controllerRef.current = { request(target) { request(target); lastTime = null; start(); } };
    media?.addEventListener?.('change', changeMotion);
    document.addEventListener('visibilitychange', visibility);
    draw(); start();
    return () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      media?.removeEventListener?.('change', changeMotion);
      document.removeEventListener('visibilitychange', visibility);
      controllerRef.current = null;
    };
  }, []);

  useLayoutEffect(() => { controllerRef.current?.request(stage); }, [stage]);

  return (
    <div ref={areaRef} className="homework-progress-glyph" aria-hidden="true" data-stage={stage} data-motion="in">
      <svg viewBox="0 0 256 256" width="60" height="60" focusable="false">
        {Object.entries(GLYPHS).map(([key, { Icon, parts }]) => (
          <g key={key} ref={(node) => { if (node) nodesRef.current[key] = { group: node, parts: nodesRef.current[key]?.parts ?? [] }; }}>
            {parts.map((part, index) => {
              const maskId = `homework-progress-${id}-${key}-${index}`;
              return (
                <g key={index} ref={(node) => { if (node) { nodesRef.current[key] ??= { parts: [] }; nodesRef.current[key].parts[index] = { ...nodesRef.current[key].parts[index], group: node }; } }}>
                  <defs>
                    <mask id={maskId} maskUnits="userSpaceOnUse" x="-64" y="-64" width="384" height="384">
                      <path ref={(node) => { if (node) { nodesRef.current[key] ??= { parts: [] }; nodesRef.current[key].parts[index] = { ...nodesRef.current[key].parts[index], mask: node }; } }} d={part.path} fill="none" stroke="white" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1 1" strokeDashoffset="1" />
                    </mask>
                  </defs>
                  <g mask={`url(#${maskId})`}><Icon size={256} weight="regular" aria-hidden="true" /></g>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function HomeworkProgressOverlay({ stage = null, message, detail }) {
  const previousFocus = useRef(null);
  const open = Object.hasOwn(GLYPHS, stage);
  const preventDismiss = (event) => event.preventDefault();

  return (
    <Dialog open={open}>
      <DialogPortal>
        <DialogOverlay className="bg-black/[0.72] data-[state=open]:animate-none data-[state=closed]:animate-none" />
        <DialogContent
          className="homework-progress-overlay"
          style={{ '--homework-progress-ink': BG_CARD }}
          onEscapeKeyDown={preventDismiss}
          onPointerDownOutside={preventDismiss}
          onInteractOutside={preventDismiss}
          onOpenAutoFocus={() => { previousFocus.current = document.activeElement; }}
          onCloseAutoFocus={(event) => {
            const target = previousFocus.current;
            if (target?.isConnected && !target.disabled) { event.preventDefault(); target.focus({ preventScroll: true }); }
          }}
        >
          {open && <ProgressGlyph stage={stage} />}
          <div className="homework-progress-copy" role="status" aria-live="polite" aria-atomic="true">
            <DialogTitle className="homework-progress-title">{message || MESSAGES[stage]}</DialogTitle>
            <DialogDescription className={detail ? 'homework-progress-detail' : 'sr-only'}>
              {detail || '처리가 끝나면 화면이 자동으로 닫혀요.'}
            </DialogDescription>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
