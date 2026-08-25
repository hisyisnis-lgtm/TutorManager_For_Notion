import {
  useState,
  useEffect,
  useRef } from 'react';
import { FilePdfIcon,
  ImageIcon,
  DownloadSimpleIcon,
  TrashIcon,
  XIcon } from '@phosphor-icons/react';
import AudioPlayer from './AudioPlayer.jsx';
import {
  PRIMARY,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  BORDER_NEUTRAL,
  STATUS_ERROR_TEXT,
  GRAY_100,
  GRAY_50 } from '../../constants/theme.js';
import { isImageByName, isPdfByName } from '../../utils/audioFile.js';

/**
 * FilePreview — 파일 카테고리별 분기 렌더링.
 * 오디오/이미지/PDF/기타를 한 컴포넌트로 처리. 학생·강사 페이지 모두에서 사용.
 *
 * Props:
 * - file: { name: string, url: string|null }  (url은 오디오 인라인 src로만 쓰임. 이미지/PDF는 사용 안 함)
 * - onGetFreshUrl: async () => string         (AudioPlayer만 사용 — URL 만료 시 재조회)
 * - onDownload: async () => void              (다운로드 버튼 클릭 시 호출 — 학생/강사 분기는 부모가 처리)
 * - fetchInlineBlobUrl: async () => string    (이미지 미리보기용 blob URL fetcher — Worker proxy 경유)
 * - onDelete: () => void                       (있을 때만 삭제 버튼 표시)
 * - deleteDisabled: boolean
 */
export default function FilePreview({
  file,
  onGetFreshUrl,
  onDownload,
  fetchInlineBlobUrl,
  onDelete,
  deleteDisabled,
}) {
  // 카테고리 분류는 명확한 PDF/이미지가 아니면 audio 폴백.
  // 이유: 옛 데이터(확장자 없는 파일 등)는 모두 음성이었고, 모르는 확장자도 일단 재생 UI 가 가장 안전.
  if (isImageByName(file?.name)) {
    return (
      <ImagePreview
        fileName={file.name}
        fetchInlineBlobUrl={fetchInlineBlobUrl}
        onDownload={onDownload}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled}
      />
    );
  }

  if (isPdfByName(file?.name)) {
    return (
      <DocumentRow
        fileName={file.name}
        // design-audit-ignore: color-literal — PDF 파일타입 식별색(Adobe 레드). 우리 팔레트가 아니다
        icon={<FilePdfIcon size={24} weight="fill" color="#d32f2f" />}
        onDownload={onDownload}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled}
      />
    );
  }

  return (
    <AudioPlayer
      url={file?.url}
      fileName={file?.name}
      onGetFreshUrl={onGetFreshUrl}
      onDelete={onDelete}
      deleteDisabled={deleteDisabled}
      onDownload={onDownload}
    />
  );
}

// ===== 이미지 인라인 미리보기 =====

function ImagePreview({ fileName, fetchInlineBlobUrl, onDownload, onDelete, deleteDisabled }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  // 호출부가 인라인 화살표로 fetcher를 넘겨도(렌더마다 새 함수) 재fetch되지 않도록
  // ref에 최신 fetcher만 보관하고, effect는 fileName 기준으로만 실행한다.
  // (이전엔 deps가 [fetchInlineBlobUrl]이라 부모 타이핑마다 표시 중인 blob을 revoke하고 재다운로드했음)
  const fetcherRef = useRef(fetchInlineBlobUrl);
  useEffect(() => { fetcherRef.current = fetchInlineBlobUrl; });

  useEffect(() => {
    let cancelled = false;
    let currentUrl = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);

    if (!fetcherRef.current) {
      setLoading(false);
      setError('미리보기를 불러올 수 없어요');
      return;
    }

    fetcherRef.current()
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || '미리보기 실패');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px',
        background: '#fff', borderRadius: 12,
        boxShadow: 'var(--shadow-border)',
      }}>
        <button
          type="button"
          onClick={() => blobUrl && setFullscreen(true)}
          disabled={!blobUrl}
          style={{
            width: 56, height: 56, borderRadius: 8,
            background: GRAY_100, border: 'none',
            cursor: blobUrl ? 'zoom-in' : 'default',
            padding: 0, overflow: 'hidden', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label={blobUrl ? '확대해서 보기' : '미리보기 로딩 중'}
        >
          {loading ? (
            <div style={{ fontSize: 11, color: TEXT_TERTIARY }}>…</div>
          ) : error ? (
            <ImageIcon size={24} color={TEXT_DISABLED} />
          ) : (
            <img src={blobUrl} alt={fileName}
              style={{
                width: '100%', height: '100%', objectFit: 'cover',
                // 밝은 사진이 흰 배경에 녹아 경계가 사라지는 걸 막는 얇은 아웃라인.
                // outline은 레이아웃에 영향이 없고 offset -1로 안쪽에 그려 크기도 안 변한다.
                outline: '1px solid rgba(0,0,0,0.1)', outlineOffset: -1,
              }} />
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {fileName}
          </div>
          {error && (
            <div style={{ fontSize: 11, color: STATUS_ERROR_TEXT, marginTop: 2 }}>
              {error}
            </div>
          )}
        </div>
        <ActionButtons
          onDownload={onDownload}
          onDelete={onDelete}
          deleteDisabled={deleteDisabled}
        />
      </div>

      {fullscreen && blobUrl && (
        <FullscreenImage url={blobUrl} fileName={fileName} onClose={() => setFullscreen(false)} />
      )}
    </>
  );
}

function FullscreenImage({ url, fileName, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={`${fileName} 확대 보기`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'fade-in 200ms ease-out both',
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="닫기"
        style={{
          position: 'absolute', top: 'max(env(safe-area-inset-top), 16px)', right: 16,
          width: 40, height: 40, borderRadius: 20,
          background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent', zIndex: 1,
        }}
      >
        <XIcon size={20} weight="bold" />
      </button>
      <img
        src={url}
        alt={fileName}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%', maxHeight: '100%',
          objectFit: 'contain', borderRadius: 8,
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
          // 전체화면은 어두운 배경이라 흰색 아웃라인
          outline: '1px solid rgba(255,255,255,0.1)', outlineOffset: -1,
        }}
      />
    </div>
  );
}

// ===== PDF/기타 문서 행 =====

function DocumentRow({ fileName, icon, onDownload, onDelete, deleteDisabled }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px',
      background: '#fff', borderRadius: 12,
      boxShadow: 'var(--shadow-border)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: GRAY_50, display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {fileName}
        </div>
      </div>
      <ActionButtons
        onDownload={onDownload}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled}
      />
    </div>
  );
}

// ===== 공통 액션 버튼 =====

function ActionButtons({ onDownload, onDelete, deleteDisabled }) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    try {
      await onDownload();
    } catch (e) {
      // 부모가 토스트 처리하므로 여기선 silent
      console.warn('[FilePreview] 다운로드 실패:', e?.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {onDownload && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          aria-label="다운로드"
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: downloading ? 'wait' : 'pointer',
            opacity: downloading ? 0.5 : 1,
            color: PRIMARY,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <DownloadSimpleIcon size={20} weight="bold" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label="삭제"
          style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: deleteDisabled ? 'not-allowed' : 'pointer',
            opacity: deleteDisabled ? 0.4 : 1,
            color: STATUS_ERROR_TEXT,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <TrashIcon size={20} />
        </button>
      )}
    </div>
  );
}
