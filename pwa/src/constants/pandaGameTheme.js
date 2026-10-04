import { FINDER_COLORS, FONT_TITLE } from '../game/tgTokens.js';

// 랴오랴오 Figma 10:99 / 169:7917. 게임 범위에서만 적용한다.
export const PANDA_GAME_THEME = Object.freeze({
  background: '#F8F4E7',
  ink: FINDER_COLORS.text,
  secondary: FINDER_COLORS.secondary,
  forest: '#36551E',
  card: FINDER_COLORS.card,
  secondaryButton: '#EFECE3',
  secondaryButtonEdge: '#D4D0C6',
  action: FINDER_COLORS.action,
  actionEdge: FINDER_COLORS.actionEdge,
  stage: '#E3EDCF',
  floor: '#EEE0C5',
  floorEdge: '#D5AB72',
  groundShadow: '#B09768',
  progress: FINDER_COLORS.success,
  progressTrack: '#E8EDE0',
  danger: '#A33B32',
  edge: FINDER_COLORS.edge,
  muted: '#DEE3D8',
  sageDark: '#C5D5A4',
  overlay: 'rgba(23, 53, 68, 0.28)',
  shadow: '0 10px 10px rgba(0, 0, 0, 0.06)',
  buttonDepth: '4px',
  buttonPressedDepth: '1px',
  buttonFontSize: '18px',
  buttonShadow: 'var(--pg-shadow), 0 var(--pg-button-depth) 0 var(--pg-secondary-button-edge)',
  motionFast: '120ms',
  motionEnter: '220ms',
  motionExit: '160ms',
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  fontTitle: FONT_TITLE,
  fontBody: '"Noto Sans KR", sans-serif',
});

export const PANDA_GAME_VARS = Object.freeze(Object.fromEntries(
  Object.entries(PANDA_GAME_THEME).map(([key, value]) => [
    '--pg-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value,
  ]),
));
