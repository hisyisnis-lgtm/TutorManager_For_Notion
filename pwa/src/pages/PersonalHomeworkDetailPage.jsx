import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Spin, message } from 'antd';
import { CaretLeftIcon, MicrophoneIcon, ImageSquareIcon } from '@phosphor-icons/react';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import {
  fetchMyHomework,
  parseHomework,
  submitHomework,
  uploadStudentFile,
  homeworkStatusColor,
  markFeedbackSeen,
  downloadHomeworkFileStudent,
  fetchHomeworkFileBlobUrlStudent,
} from '../api/homework.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import {
  validateFile,
  splitFileName,
  fileCategoryByName,
  ACCEPT_AUDIO,
  ACCEPT_DOCUMENT,
} from '../utils/audioFile.js';

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

  // 모달 — kind 가 null이면 닫힘. 'audio' 또는 'document'.
  // view: 'list' | 'record' | 'naming' (document 카테고리에선 record 없음)
  const [modalKind, setModalKind] = useState(null);
  const [modalView, setModalView] = useState('list');

  // 외부 페이지에 표시되는 저장 대기 — 카테고리별 분리.
  // 항목: { tempId, file, baseName, ext } — ext는 점 포함(`.mp3`) 또는 빈 문자열
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);

  // sessionFiles: 모달이 열려 있는 동안만 누적되는 임시 목록. 확인 누르면 그쪽 카테고리 pending 에 머지.
  const [sessionFiles, setSessionFiles] = useState([]);
  // namingFile: { file, ext } — 원본 확장자를 보존해 업로드 시 다시 결합
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingFileName, setDeletingFileName] = useState(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);

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

  const openModal = (kind) => {
    setSessionFiles([]);
    setNamingFile(null);
    setModalView('list');
    setModalKind(kind);
  };
  const closeModal = () => {
    setModalKind(null);
    setTimeout(() => {
      setModalView('list');
      setSessionFiles([]);
      setNamingFile(null);
    }, 300);
  };

  const removePendingAudio = (tempId) => setPendingAudio((prev) => prev.filter((f) => f.tempId !== tempId));
  const removePendingDoc = (tempId) => setPendingDocs((prev) => prev.filter((f) => f.tempId !== tempId));
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
  const fixedCount = (hw?.submitFiles?.length ?? 0) + pendingAudio.length + pendingDocs.length;
  const totalCount = fixedCount + sessionFiles.length;

  const tryOpenAudioPicker = () => {
    if (totalCount >= MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }
    audioInputRef.current?.click();
  };
  const tryOpenDocPicker = () => {
    if (totalCount >= MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }
    docInputRef.current?.click();
  };
  const tryOpenRecord = () => {
    if (totalCount >= MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }
    setModalView('record');
  };

  // 녹음 모달 — 단일은 naming, 다중은 자동 이름.
  const handleAudioPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'audio' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }

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

  // 문서 모달 — 원본 파일명 그대로 보존. 사진/PDF는 학생이 이름 재명명할 이유가 적음.
  const handleDocPickChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    for (const f of files) {
      const v = validateFile(f, { expectedCategory: 'document' });
      if (!v.ok) { message.error(v.error); return; }
    }
    if (totalCount + files.length > MAX_FILES) {
      message.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`);
      return;
    }

    const newOnes = files.map((file, i) => {
      const { base, ext } = splitFileName(file.name);
      return {
        tempId: Date.now() + Math.random() + i,
        file,
        baseName: base || `file_${totalCount + i + 1}`,
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim() || !namingFile) return;
    addToSession(namingFile.file, namingInput, namingFile.ext);
  };

  // 모달 확인 — sessionFiles 를 해당 카테고리 pending 으로 머지.
  const handleSessionConfirm = () => {
    if (sessionFiles.length > 0) {
      if (modalKind === 'audio') {
        setPendingAudio((prev) => [...prev, ...sessionFiles]);
      } else if (modalKind === 'document') {
        setPendingDocs((prev) => [...prev, ...sessionFiles]);
      }
    }
    closeModal();
  };

  // 저장 — 양쪽 카테고리 pending 합쳐서 한 번에 업로드 + Notion PATCH.
  const handleSaveSubmit = async () => {
    const all = [...pendingAudio, ...pendingDocs];
    if (all.length === 0) return;
    const isFirstSubmit = !hw?.submitMark;
    setUploading(true);
    try {
      const uploaded = [];
      for (const pf of all) {
        const fullName = pf.baseName + pf.ext;
        const namedFile = new File([pf.file], fullName, { type: pf.file.type });
        const { fileUploadId } = await uploadStudentFile(studentToken, namedFile);
        uploaded.push({ fileUploadId, fileName: fullName });
      }
      await submitHomework(studentToken, hwId, uploaded);
      setPendingAudio([]);
      setPendingDocs([]);
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

  // 저장본을 카테고리별로 분리 — file.name 확장자로 판정.
  const submitAudio = (hw.submitFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'audio');
  const submitDocs = (hw.submitFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'document');
  const feedbackAudio = (hw.feedbackFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'audio');
  const feedbackDocs = (hw.feedbackFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'document');

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    if (modalKind === 'audio') return '녹음 파일';
    if (modalKind === 'document') return '이미지·PDF';
    return '파일 추가';
  })();

  const pendingTotal = pendingAudio.length + pendingDocs.length;

  // 학생이 저장한 파일 한 행 — FilePreview wrapper.
  // kind: 'submit' | 'feedback'
  const renderStoredFile = (f, kind) => (
    <FilePreview
      key={`${kind}-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const h = await getFreshHw();
        const arr = kind === 'submit' ? h?.submitFiles : h?.feedbackFiles;
        return arr?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileStudent(studentToken, hwId, f.name, kind)}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlStudent(studentToken, hwId, f.name, kind)}
      onDelete={kind === 'submit' && canEdit ? () => setDeleteConfirmFile(f.name) : undefined}
      deleteDisabled={deletingFileName !== null}
    />
  );

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

        {/* 내 제출 파일 — 녹음 섹션 */}
        {submitAudio.length > 0 && (
          <SectionCard label="내 녹음 파일">
            {submitAudio.map((f) => (
              <div key={f.name} style={{ marginBottom: 8 }}>
                {renderStoredFile(f, 'submit')}
              </div>
            ))}
            {hw.submitDate && (
              <p style={{ fontSize: 12, color: '#767676', marginTop: 4 }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </SectionCard>
        )}

        {/* 내 제출 파일 — 이미지·PDF 섹션 */}
        {submitDocs.length > 0 && (
          <SectionCard label="내 이미지·PDF">
            {submitDocs.map((f) => (
              <div key={f.name} style={{ marginBottom: 8 }}>
                {renderStoredFile(f, 'submit')}
              </div>
            ))}
          </SectionCard>
        )}

        {/* 선생님 피드백 */}
        {(hw.feedbackText || feedbackAudio.length > 0 || feedbackDocs.length > 0) && (
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 16, padding: '16px', marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#389e0d', margin: '0 0 10px' }}>선생님 피드백</p>
            {hw.feedbackText && (
              <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: (feedbackAudio.length + feedbackDocs.length) > 0 ? '0 0 10px' : 0 }}>
                {hw.feedbackText}
              </p>
            )}
            {feedbackAudio.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#389e0d', margin: '8px 0 6px' }}>녹음 파일</p>
                {feedbackAudio.map((f) => (
                  <div key={f.name} style={{ marginBottom: 8 }}>
                    {renderStoredFile(f, 'feedback')}
                  </div>
                ))}
              </>
            )}
            {feedbackDocs.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#389e0d', margin: '8px 0 6px' }}>이미지·PDF</p>
                {feedbackDocs.map((f) => (
                  <div key={f.name} style={{ marginBottom: 8 }}>
                    {renderStoredFile(f, 'feedback')}
                  </div>
                ))}
              </>
            )}
            {hw.feedbackDate && (
              <p style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
                피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
              </p>
            )}
          </div>
        )}

        {/* 녹음 파일 추가 — pending + 진입 버튼 */}
        {canEdit && (
          <>
            {pendingAudio.length > 0 && (
              <PendingCard
                label={`새 녹음 파일 (${pendingAudio.length}/${MAX_FILES})`}
                items={pendingAudio}
                onRemove={removePendingAudio}
                disabled={uploading}
              />
            )}
            {fixedCount < MAX_FILES && (
              <SectionEntryButton
                icon={<MicrophoneIcon size={18} weight="fill" />}
                label="녹음 파일 추가"
                onClick={() => openModal('audio')}
                disabled={uploading}
              />
            )}
          </>
        )}

        {/* 이미지·PDF 추가 — pending + 진입 버튼 */}
        {canEdit && (
          <>
            {pendingDocs.length > 0 && (
              <PendingCard
                label={`새 이미지·PDF (${pendingDocs.length}/${MAX_FILES})`}
                items={pendingDocs}
                onRemove={removePendingDoc}
                disabled={uploading}
              />
            )}
            {fixedCount < MAX_FILES && (
              <SectionEntryButton
                icon={<ImageSquareIcon size={18} weight="fill" />}
                label="이미지·PDF 추가"
                onClick={() => openModal('document')}
                disabled={uploading}
              />
            )}
          </>
        )}

        {/* 숙제 저장 — 두 카테고리 pending 을 한 번에 업로드 */}
        {canEdit && pendingTotal > 0 && (
          <Button
            type="primary"
            block
            onClick={handleSaveSubmit}
            loading={uploading}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15, marginTop: 4 }}
          >
            숙제 저장 ({pendingTotal}개 파일)
          </Button>
        )}

        </div>
      </div>

      {/* ===== 파일 추가 팝업 — modalKind 에 따라 audio/document 분기 ===== */}
      <Modal
        open={modalKind !== null}
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
        {/* 카테고리별 input — accept 속성으로 OS picker 단계에서 필터 */}
        <input
          ref={audioInputRef}
          type="file"
          accept={ACCEPT_AUDIO}
          multiple
          style={{ display: 'none' }}
          onChange={handleAudioPickChange}
        />
        <input
          ref={docInputRef}
          type="file"
          accept={ACCEPT_DOCUMENT}
          multiple
          style={{ display: 'none' }}
          onChange={handleDocPickChange}
        />

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
                {modalKind === 'audio'
                  ? '추가할 녹음 파일을 선택하거나 직접 녹음해주세요'
                  : '추가할 이미지 또는 PDF 파일을 선택해주세요'}
              </p>
            )}

            {modalKind === 'audio' ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={tryOpenAudioPicker}
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
            ) : (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={tryOpenDocPicker}
                  className="transition-[background-color] duration-150 ease-out"
                  style={{ width: '100%', height: 44, borderRadius: 12, background: 'white', border: '1.5px solid #d9d9d9', color: '#595959', fontSize: 14, fontWeight: 600, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
                >
                  파일 추가
                </button>
              </div>
            )}

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

        {modalView === 'record' && modalKind === 'audio' && (
          <AudioRecorder
            defaultName={genStudentName(hw?.title ?? '숙제', totalCount + 1)}
            onFile={(file) => {
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

// ===== 보조 컴포넌트 =====

function SectionCard({ label, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 10px' }}>{label}</p>
      {children}
    </div>
  );
}

function PendingCard({ label, items, onRemove, disabled }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 8px' }}>{label}</p>
      {items.map((pf) => (
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
            onClick={() => onRemove(pf.tempId)}
            style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#bfbfbf', fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
            aria-label="삭제"
            disabled={disabled}
          >×</button>
        </div>
      ))}
    </div>
  );
}

function SectionEntryButton({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="transition-[background-color] duration-150 ease-out"
      style={{
        width: '100%', height: 44, borderRadius: 12,
        background: '#fff0f1', border: '1.5px solid rgba(127,0,5,0.2)',
        color: '#7f0005', fontSize: 14, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        WebkitTapHighlightColor: 'transparent', marginBottom: 10,
        opacity: disabled ? 0.6 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
