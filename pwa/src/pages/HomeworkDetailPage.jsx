import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Card, Modal, App, Spin } from 'antd';
import { ArrowLeftIcon, MicrophoneIcon, ImageSquareIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import Badge from '../components/ui/Badge.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_DISABLED,
  BORDER_DEFAULT, BORDER_NEUTRAL,
} from '../constants/theme.js';
import {
  parseHomework,
  saveFeedback,
  uploadTeacherFile,
  homeworkStatusColor,
  notifyHomework,
  downloadHomeworkFileTeacher,
  fetchHomeworkFileBlobUrlTeacher,
} from '../api/homework.js';
import { getPage, deletePage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import {
  validateFile,
  splitFileName,
  fileCategoryByName,
  ACCEPT_AUDIO,
  ACCEPT_DOCUMENT,
} from '../utils/audioFile.js';

const MAX_FILES = 5;

function genFeedbackName(title, index) {
  const base = title.replace(/[^\w가-힣]/g, '').slice(0, 20) || '숙제';
  return `${base}_피드백_${String(index).padStart(2, '0')}`;
}

export default function HomeworkDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [hw, setHw] = useState(null);
  const [studentName, setStudentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');

  // 외부 저장 대기 — 카테고리별 분리
  const [pendingFeedbackAudio, setPendingFeedbackAudio] = useState([]);
  const [pendingFeedbackDocs, setPendingFeedbackDocs] = useState([]);

  // 모달 — kind null이면 닫힘. 'audio' | 'document'
  const [modalKind, setModalKind] = useState(null);
  const [modalView, setModalView] = useState('list'); // 'list' | 'record' | 'naming'
  const [sessionFiles, setSessionFiles] = useState([]);

  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingFeedbackFileName, setDeletingFeedbackFileName] = useState(null);
  const [deleteFileConfirmName, setDeleteFileConfirmName] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedFeedbackText, setSavedFeedbackText] = useState('');
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);

  const pendingTotal = pendingFeedbackAudio.length + pendingFeedbackDocs.length;
  const isDirty = feedbackText !== savedFeedbackText || pendingTotal > 0;
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingNavRef = useRef(null);

  // 브라우저 뒤로가기 차단 (HashRouter는 useBlocker 미지원)
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      if (isDirtyRef.current) {
        window.history.pushState(null, '', window.location.href);
        setShowLeaveConfirm(true);
        pendingNavRef.current = () => navigate(-2);
      } else {
        navigate(-1);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate]);

  const handleBack = () => {
    if (isDirtyRef.current) {
      setShowLeaveConfirm(true);
      pendingNavRef.current = () => navigate(-1);
    } else {
      navigate(-1);
    }
  };

  const handleLeaveConfirm = () => {
    setShowLeaveConfirm(false);
    pendingNavRef.current?.();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getPage(id);
      const parsed = parseHomework(page);
      setHw(parsed);
      setFeedbackText(parsed.feedbackText || '');
      setSavedFeedbackText(parsed.feedbackText || '');
      if (parsed.studentIds?.[0]) {
        const studentPage = await getPage(parsed.studentIds[0]);
        const s = parseStudent(studentPage);
        setStudentName(s.name?.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim() ?? '');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const getFreshParsed = useCallback(async () => {
    const page = await getPage(id);
    return parseHomework(page);
  }, [id]);

  const fixedCount = (hw?.feedbackFiles?.length ?? 0) + pendingFeedbackAudio.length + pendingFeedbackDocs.length;
  const totalCount = fixedCount + sessionFiles.length;

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

  const removePendingAudio = (tempId) => setPendingFeedbackAudio((prev) => prev.filter((f) => f.tempId !== tempId));
  const removePendingDoc = (tempId) => setPendingFeedbackDocs((prev) => prev.filter((f) => f.tempId !== tempId));
  const removeSessionFile = (tempId) => setSessionFiles((prev) => prev.filter((f) => f.tempId !== tempId));

  const addToSession = (file, baseName, ext) => {
    const safeBase = (baseName || '').trim();
    setSessionFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, baseName: safeBase, ext: ext || '' },
    ]);
    setModalView('list');
    setNamingFile(null);
  };

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

  // 녹음 파일 picker — 단일은 naming, 다중은 자동 이름.
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
      setNamingInput(genFeedbackName(hw?.title ?? '숙제', totalCount + 1));
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
        baseName: genFeedbackName(hw?.title ?? '숙제', baseStart + i + 1),
        ext: ext || '',
      };
    });
    setSessionFiles((prev) => [...prev, ...newOnes]);
  };

  // 이미지·PDF picker — 원본 파일명 그대로.
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

  const handleSessionConfirm = () => {
    if (sessionFiles.length > 0) {
      if (modalKind === 'audio') {
        setPendingFeedbackAudio((prev) => [...prev, ...sessionFiles]);
      } else if (modalKind === 'document') {
        setPendingFeedbackDocs((prev) => [...prev, ...sessionFiles]);
      }
    }
    closeModal();
  };

  const modalTitle = (() => {
    if (modalView === 'record') return '음성 녹음';
    if (modalView === 'naming') return '파일 이름 입력';
    if (modalKind === 'audio') return '녹음 파일';
    if (modalKind === 'document') return '이미지·PDF';
    return '피드백 파일';
  })();

  const uploadAndSave = async (files) => {
    setSaving(true);
    try {
      let uploadedFiles;
      let existingFiles;

      if (files.length > 0) {
        uploadedFiles = [];
        for (const pf of files) {
          const fullName = pf.baseName + pf.ext;
          const namedFile = new File([pf.file], fullName, { type: pf.file.type });
          const { fileUploadId } = await uploadTeacherFile(namedFile);
          uploadedFiles.push({ fileUploadId, fileName: fullName });
        }
        if (hw.feedbackFiles?.length > 0) {
          const freshPage = await getPage(id);
          existingFiles = freshPage.properties['피드백 파일']?.files ?? [];
        }
      }

      await saveFeedback(id, { feedbackText, files: uploadedFiles, existingFiles });
      if (uploadedFiles && uploadedFiles.length > 0) {
        notifyHomework('feedback', id);
      }
      setSavedFeedbackText(feedbackText);
      setPendingFeedbackAudio([]);
      setPendingFeedbackDocs([]);
      closeModal();
      await load();
    } catch (e) {
      message.error(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 파일명 기반 삭제 — 카테고리 분리해도 동작하도록 인덱스 대신 이름으로 식별.
  const handleDeleteFeedbackFile = async (fileName) => {
    setDeleteFileConfirmName(null);
    setDeletingFeedbackFileName(fileName);
    try {
      const freshPage = await getPage(id);
      const existingFiles = (freshPage.properties['피드백 파일']?.files ?? [])
        .filter((f) => f.name !== fileName);
      await saveFeedback(id, { feedbackText, files: [], existingFiles });
      await load();
    } catch (e) {
      message.error(`삭제 실패: ${e.message}`);
    } finally {
      setDeletingFeedbackFileName(null);
    }
  };

  const handleSaveFeedback = async () => {
    if (!feedbackText.trim() && pendingTotal === 0 && !hw?.feedbackFiles?.length) {
      message.error('피드백 텍스트 또는 파일을 입력해주세요.');
      return;
    }
    await uploadAndSave([...pendingFeedbackAudio, ...pendingFeedbackDocs]);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      navigate(-1);
    } catch (e) {
      message.error(`삭제 실패: ${e.message}`);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="숙제 상세" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="숙제 상세" back /><ErrorMessage message={error} /></>;
  if (!hw) return null;

  const { bg, text } = homeworkStatusColor(hw.status);

  // 저장본 카테고리 분리
  const submitAudio = (hw.submitFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'audio');
  const submitDocs = (hw.submitFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'document');
  const feedbackAudio = (hw.feedbackFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'audio');
  const feedbackDocs = (hw.feedbackFiles ?? []).filter((f) => fileCategoryByName(f.name) === 'document');

  const renderSubmitFile = (f) => (
    <FilePreview
      key={`submit-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const parsed = await getFreshParsed();
        return parsed.submitFiles?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileTeacher(id, f.name, 'submit')}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlTeacher(id, f.name, 'submit')}
    />
  );

  const renderFeedbackFile = (f) => (
    <FilePreview
      key={`feedback-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const parsed = await getFreshParsed();
        return parsed.feedbackFiles?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileTeacher(id, f.name, 'feedback')}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlTeacher(id, f.name, 'feedback')}
      onDelete={() => setDeleteFileConfirmName(f.name)}
      deleteDisabled={deletingFeedbackFileName !== null}
    />
  );

  return (
    <>
      <PageHeader
        title="숙제 상세"
        back
        onBack={handleBack}
        action={
          <Button danger onClick={() => setShowDeleteConfirm(true)} style={{ borderRadius: 12, fontWeight: 500 }}>
            삭제
          </Button>
        }
      />

      <div className="px-4 pt-4 pb-24 space-y-4">
        {/* 상단 묶음: 타이틀 + 뱃지 + 과제 내용 */}
        <div style={{ paddingBottom: 16, borderBottom: `1px solid ${BORDER_DEFAULT}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: hw.content ? 20 : 0 }}>
            <div>
              {studentName && <div style={{ fontSize: 20, fontWeight: 600, color: TEXT_SECONDARY, lineHeight: 1.2 }}>{studentName}</div>}
              <div style={{ fontSize: 20, fontWeight: 600, color: TEXT_PRIMARY, lineHeight: 1.2 }}>{hw.title}</div>
            </div>
            <Badge label={hw.status} bg={bg} text={text} style={{ fontSize: 15, padding: '4px 12px', borderRadius: 10, flexShrink: 0, marginTop: 2 }} />
          </div>
          {hw.content && (
            <div>
              <SectionHeading style={{ marginBottom: 8 }}>숙제 내용</SectionHeading>
              <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{hw.content}</p>
            </div>
          )}
        </div>

        {/* 학생 제출 파일 — 카테고리별 카드 (강사는 다운로드만, 삭제 불가) */}
        {(submitAudio.length > 0 || submitDocs.length > 0) ? (
          <>
            {submitAudio.length > 0 && (
              <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
                <SectionHeading style={{ marginBottom: 12 }}>학생 제출 — 녹음</SectionHeading>
                {submitAudio.map((f, i) => (
                  <div key={f.name} style={{ marginBottom: i < submitAudio.length - 1 ? 8 : 0 }}>
                    {renderSubmitFile(f)}
                  </div>
                ))}
              </Card>
            )}
            {submitDocs.length > 0 && (
              <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
                <SectionHeading style={{ marginBottom: 12 }}>학생 제출 — 이미지·PDF</SectionHeading>
                {submitDocs.map((f, i) => (
                  <div key={f.name} style={{ marginBottom: i < submitDocs.length - 1 ? 8 : 0 }}>
                    {renderSubmitFile(f)}
                  </div>
                ))}
              </Card>
            )}
            {hw.submitDate && (
              <p style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '-8px 4px 0' }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </>
        ) : (
          <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
            <SectionHeading style={{ marginBottom: 12 }}>학생 제출 파일</SectionHeading>
            <div style={{ textAlign: 'center', padding: '20px 0', color: TEXT_DISABLED, fontSize: 13 }}>
              아직 제출하지 않았습니다
            </div>
          </Card>
        )}

        {/* 피드백 */}
        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
          <SectionHeading style={{ marginBottom: 12 }}>피드백</SectionHeading>

          <div style={{ marginBottom: 12 }}>
            <Input.TextArea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="텍스트 피드백을 입력하세요"
              rows={4}
              maxLength={2000}
              style={{ borderRadius: 12 }}
            />
            <div style={{ textAlign: 'right', fontSize: 12, color: TEXT_TERTIARY, marginTop: 4 }}>
              <span className="tabular-nums">{feedbackText.length}</span> / 2000
            </div>
          </div>

          {/* 녹음 파일 섹션 */}
          {feedbackAudio.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 6px', fontWeight: 600 }}>
                기존 녹음 파일 ({feedbackAudio.length}개)
              </p>
              {feedbackAudio.map((f, i) => (
                <div key={f.name} style={{ marginBottom: i < feedbackAudio.length - 1 ? 6 : 0 }}>
                  {renderFeedbackFile(f)}
                </div>
              ))}
            </div>
          )}
          {pendingFeedbackAudio.length > 0 && (
            <PendingCard
              label={`새 녹음 파일 (${pendingFeedbackAudio.length}/${MAX_FILES})`}
              items={pendingFeedbackAudio}
              onRemove={removePendingAudio}
            />
          )}
          {!saving && fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<MicrophoneIcon size={18} weight="fill" />}
              label="녹음 파일 추가"
              onClick={() => openModal('audio')}
            />
          )}

          {/* 이미지·PDF 섹션 */}
          {feedbackDocs.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 6px', fontWeight: 600 }}>
                기존 이미지·PDF ({feedbackDocs.length}개)
              </p>
              {feedbackDocs.map((f, i) => (
                <div key={f.name} style={{ marginBottom: i < feedbackDocs.length - 1 ? 6 : 0 }}>
                  {renderFeedbackFile(f)}
                </div>
              ))}
            </div>
          )}
          {pendingFeedbackDocs.length > 0 && (
            <PendingCard
              label={`새 이미지·PDF (${pendingFeedbackDocs.length}/${MAX_FILES})`}
              items={pendingFeedbackDocs}
              onRemove={removePendingDoc}
            />
          )}
          {!saving && fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<ImageSquareIcon size={18} weight="fill" />}
              label="이미지·PDF 추가"
              onClick={() => openModal('document')}
            />
          )}

          {hw.feedbackDate && (
            <p style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '6px 0 12px' }}>
              피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
            </p>
          )}

          <Button
            type="primary"
            block
            onClick={handleSaveFeedback}
            loading={saving}
            style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
          >
            피드백 저장{pendingTotal > 0 ? ` (${pendingTotal}개 파일)` : ''}
          </Button>
        </Card>
      </div>

      {/* ===== 파일 추가 팝업 — kind 분기 ===== */}
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
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
                aria-label="뒤로"
              ><ArrowLeftIcon size={18} weight="bold" /></button>
            )}
            <span style={{ fontSize: 16, fontWeight: 700 }}>{modalTitle}</span>
          </div>
        }
        centered
        destroyOnHidden
        styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
      >
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
                <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                  추가된 파일 ({sessionFiles.length}개)
                </p>
                {sessionFiles.map((pf) => (
                  <div key={pf.tempId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
                    borderRadius: 12, marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pf.baseName + pf.ext}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSessionFile(pf.tempId)}
                      style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                      aria-label="삭제"
                    >×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{
                fontSize: 13, color: TEXT_TERTIARY, textAlign: 'center',
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
                  className="duration-150 ease-out"
                  style={{
                    flex: 1, height: 44, borderRadius: 12,
                    background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  파일 추가
                </button>
                <button
                  type="button"
                  onClick={tryOpenRecord}
                  className="duration-150 ease-out"
                  style={{
                    flex: 1, height: 44, borderRadius: 12,
                    background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  바로 녹음
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={tryOpenDocPicker}
                  className="duration-150 ease-out"
                  style={{
                    width: '100%', height: 44, borderRadius: 12,
                    background: 'white', border: `1.5px solid ${BORDER_NEUTRAL}`, color: TEXT_SECONDARY,
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  파일 추가
                </button>
              </div>
            )}

            <Button
              type="primary"
              block
              onClick={handleSessionConfirm}
              style={{ borderRadius: 12, height: 48, fontWeight: 700, fontSize: 15 }}
            >
              확인{sessionFiles.length > 0 ? ` (${sessionFiles.length}개 추가)` : ''}
            </Button>
          </div>
        )}

        {modalView === 'record' && modalKind === 'audio' && (
          <AudioRecorder
            defaultName={genFeedbackName(hw?.title ?? '숙제', totalCount + 1)}
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
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                type="text"
                value={namingInput}
                onChange={(e) => setNamingInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
                maxLength={50}
                autoFocus
                style={{
                  width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #d9d9d9',
                  padding: namingFile.ext ? '0 56px 0 14px' : '0 14px',
                  fontSize: 15, color: TEXT_PRIMARY,
                  boxSizing: 'border-box', outline: 'none',
                }}
                onFocus={(e) => e.target.select()}
              />
              {namingFile.ext && (
                <span style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 13, color: TEXT_TERTIARY, pointerEvents: 'none',
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

      {/* 업로드/삭제 중 딤 오버레이 */}
      {(saving || deletingFeedbackFileName !== null) && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <Spin size="large" />
        </div>
      )}

      {deleteFileConfirmName !== null && (
        <ConfirmDialog
          title="피드백 파일을 삭제할까요?"
          message={`${deleteFileConfirmName?.replace(/\.[^/.]+$/, '') ?? '파일'}을 삭제합니다. 삭제 후에는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          onConfirm={() => handleDeleteFeedbackFile(deleteFileConfirmName)}
          onCancel={() => setDeleteFileConfirmName(null)}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="숙제를 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}

      {showLeaveConfirm && (
        <ConfirmDialog
          title="페이지를 나가시겠습니까?"
          message="저장하지 않은 피드백 수정사항이 있습니다. 지금 나가면 변경 내용이 사라집니다."
          confirmLabel="나가기"
          cancelLabel="계속 작성"
          onConfirm={handleLeaveConfirm}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </>
  );
}

// ===== 보조 컴포넌트 =====

function PendingCard({ label, items, onRemove }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>{label}</p>
      {items.map((pf) => (
        <div key={pf.tempId} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f',
          borderRadius: 12, marginBottom: 6,
        }}>
          <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pf.baseName + pf.ext}
          </span>
          <button
            type="button"
            onClick={() => onRemove(pf.tempId)}
            style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
            aria-label="삭제"
          >×</button>
        </div>
      ))}
    </div>
  );
}

function SectionEntryButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="duration-150 ease-out"
      style={{
        width: '100%', height: 44, borderRadius: 12,
        background: PRIMARY_BG, border: '1.5px solid rgba(127,0,5,0.2)',
        color: PRIMARY, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent', marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
