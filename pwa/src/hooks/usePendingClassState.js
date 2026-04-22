import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'home_pending_class_state_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveState(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function usePendingClassState() {
  const [state, setState] = useState(loadState);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setState(loadState());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setHwDone = useCallback((classId) => {
    setState((prev) => {
      const next = { ...prev, [classId]: { ...prev[classId], hwDone: true } };
      saveState(next);
      return next;
    });
  }, []);

  const setDismissed = useCallback((classId) => {
    setState((prev) => {
      const next = { ...prev, [classId]: { ...prev[classId], dismissed: true } };
      saveState(next);
      return next;
    });
  }, []);

  const dismissMany = useCallback((classIds) => {
    setState((prev) => {
      const next = { ...prev };
      classIds.forEach((id) => {
        next[id] = { ...next[id], dismissed: true };
      });
      saveState(next);
      return next;
    });
  }, []);

  return { state, setHwDone, setDismissed, dismissMany };
}
