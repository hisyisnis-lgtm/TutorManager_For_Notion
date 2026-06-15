import { useState, useEffect } from 'react';
import { HashRouter, BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { isAuthed } from './api/authUtils.js';
import { PRIMARY, antdTheme } from './constants/theme.js';
import { DataProvider } from './context/DataContext.jsx';
import BottomNav from './components/layout/BottomNav.jsx';
import LoginPage from './pages/LoginPage.jsx';

import StudentsPage from './pages/StudentsPage.jsx';
import StudentDetailPage from './pages/StudentDetailPage.jsx';
import StudentFormPage from './pages/StudentFormPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import ClassFormPage from './pages/ClassFormPage.jsx';
import ClassDetailPage from './pages/ClassDetailPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import PaymentFormPage from './pages/PaymentFormPage.jsx';
import PaymentDetailPage from './pages/PaymentDetailPage.jsx';
import LessonLogsPage from './pages/LessonLogsPage.jsx';
import LessonLogFormPage from './pages/LessonLogFormPage.jsx';
import HomePage from './pages/HomePage.jsx';
import PendingClassesPage from './pages/PendingClassesPage.jsx';
import TomorrowPrepPage from './pages/TomorrowPrepPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import PersonalEntryPage from './pages/PersonalEntryPage.jsx';
import PersonalPage from './pages/PersonalPage.jsx';
import PersonalHomeworkDetailPage from './pages/PersonalHomeworkDetailPage.jsx';
import PandaPage from './pages/PandaPage.jsx';
import PandaTestPage from './pages/PandaTestPage.jsx';
import ToneGamePage from './pages/ToneGamePage.jsx';
import BookingsManagePage from './pages/BookingsManagePage.jsx';
import ConsultManagePage from './pages/ConsultManagePage.jsx';
import HomeworkFormPage from './pages/HomeworkFormPage.jsx';
import HomeworkDetailPage from './pages/HomeworkDetailPage.jsx';
import StudentHomeworkPage from './pages/StudentHomeworkPage.jsx';
import HomeworkManagePage from './pages/HomeworkManagePage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import ConsentPage from './pages/ConsentPage.jsx';
import GroupClassPage from './pages/GroupClassPage.jsx';
import InAppBrowserWarning from './components/ui/InAppBrowserWarning.jsx';
import DynamicStudentManifest from './components/DynamicStudentManifest.jsx';
import StudentAuthGate from './components/StudentAuthGate.jsx';

// 앱 초기 로드 / SW 업데이트 중 스플래시 (흰 배경 + 빨간 로고)
function SplashScreen({ updating }) {
  return (
    <div
      style={{ background: PRIMARY }}
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
  return hash.startsWith('#/book') || hash.startsWith('#/intro') || hash.startsWith('#/pricing') || hash.startsWith('#/consent') || hash.startsWith('#/group-class') || hash.startsWith('#/bootcamp') || hash.startsWith('#/personal') || hash.startsWith('#/panda-test');
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
    // -2) group-class 공개 페이지를 path 형식(# 없이)으로 들어온 경우 hash 라우트로 보정.
    //     이 페이지는 HashRouter 기반이라 `/group-class`(또는 옛 `/bootcamp`)로 직접 진입하면
    //     라우터가 경로를 못 잡고 #/intro(홈)로 튕긴다 → 해시 형식으로 강제 변환.
    //     (정상 공유 링크는 `/#/group-class`. # 없이 공유·입력된 경우 대비.)
    const gcPath = window.location.pathname.replace(/\/+$/, '');
    if ((gcPath === '/group-class' || gcPath === '/bootcamp') && !window.location.hash) {
      window.location.replace('/#/group-class');
      throw new Error('redirecting');
    }

    // -1) 옛 hash 형식 학생 URL(`#/personal/{token}`)을 path 형식으로 자동 redirect.
    //     강사가 옛 PWA 버전에서 공유한 URL을 학생이 클릭하면 hash가 붙어있는데,
    //     iOS Safari "홈 화면에 추가"는 hash를 잘라내므로 path 형식으로 강제 변환해야 한다.
    const oldHashMatch = window.location.hash.match(/^#\/personal\/([^/?#]+)/);
    if (oldHashMatch && !window.location.pathname.startsWith('/personal/')) {
      const oldHashToken = decodeURIComponent(oldHashMatch[1]);
      if (oldHashToken && oldHashToken !== 'undefined' && oldHashToken.length >= 4) {
        // location.replace로 history 항목을 덮어써 뒤로 가기가 hash URL로 돌아가지 않게.
        window.location.replace(`/personal/${encodeURIComponent(oldHashToken)}`);
        // replace 후엔 페이지가 즉시 다시 로드되므로 IIFE를 명시적으로 종료.
        throw new Error('redirecting');
      }
    }

    // 0) Path-based 학생 URL 진입 시 토큰만 localStorage에 저장하고 URL은 path 그대로 유지.
    //    iOS Safari PWA "홈 화면에 추가"는 path만 보존하고 hash·query는 잘라내므로 절대 hash로 변환하지 않는다.
    //    App() 컴포넌트가 학생 path 진입을 감지하면 BrowserRouter로 학생 라우트만 렌더한다.
    const pathMatch = window.location.pathname.match(/^\/(personal|student)\/([^/?#]+)/);
    if (pathMatch) {
      const pathToken = decodeURIComponent(pathMatch[2]);
      if (pathToken && pathToken !== 'undefined' && pathToken.length >= 4) {
        localStorage.setItem('personal_student_token', pathToken);
      }
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
    //    teacher_device 플래그가 있으면(이 디바이스에서 강사 로그인을 한 적이 있으면)
    //    토큰이 만료·삭제됐더라도 강사앱 루트 진입을 학생 페이지로 튕기지 않는다.
    //    학생앱 아이콘은 path 기반(`/personal/{token}`)으로 진입하므로 이 분기와 무관 — 영향 없음.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    const isRootHash = !hash || hash === '#/' || hash === '#';
    const isTeacher = !!localStorage.getItem('auth_token') || !!localStorage.getItem('teacher_device');
    // path 기반 공개 라우트(학생 /personal·/student, 게스트 게임 /game)는 hash가 비어도 "루트 진입"이 아니다.
    // → standalone→personal·root→intro redirect 대상에서 제외(안 그러면 /game/tone 게스트 진입이 #/intro로 튕김).
    const isPathPublicRoute = /^\/(personal|student|game)\//.test(window.location.pathname);
    if (isStandalone && isRootHash && !isTeacher && !isPathPublicRoute) {
      const savedToken = localStorage.getItem('personal_student_token');
      if (savedToken) {
        // history.replaceState로 hash를 미리 바꿈 — popstate/hashchange를 발생시키지 않으므로
        // 이후 React가 첫 렌더할 때 isPublicBookingRoute()가 새 hash를 동기적으로 본다.
        window.history.replaceState(null, '', `#/personal/${encodeURIComponent(savedToken)}`);
      }
    }

    // 3) 일반 방문자(강사·학생 아님)가 루트 도메인으로 진입하면 인트로(소개) 페이지로 보낸다.
    //    검색엔진(구글·네이버) 결과의 루트 링크를 클릭한 잠재 수강생이 강사 로그인 화면 대신
    //    서비스 소개를 보게 하기 위함. teacher_device 플래그가 있는 강사 기기는 제외해
    //    기존 루트→로그인/홈 흐름을 그대로 유지하고, 새 기기의 강사는 #/login으로 로그인한다.
    //    #/login·#/intro 등 명시적 hash 진입은 isRootHash가 false라 영향받지 않는다.
    //    학생 토큰이 저장돼 있으면(standalone 분기에서 처리) intro로 보내지 않는다.
    if (isRootHash && !isTeacher && !localStorage.getItem('personal_student_token') && !isPathPublicRoute) {
      window.history.replaceState(null, '', '#/intro');
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
      if (registration) {
        setSwRegistration(registration);
        // 앱을 열자마자 즉시 새 버전 검사 (60초 폴링 첫 틱을 기다리지 않음).
        // 오프라인 등 실패는 조용히 무시 — unhandled rejection으로 에러 알림 안 뜨게.
        registration.update().catch(() => {});
      }
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

  // Path-based 학생 라우트 — BrowserRouter로 학생 라우트만 렌더.
  // iOS Safari PWA "홈 화면에 추가" 시 URL의 path는 보존되므로 path 기반 라우팅이 안전.
  // hash 기반 강사 라우트와 공존하기 위해 이 분기에서만 BrowserRouter 사용.
  // `/game/*`(게스트 독립 진입)도 path 기반으로 같은 BrowserRouter 블록에서 렌더 — 학생 토큰 없이 게임만.
  const studentPathMatch = window.location.pathname.match(/^\/(personal|student|game)\/([^/?#]+)/);
  if (studentPathMatch) {
    // 옛 호환 `/student/{token}`은 `/personal/{token}`로 자동 redirect
    if (studentPathMatch[1] === 'student') {
      const token = studentPathMatch[2];
      window.history.replaceState(null, '', `/personal/${token}${window.location.search}${window.location.hash}`);
    }
    return (
      <ConfigProvider theme={antdTheme}>
        <AntApp>
        <InAppBrowserWarning />
        {/* iOS에서는 manifest를 DOM에서 제거해 "홈 화면에 추가" 시 현재 path를 PWA URL로 박는다. */}
        <DynamicStudentManifest />
        {/* 새 기기 휴대폰 인증 게이트 — 학생 페이지만 보호, 게스트 게임(/game/*)은 면제 */}
        <StudentAuthGate token={studentPathMatch[2]} disabled={studentPathMatch[1] === 'game'}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <Routes>
            <Route path="/personal/:studentToken" element={<PersonalPage />} />
            <Route path="/personal/:studentToken/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
            <Route path="/personal/:studentToken/panda" element={<PandaPage />} />
            <Route path="/personal/:studentToken/game/tone" element={<ToneGamePage />} />
            {/* 게스트 독립 진입 (학생 토큰 없음) — 채널 유입 깔때기. ToneGamePage가 토큰 부재를 게스트로 처리 */}
            <Route path="/game/tone" element={<ToneGamePage />} />
          </Routes>
        </BrowserRouter>
        </StudentAuthGate>
        </AntApp>
      </ConfigProvider>
    );
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
            <Route path="/group-class" element={<GroupClassPage />} />
            {/* 옛 /bootcamp 링크 호환 — 그룹 수업 페이지로 리다이렉트 (부트캠프 명칭 폐기 2026-06-12) */}
            <Route path="/bootcamp" element={<Navigate to="/group-class" replace />} />
            {/* 학생 자가예약 화면 폐기 (2026-06-10) — 옛 /book* 링크는 인트로로 보냄 */}
            <Route path="/book/*" element={<Navigate to="/intro" replace />} />
            <Route path="/personal" element={<PersonalEntryPage />} />
            <Route path="/personal/:studentToken" element={<PersonalPage />} />
            <Route path="/personal/:studentToken/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
            <Route path="/personal/:studentToken/panda" element={<PandaPage />} />
            <Route path="/personal/:studentToken/game/tone" element={<ToneGamePage />} />
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
            <Route path="/home/tomorrow-prep" element={<TomorrowPrepPage />} />

            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/new" element={<StudentFormPage />} />
            <Route path="/students/:id/edit" element={<StudentFormPage />} />
            <Route path="/students/:id" element={<StudentDetailPage />} />

            <Route path="/classes" element={<ClassesPage />} />
            <Route path="/classes/new" element={<ClassFormPage />} />
            <Route path="/classes/:id/edit" element={<ClassFormPage />} />
            <Route path="/classes/:id" element={<ClassDetailPage />} />

            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/new" element={<PaymentFormPage />} />
            <Route path="/payments/:id/edit" element={<PaymentFormPage />} />
            <Route path="/payments/:id" element={<PaymentDetailPage />} />

            <Route path="/logs" element={<LessonLogsPage />} />
            <Route path="/logs/:id/edit" element={<LessonLogFormPage />} />

            <Route path="/bookings" element={<BookingsManagePage />} />
            <Route path="/consult" element={<ConsultManagePage />} />

            <Route path="/homework" element={<HomeworkManagePage />} />
            <Route path="/students/:id/homework" element={<StudentHomeworkPage />} />
            <Route path="/homework/new" element={<HomeworkFormPage />} />
            <Route path="/homework/:id" element={<HomeworkDetailPage />} />

            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />

            {/* 매칭되는 라우트가 없으면 홈으로. 옛 401 핸들러가 남긴 죽은 `#/login` 등
                알 수 없는 hash로 진입해도 흰 화면 대신 홈으로 복구된다. */}
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </div>
        <BottomNav />
      </HashRouter>
    </DataProvider>
    </AntApp>
    </ConfigProvider>
  );
}
