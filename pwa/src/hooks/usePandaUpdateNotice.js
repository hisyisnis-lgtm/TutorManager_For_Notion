import { useState } from 'react';
import { hasSeenPandaUpdate, markPandaUpdateSeen } from '../utils/pandaUpdateNotice.js';

export default function usePandaUpdateNotice(studentToken) {
  const [dismissedTokens, setDismissedTokens] = useState(() => new Set());
  const pending = Boolean(studentToken) && !dismissedTokens.has(studentToken) && !hasSeenPandaUpdate(studentToken);

  const dismiss = () => {
    if (!studentToken) return;
    markPandaUpdateSeen(studentToken);
    setDismissedTokens(previous => new Set(previous).add(studentToken));
  };

  return { pending, dismiss };
}
