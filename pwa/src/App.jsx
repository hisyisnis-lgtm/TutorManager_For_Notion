import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { useRegisterSW } from 'virtual:pwa-register/react';

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
import SettingsPage from './pages/SettingsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import BookEntryPage from './pages/BookEntryPage.jsx';
import BookingPage from './pages/BookingPage.jsx';
import BookingStatusPage from './pages/BookingStatusPage.jsx';
import BookingsManagePage from './pages/BookingsManagePage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PricingPage from './pages/PricingPage.jsx';

function SplashScreen({ updating }) {
  return (
    <div
      style={{ background: '#7f0005' }}
      className="fixed inset-0 flex flex-col items-center justify-center gap-5"
    >
      <img src="/logo-white.png" alt="하늘하늘중국어" className="h-10 w-auto" />
      <p className="text-white/70 text-sm tracking-wide">
        {updating ? '최신 버전으로 업데이트 중...' : '···'}
      </p>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function checkAuth() {
  return !!(sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token'));
}

// 현재 hash가 공개 페이지인지 확인 (로그인 불필요)
function isPublicBookingRoute() {
  const hash = window.location.hash;
  return hash.startsWith('#/book') || hash.startsWith('#/intro') || hash.startsWith('#/pricing');
}

export default function App() {
  const [authed, setAuthed] = useState(checkAuth);
  const [swReady, setSwReady] = useState(false);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegistered() { setSwReady(true); },
    onRegisterError() { setSwReady(true); },  // SW 오류도 앱 진행
  });

  useEffect(() => {
    // 새 버전 감지 → 즉시 적용 (리로드됨)
    if (needRefresh) {
      updateServiceWorker(true);
      return;
    }
    // SW 미지원 환경 대비 최대 2초 후 강제 진행
    const fallback = setTimeout(() => setSwReady(true), 2000);
    return () => clearTimeout(fallback);
  }, [needRefresh, updateServiceWorker]);

  // SW 준비 전 또는 업데이트 적용 중
  if (!swReady || needRefresh) {
    return <SplashScreen updating={needRefresh} />;
  }

  // 공개 예약 페이지는 로그인 없이 접근
  if (isPublicBookingRoute()) {
    return (
      <ConfigProvider theme={antdTheme}>
        <HashRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/intro" element={<LandingPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/book" element={<BookEntryPage />} />
            <Route path="/book/status/:token" element={<BookingStatusPage />} />
            <Route path="/book/:studentToken" element={<BookingPage />} />
          </Routes>
        </HashRouter>
      </ConfigProvider>
    );
  }

  if (!authed) {
    return (
      <ConfigProvider theme={antdTheme}>
        <LoginPage
          onSuccess={() => {
            window.location.hash = '#/home';
            setAuthed(true);
          }}
        />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={antdTheme}>
    <DataProvider>
      <HashRouter>
        <ScrollToTop />
        <div className="page-container">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />

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

            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Routes>
        </div>
        <BottomNav />
      </HashRouter>
    </DataProvider>
    </ConfigProvider>
  );
}
