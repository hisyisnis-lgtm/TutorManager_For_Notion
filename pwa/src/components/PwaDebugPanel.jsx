// PWA 진단용 임시 디버그 패널. PWA standalone 모드에서 학생 페이지로 가야 하는데
// 강사 LoginPage가 뜨는 경우, 그 화면 상단에 현재 URL·localStorage 상태를 표시해
// 학생이 캡처를 보내면 정확한 원인을 진단할 수 있게 한다.
//
// 진단 후 제거할 임시 코드.

import { useState } from 'react';

function safeRead(key) {
  try { return localStorage.getItem(key) || '(none)'; }
  catch { return '(err)'; }
}

export default function PwaDebugPanel() {
  const [hidden, setHidden] = useState(false);

  if (typeof window === 'undefined') return null;
  if (hidden) return null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // standalone PWA에서만 표시 (일반 브라우저는 영향 없음)
  if (!isStandalone) return null;

  const info = {
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    'display-mode': window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    'iOS standalone': window.navigator.standalone === true ? 'true' : 'false',
    referrer: document.referrer || '(none)',
    'personal_student_token': safeRead('personal_student_token'),
    'auth_token': safeRead('auth_token') === '(none)' ? '(none)' : '(present)',
    ua: navigator.userAgent.slice(0, 80) + '…',
  };

  const text = Object.entries(info)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert('진단 정보를 복사했어요. 강사님께 보내주세요.');
    } catch {
      alert('복사 실패. 화면을 캡처해서 강사님께 보내주세요.');
    }
  };

  const reset = async () => {
    if (!confirm('PWA 캐시·저장소를 모두 비우고 새로고침합니다. 계속하시겠어요?')) return;
    try {
      // localStorage 비우기 (강사 토큰 보존)
      const auth = localStorage.getItem('auth_token');
      localStorage.clear();
      if (auth) localStorage.setItem('auth_token', auth);
      // SW 모두 unregister
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      // 캐시 모두 비우기
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {}
    window.location.reload();
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999999,
      background: '#000', color: '#0f0', fontSize: 11,
      padding: '8px 10px',
      fontFamily: 'monospace',
      maxHeight: '60vh', overflow: 'auto',
      borderBottom: '2px solid #0f0',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 6 }}>
        <strong style={{ color: '#ff0', fontSize: 12 }}>PWA 진단 정보</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={copy} style={{ fontSize: 10, padding: '2px 6px', background: '#0f0', color: '#000', border: 'none', borderRadius: 3, fontWeight: 700 }}>
            복사
          </button>
          <button onClick={reset} style={{ fontSize: 10, padding: '2px 6px', background: '#f60', color: '#000', border: 'none', borderRadius: 3, fontWeight: 700 }}>
            캐시초기화
          </button>
          <button onClick={() => setHidden(true)} style={{ fontSize: 10, padding: '2px 6px', background: '#666', color: '#fff', border: 'none', borderRadius: 3 }}>
            ✕
          </button>
        </div>
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.4 }}>
        {text}
      </pre>
    </div>
  );
}
