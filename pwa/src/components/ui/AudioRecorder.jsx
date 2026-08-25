import {
  useState,
  useRef,
  useEffect } from 'react';
import { message } from 'antd';
import {
  PRIMARY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  BORDER_NEUTRAL,
  STATUS_ERROR,
  GRAY_100,
  GRAY_50 } from '../../constants/theme.js';

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function extFromMime(mime) {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

function detectEnv() {
  if (typeof navigator === 'undefined') return { os: 'desktop', browser: 'other' };
  const ua = navigator.userAgent || '';
  // iPadOS 13+ Safari는 UA에 iPad 대신 Macintosh를 보낸다 — touch points로 실제 iPad 식별
  const isIPadOSDesktopMode = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  let os = 'desktop';
  if (/iPad|iPhone|iPod/.test(ua) || isIPadOSDesktopMode) os = 'ios';
  else if (/Android/.test(ua)) os = 'android';

  let browser = 'other';
  if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/Whale/.test(ua)) browser = 'whale';
  else if (/Edg\//.test(ua)) browser = 'edge';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'firefox';
  else if (/Chrome|CriOS/.test(ua)) browser = 'chrome';
  else if (/Safari/.test(ua)) browser = 'safari';

  return { os, browser };
}

function micBlockedDetail() {
  const { os, browser } = detectEnv();

  if (os === 'ios') {
    if (browser === 'safari') {
      return '설정 앱 → Safari → 카메라/마이크 액세스 → 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
    }
    return '설정 앱에서 이 브라우저(Chrome 등)의 마이크 권한을 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
  }
  if (os === 'android') {
    if (browser === 'samsung') {
      return '주소창 왼쪽 자물쇠 아이콘 → 권한 → 마이크를 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
    }
    if (browser === 'firefox') {
      return '주소창 왼쪽 방패/자물쇠 → 권한 관리 → 마이크 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
    }
    return '주소창 왼쪽 자물쇠(또는 ⓘ) 아이콘 → 권한 → 마이크를 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
  }
  if (browser === 'safari') {
    return 'Safari 메뉴 → 이 웹사이트 설정(또는 환경설정 → 웹사이트 → 마이크)에서 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
  }
  if (browser === 'firefox') {
    return '주소창 왼쪽 자물쇠 아이콘 → "더보기" → 권한에서 마이크 차단을 해제하고 아래 새로고침을 눌러주세요.';
  }
  return '주소창 왼쪽 자물쇠 아이콘 → 사이트 설정 → 마이크를 허용으로 바꾸고 아래 새로고침을 눌러주세요.';
}

/**
 * 인라인 녹음 컴포넌트
 * props:
 *   onFile(file: File)  — 이름 확정 후 파일 전달 (file.name = 사용자 지정 이름)
 *   onCancel()          — 취소
 *   defaultName: string — 이름 입력 기본값
 */
export default function AudioRecorder({ onFile, onCancel, defaultName = 'recording', hideCancel = false }) {
  // ios-non-safari → idle → recording → preview → naming
  const [phase, setPhase] = useState(() => {
    const { os, browser } = detectEnv();
    if (os === 'ios' && browser !== 'safari' && browser !== 'other') return 'ios-non-safari';
    return 'idle';
  });
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [inputName, setInputName] = useState(defaultName);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const blobUrlRef = useRef(null);
  const mimeTypeRef = useRef('');
  // 컴포넌트 마운트 동안 stream을 유지해 두 번째 녹음부터는 권한 prompt가 다시 뜨지 않게 한다.
  // (브라우저에 따라 매번 getUserMedia 호출 시 prompt가 뜨거나 stream 종료 후 재요청 시 권한이 만료되는 경우가 있음)
  // trade-off: 모달이 열려있는 동안 마이크 인디케이터가 계속 표시됨 — 모달 unmount 시 stop.
  const streamRef = useRef(null);

  // defaultName이 바뀌면(부모에서 카운터 변경 등) 반영
  useEffect(() => { setInputName(defaultName); }, [defaultName]);

  // 언마운트 시 최신 blobUrl을 정리하기 위해 ref를 통해 읽는다
  // (빈 deps 배열이라 cleanup 클로저가 초기 state(null)를 캡처하면 누수 발생)
  useEffect(() => () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  async function startRecording() {
    if (!window.isSecureContext) {
      message.error('HTTPS 환경에서만 녹음할 수 있어요.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      message.error('이 브라우저는 녹음을 지원하지 않아요. 최신 Chrome/Safari로 다시 시도해주세요.');
      return;
    }
    // A. 권한 사전 체크 — Permissions API 지원 브라우저(Chrome/Edge/Firefox 등)에서 미리 'denied' 감지
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'microphone' });
        if (status.state === 'denied') {
          setPhase('mic-denied');
          return;
        }
      }
    } catch {
      // iOS Safari 등 Permissions API 또는 microphone permission name 미지원 — 정상 흐름 진행
    }
    try {
      // 컴포넌트 마운트 동안 동일 stream 재사용 → 두 번째 녹음부터 권한 prompt 회피.
      // 트랙이 종료된 상태(예: 브라우저가 백그라운드에서 자동 종료)면 새로 받는다.
      const existingTrack = streamRef.current?.getAudioTracks?.()[0];
      if (!streamRef.current || !existingTrack || existingTrack.readyState !== 'live') {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const stream = streamRef.current;
      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;
      // 비트레이트를 지정하지 않으면 브라우저 기본값(약 128kbps)이 붙어 5분 녹음이 5MB에 달한다.
      // Notion 무료 워크스페이스 상한이 파일당 5MB라 그대로 두면 긴 녹음이 업로드 단계에서 거부된다.
      // 말소리는 32kbps로 충분하고(≈ 4KB/s), 같은 5MB에 약 20분을 담을 수 있다.
      // ⚠️ Safari가 이 옵션을 무시할 수 있으나, 녹음 직후 validateFile이 실제 크기를 검사하므로
      //    그 경우에도 조용히 실패하지 않고 안내로 떨어진다.
      const mr = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        // stream은 종료하지 않고 유지 — unmount 시점에 한 번만 stop.
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
        setPhase('preview');
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setSeconds(0);
      setPhase('recording');
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase('mic-denied');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        message.error('사용 가능한 마이크를 찾지 못했어요.');
      } else if (name === 'NotReadableError') {
        message.error('마이크가 다른 앱에서 사용 중이에요. 다른 앱을 종료한 뒤 다시 시도해주세요.');
      } else {
        message.error('녹음을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  function retry() {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    setBlobUrl(null);
    blobRef.current = null;
    setPhase('idle');
  }

  async function copyCurrentUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('주소를 복사했어요. Safari를 열고 주소창에 붙여넣어 주세요.');
    } catch {
      message.error('주소 복사에 실패했어요. 주소창에서 직접 복사해주세요.');
    }
  }

  function goToNaming() {
    setPhase('naming');
  }

  function confirm() {
    const mime = mimeTypeRef.current || 'audio/webm';
    const ext = extFromMime(mime);
    const safeName = (inputName.trim() || defaultName).replace(/[/\\:*?"<>|]/g, '_');
    const file = new File([blobRef.current], `${safeName}.${ext}`, { type: mime });
    onFile(file);
  }

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ background: GRAY_50, borderRadius: 12, padding: 16, marginTop: 10 }}>

      {/* ios-non-safari (iOS Chrome/Firefox 등) — Apple 정책으로 마이크 접근 제한 안내 */}
      {phase === 'ios-non-safari' && (
        <div style={{ textAlign: 'center', padding: '4px 4px 0' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 6px' }}>
            Safari로 열어 녹음해주세요
          </p>
          <p style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.5, margin: '0 0 14px' }}>
            iOS의 Chrome·Firefox 등은 Apple 정책상 마이크 사용이 제한될 수 있어요.
          </p>
          <button
            type="button"
            onClick={copyCurrentUrl}
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: PRIMARY, border: 'none', color: 'white',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', marginBottom: 8,
            }}
          >
            주소 복사 (Safari에 붙여넣기)
          </button>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            style={{
              width: '100%', height: 36, borderRadius: 12,
              background: 'white', border: `1px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            그래도 여기서 시도
          </button>
        </div>
      )}

      {/* mic-denied — 권한 거부 시 안내 + 새로고침 트리거 */}
      {phase === 'mic-denied' && (
        <div style={{ textAlign: 'center', padding: '4px 4px 0' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 6px' }}>
            마이크 권한이 차단되어 있어요
          </p>
          <p style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.6, margin: '0 0 14px', whiteSpace: 'pre-wrap' }}>
            {micBlockedDetail()}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: PRIMARY, border: 'none', color: 'white',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', marginBottom: 8,
            }}
          >
            권한 허용 후 새로고침
          </button>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            style={{
              width: '100%', height: 36, borderRadius: 12,
              background: 'white', border: `1px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            취소
          </button>
        </div>
      )}

      {/* idle */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          style={{
            width: '100%', height: 44, borderRadius: 12,
            background: PRIMARY, border: 'none', color: 'white',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_ERROR, display: 'inline-block' }} />
          녹음 시작
        </button>
      )}

      {/* recording */}
      {phase === 'recording' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: STATUS_ERROR,
              display: 'inline-block', animation: 'rec-pulse 1s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: TEXT_PRIMARY, letterSpacing: 1 }}>
              {fmt(seconds)}
            </span>
          </div>
          <button
            type="button"
            onClick={stopRecording}
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: STATUS_ERROR, border: 'none', color: 'white',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ■ 녹음 중지
          </button>
        </div>
      )}

      {/* preview */}
      {phase === 'preview' && blobUrl && (
        <div>
          <audio controls src={blobUrl} style={{ width: '100%', marginBottom: 12, borderRadius: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={retry}
              style={{
                flex: 1, height: 44, borderRadius: 12,
                background: 'white', border: `1px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              다시 녹음
            </button>
            <button
              type="button"
              onClick={confirm}
              style={{
                flex: 1, height: 44, borderRadius: 12,
                background: PRIMARY, border: 'none', color: 'white',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              제출하기
            </button>
          </div>
        </div>
      )}

      {/* naming */}
      {phase === 'naming' && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>파일 이름</p>
          <input
            type="text"
            aria-label="파일 이름"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            maxLength={50}
            style={{
              width: '100%', height: 42, borderRadius: 12, border: `1px solid ${BORDER_NEUTRAL}`,
              padding: '0 12px', fontSize: 14, color: TEXT_PRIMARY,
              boxSizing: 'border-box', outline: 'none', marginBottom: 10,
            }}
            onFocus={(e) => e.target.select()}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setPhase('preview')}
              style={{
                flex: 1, height: 44, borderRadius: 12,
                background: 'white', border: `1px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              ← 뒤로
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!inputName.trim()}
              style={{
                flex: 2, height: 44, borderRadius: 12,
                background: inputName.trim() ? PRIMARY : GRAY_100,
                border: 'none', color: inputName.trim() ? 'white' : TEXT_DISABLED,
                fontSize: 14, fontWeight: 600, cursor: inputName.trim() ? 'pointer' : 'not-allowed',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              추가
            </button>
          </div>
        </div>
      )}

      {!hideCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            width: '100%', marginTop: 8,
            fontSize: 12, color: TEXT_TERTIARY,
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}
        >
          취소
        </button>
      )}

      <style>{`
        @keyframes rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
