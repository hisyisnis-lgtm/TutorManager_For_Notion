// 성조게임 단독 앱 전용 엔트리 (Vite `--mode game` 빌드).
// 통합 웹 PWA(main.jsx→App.jsx)와 달리 강사/학생 라우터를 마운트하지 않고 ToneGamePage만 띄운다.
// 라우트 토큰이 없으므로 resolveIdentity는 항상 게스트(로그인 시 회원)로 해석 — 학생 모드 없음.
// 학생 조회 코드(fetchStudentByToken)는 __GAME_APP__ 빌드플래그로 번들에서 제거된다(ToneGamePage 참고).
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ToneGamePage from './pages/ToneGamePage.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
// 게임 앱 전용 폰트 번들(오프라인 대응) — 웹은 CDN 유지(ensureGameFonts). 브랜드 폰트만 로컬:
// Jua(타이틀·한글통짜 360KB+라틴)·Baloo 2(숫자·라틴 600/700/800). 한글 본문은 시스템 폰트(Android=Noto CJK).
import '@fontsource/jua/latin-400.css';
import '@fontsource/jua/korean-400.css';
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import './index.css';

installErrorReporter();

// MemoryRouter: URL 바에 의존하지 않는 인앱 라우팅(네이티브 래핑 대비). 초기 경로 '/' → 라우트 토큰 없음 → 게스트.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToneGamePage />
      </MemoryRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
