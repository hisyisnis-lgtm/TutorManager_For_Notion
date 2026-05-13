import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Spin, message } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import AudioPlayer from '../components/ui/AudioPlayer.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import FoodEarnedToast from '../components/ui/FoodEarnedToast.jsx';
import {
  PRIMARY, PRIMARY_BG, PRIMARY_ALPHA_20,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_INACTIVE, TEXT_DISABLED,
  BG_APP, BORDER_NEUTRAL,
  STATUS_SUCCESS_DARK, STATUS_ERROR,
} from '../constants/theme.js';
import {
  fetchMyHomework,
  parseHomework,
  submitHomework,
  uploadStudentFile,
  homeworkStatusColor,
  markFeedbackSeen,
} from '../api/homework.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';

const MAX_FILES = 5;

const HW_VIEWED_KEY = (token) => `hw_viewed_${token}`;

function getViewedMap(token) {
  try { return JSON.parse(localStorage.getItem(HW_VIEWED_KEY(token)) || '{}'); }
  catch { return {}; }
}

function markViewed(token, hwId) {
  const map = getViewedMap(token);
  if (!map[hwId]) {
    map[hwId] = Date.now();
    localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map));
  }
}

function forceArchive(token, hwId) {
  const map = getViewedMap(token);
  map[hwId] = Date.now() - (24 * 60 * 60 * 1000 + 1000);
  localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map));
}

function genStudentName(title, index) {
  const base = title.replace(/[^\w가-힣]/g, '').slice(0, 20) || '숙제';
  return `${base}_${String(index).padStart(2, '0')}`;
}

