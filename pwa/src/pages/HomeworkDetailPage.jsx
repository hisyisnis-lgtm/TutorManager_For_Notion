import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Card, Modal, App, Spin } from 'antd';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import AudioPlayer from '../components/ui/AudioPlayer.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import Badge from '../components/ui/Badge.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_DISABLED,
  BORDER_DEFAULT, BORDER_NEUTRAL,
} from '../constants/theme.js';
import { getHomeworkPage, parseHomework, saveFeedback, deleteHomework, uploadTeacherFile, homeworkStatusColor, notifyHomework } from '../api/homework.js';
import { getPage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';

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
  // pendingFeedbackFiles: [{tempId, file, name}] — 저장 전 로컬 목록
  const [pendingFeedbackFiles, setPendingFeedbackFiles] = useState([]);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalView, setFileModalView] = useState('list'); // 'list' | 'record' | 'naming'
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingFeedbackFileName, setDeletingFeedbackFileName] = useState(null);
  const [deleteFileConfirmIndex, setDeleteFileConfirmIndex] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedFeedbackText, setSavedFeedbackText] = useState('');
  const fileInputRef = useRef(null);

  const isDirty = feedbackText !== savedFeedbackText || pendingFeedbackFiles.length > 0;
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
      const page = await getHomeworkPage(id);
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
    const page = await getHomeworkPage(id);
    return parseHomework(page);
  }, [id]);

  const openFileModal = () => { setFileModalView('list'); setFileModalOpen(true); };
  const closeFileModal = () => { setFileModalOpen(false); setTimeout(() => setFileModalView('list'), 300); };

  const addFeedbackFile = (file, name) => {
    const safeName = (name || '').trim();
    setPendingFeedbackFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, name: safeName },
    ]);
    setFileModalView('list');
    setNamingFile(null);
  };

  const removeFeedbackFile = (tempId) => {
    setPendingFeedbackFiles((prev) => prev.filter((f) => f.tempId !== tempId));
  };

  const handleFilePickChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const nextIndex = (hw?.feedbackFiles?.length ?? 0) + pendingFeedbackFiles.length + 1;
    setNamingInput(genFeedbackName(hw?.title ?? '숙제', nextIndex));
    setNamingFile({ file });
    setFileModalView('naming');
  };

  const handleNamingConfirm = () => {
    if (!namingInput.trim()) return;
    addFeedbackFile(namingFile.file, namingInput);
  };

  const fileModalTitle = (() => {
    if (fileModalView === 'record') return '음성 녹음';
    if (fileModalView === 'naming') return '파일 이름 입력';
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
          const namedFile = new File([pf.file], pf.name, { type: pf.file.type });
          const { fileUploadId } = await uploadTeacherFile(namedFile);
          uploadedFiles.push({ fileUploadId, fileName: pf.name });
        }
        if (hw.feedbackFiles?.length > 0) {
          const freshPage = await getHomeworkPage(id);
          existingFiles = freshPage.properties['피드백 파일']?.files ?? [];
        }
      }

      await saveFeedback(id, { feedbackText, files: uploadedFiles, existingFiles });
      // 새 피드백 파일이 실제로 업로드된 경우에만 학생에게 알림톡 발송
      if (uploadedFiles && uploadedFiles.length > 0) {
        notifyHomework('feedback', id);
      }
      setSavedFeedbackText(feedbackText);
      setPendingFeedbackFiles([]);
      closeFileModal();
      await load();
    } catch (e) {
      message.error(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFeedbackFile = async (fileIndex) => {
    setDeleteFileConfirmIndex(null);
    setDeletingFeedbackFileName(fileIndex);
    try {
      const freshPage = await getHomeworkPage(id);
      const existingFiles = (freshPage.properties['피드백 파일']?.files ?? [])
        .filter((_, i) => i !== fileIndex);
      await saveFeedback(id, { feedbackText, files: [], existingFiles });
      await load();
    } catch (e) {
      message.error(`삭제 실패: ${e.message}`);
    } finally {
      setDeletingFeedbackFileName(null);
    }
  };

  const handleSaveFeedback = async () => {
    if (!feedbackText.trim() && pendingFeedbackFiles.length === 0 && !hw?.feedbackFiles?.length) {
      message.error('피드백 텍스트 또는 음성 파일을 입력해주세요.');
      return;
    }
    await uploadAndSave(pendingFeedbackFiles);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteHomework(id);
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

        {/* 학생 제출 파일 */}
        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
          <SectionHeading style={{ marginBottom: 12 }}>학생 제출 파일</SectionHeading>
          {hw.submitFiles?.length > 0 ? (
            <>
              {hw.submitFiles.map((f, i) => (
                <div key={i} style={{ marginBottom: i < hw.submitFiles.length - 1 ? 8 : 0 }}>
                  <AudioPlayer
                    url={f.url}
                    fileName={f.name}
                    onGetFreshUrl={async () => {
                      const parsed = await getFreshParsed();
                      return parsed.submitFiles?.[i]?.url ?? null;
                    }}
                  />
                </div>
              ))}
              {hw.submitDate && (
                <p style={{ fontSize: 13, color: TEXT_TERTIARY, marginTop: 8, margin: '8px 0 0' }}>
                  제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
                </p>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0', color: TEXT_DISABLED, fontSize: 13 }}>
              아직 제출하지 않았습니다
            </div>
          )}
        </Card>

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

          {/* 기존 피드백 파일 (저장된 것) */}
          {hw.feedbackFiles?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 6px', fontWeight: 600 }}>
                기존 피드백 파일 ({hw.feedbackFiles.length}개)
              </p>
              {hw.feedbackFiles.map((f, i) => (
                <div key={i} style={{ marginBottom: i < hw.feedbackFiles.length - 1 ? 6 : 0 }}>
                  <AudioPlayer
                    url={f.url}
                    fileName={f.name}
                    onGetFreshUrl={async () => {
                      const parsed = await getFreshParsed();
                      return parsed.feedbackFiles?.[i]?.url ?? null;
                    }}
                    onDelete={() => setDeleteFileConfirmIndex(i)}
                    deleteDisabled={deletingFeedbackFileName !== null}
                  />
                </div>
              ))}
              {hw.feedbackDate && (
                <p style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '6px 0 0' }}>
                  피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
                </p>
              )}
            </div>
          )}

          {/* 새로 추가할 피드백 파일 목록 */}
          {pendingFeedbackFiles.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                새 피드백 파일 ({pendingFeedbackFiles.length}/{MAX_FILES})
              </p>
              {pendingFeedbackFiles.map((pf) => (
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
                    onClick={() => removeFeedbackFile(pf.tempId)}
                    style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                    aria-label="삭제"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* 파일 추가 버튼 → 모달 오픈 */}
          {!saving && pendingFeedbackFiles.length < MAX_FILES && (
            <button
              type="button"
              onClick={openFileModal}
              className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
              style={{
                width: '100%', height: 44, borderRadius: 12,
                background: PRIMARY_BG, border: '1.5px solid rgba(127,0,5,0.2)',
                color: PRIMARY, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent', marginBottom: 12,
              }}
            >
              피드백 파일 추가
            </button>
          )}

          <Button
            type="primary"
            block
            onClick={handleSaveFeedback}
            loading={saving}
            style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
          >
            피드백 저장{pendingFeedbackFiles.length > 0 ? ` (${pendingFeedbackFiles.length}개 파일)` : ''}
          </Button>
        </Card>
      </div>

      {/* ===== 피드백 파일 추가 팝업 ===== */}
      <Modal
        open={fileModalOpen}
        onCancel={closeFileModal}
        footer={null}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {fileModalView !== 'list' && (
              <button
                type="button"
                onClick={() => setFileModalView('list')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_SECONDARY, padding: '0 4px 0 0', display: 'flex', alignItems: 'center' }}
                aria-label="뒤로"
              ><ArrowLeftIcon size={18} weight="bold" /></button>
            )}
            <span style={{ fontSize: 16, fontWeight: 700 }}>{fileModalTitle}</span>
          </div>
        }
        centered
        destroyOnHide
        styles={{ body: { paddingTop: 8, paddingBottom: 4 } }}
      >
        <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFilePickChange} />

        {/* list 뷰 */}
        {fileModalView === 'list' && (
          <div>
            {pendingFeedbackFiles.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>
                  새로 추가할 파일 ({pendingFeedbackFiles.length}개)
                </p>
                {pendingFeedbackFiles.map((pf) => (
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
                      onClick={() => removeFeedbackFile(pf.tempId)}
                      style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEXT_DISABLED, fontSize: 18, flexShrink: 0, padding: 0, lineHeight: 1 }}
                      aria-label="삭제"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {pendingFeedbackFiles.length < MAX_FILES && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
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
                  onClick={() => setFileModalView('record')}
                  className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
                  style={{
                    flex: 1, height: 44, borderRadius: 12,
                    background: PRIMARY, border: 'none', color: 'white',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  바로 녹음
                </button>
              </div>
            )}
          </div>
        )}

        {/* record 뷰 */}
        {fileModalView === 'record' && (
          <AudioRecorder
            defaultName={genFeedbackName(hw?.title ?? '숙제', (hw?.feedbackFiles?.length ?? 0) + pendingFeedbackFiles.length + 1)}
            onFile={(file) => {
              const safeName = file.name.replace(/\.[^/.]+$/, '');
              closeFileModal();
              uploadAndSave([...pendingFeedbackFiles, { tempId: Date.now(), file, name: safeName }]);
            }}
            onCancel={() => setFileModalView('list')}
            hideCancel
          />
        )}

        {/* naming 뷰 */}
        {fileModalView === 'naming' && namingFile && (
          <div>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 8px' }}>파일 이름을 입력하세요</p>
            <input
              type="text"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNamingConfirm()}
              maxLength={50}
              autoFocus
              style={{
                width: '100%', height: 44, borderRadius: 12, border: '1.5px solid #d9d9d9',
                padding: '0 14px', fontSize: 15, color: TEXT_PRIMARY,
                boxSizing: 'border-box', outline: 'none', marginBottom: 12,
              }}
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

      {/* 파일 업로드/삭제 중 딤 오버레이 */}
      {(saving || deletingFeedbackFileName !== null) && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <Spin size="large" />
        </div>
      )}

      {deleteFileConfirmIndex !== null && (
        <ConfirmDialog
          title="피드백 파일을 삭제할까요?"
          message={`${hw?.feedbackFiles?.[deleteFileConfirmIndex]?.name?.replace(/\.[^/.]+$/, '') ?? '파일'}을 삭제합니다. 삭제 후에는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          onConfirm={() => handleDeleteFeedbackFile(deleteFileConfirmIndex)}
          onCancel={() => setDeleteFileConfirmIndex(null)}
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
