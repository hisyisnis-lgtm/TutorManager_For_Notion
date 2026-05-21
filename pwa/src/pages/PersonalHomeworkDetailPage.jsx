import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Spin, message } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import AudioPlayer from '../components/ui/AudioPlayer.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import {
  fetchMyHomework,
  parseHomework,
  submitHomework,
  uploadStudentFile,
  homeworkStatusColor,
  markFeedbackSeen,
} from '../api/homework.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import { validateAudioFile, splitFileName } from '../utils/audioFile.js';

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
  // pendingFiles: 외부 페이지에 표시되는 저장 대기 목록. 학생이 "숙제 저장"을 눌러야 업로드된다.
  // 항목: { tempId, file, baseName, ext } — ext는 점 포함(`.mp3`) 또는 빈 문자열
  const [pendingFiles, setPendingFiles] = useState([]);
  // sessionFiles: 모달이 열려있는 동안만 누적되는 임시 목록. 확인 누르면 pendingFiles 에 합쳐진다.
  const [sessionFiles, setSessionFiles] = useState([]);
  // namingFile: { file, ext } — 원본 확장자를 보존해 업로드 시 다시 결합
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingFileName, setDeletingFileName] = useState(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const fileInputRef = useRef(null);

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
  useEffect(() => {
    if (hw?.status === '피드백완료' && !hw.feedbackSeenDate) {
      markFeedbackSeen(studentToken, hwId)
        .then(() => {
          setHw(prev => prev ? { ...prev, feedbackSeenDate: new Date().toISOString() } : prev);
          message.success('피드백 확인 완료 · 먹이 +1');
        })
        .catch(e => console.warn('피드백 확인 기록 실패:', e?.message));
    }
  }, [hw?.status, hw?.feedbackSeenDate, studentToken, hwId]);

  const getFreshHw = useCallback(async () => {
    const pages = await fetchMyHomework(studentToken);
    const list = pages.map(parseHomework);
    return list.find((h) => h.id === hwId) ?? null;
  }, [studentToken, hwId]);

  const openModal = () => {
    setSessionFiles([]);
    setNamingFile(null);
    setModalView('list');
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setTimeout(() => {
      setModalView('list');
      setSessionFiles([]);
      setNamingFile(null);
    }, 300);
  };

  const removeFile = (tempId) => setPendingFiles((prev) => prev.filter((f) => f.tempId !== tempId));
  const removeSessionFile = (tempId) => setSessionFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const addToSession = (file, baseName, ext) => {
    setSessionFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, baseName: (baseName || '').trim(), ext: ext || '' },
    ]);
    setModalView('list');
    setNamingFile(null);
  };

  // 외부 페이지·기존 저장본·모달 임시 목록 합산 — 5개 제한 판정에 쓰인다.
  // (hw 가 아직 없을 때도 안전하도록 옵셔널 체이닝)
  const fixedCount = (hw?.submitFiles?.length ?? 0) + pendingFiles.length;
  const totalCount = fixedCount + sessionFiles.length;

  const tryOpenFilePicker = () => {
    if (totalCount >= MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }
    fileInputRef.current?.click();
  };
  const tryOpenRecord = () => {
    if (totalCount >= MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }
    setModalView('record');
  };

  const handleFilePickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    // 사이즈/MIME 사전 차단 — Notion 20 MiB 상한 + 오디오 외 파일 거부.
    for (const f of files) {
      const v = validateAudioFile(f);
      if (!v.ok) {
        message.error(v.error);
        return;
      }
    }
    // 5개 제한: 다중 선택분이 한계를 넘으면 전체 거부 (부분 추가는 사용자 의도와 어긋남).
    if (totalCount + files.length > MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }

    // 단일 파일은 기존처럼 naming 뷰로, 다중 파일은 자동 이름으로 한꺼번에 누적.
    if (files.length === 1) {
      const file = files[0];
      const { ext } = splitFileName(file.name);
      setNamingInput(genStudentName(hw?.title ?? '숙제', totalCount + 1));
      setNamingFile({ file, ext });
      setModalView('naming');
      return;
    }
    const baseStart = totalCount;
    const newOnes = files.map((file, i) => {
      const { ext } = splitFileName(file.name);
      return {
        tempId: Date.now() + Math.random() + i,
        file,
        baseName: genStudentName(hw?.title ?? '숙제', baseStart + i + 1),
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim() || !namingFile) return;
    addToSession(namingFile.file, namingInput, namingFile.ext);
  };

  const handleSessionConfirm = () => {
    if (sessionFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...sessionFiles]);
    }
    closeModal();
  };

  const handleSaveSubmit = async () => {
    if (pendingFiles.length === 0) return;
    const isFirstSubmit = !hw?.submitMark;
    setUploading(true);
    try {
      const uploaded = [];
      for (const pf of pendingFiles) {
        const fullName = pf.baseName + pf.ext;
        const namedFile = new File([pf.file], fullName, { type: pf.file.type });
        const { fileUploadId } = await uploadStudentFile(studentToken, namedFile);
        uploaded.push({ fileUploadId, fileName: fullName });
      }
      await submitHomework(studentToken, hwId, uploaded);
      setPendingFiles([]);
      await load();
      if (isFirstSubmit) {
        message.success('숙제 제출 완료 · 먹이 +1');
      } else {
        message.success('숙제가 제출되었어요');
      }
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
    color: '#595959', WebkitTapHighlightColor: 'transparent', flexShrink: 0,
  };

  const BackButton = () => (
    <button
      onClick={() => navigate(-1)}
      aria-label="뒤로"
      className="transition-[color] duration-150 ease-out"
      style={backBtnStyle}
    >
      <CaretLeftIcon weight="bold" size={20} />
    </button>
  );

  if (loading) return (
    <div style={{ minHeight: '100dvh', background: '#f9fafb' }}>
      <div style={headerStyle}>
        <div style={innerStyle}><BackButton /></div>
      </div>
      <LoadingSpinner />
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100dvh', background: '#f9fafb' }}>
      <div style={headerStyle}>
        <div style={innerStyle}>
          <BackButton />
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: 0 }}>숙제 상세</h1>
        </div>
      </div>
      <ErrorMessage message={error} onRetry={load} />
    </div>
  );

  if (!hw) return null;

  const { bg, text } = homeworkStatusColor(hw.status);
  // 피드백완료 후에는 학생이 파일 추가·삭제 불가 — 강사가 피드백을 단 결과물을 보존.
  const canEdit = hw.status === '미제출' || hw.status === '제출완료';

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    return '숙제 파일';
  })();

  return (
    <>
      {/* 헤더 */}
      <div style={{ ...headerStyle, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={innerStyle}>
          <BackButton />
          <h1 style={{ flex: 1, fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hw.title}
          </h1>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color: text }}>
            {hw.status}
          </span>
        </div>
      </div>

      <div style={{ background: '#f9fafb', minHeight: 'calc(100dvh - 56px)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* 숙제 내용 */}
        {hw.content && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 8px' }}>숙제 내용</p>
            <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{hw.content}</p>
          </div>
        )}

        {/* 내 제출 파일 */}
        {hw.submitFiles?.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 10px' }}>내 제출 파일</p>
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
              <p style={{ fontSize: 12, color: '#767676', marginTop: 8 }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </div>
        )}

        {/* 선생님 피드백 */}
        {(hw.feedbackText || hw.feedbackFiles?.length > 0) && (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 16, padding: '16px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#389e0d', margin: '0 0 10px' }}>선생님 피드백</p>
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
              <p style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
                피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
              </p>
            )}
          </div>
        )}

        {/* 새로 추가할 숙제 파일 — pendingFiles 목록. 저장 전 외부에서 미리보기·삭제 가능 */}
        {canEdit && pendingFiles.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 8px' }}>
              새 숙제 파일 ({pendingFiles.length}/{MAX_FILES})
            </p>
            {pendingFiles.map((pf) => (
              <div key={pf.tempId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
                borderRadius: 12, marginBottom: 6,
              }}>
                <span style={{ fontSize: 13, color: '#1d1d1f', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pf.baseName + pf.ext}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(pf.tempId)}
                  style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#bfbfbf', fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                  aria-label="삭제"
                  disabled={uploading}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* 숙제 파일 추가 진입 버튼 — 모달 내부에서 "확인" 누르면 위 pendingFiles 에 합쳐진다 */}
        {canEdit && fixedCount < MAX_FILES && (
          <button
            type="button"
            onClick={openModal}
            disabled={uploading}
            className="transition-[background-color] duration-150 ease-out"
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: '#fff0f1', border: '1.5px solid rgba(127,0,5,0.2)',
              color: '#7f0005', fontSize: 14, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer',
              WebkitTapHighlightColor: 'transparent', marginBottom: 10,
              opacity: uploading ? 0.6 : 1,
            }}
          >
            숙제 파일 추가
          </button>
        )}

        {/* 숙제 저장 — pendingFiles 를 한 번에 업로드 + Notion 반영. 추가할 게 있을 때만 노출 */}
        {canEdit && pendingFiles.length > 0 && (
          <Button
            type="primary"
            block
            onClick={handleSaveSubmit}
            loading={uploading}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15, marginBottom: 10 }}
          >
            숙제 저장 ({pendingFiles.length}개 파일)
          </Button>
        )}

        </div>
      </div>

      {/* ===== 숙제 파일 추가 팝업 ===== */}
      <Modal
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        closable={false}
        maskClosable={false}
        keyboard={false}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {modalView !== 'list' && (
              <button
                type="button"
                onClick={() => setModalView('list')}
                className="transition-[color] duration-150 ease-out"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#595959', padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
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
        {/* iOS Safari는 accept="audio/*" 만으로 .m4a/.mp3 등을 회색 처리하는 경우가 있어 확장자를 명시적으로 함께 나열 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.mp4,.wav,.aac,.ogg,.webm,.opus,.flac"
          multiple
          style={{ display: 'none' }}
          onChange={handleFilePickChange}
        />

        {/* list 뷰 — 이 세션에서 추가한 파일만 노출. 외부 페이지의 pendingFiles 는 모달 밖에서 보여준다. */}
        {modalView === 'list' && (
          <div>
            {sessionFiles.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#595959', margin: '0 0 6px' }}>
                  추가된 파일 ({sessionFiles.length}개)
                </p>
                {sessionFiles.map((pf) => (
                  <div key={pf.tempId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
                    borderRadius: 12, marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 13, color: '#1d1d1f', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pf.baseName + pf.ext}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSessionFile(pf.tempId)}
                      style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#bfbfbf', fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                      aria-label="삭제"
                    >×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{
                fontSize: 13, color: '#8c8c8c', textAlign: 'center',
                padding: '14px 0 16px', margin: 0, lineHeight: 1.6,
              }}>
                추가할 파일을 선택하거나 녹음해주세요
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={tryOpenFilePicker}
                className="transition-[background-color] duration-150 ease-out"
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: '1.5px solid #d9d9d9', color: '#595959', fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
              >
                파일 추가
              </button>
              <button
                type="button"
                onClick={tryOpenRecord}
                className="transition-[background-color] duration-150 ease-out"
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'white', border: '1.5px solid #d9d9d9', color: '#595959', fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
              >
                바로 녹음
              </button>
            </div>
            <Button
              type="primary"
              block
              onClick={handleSessionConfirm}
              style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
            >
              확인{sessionFiles.length > 0 ? ` (${sessionFiles.length}개 추가)` : ''}
            </Button>
          </div>
        )}

        {modalView === 'record' && (
          <AudioRecorder
            defaultName={genStudentName(hw?.title ?? '숙제', totalCount + 1)}
            onFile={(file) => {
              // AudioRecorder가 `${name}.${ext}` 형식으로 만들어 보냄 → 확장자 분리해 sessionFiles 누적.
              const { base, ext } = splitFileName(file.name);
              addToSession(file, base, ext);
            }}
            onCancel={() => setModalView('list')}
            hideCancel
          />
        )}

        {modalView === 'naming' && namingFile && (
          <div>
            <p style={{ fontSize: 13, color: '#595959', margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <input
                type="text"
                value={namingInput}
                onChange={(e) => setNamingInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
                maxLength={50}
                autoFocus
                style={{
                  width: '100%', height: 44, borderRadius: 12,
                  border: '1.5px solid #d9d9d9',
                  padding: namingFile.ext ? '0 56px 0 14px' : '0 14px',
                  fontSize: 15, color: '#1d1d1f', boxSizing: 'border-box', outline: 'none',
                }}
                onFocus={(e) => e.target.select()}
              />
              {namingFile.ext && (
                <span style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 13, color: '#8c8c8c', pointerEvents: 'none',
                }}>
                  {namingFile.ext}
                </span>
              )}
            </div>
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
        <p style={{ fontSize: 14, color: '#595959', margin: '0 0 20px', lineHeight: 1.6 }}>
          <strong style={{ color: '#1d1d1f' }}>{deleteConfirmFile?.replace(/\.[^/.]+$/, '')}</strong> 파일을 삭제할까요?<br />
          삭제 후에는 복구할 수 없어요.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setDeleteConfirmFile(null)}
            style={{ flex: 1, height: 44, borderRadius: 12, border: '1.5px solid #d9d9d9', background: '#fff', color: '#595959', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => handleDeleteFile(deleteConfirmFile)}
            className="duration-150 ease-out"
            style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', background: '#ff4d4f', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
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
    </>
  );
}
