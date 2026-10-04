import { PANDA_PALETTE } from '../../constants/pandaMascot.js';
import { PANDA_GAME_THEME } from '../../constants/pandaGameTheme.js';

// A small, outline-free bamboo sprig. Inline paths are ready on the first feed.
export default function PandaFeedLeaf() {
  return <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true" focusable="false">
    <path d="M9 35.5c-.8-.6-.9-1.6-.2-2.4L27 10.8l2.5 1.9-18.1 22.5c-.6.8-1.7.9-2.4.3Z" fill={PANDA_GAME_THEME.forest} />
    <path d="M20.7 24C10.3 25.1 5.3 18.4 6.1 5.8c10 1.3 16.1 7.6 14.6 18.2Z" fill={PANDA_PALETTE.bamboo} />
    <path d="M7.9 8c2.1 7.5 6.6 12.5 12.8 16C12.3 21.6 7.1 15.8 7.9 8Z" fill={PANDA_PALETTE.bambooLight} />
    <path d="M21.2 24C20.5 13.7 27 7.2 37.1 7.3c.3 10.1-5.9 17.4-15.9 16.7Z" fill={PANDA_GAME_THEME.forest} />
    <path d="M22.6 21.2C23.9 13.9 28.8 9.6 35 9.3c-3.5 6.7-7.8 10.3-12.4 11.9Z" fill={PANDA_PALETTE.bamboo} />
    <path d="M14.9 31C7.1 32.6 2.8 27.4 3.3 19.3c7.5.4 12 4.7 11.6 11.7Z" fill={PANDA_PALETTE.bamboo} />
    <path d="M4.9 21c1.6 4.5 4.7 7.5 10 10-6.4-.8-9.8-4.5-10-10Z" fill={PANDA_PALETTE.bambooLight} />
  </svg>;
}
