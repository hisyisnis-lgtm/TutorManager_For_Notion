import { useState, useCallback, useEffect } from 'react';

// v1 → v2 (2026-08-30): '숙제 부여'가 **클릭 시점**에 hwDone을 기록해서, 폼에서 저장 없이
// 나와도 완료로 남는 버그가 있었다. v2부터는 숙제 **저장 성공 시점**에만 기록한다
// (markPendingHwDone — HomeworkFormPage가 호출). 키를 올려 잘못 기록된 v1 플래그를 버린다.
// 이 상태는 오늘 수업에만 쓰이므로 dismissed가 함께 초기화돼도 하루치 영향뿐이다.
const STORAGE_KEY = 'home_pending_class_state_v2';

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

/**
 * 숙제 저장이 실제로 성공했을 때만 호출할 것 (HomeworkFormPage handleSubmit).
 * 훅 밖 일반 함수인 이유: 폼 페이지는 이 상태를 구독할 필요가 없고,
 * 홈/수업 준비 페이지는 라우트 복귀 시 재마운트되며 localStorage를 새로 읽는다.
 */
export function markPendingHwDone(classId) {
  if (!classId) return;
  const prev = loadState();
  saveState({ ...prev, [classId]: { ...prev[classId], hwDone: true } });
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

  return { state, dismissMany };
}
