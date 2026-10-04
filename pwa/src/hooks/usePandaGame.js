import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPandaProfile, performPandaAction } from '../api/pandaApi.js';
import { commitPandaGameAction, getPandaFoodBalance, getPandaGameStorageKey, normalizePandaGameProfile, readPandaGameProfile } from '../constants/pandaGameState.js';
import { getPandaServerCacheKey, persistPandaServerCache, readPandaServerCache } from '../constants/pandaServerState.js';

const emptyProfile = normalizePandaGameProfile();
function initialState(storageKey, remote) {
  if (remote) {
    const snapshot = readPandaServerCache(storageKey);
    return { profile: snapshot?.profile || emptyProfile, snapshot, error: '' };
  }
  try { return { profile: readPandaGameProfile(storageKey, { strict: true }), snapshot: null, error: '' }; }
  catch (failure) { return { profile: emptyProfile, snapshot: null, error: failure.message }; }
}

export default function usePandaGame({ storageKey, earnedTotal, studentToken, serverEnabled = import.meta.env.VITE_PANDA_SERVER_PERSISTENCE === 'true' }) {
  const remote = Boolean(serverEnabled && studentToken);
  const owner = JSON.stringify([storageKey, studentToken, remote]);
  const [initial] = useState(() => initialState(storageKey, remote));
  const [stateOwner, setStateOwner] = useState(owner);
  const [profile, setProfile] = useState(initial.profile);
  const [serverSnapshot, setServerSnapshot] = useState(initial.snapshot);
  const [serverReady, setServerReady] = useState(false);
  const [loading, setLoading] = useState(remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const [localReadError, setLocalReadError] = useState(initial.error);
  const profileRef = useRef(profile);
  const verifiedSnapshotRef = useRef(null);
  const busyRef = useRef(false);
  const pendingRef = useRef(null);
  const aliveRef = useRef(true);
  const loadGeneration = useRef(0);
  const sessionGeneration = useRef(0);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const isCurrent = useCallback(() => aliveRef.current && ownerRef.current === owner, [owner]);

  const acceptSnapshot = useCallback(snapshot => {
    if (!isCurrent()) return null;
    const current = verifiedSnapshotRef.current;
    // A slow GET must not rewind a newer transaction or revoke verified earnings.
    if (current && (snapshot.profile.revision < current.profile.revision
      || (snapshot.profile.revision === current.profile.revision && snapshot.earnedTotal < current.earnedTotal))) {
      return profileRef.current;
    }
    const next = normalizePandaGameProfile(snapshot.profile);
    const accepted = { profile: next, earnedTotal: snapshot.earnedTotal,
      availableFood: snapshot.availableFood, transition: snapshot.transition };
    verifiedSnapshotRef.current = accepted;
    profileRef.current = next;
    setProfile(next);
    setServerSnapshot(accepted);
    setServerReady(true);
    // Never write the old live fed key or the local preview profile from a server response.
    try { persistPandaServerCache(storageKey, accepted); } catch { /* DB remains authoritative */ }
    return next;
  }, [storageKey, isCurrent]);

  const loadRemote = useCallback(async () => {
    if (!remote || !isCurrent() || busyRef.current || pendingRef.current) return null;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError('');
    try {
      const snapshot = await fetchPandaProfile(studentToken);
      if (!isCurrent() || generation !== loadGeneration.current) return null;
      return acceptSnapshot(snapshot);
    } catch (failure) {
      if (isCurrent() && generation === loadGeneration.current) {
        setServerReady(false);
        setError(failure.message || '기록을 불러오지 못했어요. 마지막으로 확인한 기록은 유지돼요.');
      }
      return null;
    } finally {
      if (isCurrent() && generation === loadGeneration.current) setLoading(false);
    }
  }, [remote, studentToken, acceptSnapshot, isCurrent]);

  useEffect(() => {
    aliveRef.current = true;
    sessionGeneration.current += 1;
    const next = initialState(storageKey, remote);
    profileRef.current = next.profile;
    verifiedSnapshotRef.current = null;
    busyRef.current = false;
    pendingRef.current = null;
    setStateOwner(owner);
    setProfile(next.profile);
    setServerSnapshot(next.snapshot);
    setServerReady(false);
    setBusy(false);
    setLoading(remote);
    setError(next.error);
    setLocalReadError(next.error);
    void loadRemote();
    return () => { aliveRef.current = false; loadGeneration.current += 1; sessionGeneration.current += 1; };
  }, [owner, storageKey, remote, loadRemote]);

  useEffect(() => {
    const refresh = event => {
      if (event?.type === 'visibilitychange' && document.visibilityState !== 'visible') return;
      if (remote) {
        if (event?.type === 'storage' && event.key !== null && event.key !== getPandaServerCacheKey(storageKey)) return;
        // A storage event is just a refresh signal; its payload cannot authorize writes.
        void loadRemote();
        return;
      }
      if (event?.type === 'storage' && event.key !== null && event.key !== getPandaGameStorageKey(storageKey) && event.key !== storageKey) return;
      try {
        const next = readPandaGameProfile(storageKey, { strict: true });
        profileRef.current = next;
        setProfile(next);
        setLocalReadError('');
        setError('');
      } catch (failure) {
        setLocalReadError(failure.message);
        setError(failure.message);
      }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [remote, storageKey, loadRemote]);

  const transact = useCallback(async (action, retry = false) => {
    if (!isCurrent() || stateOwner !== owner || busyRef.current || loading
      || (!remote && localReadError) || (remote && !serverReady && !(retry && pendingRef.current))) return null;
    if (remote && pendingRef.current && !retry) {
      setError('이전 요청 결과를 먼저 다시 확인해 주세요.');
      return null;
    }
    busyRef.current = true;
    const session = sessionGeneration.current;
    const isActiveRequest = () => isCurrent() && session === sessionGeneration.current;
    loadGeneration.current += 1;
    setLoading(false);
    setBusy(true);
    setError('');
    try {
      if (remote) {
        const payload = retry ? pendingRef.current : {
          ...action, requestId: crypto.randomUUID(), expectedRevision: profileRef.current.revision,
        };
        if (!payload) return null;
        pendingRef.current = payload;
        const snapshot = await performPandaAction(studentToken, payload);
        if (!isActiveRequest()) return null;
        pendingRef.current = null;
        return acceptSnapshot(snapshot);
      }
      const next = await commitPandaGameAction(storageKey, profileRef.current, action, earnedTotal);
      if (!isActiveRequest()) return null;
      profileRef.current = next;
      setProfile(next);
      return next;
    } catch (failure) {
      if (!isActiveRequest()) return null;
      if (!remote && failure.code === 'invalid_saved_profile') setLocalReadError(failure.message);
      if (!remote && failure.profile) {
        profileRef.current = failure.profile;
        setProfile(failure.profile);
      }
      if (remote && failure.snapshot) {
        acceptSnapshot(failure.snapshot);
        pendingRef.current = null;
      } else if (remote) {
        setServerReady(false);
        if (failure.status && failure.status < 500) pendingRef.current = null;
      }
      setError(failure.message || '처리하지 못했어요. 다시 시도해 주세요.');
      return null;
    } finally {
      if (isActiveRequest()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [isCurrent, stateOwner, owner, remote, loading, localReadError, serverReady, studentToken, storageKey, earnedTotal, acceptSnapshot]);

  const retry = useCallback(async () => {
    const action = pendingRef.current ? { type: pendingRef.current.type } : null;
    const next = action ? await transact(null, true) : await loadRemote();
    return next ? { profile: next, action } : null;
  }, [transact, loadRemote]);
  const matchingOwner = stateOwner === owner;
  return {
    profile: matchingOwner ? profile : emptyProfile, remote,
    loading: !matchingOwner || loading, busy: matchingOwner && busy, error: matchingOwner ? error : '',
    transition: matchingOwner ? serverSnapshot?.transition ?? null : null,
    serverReady: matchingOwner && serverReady,
    hasProfile: matchingOwner && (!remote || serverSnapshot !== null),
    transact,
    available: !matchingOwner ? 0 : remote ? (serverSnapshot?.availableFood ?? 0) : getPandaFoodBalance(profile, earnedTotal),
    retry: matchingOwner && remote && error ? retry : null,
    canTransact: matchingOwner && !loading && !busy && (remote ? serverReady : !localReadError) && !pendingRef.current,
  };
}
