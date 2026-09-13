import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { setUnsavedChanges } from '../utils/unsavedChanges.js';

/** Data router의 앱 이동·뒤로가기와 브라우저 종료를 함께 보호한다. */
export default function useUnsavedChanges(isDirty) {
  const owner = useRef(Symbol('unsaved-form'));
  const dirtyRef = useRef(isDirty);
  const allowedRef = useRef(false);
  const pendingAction = useRef(null);
  const [localBlocked, setLocalBlocked] = useState(false);
  dirtyRef.current = isDirty;
  if (!isDirty) allowedRef.current = false;

  const shouldBlock = useCallback(() => dirtyRef.current && !allowedRef.current, []);
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  useLayoutEffect(() => {
    const key = owner.current;
    setUnsavedChanges(key, isDirty);
    return () => setUnsavedChanges(key, false);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const beforeUnload = (event) => {
      if (!shouldBlock()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty, shouldBlock]);

  function requestLeave(action) {
    if (!shouldBlock()) { action(); return; }
    pendingAction.current = action;
    setLocalBlocked(true);
  }

  function cancelLeave() {
    pendingAction.current = null;
    setLocalBlocked(false);
    if (blockerRef.current.state === 'blocked') blockerRef.current.reset();
  }

  function allowLeave() {
    allowedRef.current = true;
    setUnsavedChanges(owner.current, false);
  }

  function confirmLeave() {
    const action = pendingAction.current;
    pendingAction.current = null;
    setLocalBlocked(false);
    allowLeave();
    if (blockerRef.current.state === 'blocked') blockerRef.current.proceed();
    else action?.();
  }

  // 저장 성공 후의 이동이 이탈 경고로 다시 막히거나 보류한 이동과 중복되지 않게 한다.
  function markSaved() {
    cancelLeave();
    allowLeave();
  }

  return {
    showLeaveConfirm: localBlocked || blocker.state === 'blocked',
    requestLeave, cancelLeave, confirmLeave, markSaved,
  };
}
