import { useCallback, useEffect, useRef, useState } from 'react';
import { createMemberSync } from './memberSync.js';
import { getMemberSession, mergeGuestIntoMember } from './gameStore.js';

export function useMemberSync(identity, onSynced) {
  const [status, setStatus] = useState(identity.kind === 'member' ? 'checking' : 'local');
  const syncRef = useRef(null);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  useEffect(() => {
    if (identity.kind !== 'member') return undefined;
    mergeGuestIntoMember(identity);
    const sync = createMemberSync(identity, {
      onState: setStatus,
      onSynced: () => onSyncedRef.current(),
    });
    syncRef.current = sync;
    // The session also preserves a nickname whose previous upload failed.
    sync.save(getMemberSession()?.user.nickname);
    const online = () => sync.retry();
    const storage = () => {
      const session = getMemberSession();
      if (session?.token !== identity.token || session?.user.id !== identity.id) {
        sync.dispose();
        setStatus('signed-out');
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('storage', storage);
    return () => {
      sync.dispose();
      syncRef.current = null;
      window.removeEventListener('online', online);
      window.removeEventListener('storage', storage);
    };
  }, [identity]);
  const save = useCallback(nickname => syncRef.current?.save(nickname), []);
  const retry = useCallback(() => syncRef.current?.retry(), []);
  return { status, save, retry };
}
