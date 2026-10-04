import { PANDA_PALETTE as P } from '../../constants/pandaMascot.js';
import { PANDA_PETTING_HAND_PATHS as HAND } from '../../constants/pandaPettingHandGeometry.js';
import './PandaPettingHand.css';

/** 사용자가 직접 다듬은 흰 장갑 벡터. 반전된 원본의 방향을 유지한다. */
export default function PandaPettingHand({ crowned = false, offsetY = 0 }) {
  return (
    <g
      data-part="petting-hand-position"
      transform={`translate(440 ${(crowned ? 40 : 60) + offsetY})`}
      aria-hidden="true"
    >
      <g data-part="petting-hand" className="panda-mascot__petting-hand panda-mascot__action">
        {/* Illustrator의 4배 캔버스를 기존 손보다 가로·세로 2배로 표시한다. */}
        <g data-part="petting-hand-mirrored" transform="scale(.45)" fill={P.hand} stroke={P.handCrease} strokeWidth="9.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={HAND.palm} />
          <path d={HAND.fingers} fill="none" />
          <path d={HAND.cuff} />
          <path d={HAND.opening} fill="none" />
        </g>
      </g>
    </g>
  );
}