export default function PersonalHomeworkDetailPage() {
  const { studentToken, hwId } = useParams();
  const navigate = useNavigate();

  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalView, setModalView] = useState('list');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingFileName, setDeletingFileName] = useState(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const fileInputRef = useRef(null);
  // 먹이 획득 알림 — 숙제 첫 제출 또는 피드백 첫 확인 시점에 표시.
  const [foodToast, setFoodToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pages = await fetchMyHomework(studentToken);
      const list = pages.map(parseHomework);
      const found = list.find((h) => h.id === hwId) ?? null;
      if (!found) throw new Error('숙제를 찾을 수 없습니다.');
      setHw(found);
      markViewed(studentToken, hwId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken, hwId]);

  useEffect(() => { load(); }, [load]);

  // 학생이 피드백완료 숙제를 처음 열어본 시점 기록 — Worker가 비어있을 때만 PATCH(idempotent).
  // 호출 후 로컬 상태도 즉시 갱신해 같은 페이지에서 재호출되지 않게 함.
  // recorded:true는 Worker가 실제로 기록한 첫 호출이라는 뜻 = 먹이 1개 적립 시점.
  useEffect(() => {
    if (hw?.status === '피드백완료' && !hw.feedbackSeenDate) {
      markFeedbackSeen(studentToken, hwId)
        .then((result) => {
          setHw(prev => prev ? { ...prev, feedbackSeenDate: new Date().toISOString() } : prev);
          if (result?.recorded) setFoodToast({ message: '피드백 확인 보상이에요' });
        })
        .catch(e => console.warn('피드백 확인 기록 실패:', e?.message));
    }
  }, [hw?.status, hw?.feedbackSeenDate, studentToken, hwId]);

  const getFreshHw = useCallback(async () => {
    const pages = await fetchMyHomework(studentToken);
    const list = pages.map(parseHomework);
    return list.find((h) => h.id === hwId) ?? null;
  }, [studentToken, hwId]);

  const openModal = () => { setModalView('list'); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setTimeout(() => setModalView('list'), 300); };
  const removeFile = (tempId) => setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const handleFilePickChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const nextIndex = (hw?.submitFiles?.length ?? 0) + pendingFiles.length + 1;
    setNamingInput(genStudentName(hw.title, nextIndex));
    setNamingFile(file);
    setModalView('naming');
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim()) return;
    const newPf = { tempId: Date.now(), file: namingFile, name: namingInput.trim() };
    setNamingFile(null);
    uploadAndSubmit([...pendingFiles, newPf]);
  };

  const uploadAndSubmit = async (files) => {
    if (files.length === 0) return;
    // 첫 제출이면 Worker가 "제출 먹이 마크"를 박고 먹이 1개를 적립함.
    // 이후 재제출·파일 추가에선 마크가 이미 있어 추가 적립 없음 → 토스트도 1회만.
    const wasFirstSubmit = !hw?.submitMark;
    setUploading(true);
    try {
      const uploaded = [];
      for (const pf of files) {
        const namedFile = new File([pf.file], pf.name, { type: pf.file.type });
        const { fileUploadId } = await uploadStudentFile(studentToken, namedFile);
        uploaded.push({ fileUploadId, fileName: pf.name });
      }
      await submitHomework(studentToken, hwId, uploaded);
      setPendingFiles([]);
      closeModal();
      await load();
      if (wasFirstSubmit) setFoodToast({ message: '숙제 제출 보상이에요' });
    } catch (err) {
      message.error(`제출 실패: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileName) => {
    setDeleteConfirmFile(null);
    setDeletingFileName(fileName);
    try {
      await submitHomework(studentToken, hwId, [], [fileName]);
      await load();
    } catch (err) {
      message.error(`삭제 실패: ${err.message}`);
    } finally {
      setDeletingFileName(null);
    }
  };

  const headerStyle = {
    backgroundColor: 'rgba(255,255,255,0.82)',
    backdropFilter: 'saturate(180%) blur(20px)',
    WebkitBackdropFilter: 'saturate(180%) blur(20px)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
  };
  const innerStyle = {
    maxWidth: 480, margin: '0 auto',
    height: 56, display: 'flex', alignItems: 'center', padding: '0 16px',
  };
  const backBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 44, height: 44, marginLeft: -8, padding: 0,
    border: 'none', background: 'none', cursor: 'pointer',
    color: TEXT_SECONDARY, WebkitTapHighlightColor: 'transparent', flexShrink: 0,
  };

  const BackButton = () => (
    <button
      onClick={() => navigate(-1)}
      aria-label="뒤로"
      className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
      style={backBtnStyle}
    >
      <CaretLeftIcon weight="bold" size={20} />
    </button>
  );

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: BG_APP }}>
      <div style={headerStyle}>
        <div style={innerStyle}><BackButton /></div>
      </div>
      <LoadingSpinner />
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100dvh', background: BG_APP }}>
      <div style={headerStyle}>
        <div style={innerStyle}>
          <BackButton />
          <h1 style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>숙제 상세</h1>
        </div>
      </div>
      <ErrorMessage message={error} onRetry={load} />
    </div>
  );

  if (!hw) return null;

  const { bg, text } = homeworkStatusColor(hw.status);
  // 피드백완료 후에는 학생이 파일 추가·삭제 불가 — 강사가 피드백을 단 결과물을 보존.
  const canEdit = hw.status === '미제출' || hw.status === '제출완료';
  const isFeedback = hw.status === '피드백완료';
  const totalFiles = (hw.submitFiles?.length ?? 0) + pendingFiles.length;
  const canAddMore = totalFiles < MAX_FILES;
  const nextIndex = (hw.submitFiles?.length ?? 0) + pendingFiles.length + 1;

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    return '숙제 제출';
  })();

  return (
    <>
      {/* 헤더 */}
      <div style={{ ...headerStyle, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={innerStyle}>
          <BackButton />
          <h1 style={{ flex: 1, fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hw.title}
          </h1>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color: text }}>
            {hw.status}
          </span>
        </div>
      </div>

      <div style={{ background: BG_APP, minHeight: 'calc(100dvh - 56px)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* 숙제 내용 */}
        {hw.content && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 8px' }}>숙제 내용</p>
            <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{hw.content}</p>
          </div>
        )}

        {/* 내 제출 파일 */}
        {hw.submitFiles?.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 10px' }}>내 제출 파일</p>
            {hw.submitFiles.map((f, i) => (
              <div key={i} style={{ marginBottom: i < hw.submitFiles.length - 1 ? 8 : 0 }}>
                <AudioPlayer
                  url={f.url}
                  fileName={f.name}
                  onGetFreshUrl={async () => { const h = await getFreshHw(); return h?.submitFiles?.[i]?.url ?? null; }}
                  onDelete={canEdit ? () => setDeleteConfirmFile(f.name) : undefined}
                  deleteDisabled={deletingFileName !== null}
                />
              </div>
            ))}
            {hw.submitDate && (
              <p style={{ fontSize: 12, color: TEXT_TERTIARY, marginTop: 8 }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </div>
        )}

        {/* 선생님 피드백 */}
        {(hw.feedbackText || hw.feedbackFiles?.length > 0) && (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 16, padding: '16px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: STATUS_SUCCESS_DARK, margin: '0 0 10px' }}>선생님 피드백</p>
            {hw.feedbackText && (
              <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: hw.feedbackFiles?.length > 0 ? '0 0 10px' : 0 }}>
                {hw.feedbackText}
              </p>
            )}
            {hw.feedbackFiles?.map((f, i) => (
              <div key={i} style={{ marginBottom: i < hw.feedbackFiles.length - 1 ? 8 : 0 }}>
                <AudioPlayer
                  url={f.url}
                  fileName={f.name}
                  onGetFreshUrl={async () => { const h = await getFreshHw(); return h?.feedbackFiles?.[i]?.url ?? null; }}
                />
              </div>
            ))}
            {hw.feedbackDate && (
              <p style={{ fontSize: 12, color: TEXT_INACTIVE, marginTop: 8 }}>
                피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
              </p>
            )}
          </div>
        )}

        {/* 제출 버튼 */}
        {canEdit && (
          <button
            type="button"
            onClick={openModal}
            className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
            style={{
              width: '100%', height: 48, borderRadius: 12,
              background: PRIMARY_BG, border: `1.5px solid ${PRIMARY_ALPHA_20}`,
              color: PRIMARY, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent', marginBottom: 10,
            }}
          >
            숙제 제출하기
          </button>
        )}

        {/* 피드백완료 후 수정 불가 안내 */}
        {isFeedback && (
          <p style={{
            fontSize: 12, color: TEXT_INACTIVE,
            textAlign: 'center', margin: '0 0 10px',
            wordBreak: 'keep-all',
          }}>
            강사 피드백이 완료되어 더 이상 수정할 수 없습니다.
          </p>
        )}

        {/* 보관함으로 이동 버튼 */}
        {isFeedback && (
          <button
            type="button"
            onClick={() => { forceArchive(studentToken, hwId); navigate(-1); }}
            className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: 'none', border: `1.5px solid ${BORDER_NEUTRAL}`,
              color: TEXT_INACTIVE, fontSize: 14, fontWeight: 500, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            보관함으로 이동
          </button>
        )}
        </div>
      </div>

      {/* ===== 제출 팝업 ===== */}
      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {modalView !== 'list' && (
              <button
                type="button"
                onClick={() => setModalView('list')}
                className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
                aria-label="뒤로"
              >
                <CaretLeftIcon size={18} weight="bold" />
              </button>
            )}
            <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
          </div>
        }
        centered
        destroyOnHidden
        styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
      >
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFilePickChange} />

        {modalView === 'list' && (
          <div>
            {pendingFiles.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                  새로 추가할 파일 ({pendingFiles.length}개)
                </p>
                {pendingFiles.map((pf) => (
                  <div key={pf.tempId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
                    borderRadius: 12, marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pf.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(pf.tempId)}
                      style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                      aria-label="삭제"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {canAddMore && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
                  style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  파일 추가
                </button>
                <button
                  type="button"
                  onClick={() => setModalView('record')}
                  className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
                  style={{ flex: 1, height: 44, borderRadius: 12, background: PRIMARY, border: 'none', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  바로 녹음
                </button>
              </div>
            )}
          </div>
        )}

        {modalView === 'record' && (
          <AudioRecorder
            defaultName={genStudentName(hw.title, nextIndex)}
            onFile={(file) => {
              const safeName = file.name.replace(/\.[^/.]+$/, '');
              setModalView('list');
              uploadAndSubmit([...pendingFiles, { tempId: Date.now(), file, name: safeName }]);
            }}
            onCancel={() => setModalView('list')}
            hideCancel
          />
        )}

        {modalView === 'naming' && namingFile && (
          <div>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <input
              type="text"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
              maxLength={50}
              autoFocus
              style={{ width: '100%', height: 44, borderRadius: 12, border: `1.5px solid ${BORDER_NEUTRAL}`, padding: '0 14px', fontSize: 15, color: TEXT_PRIMARY, boxSizing: 'border-box', outline: 'none', marginBottom: 12 }}
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="primary"
              block
              onClick={handleNamingConfirm}
              disabled={!namingInput.trim()}
              style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
            >
              추가
            </Button>
          </div>
        )}
      </Modal>

      {/* 파일 삭제 확인 팝업 */}
      <Modal
        open={deleteConfirmFile !== null}
        onCancel={() => setDeleteConfirmFile(null)}
        footer={null}
        title={<span style={{ fontSize: 16, fontWeight: 700 }}>파일 삭제</span>}
        centered
        destroyOnHidden
      >
        <p style={{ fontSize: 14, color: TEXT_SECONDARY, margin: '0 0 20px', lineHeight: 1.6 }}>
          <strong style={{ color: TEXT_PRIMARY }}>{deleteConfirmFile?.replace(/\.[^/.]+$/, '')}</strong> 파일을 삭제할까요?<br />
          삭제 후에는 복구할 수 없어요.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setDeleteConfirmFile(null)}
            style={{ flex: 1, height: 44, borderRadius: 12, border: `1.5px solid ${BORDER_NEUTRAL}`, background: '#fff', color: TEXT_SECONDARY, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => handleDeleteFile(deleteConfirmFile)}
            className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
            style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', background: STATUS_ERROR, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            삭제
          </button>
        </div>
      </Modal>

      {/* 업로드/삭제 중 딤 오버레이 */}
      {(uploading || deletingFileName !== null) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <Spin size="large" />
        </div>
      )}

      {/* 먹이 획득 알림 — 첫 제출/첫 피드백 확인 순간에 1.8s 표시 */}
      <FoodEarnedToast
        open={!!foodToast}
        message={foodToast?.message}
        onClose={() => setFoodToast(null)}
      />
    </>
  );
}
