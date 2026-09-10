import { getMemberSession, pullMemberData, pushMemberData } from './gameStore.js';

// One queue per mounted game. A failed first read never permits a write; later
// saves reuse that read and keep progress made while a request is in flight.
export function createMemberSync(identity, { onState, onSynced = () => {} }) {
  let active = true;
  let pulled = false;
  let pendingSave = false;
  let running = null;
  let nickname;
  const current = () => {
    const session = getMemberSession();
    return active && session?.token === identity.token && session?.user.id === identity.id;
  };
  const report = status => { if (active) onState(status); };
  const run = () => {
    if (!active) return Promise.resolve(false);
    if (running) return running;
    if (!current()) { report('signed-out'); return Promise.resolve(false); }
    // Defer so synchronous double taps also share the same promise.
    running = Promise.resolve().then(async () => {
      try {
        if (!pulled) {
          report('checking');
          await pullMemberData(identity);
          if (!current()) return false;
          pulled = true;
          onSynced();
        }
        while (pendingSave && current()) {
          pendingSave = false;
          const savingNickname = nickname;
          nickname = undefined;
          report('saving');
          try { await pushMemberData(identity, savingNickname); }
          catch (error) {
            pendingSave = true;
            if (nickname === undefined) nickname = savingNickname;
            throw error;
          }
          if (!current()) return false;
          onSynced();
        }
        if (current()) report('saved');
        return current();
      } catch {
        if (active) report(!current() ? 'signed-out' : pulled ? 'save-error' : 'read-error');
        return false;
      } finally { running = null; }
    });
    return running;
  };
  return {
    retry: () => { if (!running) pendingSave = true; return run(); },
    save: (nextNickname) => {
      pendingSave = true;
      if (nextNickname !== undefined) nickname = nextNickname;
      return run();
    },
    dispose: () => { active = false; },
  };
}
