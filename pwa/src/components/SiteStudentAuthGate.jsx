import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clearStudentAppContext, fetchStudentAppContext, getStudentAppContext, subscribeStudentAppContext } from '../api/studentApp.js';
import { StudentAppContext } from '../context/StudentAppContext.jsx';
import LoadingSpinner from './ui/LoadingSpinner.jsx';
import SitePersonalEntryPage from '../pages/SitePersonalEntryPage.jsx';

// 권한은 주소·강사 토큰·옛 OTP 세션으로 추정하지 않고 회원 HttpOnly 쿠키로 확인한다.
export default function SiteStudentAuthGate({ children }) {
  const context = useSyncExternalStore(subscribeStudentAppContext, getStudentAppContext, () => null);
  const [checking, setChecking] = useState(true);
  const [verified, setVerified] = useState(false);
  const requestRef = useRef(null);
  const mountedRef = useRef(false);
  const refresh = useCallback((invalidate = false) => {
    // 탭 복귀 이벤트는 같은 서버 검증을 공유하고 회원 변경만 진행 중 검증을 교체한다.
    if (!invalidate && requestRef.current && !requestRef.current.controller.signal.aborted) return requestRef.current.promise;
    requestRef.current?.controller.abort();
    const request = { controller: new AbortController(), promise: null };
    requestRef.current = request;
    if (invalidate) clearStudentAppContext('login_required');
    setChecking(true);
    request.promise = fetchStudentAppContext(request.controller.signal).catch(error => {
      if (error.name !== 'AbortError' && !request.controller.signal.aborted && requestRef.current === request
        && !error.status) clearStudentAppContext('connection_error');
    }).finally(() => {
      if (requestRef.current !== request) return;
      requestRef.current = null;
      if (mountedRef.current && !request.controller.signal.aborted) {
        setVerified(true);
        setChecking(false);
      }
    });
    return request.promise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const changed = event => {
      if (event.key === null || event.key === 'hanul_member_auth_changed') refresh(true);
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', visible);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 60_000);
    return () => {
      mountedRef.current = false;
      requestRef.current?.controller.abort();
      clearInterval(interval);
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);

  if (!verified || (checking && !context?.allowed)) return <div className="flex min-h-[100dvh] items-center justify-center"><LoadingSpinner message="학생 앱 이용 상태를 확인하고 있어요" /></div>;
  if (!context?.allowed) return <SitePersonalEntryPage reason={context?.reason} onRetry={() => refresh()} />;
  return <StudentAppContext.Provider value={context} key={context.scope}>{children}</StudentAppContext.Provider>;
}
