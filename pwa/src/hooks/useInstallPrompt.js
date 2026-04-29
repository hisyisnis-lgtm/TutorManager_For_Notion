import { useState, useEffect } from 'react';

const DISMISS_KEY = 'pwa_install_dismissed_until';
const DISMISS_DAYS = 7;

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => {
    const until = localStorage.getItem(DISMISS_KEY);
    return until ? Date.now() < Number(until) : false;
  });

  useEffect(() => {
    // 이미 설치된 경우 (standalone 모드)
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (standalone) { setIsInstalled(true); return; }

    // iOS 감지 (Safari는 beforeinstallprompt 미지원)
    // iPadOS 13+ Safari는 UA에 Macintosh로 위장하므로 touch points로 iPad 식별
    const ua = navigator.userAgent;
    const isIPadOSDesktopMode = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    const ios = (/iPad|iPhone|iPod/.test(ua) || isIPadOSDesktopMode) && !window.MSStream;
    setIsIOS(ios);

    // Android Chrome 설치 프롬프트 캡처
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setIsInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setDeferredPrompt(null);
    return outcome === 'accepted';
  };

  const dismiss = () => {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(until));
    setIsDismissed(true);
  };

  // 네이티브 프롬프트 바로 실행 가능 여부
  const canPrompt = deferredPrompt !== null;

  // 설치 가능 여부 (dismissed 여부 무관 — 배너용)
  const isInstallable = !isInstalled && (canPrompt || isIOS);

  // 배너 표시 조건
  const showBanner = isInstallable && !isDismissed;

  return { showBanner, isInstallable, canPrompt, isIOS, isInstalled, promptInstall, dismiss };
}
