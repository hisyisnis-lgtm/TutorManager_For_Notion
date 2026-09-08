import { useId } from 'react';
import { SCENE } from '../tgTokens.js';
import './RoomBackdrop.css';

function AtticWindow() {
  const id = useId();
  return <svg data-room-window="" className="tg-room-window" viewBox="0 0 88 84" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id={`${id}-glass`}><rect x="16" y="14" width="56" height="52" rx="2" /></clipPath>
    </defs>
    {/* 정면 벽의 사각창. 얇은 목재 테두리와 밝은 안쪽 면으로 깊이만 준다. */}
    <rect x="6" y="6" width="76" height="72" rx="5" fill={SCENE.MOLD_DARK} opacity=".1" />
    <rect x="6" y="4" width="76" height="72" rx="5" fill={SCENE.MOLD_LIGHT} />
    <rect x="11" y="9" width="66" height="62" rx="2" fill={SCENE.FLOOR} />
    <g clipPath={`url(#${id}-glass)`}>
      <rect x="16" y="14" width="56" height="52" fill={SCENE.ROOM_SKY} />
      <path d="M12 33Q16 27 22 29Q27 20 34 27Q42 26 45 33Z" fill={SCENE.FLOOR} opacity=".85" />
      <path d="M16 14H72M16 14V66" fill="none" stroke={SCENE.MOLD_MID} strokeWidth="3" opacity=".18" />
      <path d="M44 14V66M16 40H72" stroke={SCENE.MOLD_LIGHT} strokeWidth="3" />
    </g>
    <path d="M9 6H79" stroke={SCENE.FLOOR} opacity=".55" strokeLinecap="round" />
    <rect x="3" y="74" width="82" height="5" rx="2" fill={SCENE.MOLD_LIGHT} />
  </svg>;
}

// 바닥 경계 144px는 HomeScreen의 물리 영역(ROOM_TOP=146)과 함께 유지한다.
export default function RoomBackdrop() {
  const id = useId();
  return <div data-room-backdrop="" className="tg-room-backdrop" aria-hidden="true">
    {/* viewBox 없이 CSS px를 사용해 방 높이가 바뀌어도 바닥 경계를 고정한다. */}
    <svg className="tg-room-scene" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${id}-boards`} width="560" height="224" x="50%"
          patternUnits="userSpaceOnUse" patternTransform="translate(-280 0)">
          <path d="M0 0H560M0 56H560M0 112H560M0 168H560M140 0V56M420 0V56M280 56V112M80 112V168M360 112V168M220 168V224M500 168V224"
            fill="none" stroke={SCENE.MOLD_MID} strokeOpacity=".13" />
        </pattern>
        <pattern id={`${id}-panels`} width="72" height="26" patternUnits="userSpaceOnUse">
          <rect x="71" width="1" height="26" fill={SCENE.RAIL} opacity=".15" />
        </pattern>
      </defs>
      {/* 넓은 판재의 이음선만 남기고 나뭇결·얼룩·광원 질감을 제거한다. */}
      <svg data-room-floor="" className="tg-room-floor" x="0" y="144" width="100%">
        <rect width="100%" height="100%" fill={SCENE.FLOOR} />
        <rect width="100%" height="100%" fill={`url(#${id}-boards)`} />
      </svg>
      <g data-room-wall="">
        <rect width="100%" height="112" fill={SCENE.WALL} />
        <rect width="6" height="112" fill={SCENE.PANEL} opacity=".21" />
        <rect x="100%" width="6" height="112" transform="translate(-6 0)" fill={SCENE.PANEL} opacity=".21" />
      </g>
      <rect y="112" width="100%" height="26" fill={SCENE.ROOM_PANEL} />
      <rect y="112" width="100%" height="26" fill={`url(#${id}-panels)`} />
      <rect y="112" width="100%" height="2" fill={SCENE.WALL_BAND} />
      <rect y="138" width="100%" height="6" fill={SCENE.MOLD_LIGHT} />
      <rect y="138" width="100%" height="2" fill={SCENE.WALL_BAND} />
    </svg>
    <AtticWindow />
  </div>;
}
