import { useEffect, useState } from 'react';
import { SCENE } from '../tgTokens.js';
import { FIELD_ASSETS, FIELD_TREES, FIELD_HOUSE, FIELD_CHIMNEY, FIELD_SHRUBS, FIELD_SMOKE } from '../fieldScene.js';

const placement = ([x, y, width, height]) => ({
  position: 'absolute', left: `${x / 1536 * 100}%`, top: `${y / 1024 * 100}%`,
  width: `${width / 1536 * 100}%`, height: `${height / 1024 * 100}%`,
});

// 각 viewBox에는 복원한 오브젝트 전체가 들어 있다. 가림은 앞 레이어가 담당한다.
function FieldSprite({ asset, part, className, style }) {
  return <svg data-field-part={part.name} className={className} viewBox={part.viewBox.join(' ')}
    preserveAspectRatio="none" aria-hidden="true" focusable="false"
    style={{ display: 'block', overflow: 'hidden', ...placement(part.box), ...style }}>
    <image href={asset.src} width={asset.width} height={asset.height} />
  </svg>;
}

export default function FieldIllustration() {
  const [paused, setPaused] = useState(() => document.hidden);
  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  const shrub = part => <FieldSprite key={part.name} asset={FIELD_ASSETS.shrubs} part={part} />;
  return <div className="tg-field-parts" data-paused={paused} style={{
    position: 'absolute', bottom: 0, width: '100%', aspectRatio: '1536 / 1024',
  }}>
    <img data-field-part="backdrop" src={FIELD_ASSETS.backdrop} alt="" draggable={false}
      style={{ display: 'block', width: '100%', height: '100%', maxWidth: 'none' }} />
    {FIELD_SHRUBS.filter(part => part.layer === 'back').map(shrub)}
    {FIELD_TREES.map((part, i) => <FieldSprite key={part.name} asset={FIELD_ASSETS.trees}
      part={part} className="tg-field-tree" style={{
        transformOrigin: `${part.pivot[0] / part.viewBox[2] * 100}% ${part.pivot[1] / part.viewBox[3] * 100}%`,
        animationDuration: `${6 + i * .7}s`, animationDelay: `${-i * 1.1}s`,
      }} />)}
    <FieldSprite asset={FIELD_ASSETS.chimney} part={FIELD_CHIMNEY} />
    <FieldSprite asset={FIELD_ASSETS.house} part={FIELD_HOUSE} />
    <div data-field-part="smoke" style={{ position: 'absolute', left: `${FIELD_SMOKE[0] / 1536 * 100}%`,
      top: `${FIELD_SMOKE[1] / 1024 * 100}%`, width: `${FIELD_SMOKE[2] / 1536 * 100}%`, aspectRatio: '1' }}>
      {[0, 1, 2].map(i => <span key={i} className="tg-field-smoke" style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: SCENE.SMOKE_SHADE,
        animationDelay: `${-i * 1.6}s`,
      }} />)}
    </div>
    {FIELD_SHRUBS.filter(part => part.layer === 'front').map(shrub)}
  </div>;
}
