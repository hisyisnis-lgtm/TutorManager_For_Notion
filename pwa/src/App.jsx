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
import InAppBrowserWarning from './components/ui/InAppBrowserWarning.jsx';
import DynamicStudentManifest from './components/DynamicStudentManifest.jsx';
import PwaDebugPanel from './components/PwaDebugPanel.jsx';

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

// PWA standalone에서 root hash로 진입 + 강사 미인증 + 저장된 학생 토큰이 있으면 학생 페이지로 자동 이동.
// manifest.start_url이 '/' 고정이라 그대로 두면 강사 LoginPage가 뜨는 문제를 우회.
// useEffect 대신 모듈 로드 시점(첫 렌더 전)에 동기적으로 실행해 isPublicBookingRoute() 첫 호출이
// 갱신된 hash를 보도록 한다. 강사는 PWA로 학생 페이지를 미리보지 않으므로 isTeacher 체크로 강사 PWA 흐름은 보호.
if (typeof window !== 'undefined') {
  try {
    // 0) Path-based 학생 URL을 hash로 변환 — 카카오톡 공유 URL과 PWA 진입의 핵심 경로.
    //    iOS Safari PWA는 manifest의 hash·query를 잘라내고 path만 보존하므로 학생 URL을
    //    `/personal/{token}` (또는 옛 호환 `/student/{token}`) 형식으로 만들고, App 진입 시
    //    즉시 HashRouter 호환 형태(`#/personal/{token}`)로 변환한다.
    const pathMatch = window.location.pathname.match(/^\/(personal|student)\/([^/?#]+)/);
    if (pathMatch) {
      const pathToken = decodeURIComponent(pathMatch[2]);
      if (pathToken && pathToken !== 'undefined' && pathToken.length >= 4) {
        localStorage.setItem('personal_student_token', pathToken);
        // path는 root로 정리하고 hash로 변환
        window.history.replaceState(null, '', `/#/personal/${encodeURIComponent(pathToken)}`);
      }
    }
    // 옛 버전 호환: `?student={token}` query string도 동일하게 처리
    const search = new URLSearchParams(window.location.search);
    const queryToken = search.get('student');
    if (queryToken && queryToken !== 'undefined' && queryToken.length >= 4) {
      localStorage.setItem('personal_student_token', queryToken);
      const cleanPath = window.location.pathname || '/';
      window.history.replaceState(null, '', `${cleanPath}#/personal/${encodeURIComponent(queryToken)}`);
    }

    const hash = window.location.hash;

    // 1) 학생 라우트(`#/personal/{token}` 또는 그 하위)로 진입한 경우 토큰을 localStorage에 저장.
    //    학생은 보통 카카오톡으로 받은 토큰 URL을 바로 클릭하므로 PersonalEntryPage를 거치지 않아
    //    토큰이 저장될 기회가 없다. 이 단계가 PWA 설치 후 자동 redirect의 전제 조건.
    const personalMatch = hash.match(/^#\/personal\/([^/?#]+)/);
    if (personalMatch) {
      const token = decodeURIComponent(personalMatch[1]);
      // 'undefined' 같은 잘못된 값 또는 너무 짧은 값은 제외 (예약 코드는 12자 대문자+숫자)
      if (token && token !== 'undefined' && token.length >= 4) {
        localStorage.setItem('personal_student_token', token);
      }
    }

    // 2) standalone + root hash + 강사 미인증 + 저장된 학생 토큰 → 학생 페이지로 redirect.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    const isRootHash = !hash || hash === '#/' || hash === '#';
    const isTeacher = !!localStorage.getItem('auth_token');
    if (isStandalone && isRootHash && !isTeacher) {
      const savedToken = localStorage.getItem('personal_student_token');
      if (savedToken) {
        // history.replaceState로 hash를 미리 바꿈 — popstate/hashchange를 발생시키지 않으므로
        // 이후 React가 첫 렌더할 때 isPublicBookingRoute()가 새 hash를 동기적으로 본다.
        window.history.replaceState(null, '', `#/personal/${encodeURIComponent(savedToken)}`);
      }
    }
  } catch {}
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
        {/* SNS 인앱 브라우저(카카오톡·인스타·페북 등)에서 학생 라우트로 진입하면
            외부 브라우저(Android: Chrome, iOS: Safari) 사용 권장 모달 표시. */}
        <InAppBrowserWarning />
        {/* 학생 페이지에서 "홈 화면에 추가" 시 manifest.start_url에 학생 토큰을 박아넣어
            iOS PWA의 localStorage 격리 문제를 우회 — PWA 진입 시 학생 페이지로 직접 진입. */}
        <DynamicStudentManifest />
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
          <PwaDebugPanel />
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
