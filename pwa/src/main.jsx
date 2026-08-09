import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
import './index.css';

// [DEV] 성조게임 기록 초기화 백도어 — 폰(인앱 브라우저)엔 콘솔이 없어 URL로 지운다. **앱이 값을 읽기 전**에 실행돼야 해서 여기(진입점 최상단).
//   ?reset=1   → 게임 기록만(game_* : 스테이지 점수·성조 통계·연속학습·업적·XP/등급·단어 숙련도)
//   ?reset=all → 위 + tg_*(게스트ID·닉네임·소리/뜻/병음 설정·온보딩 플래그) + tab_tips_v1(코치마크 본 기록) = 완전 초기 상태
//   ⚠️ import.meta.env.DEV 게이트 — 프로덕션 빌드엔 포함되지 않는다. 지우는 대상은 **이 브라우저의 로컬 기록**뿐(회원 서버 기록 아님).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const q = new URLSearchParams(window.location.search);
  if (q.has('reset')) {
    const all = q.get('reset') === 'all';
    try {
      for (const k of Object.keys(localStorage)) {
        // ★코치마크 기록(tab_tips_v1)은 game_/tg_ 어느 네임스페이스도 아니다 — 빼먹으면 '첫 진입인데 가이드가 안 뜨는' 상태가 된다.
        if (k.startsWith('game_') || (all && (k.startsWith('tg_') || k === 'tab_tips_v1'))) localStorage.removeItem(k);
      }
    } catch { /* noop */ }
    // reset 파라미터만 뺀 주소로 교체 — 새로고침해도 다시 지워지지 않게(히스토리도 안 남김)
    const u = new URL(window.location.href);
    u.searchParams.delete('reset');
    window.location.replace(u.toString());
  }
}

installErrorReporter();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
