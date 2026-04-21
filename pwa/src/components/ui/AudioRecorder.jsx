import { useState, useRef, useEffect } from 'react';
import { message } from 'antd';

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

/**
 * 인라인 녹음 컴포넌트
 * props:
 *   onFile(file: File)  — 이름 확정 후 파일 전달 (file.name = 사용자 지정 이름)
 *   onCancel()          — 취소
 *   defaultName: string — 이름 입력 기본값
 */
export default function AudioRecorder({ onFile, onCancel, defaultName = 'recording', hideCancel = false }) {
  // idle → recording → preview → naming
  const [phase, setPhase] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [inputName, setInputName] = useState(defaultName);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const blobUrlRef = useRef(null);
  const mimeTypeRef = useRef('');

  // defaultName이 바뀌면(부모에서 카운터 변경 등) 반영
  useEffect(() => { setInputName(defaultName); }, [defaultName]);

  // 언마운트 시 최신 blobUrl을 정리하기 위해 ref를 통해 읽는다
  // (빈 deps 배열이라 cleanup 클로저가 초기 state(null)를 캡처하면 누수 발생)
  useEffect(() => () => {
    clearInterval(timerRef.current);
    mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
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
    } catch {
      message.error('마이크 접근 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.');
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

  function goToNaming() {
    setPhase('naming');
  }

  function confirm() {
    const mime = mimeTypeRef.current || 'audio/webm';
    const ext = 'mp3';
    const safeName = (inputName.trim() || defaultName).replace(/[/\\:*?"<>|]/g, '_');
    const file = new File([blobRef.current], `${safeName}.${ext}`, { type: mime });
    onFile(file);
  }

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ background: '#f9f9f9', borderRadius: 12, padding: 16, marginTop: 10 }}>

      {/* idle */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          style={{
            width: '100%', height: 44, borderRadius: 12,
            background: '#7f0005', border: 'none', color: 'white',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff7875', display: 'inline-block' }} />
          녹음 시작
        </button>
      )}

      {/* recording */}
      {phase === 'recording' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: '#ff4d4f',
              display: 'inline-block', animation: 'rec-pulse 1s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#1d1d1f', letterSpacing: 1 }}>
              {fmt(seconds)}
            </span>
          </div>
          <button
            type="button"
            onClick={stopRecording}
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: '#ff4d4f', border: 'none', color: 'white',
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
                background: 'white', border: '1.5px solid #d9d9d9', color: '#595959',
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
                background: '#7f0005', border: 'none', color: 'white',
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
          <p style={{ fontSize: 12, fontWeight: 600, color: '#595959', margin: '0 0 6px' }}>파일 이름</p>
          <input
            type="text"
            aria-label="파일 이름"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            maxLength={50}
            style={{
              width: '100%', height: 42, borderRadius: 12, border: '1.5px solid #d9d9d9',
              padding: '0 12px', fontSize: 14, color: '#1d1d1f',
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
                background: 'white', border: '1.5px solid #d9d9d9', color: '#595959',
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
                background: inputName.trim() ? '#7f0005' : '#f5f5f5',
                border: 'none', color: inputName.trim() ? 'white' : '#bfbfbf',
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
            fontSize: 12, color: '#767676',
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
