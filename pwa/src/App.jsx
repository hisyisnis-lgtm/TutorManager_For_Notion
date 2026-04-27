import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isAuthed } from './api/authUtils.js';

const antdTheme = {
  token: {
    colorPrimary: '#7f0005',
    borderRadius: 12,
    colorBgContainer: '#ffffff',
    fontFamily: 'inherit',
  },
};
import { DataProvider } from './context/DataContext.jsx';
import BottomNav from './components/layout/BottomNav.jsx';
import LoginPage from './pages/LoginPage.jsx';

import StudentsPage from './pages/StudentsPage.jsx';
import StudentDetailPage from './pages/StudentDetailPage.jsx';
import StudentFormPage from './pages/StudentFormPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import ClassFormPage from './pages/ClassFormPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import PaymentFormPage from './pages/PaymentFormPage.jsx';
import LessonLogsPage from './pages/LessonLogsPage.jsx';
import LessonLogFormPage from './pages/LessonLogFormPage.jsx';
import HomePage from './pages/HomePage.jsx';
import PendingClassesPage from './pages/PendingClassesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import BookEntryPage from './pages/BookEntryPage.jsx';
import BookingPage from './pages/BookingPage.jsx';
import BookingStatusPage from './pages/BookingStatusPage.jsx';
import PersonalEntryPage from './pages/PersonalEntryPage.jsx';
import PersonalPage from './pages/PersonalPage.jsx';
import PersonalHomeworkDetailPage from './pages/PersonalHomeworkDetailPage.jsx';
import PandaPage from './pages/PandaPage.jsx';
import PandaTestPage from './pages/PandaTestPage.jsx';
import BookingsManagePage from './pages/BookingsManagePage.jsx';
import ConsultManagePage from './pages/ConsultManagePage.jsx';
import HomeworkFormPage from './pages/HomeworkFormPage.jsx';
import HomeworkDetailPage from './pages/HomeworkDetailPage.jsx';
import StudentHomeworkPage from './pages/StudentHomeworkPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import ConsentPage from './pages/ConsentPage.jsx';

// 앱 초기 로드 / SW 업데이트 중 스플래시 (흰 배경 + 빨간 로고)
function SplashScreen({ updating }) {
  return (
    <div
      style={{ background: '#7f0005' }}
      className="fixed inset-0 flex flex-col items-center justify-center gap-6"
    >
      <img
        src={`${import.meta.env.BASE_URL}logo/logo-white.png`}
        alt="하늘하늘중국어"
        style={{ height: 36, width: 'auto', display: 'block', outline: 'none', border: 'none' }}
      />
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: '2.5px solid rgba(255,255,255,0.3)',
        borderTopColor: '#ffffff',
        animation: 'spin 0.75s linear infinite',
      }} />
      {updating && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', margin: 0, letterSpacing: '0.02em' }}>
          최신 버전으로 업데이트 중...
        </p>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}


// 현재 hash가 공개 페이지인지 확인 (로그인 불필요)
function isPublicBookingRoute() {
  const hash = window.location.hash;
  return hash.startsWith('#/book') || hash.startsWith('#/intro') || hash.startsWith('#/pricing') || hash.startsWith('#/consent') || hash.startsWith('#/personal') || hash.startsWith('#/panda-test');
}

// 데이터 작성 중인 폼 페이지 여부 확인
function isOnFormPage() {
  const hash = window.location.hash;
  return /\/(logs|classes|students|payments|homework)\/(new|[^/]+\/edit)/.test(hash);
}

export default function App() {
  const [authed, setAuthed] = useState(isAuthed);
  const [swReady, setSwReady] = useState(false);

  const [swRegistration, setSwRegistration] = useState(null);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegistered(registration) {
      setSwReady(true);
      if (registration) setSwRegistration(registration);
    },
    onRegisterError() { setSwReady(true); },
  });

  // 60초마다 새 버전 체크 — 컴포넌트 언마운트 시 정리
  useEffect(() => {
    if (!swRegistration) return;
    const id = setInterval(() => swRegistration.update(), 60 * 1000);
    return () => clearInterval(id);
  }, [swRegistration]);

  useEffect(() => {
    if (!needRefresh) {
      // SW 미지원 환경 대비 최대 2초 후 강제 진행
      const fallback = setTimeout(() => setSwReady(true), 2000);
      return () => clearTimeout(fallback);
    }

    function applyUpdate() {
      const handleControllerChange = () => window.location.reload();
      navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);
      updateServiceWorker(true);
      // controllerchange가 오지 않을 경우 10초 후 강제 리로드
      setTimeout(() => window.location.reload(), 10000);
    }

    // 폼 작성 중이면 이탈 후 업데이트
    if (isOnFormPage()) {
      const interval = setInterval(() => {
        if (!isOnFormPage()) {
          clearInterval(interval);
          applyUpdate();
        }
      }, 500);
      return () => clearInterval(interval);
    }

    applyUpdate();
  }, [needRefresh, updateServiceWorker]);

  // SW 준비 전 또는 업데이트 적용 중 (폼 작성 중이면 업데이트 미표시)
  if (!swReady || (needRefresh && !isOnFormPage())) {
    return <SplashScreen updating={needRefresh} />;
  }

  // 공개 예약 페이지는 로그인 없이 접근
  if (isPublicBookingRoute()) {
    return (
      <ConfigProvider theme={antdTheme}>
        <AntApp>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <Routes>
            <Route path="/intro" element={<LandingPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/consent" element={<ConsentPage />} />
            <Route path="/book" element={<BookEntryPage />} />
            <Route path="/book/status/:token" element={<BookingStatusPage />} />
            <Route path="/book/:studentToken" element={<BookingPage />} />
            <Route path="/personal" element={<PersonalEntryPage />} />
            <Route path="/personal/:studentToken" element={<PersonalPage />} />
            <Route path="/personal/:studentToken/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
            <Route path="/personal/:studentToken/panda" element={<PandaPage />} />
            <Route path="/panda-test" element={<PandaTestPage />} />
          </Routes>
        </HashRouter>
        </AntApp>
      </ConfigProvider>
    );
  }

  if (!authed) {
    return (
      <ConfigProvider theme={antdTheme}>
        <AntApp>
          <LoginPage
            onSuccess={() => {
              window.location.hash = '#/home';
              setAuthed(true);
            }}
          />
        </AntApp>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={antdTheme}>
    <AntApp>
    <DataProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ScrollToTop />
        <div className="page-container">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/home/pending" element={<PendingClassesPage />} />

            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/new" element={<StudentFormPage />} />
            <Route path="/students/:id/edit" element={<StudentFormPage />} />
            <Route path="/students/:id" element={<StudentDetailPage />} />

            <Route path="/classes" element={<ClassesPage />} />
            <Route path="/classes/new" element={<ClassFormPage />} />
            <Route path="/classes/:id/edit" element={<ClassFormPage />} />

            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/new" element={<PaymentFormPage />} />
            <Route path="/payments/:id/edit" element={<PaymentFormPage />} />

            <Route path="/logs" element={<LessonLogsPage />} />
            <Route path="/logs/:id/edit" element={<LessonLogFormPage />} />

            <Route path="/bookings" element={<BookingsManagePage />} />
            <Route path="/consult" element={<ConsultManagePage />} />

            <Route path="/students/:id/homework" element={<StudentHomeworkPage />} />
            <Route path="/homework/new" element={<HomeworkFormPage />} />
            <Route path="/homework/:id" element={<HomeworkDetailPage />} />

            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Routes>
        </div>
        <BottomNav />
      </HashRouter>
    </DataProvider>
    </AntApp>
    </ConfigProvider>
  );
}
