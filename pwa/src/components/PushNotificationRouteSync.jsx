import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { captureAuthScope, isAuthScopeCurrent } from '../api/authState.js';
import { currentPushNotificationRoute, normalizePushLaunch } from '../api/pushNavigation.js';

// 일부 native 복귀는 URL만 바꾸고 HashRouter가 듣는 popstate를 전달하지 않는다.
// 강사 라우터 안에서 명시적인 알림 상세 주소가 다를 때만 상태를 맞춘다.
export default function PushNotificationRouteSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    const auth = captureAuthScope();
    const sync = () => {
      if (document.visibilityState === 'hidden' || !isAuthScopeCurrent(auth)) return;
      normalizePushLaunch();
      const target = currentPushNotificationRoute();
      const current = locationRef.current;
      if (target && target !== `${current.pathname}${current.search}${current.hash}`) {
        navigate(target, { replace: true });
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('hashchange', sync);
    document.addEventListener('visibilitychange', onVisible);
    sync();
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('hashchange', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);

  return null;
}
