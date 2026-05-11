// 카카오톡·인스타·페북·라인·네이버앱·밴드 등 SNS 인앱 브라우저 감지 + 외부 브라우저로 우회 유틸.
// PWA 설치·마이크 권한·푸시 등 PWA 기능이 인앱 환경에서 대부분 제한되므로 학생 라우트 진입 시 안내 모달을 띄운다.

const NAMES = {
  kakao: '카카오톡',
  instagram: '인스타그램',
  facebook: '페이스북',
  line: '라인',
  naver: '네이버 앱',
  band: '밴드',
};

export function detectInAppBrowser() {
  if (typeof navigator === 'undefined') return { isInApp: false, name: '', appLabel: '', os: 'desktop' };
  const ua = navigator.userAgent || '';
  let name = '';
  if (/KAKAOTALK/i.test(ua)) name = 'kakao';
  else if (/Instagram/i.test(ua)) name = 'instagram';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) name = 'facebook';
  else if (/Line\//i.test(ua)) name = 'line';
  else if (/NAVER\(inapp/i.test(ua)) name = 'naver';
  else if (/BAND\//i.test(ua)) name = 'band';

  // iPadOS 13+ Safari는 UA에 iPad 대신 Macintosh를 보내므로 touch points로 보정
  const isIPadOSDesktopMode = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  let os = 'desktop';
  if (/iPad|iPhone|iPod/.test(ua) || isIPadOSDesktopMode) os = 'ios';
  else if (/Android/.test(ua)) os = 'android';

  return { isInApp: !!name, name, appLabel: NAMES[name] || '인앱 브라우저', os };
}

/**
 * Android Chrome으로 현재 URL을 강제로 다시 연다.
 * intent URL 스킴은 Android에서만 동작하며, 사용자에게 "Chrome 앱으로 이동" 시스템 다이얼로그가 한 번 표시된다.
 * iOS는 동등한 API가 없어 false 반환.
 */
export function openInChromeAndroid(targetUrl = window.location.href) {
  try {
    const u = new URL(targetUrl);
    const fragment = u.hash || '';
    // intent URL 본문은 scheme을 제외한 host+path+search이고, fragment는 본문 뒤가 아니라 #Intent;...;end 구문에 합쳐서 전달한다.
    const hostAndPath = `${u.host}${u.pathname}${u.search}${fragment}`;
    window.location.href = `intent://${hostAndPath}#Intent;scheme=https;package=com.android.chrome;end`;
    return true;
  } catch {
    return false;
  }
}
