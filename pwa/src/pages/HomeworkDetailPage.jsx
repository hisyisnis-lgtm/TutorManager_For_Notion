import {
  useState,
  useEffect,
  useRef,
  useCallback } from 'react';
import { toast } from 'sonner';
import { useParams,
  useNavigate } from 'react-router-dom';
import { CircleNotchIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import { Card, CardContent } from '../components/shadcn/card';
import { Textarea } from '../components/shadcn/textarea';
import { MicrophoneIcon,
  ImageSquareIcon,
  ClipboardTextIcon,
  PaperPlaneTiltIcon,
  ChatTeardropTextIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import AutoLink from '../components/ui/AutoLink.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import Badge from '../components/ui/Badge.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import SectionEntryButton from '../components/ui/SectionEntryButton.jsx';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  BORDER_DEFAULT,
  INK_900,
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_BORDER } from '../constants/theme.js';
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
import { invalidateCache } from '../hooks/useCachedResource.js';
import useFileAttach, { MAX_FILES } from '../hooks/useFileAttach.js';
import { useData } from '../context/DataContext.jsx';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import {
  dedupeFileNames,
  isImageByName,
  isPdfByName,
} from '../utils/audioFile.js';

function genFeedbackName(title, index) {
  // 한자(\p{Script=Han})도 보존 — "声调练习" 같은 중국어 제목이 통째로 지워지지 않게
  const base = title.replace(/[^\w가-힣\p{Script=Han}]/gu, '').slice(0, 20) || '숙제';
  return `${base}_피드백_${String(index).padStart(2, '0')}`;
}

export default function HomeworkDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { studentNameMap } = useData();

  const [hw, setHw] = useState(null);
  const [studentName, setStudentName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');

  // 외부 저장 대기 — 카테고리별 분리
  const [pendingFeedbackAudio, setPendingFeedbackAudio] = useState([]);
  const [pendingFeedbackDocs, setPendingFeedbackDocs] = useState([]);

  const [saving, setSaving] = useState(false);
  const [deletingFeedbackFileName, setDeletingFeedbackFileName] = useState(null);
  const [deleteFileConfirmName, setDeleteFileConfirmName] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedFeedbackText, setSavedFeedbackText] = useState('');

  const pendingTotal = pendingFeedbackAudio.length + pendingFeedbackDocs.length;
  const isDirty = feedbackText !== savedFeedbackText || pendingTotal > 0;
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingNavRef = useRef(null);

  // 브라우저 뒤로가기 차단 (HashRouter는 useBlocker 미지원)
  // ⚠️ 이탈 결정 후의 pop이 만드는 popstate에 또 navigate(-1)을 쏘면 pop이 초과되어
  // 문서 전체 리로드가 걸렸다(학생 페이지와 동일 패턴·해법, 2026-08-31):
  // pushedRef = 쌓인 더미 개수(StrictMode는 2개) · leave() 한 번으로 이탈 · leavingRef로 이탈 pop 무시.
  const leavingRef = useRef(false);
  const pushedRef = useRef(0);
  const leave = useCallback(() => {
    leavingRef.current = true;
    navigate(-(pushedRef.current + 1));
  }, [navigate]);
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    pushedRef.current += 1;
    const onPopState = () => {
      if (leavingRef.current) return;
      pushedRef.current -= 1; // 방금 pop으로 더미 하나 소진
      if (isDirtyRef.current) {
        window.history.pushState(null, '', window.location.href);
        pushedRef.current += 1;
        setShowLeaveConfirm(true);
        pendingNavRef.current = leave;
      } else {
        leave();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate, leave]);

  const handleBack = () => {
    if (isDirtyRef.current) {
      setShowLeaveConfirm(true);
      pendingNavRef.current = leave;
    } else {
      leave();
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
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // 학생 이름은 캐시(DataContext)에서 파생 — getPage(학생) 왕복 제거.
  useEffect(() => {
    const sid = hw?.studentIds?.[0];
    if (!sid) return;
    const nm = studentNameMap[sid] || '';
    setStudentName(nm.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim());
  }, [hw, studentNameMap]);

  const getFreshParsed = useCallback(async () => {
    const page = await getPage(id);
    return parseHomework(page);
  }, [id]);

  const fixedCount = (hw?.feedbackFiles?.length ?? 0) + pendingFeedbackAudio.length + pendingFeedbackDocs.length;

  // 파일 첨부 모달 로직 — 공용 훅 (state·picker·검증·이름 짓기)
  const attach = useFileAttach({
    genName: (index) => genFeedbackName(hw?.title ?? '숙제', index),
    fixedCount,
    onConfirm: (kind, files) => {
      if (kind === 'audio') {
        setPendingFeedbackAudio((prev) => [...prev, ...files]);
      } else if (kind === 'document') {
        setPendingFeedbackDocs((prev) => [...prev, ...files]);
      }
    },
  });
  const { openModal, closeModal } = attach;

  const removePendingAudio = (tempId) => setPendingFeedbackAudio((prev) => prev.filter((f) => f.tempId !== tempId));
  const removePendingDoc = (tempId) => setPendingFeedbackDocs((prev) => prev.filter((f) => f.tempId !== tempId));

  const uploadAndSave = async (files) => {
    setSaving(true);
    try {
      let uploadedFiles;
      let existingFiles;

      if (files.length > 0) {
        // 동명 파일 충돌 방지 — 기존 피드백 파일 + 새 파일 이름을 합쳐 유일화한다.
        // (다운로드/미리보기가 파일을 이름으로 찾으므로 같은 이름이면 전부 첫 번째로만 조회됨)
        // 기존 이름은 보존되고 새 파일에만 ` (2)` 접미사가 붙는다. 서버도 saveFeedback 후 한 번 더 dedup 가능.
        const existingNames = (hw?.feedbackFiles ?? []).map((f) => f.name);
        const allNames = dedupeFileNames([...existingNames, ...files.map((pf) => pf.baseName + pf.ext)]);
        const newNames = allNames.slice(existingNames.length);
        // 여러 파일은 순차 대신 동시 업로드(업로드는 토큰버킷과 무관한 별도 엔드포인트).
        uploadedFiles = await Promise.all(files.map((pf, i) => {
          const fullName = newNames[i];
          // 원본 File 그대로 전달하고 이름만 지정 — 재포장하면 안드로이드에서 뒤가 잘린다.
          return uploadTeacherFile(pf.file, fullName).then(({ fileUploadId }) => ({ fileUploadId, fileName: fullName }));
        }));
        if (hw.feedbackFiles?.length > 0) {
          const freshPage = await getPage(id);
          existingFiles = freshPage.properties['피드백 파일']?.files ?? [];
        }
      }

      await saveFeedback(id, { feedbackText, files: uploadedFiles, existingFiles });
      // 알림톡 발송 조건: 새 파일을 첨부했거나, 피드백 텍스트가 새로 작성/변경된 경우.
      // 텍스트가 그대로인 재저장(파일 삭제·오타 미수정 등)은 중복 발송 방지를 위해 제외.
      const hasNewFiles = uploadedFiles && uploadedFiles.length > 0;
      const hasNewText = feedbackText.trim() && feedbackText.trim() !== savedFeedbackText.trim();
      if (hasNewFiles || hasNewText) {
        notifyHomework('feedback', id);
      }
      // 저장 성공 → 재조회 없이 결과를 즉시 반영(낙관적). 저장에 필요한 왕복은 PATCH 1번뿐.
      // (재조회를 안 하므로 Notion read-after-write 지연에 옛값으로 덮일 위험도 없음)
      const savedFiles = hasNewFiles
        ? [
            ...(hw?.feedbackFiles ?? []),
            ...uploadedFiles.map(({ fileName }) => ({ name: fileName, url: null })),
          ]
        : (hw?.feedbackFiles ?? []);
      setHw((prev) => (prev ? {
        ...prev,
        feedbackText,
        status: '피드백완료',
        feedbackDate: new Date().toISOString(),
        feedbackFiles: savedFiles,
      } : prev));
      setSavedFeedbackText(feedbackText);
      setPendingFeedbackAudio([]);
      setPendingFeedbackDocs([]);
      invalidateCache('homework'); // 홈 '피드백 대기'·숙제 관리 카운트 stale 방지
      closeModal();
    } catch (e) {
      toast.error(`저장 실패: ${e.message}`);
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
      // filesOnly: 파일 삭제가 입력 중 텍스트 커밋·피드백일 리셋·상태 변경을 일으키지 않게
      await saveFeedback(id, { files: [], existingFiles, filesOnly: true });
      await load();
    } catch (e) {
      toast.error(`삭제 실패: ${e.message}`);
    } finally {
      setDeletingFeedbackFileName(null);
    }
  };

  const handleSaveFeedback = async () => {
    if (!feedbackText.trim() && pendingTotal === 0 && !hw?.feedbackFiles?.length) {
      toast.error('피드백 텍스트 또는 파일을 입력해주세요.');
      return;
    }
    await uploadAndSave([...pendingFeedbackAudio, ...pendingFeedbackDocs]);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      invalidateCache('homework');
      navigate(-1);
    } catch (e) {
      toast.error(`삭제 실패: ${e.message}`);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="숙제 상세" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="숙제 상세" back /><ErrorMessage message={error} /></>;
  if (!hw) return null;

  const { bg, text } = homeworkStatusColor(hw.status);

  // 저장본 카테고리 분리 — PDF/이미지가 아닌 모든 파일은 녹음 섹션으로 (옛 데이터 누락 방지)
  const isDoc = (f) => isImageByName(f.name) || isPdfByName(f.name);
  const submitAudio = (hw.submitFiles ?? []).filter((f) => !isDoc(f));
  const submitDocs = (hw.submitFiles ?? []).filter(isDoc);
  const feedbackAudio = (hw.feedbackFiles ?? []).filter((f) => !isDoc(f));
  const feedbackDocs = (hw.feedbackFiles ?? []).filter(isDoc);

  const renderSubmitFile = (f, idx = 0) => (
    <FilePreview
      key={`submit-${idx}-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const parsed = await getFreshParsed();
        return parsed.submitFiles?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileTeacher(id, f.name, 'submit')}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlTeacher(id, f.name, 'submit')}
    />
  );

  // 과제 파일 — 강사 본인이 등록한 출제 파일. 다운로드만 노출 (편집은 미지원).
  const renderAssignmentFile = (f, idx = 0) => (
    <FilePreview
      key={`assignment-${idx}-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const parsed = await getFreshParsed();
        return parsed.assignmentFiles?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileTeacher(id, f.name, 'assignment')}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlTeacher(id, f.name, 'assignment')}
    />
  );

  const renderFeedbackFile = (f, idx = 0) => (
    <FilePreview
      key={`feedback-${idx}-${f.name}`}
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
          <Button variant="destructiveOutline" onClick={() => setShowDeleteConfirm(true)}>
            삭제
          </Button>
        }
      />

      <div className="px-4 pt-4 pb-24">
        {/* 상단 묶음: 학생명 + 타이틀 + 뱃지 */}
        <div style={{ paddingBottom: 16, marginBottom: 8, borderBottom: `1px solid ${BORDER_DEFAULT}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            {studentName && <div style={{ fontSize: 20, fontWeight: 600, color: TEXT_SECONDARY, lineHeight: 1.2 }}>{studentName}</div>}
            <div style={{ fontSize: 20, fontWeight: 600, color: TEXT_PRIMARY, lineHeight: 1.2 }}>{hw.title}</div>
          </div>
          <Badge label={hw.status} bg={bg} text={text} style={{ fontSize: 15, padding: '4px 12px', borderRadius: 10, flexShrink: 0, marginTop: 2 }} />
        </div>

        {/* ===== 1. 부여한 숙제 ===== */}
        <AreaHeading icon={<ClipboardTextIcon size={20} weight="fill" />} label="부여한 숙제" first />
        {hw.content && (
          <Card className="mb-3">
            <CardContent className="p-4">
            <SectionHeading style={{ marginBottom: 8 }}>숙제 내용</SectionHeading>
            <p style={{ fontSize: 14, color: INK_900, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}><AutoLink text={hw.content} /></p>
            </CardContent>
          </Card>
        )}
        {hw.assignmentFiles?.length > 0 && (
          <Card className="mb-3">
            <CardContent className="p-4">
            <SectionHeading style={{ marginBottom: 12 }}>숙제 파일</SectionHeading>
            {hw.assignmentFiles.map((f, i) => (
              <div key={`assignment-${i}-${f.name}`} style={{ marginBottom: i < hw.assignmentFiles.length - 1 ? 8 : 0 }}>
                {renderAssignmentFile(f, i)}
              </div>
            ))}
            </CardContent>
          </Card>
        )}

        {/* ===== 2. 학생 제출 ===== */}
        <AreaHeading icon={<PaperPlaneTiltIcon size={20} weight="fill" />} label="학생 제출" />
        {(submitAudio.length > 0 || submitDocs.length > 0) ? (
          <Card className="mb-3">
            <CardContent className="p-4">
            <SectionHeading style={{ marginBottom: 12 }}>학생 제출 파일</SectionHeading>
            {[...submitAudio, ...submitDocs].map((f, i, arr) => (
              <div key={`submit-${i}-${f.name}`} style={{ marginBottom: i < arr.length - 1 ? 8 : 0 }}>
                {renderSubmitFile(f, i)}
              </div>
            ))}
            {hw.submitDate && (
              <p style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '8px 0 0' }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-3">
            <CardContent className="p-4">
            <div style={{ textAlign: 'center', padding: '20px 0', color: TEXT_DISABLED, fontSize: 13 }}>
              아직 제출하지 않았습니다
            </div>
            </CardContent>
          </Card>
        )}

        {/* ===== 3. 피드백 ===== */}
        <AreaHeading icon={<ChatTeardropTextIcon size={20} weight="fill" />} label="피드백" />
        <Card>
          <CardContent className="p-4">
          <div style={{ marginBottom: 12 }}>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="텍스트 피드백을 입력하세요"
              rows={4}
              maxLength={2000}
            />
            <div style={{ textAlign: 'right', fontSize: 12, color: TEXT_TERTIARY, marginTop: 4 }}>
              <span className="tabular-nums">{feedbackText.length}</span> / 2000
            </div>
          </div>

          {/* 기존 피드백 파일 — 녹음·이미지·PDF 통합 표시 (카테고리 라벨 없이 한 목록) */}
          {(feedbackAudio.length > 0 || feedbackDocs.length > 0) && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 6px', fontWeight: 600 }}>
                기존 피드백 파일 ({feedbackAudio.length + feedbackDocs.length}개)
              </p>
              {[...feedbackAudio, ...feedbackDocs].map((f, i, arr) => (
                <div key={`feedback-${i}-${f.name}`} style={{ marginBottom: i < arr.length - 1 ? 6 : 0 }}>
                  {renderFeedbackFile(f, i)}
                </div>
              ))}
            </div>
          )}

          {/* 새 추가 업로드 — 카테고리별 분리 유지 (모달이 카테고리별로 다름) */}
          {pendingFeedbackAudio.length > 0 && (
            <PendingCard
              label={`새 녹음 파일 (${pendingFeedbackAudio.length}/${MAX_FILES})`}
              items={pendingFeedbackAudio}
              onRemove={removePendingAudio}
            />
          )}
          {!saving && fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<MicrophoneIcon size={20} weight="fill" />}
              label="녹음 파일 추가"
              onClick={() => openModal('audio')}
            />
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
              icon={<ImageSquareIcon size={20} weight="fill" />}
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
            block
            onClick={handleSaveFeedback}
            loading={saving}
          >
            피드백 저장{pendingTotal > 0 ? ` (${pendingTotal}개 파일)` : ''}
          </Button>
          </CardContent>
        </Card>
      </div>

      {/* ===== 파일 추가 팝업 — 공용 모달 (kind 분기) ===== */}
      <FileAttachModal
        attach={attach}
        titles={{ audio: '녹음 파일', document: '이미지·PDF', fallback: '피드백 파일' }}
        hints={{
          audio: '추가할 녹음 파일을 선택하거나 직접 녹음해주세요',
          document: '추가할 이미지 또는 PDF 파일을 선택해주세요',
        }}
      />

      {/* 업로드/삭제 중 딤 오버레이 */}
      {(saving || deletingFeedbackFileName !== null) && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <CircleNotchIcon size={24} weight="bold" className="animate-spin" aria-hidden />
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

// 3영역(부여한 숙제 / 학생 제출 / 피드백) 시각 구분용 헤더.
// 아이콘 + 텍스트, 영역 사이 24px 여백. 첫 영역은 marginTop 0.
function AreaHeading({ icon, label, first }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginTop: first ? 0 : 24,
      marginBottom: 10,
      color: TEXT_SECONDARY,
    }}>
      {icon}
      <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

function PendingCard({ label, items, onRemove }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: '0 0 6px' }}>{label}</p>
      {items.map((pf) => (
        <div key={pf.tempId} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: STATUS_SUCCESS_BG, border: `1px solid ${STATUS_SUCCESS_BORDER}`,
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

