import {
  useState } from 'react';
import { message } from 'antd';
import { detectInAppBrowser,
  openInChromeAndroid } from '../../utils/inAppBrowser.js';
import {
  PRIMARY,
  PRIMARY_BG,
  PRIMARY_ALPHA_20,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_INACTIVE,
  GRAY_50 } from '../../constants/theme.js';

// SNS 인앱 브라우저로 PWA에 진입한 학생에게 외부 브라우저(Chrome/Safari) 이동을 권하는 모달.
// 모달 dismiss는 24시간 기억하므로 매번 짜증나게 뜨지는 않는다 — 새 학생이 새 디바이스로
// 처음 들어왔을 때만 본다.
const DISMISS_KEY = 'inapp_warning_dismissed_at';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function isRecentlyDismissed() {
  try {
    const at = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    return at && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export default function InAppBrowserWarning() {
  const [info] = useState(detectInAppBrowser);
  const [dismissed, setDismissed] = useState(isRecentlyDismissed);

  if (!info.isInApp || dismissed) return null;

  const handleAndroidOpen = () => {
    openInChromeAndroid(window.location.href);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('주소를 복사했어요. Safari를 열고 주소창에 붙여넣어 주세요.');
    } catch {
      message.error('주소 복사에 실패했어요. 주소창에서 직접 복사해주세요.');
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="외부 브라우저로 열기 안내"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 16px',
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 440,
        background: '#fff', borderRadius: 20,
        padding: '24px 20px',
        boxShadow: '0 12px 48px rgba(0,0,0,0.24)',
        animation: 'slideUpModal 0.28s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <p style={{ fontSize: 32, margin: '0 0 8px', textAlign: 'center', lineHeight: 1 }}>📱</p>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 6px', textAlign: 'center' }}>
          외부 브라우저로 열어주세요
        </h2>
        <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 18px', textAlign: 'center', lineHeight: 1.55, wordBreak: 'keep-all' }}>
          현재 <strong style={{ color: PRIMARY }}>{info.appLabel}</strong> 안에서 열려있어요.<br />
          홈 화면에 추가나 마이크 사용이 제한될 수 있어 <strong>{info.os === 'ios' ? 'Safari' : 'Chrome'}</strong>으로 다시 열어주세요.
        </p>

        {info.os === 'android' && (
          <button
            type="button"
            onClick={handleAndroidOpen}
            style={{
              width: '100%', height: 48, marginBottom: 8,
              background: PRIMARY, color: '#fff',
              fontSize: 15, fontWeight: 700,
              border: 'none', borderRadius: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            Chrome으로 열기
          </button>
        )}

        {info.os === 'ios' && (
          <>
            <div style={{
              background: GRAY_50, borderRadius: 12,
              padding: '14px 16px', marginBottom: 12,
            }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: PRIMARY, margin: '0 0 8px', letterSpacing: '0.04em' }}>
                Safari로 여는 방법
              </p>
              {[
                '오른쪽 위 점 3개(⋮) 또는 공유 아이콘을 눌러요',
                '"Safari로 열기" 또는 "다른 브라우저로 열기"를 눌러요',
                '주소창에 붙여넣기가 필요하면 아래 버튼으로 주소를 복사해요',
              ].map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: i < 2 ? 8 : 0 }}>
                  <div style={{
                    flexShrink: 0,
                    width: 22, height: 22, borderRadius: '50%',
                    background: PRIMARY_BG, color: PRIMARY,
                    fontSize: 12, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginTop: 1,
                  }}>
                    {i + 1}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: TEXT_PRIMARY, lineHeight: 1.55, wordBreak: 'keep-all' }}>{text}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                width: '100%', height: 44, marginBottom: 8,
                background: PRIMARY_BG, color: PRIMARY,
                fontSize: 14, fontWeight: 700,
                border: `1px solid ${PRIMARY_ALPHA_20}`, borderRadius: 12,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              주소 복사하기
            </button>
          </>
        )}

        {info.os === 'desktop' && (
          <button
            type="button"
            onClick={handleCopyUrl}
            style={{
              width: '100%', height: 48, marginBottom: 8,
              background: PRIMARY, color: '#fff',
              fontSize: 15, fontWeight: 700,
              border: 'none', borderRadius: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            주소 복사하기
          </button>
        )}

        <button
          type="button"
          onClick={handleDismiss}
          style={{
            width: '100%', height: 40,
            background: 'transparent', color: TEXT_INACTIVE,
            fontSize: 13, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          그냥 여기서 사용할게요
        </button>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUpModal {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
