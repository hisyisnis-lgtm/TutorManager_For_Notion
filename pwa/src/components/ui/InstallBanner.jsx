/**
 * PWA 홈 화면 추가 안내 배너
 * - Android Chrome: beforeinstallprompt 이벤트로 네이티브 설치 프롬프트 호출
 * - iOS Safari: 공유 버튼 → 홈 화면에 추가 순서 안내 모달
 * - 닫기 시 7일간 재표시 안함
 *
 * Props: showBanner, isIOS, promptInstall, dismiss, showIOSGuide, setShowIOSGuide (from useInstallPrompt + parent)
 */
export default function InstallBanner({ showBanner, isIOS, promptInstall, dismiss, showIOSGuide, setShowIOSGuide }) {
  if (!showBanner && !showIOSGuide) return null;

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
    } else {
      await promptInstall();
    }
  };

  return (
    <>
      {/* 배너 — showBanner일 때만 */}
      {showBanner && <div style={{
        position: 'fixed',
        bottom: 'calc(56px + env(safe-area-inset-bottom) + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)',
        maxWidth: 448,
        zIndex: 150,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        animation: 'slideUpBanner 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* 앱 아이콘 */}
        <img
          src="/pwa-192x192.png"
          alt=""
          aria-hidden="true"
          style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}
        />

        {/* 텍스트 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1d1d1f', lineHeight: 1.3 }}>
            홈 화면에 추가하기
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#595959', lineHeight: 1.4 }}>
            앱처럼 빠르게 수업을 확인해요
          </p>
        </div>

        {/* 추가 버튼 */}
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            flexShrink: 0,
            height: 34,
            padding: '0 14px',
            backgroundColor: '#7f0005',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            outline: 'none',
            transition: 'transform 0.1s',
          }}
          onPointerDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; }}
          onPointerUp={e => { e.currentTarget.style.transform = ''; }}
          onPointerLeave={e => { e.currentTarget.style.transform = ''; }}
        >
          추가
        </button>

        {/* 닫기 */}
        <button
          type="button"
          aria-label="닫기"
          onClick={dismiss}
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'none', cursor: 'pointer',
            color: '#8c8c8c', fontSize: 18,
            WebkitTapHighlightColor: 'transparent',
            outline: 'none',
          }}
        >
          ×
        </button>
      </div>}

      {/* iOS 안내 모달 */}
      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="홈 화면에 추가하는 방법"
          onClick={() => setShowIOSGuide(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: '0 16px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 448,
              backgroundColor: '#ffffff',
              borderRadius: 20,
              padding: '24px 20px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: '0 0 4px' }}>
              홈 화면에 추가하는 방법
            </h2>
            <p style={{ fontSize: 13, color: '#595959', margin: '0 0 20px' }}>
              {isIOS ? 'Safari에서 아래 순서를 따라주세요' : '브라우저 메뉴에서 직접 추가할 수 있어요'}
            </p>

            {(isIOS ? [
              { step: '1', text: '하단의 공유 버튼(□↑)을 탭하세요' },
              { step: '2', text: '스크롤하여 "홈 화면에 추가"를 탭하세요' },
              { step: '3', text: '오른쪽 위 "추가"를 탭하면 완료!' },
            ] : [
              { step: '1', text: '브라우저 주소창 오른쪽 메뉴(⋮)를 탭하세요' },
              { step: '2', text: '"홈 화면에 추가" 또는 "앱 설치"를 탭하세요' },
              { step: '3', text: '"추가" 또는 "설치"를 탭하면 완료!' },
            ]).map(({ step, text }) => (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  backgroundColor: '#fff0f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 13, fontWeight: 700, color: '#7f0005',
                }}>
                  {step}
                </div>
                <p style={{ margin: 0, fontSize: 14, color: '#1d1d1f', lineHeight: 1.4 }}>{text}</p>
              </div>
            ))}

            <button
              type="button"
              onClick={() => { setShowIOSGuide(false); dismiss(); }}
              style={{
                marginTop: 8,
                width: '100%', height: 48,
                backgroundColor: '#7f0005', color: '#ffffff',
                fontSize: 15, fontWeight: 600,
                border: 'none', borderRadius: 14,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUpBanner {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
