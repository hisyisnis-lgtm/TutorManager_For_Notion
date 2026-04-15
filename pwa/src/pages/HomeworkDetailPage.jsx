import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Card, message } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import AudioPlayer from '../components/ui/AudioPlayer.jsx';
import AudioRecorder from '../components/ui/AudioRecorder.jsx';
import Badge from '../components/ui/Badge.jsx';
import { getHomeworkPage, parseHomework, saveFeedback, deleteHomework, uploadTeacherFile, homeworkStatusColor } from '../api/homework.js';

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

const MAX_FILES = 5;

function genFeedbackName(title, index) {
  const base = title.replace(/[^\w가-힣]/g, '').slice(0, 20) || '숙제';
  return `${base}_피드백_${String(index).padStart(2, '0')}`;
}

export default function HomeworkDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  // pendingFeedbackFiles: [{tempId, file, name}] — 저장 전 로컬 목록
  const [pendingFeedbackFiles, setPendingFeedbackFiles] = useState([]);
  const [showRecorder, setShowRecorder] = useState(false);
  const [namingFile, setNamingFile] = useState(null);
  const [namingInput, setNamingInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getHomeworkPage(id);
      const parsed = parseHomework(page);
      setHw(parsed);
      setFeedbackText(parsed.feedbackText || '');
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

  const addFeedbackFile = (file, name) => {
    const safeName = (name || '').trim();
    setPendingFeedbackFiles((prev) => [
      ...prev,
      { tempId: Date.now() + Math.random(), file, name: safeName },
    ]);
    setShowRecorder(false);
    setNamingFile(null);
  };

  const removeFeedbackFile = (tempId) => {
    setPendingFeedbackFiles((prev) => prev.filter((f) => f.tempId !== tempId));
  };

  const handleFilePickChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const nextIndex = pendingFeedbackFiles.length + 1;
    setNamingInput(genFeedbackName(hw?.title ?? '숙제', nextIndex));
    setNamingFile({ file });
  };

  const handleSaveFeedback = async () => {
    if (!feedbackText.trim() && pendingFeedbackFiles.length === 0 && !hw?.feedbackFiles?.length) {
      message.error('피드백 텍스트 또는 음성 파일을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      let uploadedFiles;
      let existingFiles;

      if (pendingFeedbackFiles.length > 0) {
        // 새 파일 업로드
        uploadedFiles = [];
        for (const pf of pendingFeedbackFiles) {
          const namedFile = new File([pf.file], pf.name, { type: pf.file.type });
          const { fileUploadId } = await uploadTeacherFile(namedFile);
          uploadedFiles.push({ fileUploadId, fileName: pf.name });
        }

        // 기존 피드백 파일 보존: fresh URL 재조회 후 포함
        if (hw.feedbackFiles?.length > 0) {
          const fresh = await getFreshParsed();
          existingFiles = fresh.feedbackFiles
            .filter((f) => f.url)
            .map((f) => ({ name: f.name, url: f.url }));
        }
      }

      await saveFeedback(id, { feedbackText, files: uploadedFiles, existingFiles });
      setPendingFeedbackFiles([]);
      await load();
    } catch (e) {
      message.error(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
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
        title={hw.title}
        back
        action={
          <Button danger onClick={() => setShowDeleteConfirm(true)} style={{ borderRadius: 12, fontWeight: 500 }}>
            삭제
          </Button>
        }
      />

      <div className="px-5 pt-4 pb-24 space-y-4">
        {/* 상태 + 과제 내용 */}
        <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
          <div className="flex items-center justify-between mb-3">
            <span style={{ fontSize: 13, color: '#595959' }}>제출 상태</span>
            <Badge label={hw.status} bg={bg} text={text} />
          </div>
          {hw.content && (
            <>
              <p style={{ fontSize: 12, color: '#595959', marginBottom: 4 }}>과제 내용</p>
              <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{hw.content}</p>
            </>
          )}
        </Card>

        {/* 학생 제출 파일 */}
        <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', marginBottom: 12 }}>학생 제출 파일</p>
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
                <p style={{ fontSize: 12, color: '#767676', marginTop: 8 }}>
                  제출일: {formatDateTime(hw.submitDate)}
                </p>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#bfbfbf', fontSize: 13 }}>
              아직 제출하지 않았습니다
            </div>
          )}
        </Card>

        {/* 피드백 */}
        <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', marginBottom: 12 }}>피드백</p>

          <div style={{ marginBottom: 12 }}>
            <Input.TextArea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="텍스트 피드백을 입력하세요"
              rows={4}
              maxLength={2000}
              style={{ borderRadius: 12 }}
            />
            <div style={{ textAlign: 'right', fontSize: 12, color: '#767676', marginTop: 4 }}>
              <span className="tabular-nums">{feedbackText.length}</span> / 2000
            </div>
          </div>

          {/* 기존 피드백 파일 (저장된 것) */}
          {hw.feedbackFiles?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: '#595959', margin: '0 0 6px', fontWeight: 600 }}>
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
                  />
                </div>
              ))}
              {hw.feedbackDate && (
                <p style={{ fontSize: 12, color: '#767676', marginTop: 6 }}>
                  피드백일: {formatDateTime(hw.feedbackDate)}
                </p>
              )}
            </div>
          )}

          {/* 새로 추가할 피드백 파일 목록 */}
          <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleFilePickChange} />

          {pendingFeedbackFiles.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#595959', margin: '0 0 6px' }}>
                새 피드백 파일 ({pendingFeedbackFiles.length}/{MAX_FILES})
              </p>
              {pendingFeedbackFiles.map((pf) => (
                <div key={pf.tempId} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', background: '#f6ffed', border: '1px solid #b7eb8f',
                  borderRadius: 8, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 13, color: '#1d1d1f', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    🎵 {pf.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFeedbackFile(pf.tempId)}
                    style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#767676', fontSize: 16, flexShrink: 0, padding: '0 2px' }}
                    aria-label="삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 파일 이름 입력 (파일 선택 후) */}
          {namingFile && !showRecorder && (
            <div style={{ background: '#f9f9f9', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#595959', margin: '0 0 6px' }}>파일 이름</p>
              <input
                type="text"
                aria-label="파일 이름"
                value={namingInput}
                onChange={(e) => setNamingInput(e.target.value)}
                maxLength={50}
                autoFocus
                style={{
                  width: '100%', height: 40, borderRadius: 12, border: '1.5px solid #d9d9d9',
                  padding: '0 12px', fontSize: 14, color: '#1d1d1f',
                  boxSizing: 'border-box', outline: 'none', marginBottom: 8,
                }}
                onFocus={(e) => e.target.select()}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setNamingFile(null)}
                  style={{ flex: 1, height: 38, borderRadius: 12, background: 'white', border: '1.5px solid #d9d9d9', color: '#595959', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => addFeedbackFile(namingFile.file, namingInput)}
                  disabled={!namingInput.trim()}
                  style={{ flex: 2, height: 38, borderRadius: 12, background: namingInput.trim() ? '#7f0005' : '#f5f5f5', border: 'none', color: namingInput.trim() ? 'white' : '#bfbfbf', fontSize: 13, fontWeight: 600, cursor: namingInput.trim() ? 'pointer' : 'not-allowed' }}
                >
                  추가
                </button>
              </div>
            </div>
          )}

          {/* 녹음 컴포넌트 */}
          {showRecorder && (
            <div style={{ marginBottom: 10 }}>
              <AudioRecorder
                defaultName={genFeedbackName(hw.title, pendingFeedbackFiles.length + 1)}
                onFile={(file) => addFeedbackFile(file, file.name.replace(/\.[^/.]+$/, ''))}
                onCancel={() => setShowRecorder(false)}
              />
            </div>
          )}

          {/* 파일 추가 버튼 */}
          {!saving && !namingFile && !showRecorder && pendingFeedbackFiles.length < MAX_FILES && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  flex: 1, height: 42, borderRadius: 12,
                  border: '1.5px solid #d9d9d9', background: '#fafafa',
                  fontSize: 13, color: '#595959', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                📁 파일 추가
              </button>
              <button
                type="button"
                onClick={() => setShowRecorder(true)}
                style={{
                  flex: 1, height: 42, borderRadius: 12,
                  border: '1.5px solid #7f0005', background: '#fff0f1',
                  fontSize: 13, color: '#7f0005', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  fontWeight: 600, WebkitTapHighlightColor: 'transparent',
                }}
              >
                🎤 바로 녹음
              </button>
            </div>
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

      {showDeleteConfirm && (
        <ConfirmDialog
          title="숙제를 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}
