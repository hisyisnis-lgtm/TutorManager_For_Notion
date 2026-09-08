import { useEffect, useState } from 'react';
import { FIELD_ASSETS, FIELD_TREES, FIELD_SHRUBS } from '../fieldScene.js';

const treeForm = name => FIELD_TREES.find(part => part.name === name);
const shrubForm = name => FIELD_SHRUBS.find(part => part.name === name);
// 원본의 완전한 윤곽과 비율을 유지하고, 겹치는 위치는 앞 레이어가 가린다.
const place = (source, name, x, y, width) => ({
  ...source, name, box: [x, y, width, width * source.viewBox[3] / source.viewBox[2]],
});
const FOREST_TREES = [
  place(treeForm('tree-small-left'), 'forest-far-left', 365, 404, 270),
  place(treeForm('tree-small-right'), 'forest-far-right', 910, 416, 260),
  place(treeForm('tree-small-right'), 'forest-rear-left', 48, 360, 290),
  place(treeForm('tree-left'), 'forest-middle-left', 174, 300, 405),
  place(treeForm('tree-right'), 'forest-middle-right', 1015, 285, 415),
  place(treeForm('tree-right'), 'forest-front-left', -166, 280, 485),
  place(treeForm('tree-left'), 'forest-front-right', 1288, 230, 475),
];
const FOREST_SHRUBS = [
  place(shrubForm('hedge-left'), 'forest-shrub-inner-left', 390, 666, 248),
  place(shrubForm('hedge-right'), 'forest-shrub-inner-right', 909, 657, 270),
  place(shrubForm('shrub-house-left'), 'forest-shrub-left', 179, 685, 276),
  place(shrubForm('shrub-house-right'), 'forest-shrub-right', 1068, 671, 270),
  place(shrubForm('hedge-left'), 'forest-shrub-left-edge', -54, 707, 290),
  place(shrubForm('hedge-right'), 'forest-shrub-right-edge', 1272, 712, 308),
  place(shrubForm('shrub-house-right'), 'forest-foreground-left', 64, 864, 236),
  place(shrubForm('shrub-house-left'), 'forest-foreground-right', 1284, 875, 214),
];

function ForestSprite({ asset, part, className, style }) {
  const [x, y, width, height] = part.box;
  return <svg data-field-part={part.name} className={className} viewBox={part.viewBox.join(' ')}
    preserveAspectRatio="none" aria-hidden="true" focusable="false"
    style={{ position: 'absolute', display: 'block', overflow: 'hidden',
      left: `${x / 1536 * 100}%`, top: `${y / 1024 * 100}%`,
      width: `${width / 1536 * 100}%`, height: `${height / 1024 * 100}%`, ...style }}>
    <image href={asset.src} width={asset.width} height={asset.height} />
  </svg>;
}

export default function ForestIllustration() {
  const [paused, setPaused] = useState(() => document.hidden);
  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <div className="tg-field-parts" data-paused={paused} data-field-scene="forest"
    style={{ position: 'absolute', bottom: 0, width: '100%', aspectRatio: '1536 / 1024' }}>
    <img data-field-part="forest-backdrop" src="/game/field-parts-vector/forest-backdrop.svg" alt="" draggable={false}
      style={{ display: 'block', width: '100%', height: '100%', maxWidth: 'none' }} />
    {FOREST_TREES.map((part, i) => <ForestSprite key={part.name} asset={FIELD_ASSETS.trees}
      part={part} className="tg-field-tree" style={{
        transformOrigin: `${part.pivot[0] / part.viewBox[2] * 100}% ${part.pivot[1] / part.viewBox[3] * 100}%`,
        animationDuration: `${7.2 + i * .45}s`, animationDelay: `${-i * 1.2}s`,
      }} />)}
    {FOREST_SHRUBS.map(part => <ForestSprite key={part.name} asset={FIELD_ASSETS.shrubs} part={part} />)}
  </div>;
}
