// 성조게임 단독 앱 전용 엔트리 (Vite `--mode game` 빌드).
// 통합 웹 PWA(main.jsx→App.jsx)와 달리 강사/학생 라우터를 마운트하지 않고 ToneGamePage만 띄운다.
// 라우트 토큰이 없으므로 resolveIdentity는 항상 게스트(로그인 시 회원)로 해석 — 학생 모드 없음.
// 학생 조회 코드(fetchStudentByToken)는 __GAME_APP__ 빌드플래그로 번들에서 제거된다(ToneGamePage 참고).
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { antdTheme } from './constants/theme.js';
import ToneGamePage from './pages/ToneGamePage.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
import './index.css';

installErrorReporter();

// MemoryRouter: URL 바에 의존하지 않는 인앱 라우팅(네이티브 래핑 대비). 초기 경로 '/' → 라우트 토큰 없음 → 게스트.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConfigProvider theme={antdTheme}>
        <AntApp>
          <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ToneGamePage />
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
