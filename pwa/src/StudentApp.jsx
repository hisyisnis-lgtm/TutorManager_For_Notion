import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Toaster } from './components/shadcn/sonner';
import FreshnessIndicator from './components/layout/FreshnessIndicator.jsx';
import LoadingSpinner from './components/ui/LoadingSpinner.jsx';
import InAppBrowserWarning from './components/ui/InAppBrowserWarning.jsx';
import SiteDynamicStudentManifest from './components/SiteDynamicStudentManifest.jsx';
import SiteStudentAuthGate from './components/SiteStudentAuthGate.jsx';
const SitePersonalPage = lazy(() => import('./pages/SitePersonalPage.jsx'));
const PersonalHomeworkDetailPage = lazy(() => import('./pages/PersonalHomeworkDetailPage.jsx'));
const PersonalNoticeDetailPage = lazy(() => import('./pages/PersonalNoticeDetailPage.jsx'));
const PandaPage = lazy(() => import('./pages/PandaPage.jsx'));
const AuthenticatedConsentPage = lazy(() => import('./pages/ConsentPage.jsx').then(module => ({ default: module.AuthenticatedConsentPage })));
import { startGuardedSwUpdate } from './utils/swUpdateGuard.js';
import { normalizeStudentAppEntry } from './utils/studentAppPaths.js';

normalizeStudentAppEntry();

function StudentRoutes() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return <SiteStudentAuthGate>
    <Suspense fallback={<LoadingSpinner />}>
    <Routes>
      <Route path="/personal/" element={<SitePersonalPage />} />
      <Route path="/personal/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
      <Route path="/personal/notice/:noticeId" element={<PersonalNoticeDetailPage />} />
      <Route path="/personal/consent" element={<AuthenticatedConsentPage />} />
      <Route path="/personal/panda" element={<PandaPage />} />
      <Route path="*" element={<Navigate to="/personal/" replace />} />
    </Routes>
    </Suspense>
    <FreshnessIndicator />
  </SiteStudentAuthGate>;
}

export default function StudentApp() {
  const [updating, setUpdating] = useState(false);
  const registrationRef = useRef(null);
  const reloadRef = useRef(null);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegistered(registration) {
      registrationRef.current = registration;
      registration?.update().catch(() => {});
    },
    onNeedReload() { reloadRef.current?.requestReload(); },
  });
  useEffect(() => {
    const timer = setInterval(() => registrationRef.current?.update().catch(() => {}), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!needRefresh) return undefined;
    const controller = startGuardedSwUpdate({ update: () => { setUpdating(true); return updateServiceWorker(true); } });
    reloadRef.current = controller;
    return () => { reloadRef.current = null; controller.dispose(); };
  }, [needRefresh, updateServiceWorker]);
  if (updating) return <div className="flex min-h-[100dvh] items-center justify-center"><LoadingSpinner message="최신 버전으로 업데이트 중이에요" /></div>;
  return <>
    <Toaster position="top-center" />
    <InAppBrowserWarning />
    <SiteDynamicStudentManifest />
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><StudentRoutes /></BrowserRouter>
  </>;
}
