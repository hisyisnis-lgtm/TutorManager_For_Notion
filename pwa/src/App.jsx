import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import BookingPage from './pages/BookingPage.jsx';
import BookingStatusPage from './pages/BookingStatusPage.jsx';
import BookingsManagePage from './pages/BookingsManagePage.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function checkAuth() {
  return !!(sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token'));
}

// 현재 hash가 공개 예약 페이지인지 확인
function isPublicBookingRoute() {
  const hash = window.location.hash;
  return hash.startsWith('#/book');
}

export default function App() {
  const [authed, setAuthed] = useState(checkAuth);

  // 공개 예약 페이지는 로그인 없이 접근
  if (isPublicBookingRoute()) {
    return (
      <HashRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/book" element={<BookingPage />} />
          <Route path="/book/status/:token" element={<BookingStatusPage />} />
        </Routes>
      </HashRouter>
    );
  }

  if (!authed) {
    return (
      <LoginPage
        onSuccess={() => {
          window.location.hash = '#/home';
          setAuthed(true);
        }}
      />
    );
  }

  return (
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
  );
}
