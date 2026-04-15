import { useState, useRef, useEffect } from 'react';

/**
 * AudioPlayer — Notion 파일 URL용 오디오 플레이어
 * - url: 재생할 오디오 URL (Notion 임시 URL, 만료 가능)
 * - fileName: 표시할 파일명
 * - onGetFreshUrl: URL 만료 시 호출할 async 함수 → 새 URL 반환
 */
export default function AudioPlayer({ url, fileName, onGetFreshUrl, onDelete, deleteDisabled }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [src, setSrc] = useState(url);
  const pendingPlayRef = useRef(false);

  // url prop이 바뀌면 src 갱신
  useEffect(() => {
    setSrc(url);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [url]);

  function formatTime(sec) {
    if (!isFinite(sec) || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const handlePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (playing) {
      audio.pause();
      return;
    }

    // 재생 전 URL 유효성 체크 (만료 시 재조회)
    if (onGetFreshUrl) {
      setLoading(true);
      try {
        const freshUrl = await onGetFreshUrl();
        if (freshUrl && freshUrl !== src) {
          pendingPlayRef.current = true;
          setSrc(freshUrl);
          return; // useEffect([src])에서 pendingPlayRef 보고 재생
        }
      } catch {
        // 재조회 실패해도 기존 URL로 시도
      } finally {
        setLoading(false);
      }
    }

    try {
      await audio.play();
    } catch (e) {
      setError('재생 실패: ' + e.message);
    }
  };

  // src 바뀌면 새로 로드 후 재생 (pendingPlayRef: URL 갱신 후 재생 대기 중)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (playing || pendingPlayRef.current) {
      pendingPlayRef.current = false;
      audio.load();
      audio.play().catch((e) => setError('재생 실패: ' + e.message));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * duration;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#f9fafb', borderRadius: 12,
      padding: '10px 14px', border: '1px solid #f0f0f0',
    }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onError={async () => {
          if (onGetFreshUrl) {
            try {
              setLoading(true);
              const freshUrl = await onGetFreshUrl();
              if (freshUrl) setSrc(freshUrl);
              else setError('URL이 만료되었습니다. 페이지를 새로고침해주세요.');
            } catch {
              setError('재생 실패. 다시 시도해주세요.');
            } finally {
              setLoading(false);
            }
          } else {
            setError('재생 실패. URL이 만료되었을 수 있습니다.');
          }
        }}
        preload="metadata"
      />

      {/* 재생/정지 버튼 */}
      <button
        onClick={handlePlayPause}
        disabled={loading || !src}
        aria-label={playing ? '일시정지' : '재생'}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          border: 'none', background: '#7f0005',
          color: 'white', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: loading || !src ? 'not-allowed' : 'pointer',
          opacity: loading || !src ? 0.5 : 1,
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {loading ? '…' : playing ? '⏸' : '▶'}
      </button>

      {/* 파일명 + 프로그레스바 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {fileName && (
          <div style={{ fontSize: 12, color: '#595959', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
        )}
        {error ? (
          <div style={{ fontSize: 11, color: '#cf1322' }}>{error}</div>
        ) : (
          <div
            onClick={handleSeek}
            style={{ height: 4, background: '#e8e8e8', borderRadius: 2, cursor: 'pointer', position: 'relative' }}
          >
            <div style={{ height: '100%', width: `${progress * 100}%`, background: '#7f0005', borderRadius: 2, transition: 'width 0.1s linear' }} />
          </div>
        )}
      </div>

      {/* 시간 */}
      <div style={{ fontSize: 12, color: '#767676', flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 72, textAlign: 'right' }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      {/* 삭제 버튼 (onDelete가 있을 때만) */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label="삭제"
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: deleteDisabled ? 'not-allowed' : 'pointer',
            color: deleteDisabled ? '#d9d9d9' : '#bfbfbf',
            fontSize: 18, padding: '0 2px', lineHeight: 1,
            WebkitTapHighlightColor: 'transparent',
          }}
        >×</button>
      )}
    </div>
  );
}
