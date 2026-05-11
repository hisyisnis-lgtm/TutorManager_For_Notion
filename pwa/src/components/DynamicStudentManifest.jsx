import { useEffect } from 'react';

// 학생 라우트(`#/personal/{token}` 또는 그 하위)에 진입했을 때 PWA manifest의 start_url을
// 그 학생 토큰이 포함된 URL로 동적으로 교체한다. 이게 없으면:
//
// 1) Safari에서 학생 페이지 본 후 "홈 화면에 추가" → manifest.start_url='/'로 PWA 설치
// 2) PWA 진입 → start_url='/'로 시작 → hash 비어있음 → LoginPage
//
// iOS Safari PWA는 16.4+부터 localStorage가 Safari와 격리되므로 localStorage redirect 트릭으로는
// 해결 불가. start_url 자체에 토큰을 박아두는 게 유일하게 확실한 방법.
//
// 중요: iOS Safari는 manifest start_url의 hash(#)를 잘라내므로 query string(`?student=...`)으로 전달.
// App.jsx 진입 시점에 query를 hash로 변환해 정상 라우팅한다.
//
// <link rel="manifest"> href를 data URL로 바꾸면 vite-plugin-pwa의 정적 manifest를 런타임에 덮어쓴다.
// PWA 설치 시점의 manifest가 영구적으로 박히므로, 이미 설치된 PWA는 재설치해야 새 start_url 반영.

// vite-plugin-pwa가 빌드 시점에 생성하는 manifest와 동일한 메타데이터를 유지하고 start_url만 학생 URL로.
function buildManifest(studentToken) {
  return {
    name: '하늘하늘중국어',
    short_name: '하늘하늘중국어',
    description: '중국어 튜터링 관리 시스템',
    theme_color: '#830009',
    background_color: '#F9FAFB',
    display: 'standalone',
    orientation: 'portrait',
    // iOS Safari는 manifest start_url의 hash·query를 잘라낼 수 있으므로 가장 안정적인 path-based로 전달.
    // _redirects의 `/* /index.html 200`이 SPA fallback을 처리하고, App.jsx 모듈 IIFE가
    // `/student/{token}` path를 감지해 hash(`#/personal/...`)로 변환한다.
    start_url: `/student/${encodeURIComponent(studentToken)}`,
    scope: '/',
    lang: 'ko',
    icons: [
      { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function extractToken(hash) {
  const m = hash.match(/^#\/personal\/([^/?#]+)/);
  if (!m) return '';
  const token = decodeURIComponent(m[1]);
  // 'personal' 라우트(PersonalEntryPage) 자체 또는 너무 짧은 값 제외
  return token && token !== 'undefined' && token.length >= 4 ? token : '';
}

export default function DynamicStudentManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const originalHref = link.getAttribute('href') || '/manifest.webmanifest';
    let lastApplied = '';

    function apply() {
      const token = extractToken(window.location.hash);
      if (!token) {
        // 학생 라우트가 아니면 원본 manifest로 복원
        if (lastApplied) {
          lastApplied = '';
          link.setAttribute('href', originalHref);
        }
        return;
      }
      if (lastApplied === token) return;
      lastApplied = token;
      const json = JSON.stringify(buildManifest(token));
      // data URL은 Blob URL보다 origin·revoke 이슈가 없어 iOS Safari가 더 잘 인식한다.
      const dataUrl = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(json)}`;
      link.setAttribute('href', dataUrl);
    }

    apply();
    window.addEventListener('hashchange', apply);
    return () => {
      window.removeEventListener('hashchange', apply);
      if (lastApplied) link.setAttribute('href', originalHref);
    };
  }, []);

  return null;
}
