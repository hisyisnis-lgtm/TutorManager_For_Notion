import './PandaRoomBackdrop.css';

// Main room and circular growth reveals share this renderer. Future room decor
// belongs here so both views display the same room without copying its layers.
export default function PandaRoomBackdrop() {
  return <div className="panda-room-backdrop" aria-hidden="true">
    <div className="panda-room-floor" />
    <div className="panda-room-baseboard" />
  </div>;
}
