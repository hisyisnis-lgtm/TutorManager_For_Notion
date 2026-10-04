import { cn } from '@/lib/utils';
import PandaMascot from './PandaMascot.jsx';

// Original 1254×1254 coordinates: midpoint between the inner foot bounds, at
// the lowest sole. Egg / hatching use the bottom centre of the shell instead.
// These exclude clothing, the petting hand and animated head/arm bounds.
const GROUND_POINTS = [
  [626, 1117],
  [625.090240, 1131.899902],
  [625, 1132.253052],
  [624.899994, 1139.800049],
  [632.677124, 1123.128052],
  [624.900024, 1123.142212],
];

function figureGeometry(width, stage) {
  // Figma 7:3 keeps the egg smaller and lower within the same 500×680 frame.
  // Its 42px instance has painted bounds (7.182,19.18,27.748,33.7064).
  const stageIndex = Number.isFinite(Number(stage)) ? Math.max(0, Math.min(5, Math.floor(Number(stage)))) : 5;
  const egg = stageIndex === 0;
  const scale = egg ? width / 42 * (27.748003005981445 / 638) : width / 750;
  const left = egg ? width / 42 * 7.181997299194336 - 307 * scale : -250 * scale;
  const top = egg ? width / 42 * 19.17999839782715 - 342 * scale : -150 * scale;
  const [groundX, groundY] = GROUND_POINTS[stageIndex];
  return { scale, left, top, groundX: left + groundX * scale, groundY: top + groundY * scale };
}

// A floor-anchored shadow and the figure's motion must use the same sole point.
export function getPandaFigureGroundPoint(width = 160, stage = 5) {
  const { groundX: x, groundY: y } = figureGeometry(width, stage);
  return { x, y };
}

// Figma's 500×680 character frame is the original artwork's (250,150,750,1020)
// window. Crop the presentation wrapper without changing the SVG coordinate
// system: sleeves, hats and animation pivots must retain their 1254×1254 space.
export default function PandaFigure({ width = 160, className, style, stage = 5, ...mascotProps }) {
  const { scale, left, top, groundX, groundY } = figureGeometry(width, stage);
  return <span className={cn('panda-figure', className)} style={{
    display: 'block', position: 'relative', flexShrink: 0, width, height: width * 1.36,
    transformOrigin: `${groundX}px ${groundY}px`, ...style,
  }}>
    <PandaMascot {...mascotProps} stage={stage} size={1254 * scale} style={{
      position: 'absolute', left, top,
      width: 1254 * scale, height: 1254 * scale, maxWidth: 'none',
    }} />
  </span>;
}
