import { useState, useRef, useEffect } from 'react';
import { SpeakerHighIcon, PauseIcon, TrashIcon } from '@phosphor-icons/react';

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
  const [hoverBar, setHoverBar] = useState(false);
  const pendingPlayRef = useRef(false);

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

    if (onGetFreshUrl) {
      setLoading(true);
      try {
        const freshUrl = await onGetFreshUrl();
        if (freshUrl && freshUrl !== src) {
          pendingPlayRef.current = true;
          setSrc(freshUrl);
          return;
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
  const displayName = fileName ? fileName.replace(/\.[^/.]+$/, '') : '';

  // 아이콘 크로스페이드: transform(not scale shorthand) + opacity + filter
  // scale shorthand는 크로스브라우저 이슈가 있어 transform: scale() 사용
  const iconTransition = 'opacity 250ms cubic-bezier(0.2,0,0,1), transform 250ms cubic-bezier(0.2,0,0,1), filter 250ms cubic-bezier(0.2,0,0,1)';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#ffffff',
      borderRadius: 16,
      padding: '12px 14px',
      boxShadow: 'var(--shadow-border)',
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
          width: 40, height: 40, borderRadius: '50%',
          border: 'none', background: '#7f0005',
          color: '#ffffff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: loading || !src ? 'not-allowed' : 'pointer',
          opacity: loading || !src ? 0.5 : 1,
          flexShrink: 0,
          // transform 명시 (scale shorthand 대신)
          transition: 'transform 150ms ease-out, opacity 150ms ease-out',
          WebkitTapHighlightColor: 'transparent',
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        onTouchStart={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
        onTouchEnd={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {/* 두 아이콘 DOM에 유지 — 레이아웃은 PlayIcon이 정의, PauseIcon은 absolute 오버레이 */}
        <div style={{ position: 'relative', width: 18, height: 18 }}>
          {/* PauseIcon — absolute 오버레이, 재생 중 표시 */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: playing ? 1 : 0,
            transform: playing ? 'scale(1)' : 'scale(0.25)',
            filter: playing ? 'blur(0px)' : 'blur(4px)',
            transition: iconTransition,
          }}>
            <PauseIcon size={18} weight="fill" />
          </div>
          {/* SpeakerHighIcon — 레이아웃 정의, 정지 중 표시 */}
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: playing ? 0 : (loading ? 0.4 : 1),
            transform: playing ? 'scale(0.25)' : 'scale(1)',
            filter: playing ? 'blur(4px)' : 'blur(0px)',
            transition: iconTransition,
          }}>
            <SpeakerHighIcon size={18} weight="fill" />
          </div>
        </div>
      </button>

      {/* 파일명 + 프로그레스바 + 시간 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          {displayName && (
            <div style={{
              fontSize: 13, color: '#1d1d1f', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, minWidth: 0,
            }}>
              {displayName}
            </div>
          )}
          <div className="tabular-nums" style={{ fontSize: 12, color: '#767676', flexShrink: 0, marginLeft: 8 }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>
        {error ? (
          <div style={{ fontSize: 11, color: '#cf1322' }}>{error}</div>
        ) : (
          <div
            onClick={handleSeek}
            onMouseEnter={() => setHoverBar(true)}
            onMouseLeave={() => setHoverBar(false)}
            style={{
              height: hoverBar ? 6 : 4,
              background: '#f0f0f0',
              borderRadius: 3,
              cursor: 'pointer',
              position: 'relative',
              // height만 명시
              transition: 'height 150ms ease-out',
            }}
          >
            <div style={{
              height: '100%', width: `${progress * 100}%`,
              background: '#7f0005', borderRadius: 3,
              transition: 'width 0.1s linear',
              position: 'relative',
            }}>
              {/* thumb: opacity 트랜지션으로 부드럽게 등장 */}
              <div style={{
                position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)',
                width: 10, height: 10, borderRadius: '50%', background: '#7f0005',
                boxShadow: '0 1px 4px rgba(127,0,5,0.35)',
                opacity: progress > 0 ? 1 : 0,
                transition: 'opacity 200ms ease-out',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* 삭제 버튼 — 40×40px 히트 영역 */}
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 8,
            transition: 'color 150ms ease-out',
            WebkitTapHighlightColor: 'transparent',
          }}
          onMouseEnter={(e) => { if (!deleteDisabled) e.currentTarget.style.color = '#ff4d4f'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = deleteDisabled ? '#d9d9d9' : '#bfbfbf'; }}
        >
          <TrashIcon size={16} weight="regular" />
        </button>
      )}
    </div>
  );
}
