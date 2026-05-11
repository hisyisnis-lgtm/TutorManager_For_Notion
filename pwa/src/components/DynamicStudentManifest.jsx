import { useEffect } from 'react';

// 학생 라우트(path-based `/personal/{token}` 또는 hash-based) 진입 시 manifest 동작을 우회한다.
//
// iOS Safari PWA quirk:
//  - manifest의 start_url은 hash·query를 잘라낸다 (data URL·blob URL도 마찬가지)
//  - manifest 자체가 없으면 "홈 화면에 추가" 시점의 페이지 URL을 그대로 사용 (path는 보존)
//  - 따라서 iOS에서는 학생 라우트일 때 <link rel="manifest"> 자체를 DOM에서 제거해
//    iOS가 강제로 현재 URL을 사용하게 한다. path 기반 학생 URL이므로 토큰이 박힌다.
//  - Android Chrome 등은 manifest가 있어야 PWA 설치 가능하므로 iOS만 제거.

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ Safari는 UA에 Macintosh를 보내므로 touch points로 보정
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

// Android·Desktop용 — vite-plugin-pwa가 빌드 시점에 생성하는 manifest와 동일한 메타데이터를 유지하고
// start_url에 학생 path를 박는다. Android Chrome의 PWA 설치 흐름에서 사용.
function buildManifest(studentToken) {
  return {
    name: '하늘하늘중국어',
    short_name: '하늘하늘중국어',
    description: '중국어 튜터링 관리 시스템',
    theme_color: '#830009',
    background_color: '#F9FAFB',
    display: 'standalone',
    orientation: 'portrait',
    start_url: `/personal/${encodeURIComponent(studentToken)}`,
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

function extractTokenFromUrl() {
  // path 기반 URL 우선 (BrowserRouter 환경)
  const pathMatch = window.location.pathname.match(/^\/(personal|student)\/([^/?#]+)/);
  if (pathMatch) {
    const token = decodeURIComponent(pathMatch[2]);
    if (token && token !== 'undefined' && token.length >= 4) return token;
  }
  // hash 기반 URL (HashRouter 환경 호환)
  const hashMatch = window.location.hash.match(/^#\/personal\/([^/?#]+)/);
  if (hashMatch) {
    const token = decodeURIComponent(hashMatch[1]);
    if (token && token !== 'undefined' && token.length >= 4) return token;
  }
  return '';
}

export default function DynamicStudentManifest() {
  useEffect(() => {
    const isIOS = isIOSDevice();

    // iOS: manifest link가 있으면 DOM에서 제거 (학생 path에서는 index.html inline script가 link를 추가하지
    // 않으니 보통은 없지만, 혹시 다른 곳에서 추가됐다면 cleanup). manifest 없는 상태로 "홈 화면에 추가"
    // 시 현재 페이지 URL이 그대로 PWA에 박힘.
    if (isIOS) {
      const existing = document.querySelector('link[rel="manifest"]');
      if (!existing) return;
      const parent = existing.parentNode;
      const nextSibling = existing.nextSibling;
      parent?.removeChild(existing);
      return () => {
        if (parent) parent.insertBefore(existing, nextSibling);
      };
    }

    // Android·Desktop: 학생 path에서는 index.html inline script가 manifest link를 추가하지 않으므로
    // 직접 새 link를 만들어 학생 토큰이 박힌 동적 manifest를 적용한다. 이러면 Android Chrome에서
    // "앱 설치" 옵션이 떠 PWA로 정상 설치 가능.
    let createdLink = null;
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
      createdLink = link;
    }
    const originalHref = createdLink ? '' : (link.getAttribute('href') || '/manifest.webmanifest');
    let lastApplied = '';

    function apply() {
      const token = extractTokenFromUrl();
      if (!token) {
        if (lastApplied) {
          lastApplied = '';
          if (createdLink) {
            link.remove();
          } else {
            link.setAttribute('href', originalHref);
          }
        }
        return;
      }
      if (lastApplied === token) return;
      lastApplied = token;
      const json = JSON.stringify(buildManifest(token));
      const dataUrl = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(json)}`;
      link.setAttribute('href', dataUrl);
    }

    apply();
    window.addEventListener('hashchange', apply);
    window.addEventListener('popstate', apply);
    return () => {
      window.removeEventListener('hashchange', apply);
      window.removeEventListener('popstate', apply);
      if (createdLink) {
        link.remove();
      } else if (lastApplied) {
        link.setAttribute('href', originalHref);
      }
    };
  }, []);

  return null;
}
