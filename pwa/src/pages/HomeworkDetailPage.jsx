import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { CaretLeftIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import { Textarea } from '../components/shadcn/textarea';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import AutoLink from '../components/ui/AutoLink.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import HomeworkProgressOverlay from '../components/homework/HomeworkProgressOverlay.jsx';
import HomeworkAttachmentFields from '../components/homework/HomeworkAttachmentFields.jsx';
import HomeworkCompleteScreen from '../components/homework/HomeworkCompleteScreen.jsx';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';
import {
  parseHomework, saveFeedback, uploadTeacherFile, notifyHomework,
  downloadHomeworkFileTeacher, fetchHomeworkFileBlobUrlTeacher, fetchHomeworkFileSizesTeacher,
} from '../api/homework.js';
import { getPage, deletePage } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { captureAuthScope, isAuthScopeCurrent } from '../api/authState.js';
import useFileAttach from '../hooks/useFileAttach.js';
import useUnsavedChanges from '../hooks/useUnsavedChanges.js';
import { MAX_FILES } from '../utils/homeworkLimits.js';
import { useData } from '../context/DataContext.jsx';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import { dedupeFileNames } from '../utils/audioFile.js';

function genFeedbackName(title, index) {
  const base = title.replace(/[^\w가-힣\p{Script=Han}]/gu, '').slice(0, 20) || '숙제';
  return `${base}_피드백_${String(index).padStart(2, '0')}`;
}

export default function HomeworkDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { studentNameMap } = useData();
  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [savedFeedbackText, setSavedFeedbackText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [deletedFileNames, setDeletedFileNames] = useState([]);
  const [view, setView] = useState('detail');
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const uploadedRef = useRef(new Map());
  const operationRef = useRef(0);
  const requestRef = useRef(0);
  const cancelPreparationRef = useRef(null);
  const closeAttachmentRef = useRef(null);
  const pageHeadingRef = useRef(null);
  const viewRef = useRef(view);
  const savingRef = useRef(saving);
  viewRef.current = view;
  savingRef.current = saving;

  const isDirty = feedbackText !== savedFeedbackText || pendingFiles.length > 0 || deletedFileNames.length > 0;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const leaveGuard = useUnsavedChanges(isDirty || saving || view === 'edit');
  const leaveGuardRef = useRef(leaveGuard);
  leaveGuardRef.current = leaveGuard;
  const { showLeaveConfirm } = leaveGuard;
  const retainedFiles = (hw?.feedbackFiles ?? []).filter(file => !deletedFileNames.includes(file.name));
  const hasFeedback = !!(hw?.feedbackText?.trim() || hw?.feedbackFiles?.length || hw?.feedbackDate);

  useEffect(() => {
    if (view === 'complete' || view === 'updated') return;
    window.scrollTo?.({ top: 0, behavior: 'instant' });
    pageHeadingRef.current?.focus({ preventScroll: true });
  }, [view, loading]);

  const resetDraft = useCallback(() => {
    operationRef.current += 1;
    cancelPreparationRef.current?.();
    uploadedRef.current.clear();
    setFeedbackText(savedFeedbackText);
    setPendingFiles([]);
    setDeletedFileNames([]);
    setSaving(false);
    setSaveProgress(null);
    setView('detail');
    viewRef.current = 'detail';
    isDirtyRef.current = false;
  }, [savedFeedbackText]);

  // data router의 history index는 그대로 둔다. 실제 브라우저 POP만 관찰해
  // 편집 → 상세로 흡수하고 BottomNav 같은 앱 이동은 기존 이탈 가드로 보호한다.
  const browserPopRef = useRef(false);
  const locationKeyRef = useRef(location.key);
  locationKeyRef.current = location.key;
  useEffect(() => {
    const onPopState = event => {
      // 차단을 되돌리는 복원 POP가 먼저 도착해도, 아직 처리하지 않은 원래 POP는 유지한다.
      if (event.state?.key !== locationKeyRef.current) browserPopRef.current = true;
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, []);
  useEffect(() => {
    if (!showLeaveConfirm || !browserPopRef.current) return;
    browserPopRef.current = false;
    if (viewRef.current === 'edit' && !savingRef.current) {
      leaveGuard.cancelLeave();
      setView('detail');
    }
  }, [showLeaveConfirm, leaveGuard]);

  const finish = () => {
    leaveGuard.markSaved();
    navigate('/homework', { replace: true });
  };

  const handleBack = () => {
    if (viewRef.current === 'complete' || viewRef.current === 'updated') { finish(); return; }
    if (savingRef.current) {
      leaveGuard.requestLeave(resetDraft);
    } else if (viewRef.current === 'edit') setView('detail');
    else leaveGuard.requestLeave(() => navigate(-1));
  };

  useEffect(() => {
    if (showLeaveConfirm && !saving && !isDirty && view !== 'edit') leaveGuard.cancelLeave();
  }, [showLeaveConfirm, saving, isDirty, view, leaveGuard]);

  const load = useCallback(async () => {
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    const request = ++requestRef.current;
    const current = () => request === requestRef.current && isAuthScopeCurrent(auth);
    setLoading(true);
    setError(null);
    try {
      const parsed = parseHomework(await getPage(id));
      if (!current()) return;
      setHw(parsed);
      setFeedbackText(parsed.feedbackText || '');
      setSavedFeedbackText(parsed.feedbackText || '');
    } catch (e) {
      if (current()) setError(e.message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // 같은 /homework/:id 컴포넌트가 재사용되어도 이전 숙제의 초안은 넘기지 않는다.
    // clean/detail 렌더가 이탈 가드의 일회성 허용 상태도 다시 잠근다.
    operationRef.current += 1;
    cancelPreparationRef.current?.();
    closeAttachmentRef.current?.();
    uploadedRef.current.clear();
    leaveGuardRef.current.cancelLeave();
    browserPopRef.current = false;
    isDirtyRef.current = false;
    viewRef.current = 'detail';
    savingRef.current = false;
    setHw(null);
    setFeedbackText('');
    setSavedFeedbackText('');
    setPendingFiles([]);
    setDeletedFileNames([]);
    setView('detail');
    setSaving(false);
    setSaveProgress(null);
    setShowDeleteConfirm(false);
    setDeleting(false);
    load();
    return () => { requestRef.current += 1; operationRef.current += 1; cancelPreparationRef.current?.(); };
  }, [load]);

  const getFreshParsed = useCallback(async () => parseHomework(await getPage(id)), [id]);
  const attach = useFileAttach({
    directSelection: true,
    genName: index => genFeedbackName(hw?.title ?? '숙제', index),
    fixedFiles: [...retainedFiles, ...pendingFiles],
    loadFileSizes: () => fetchHomeworkFileSizesTeacher(id, 'feedback'),
    attachmentScope: `teacher:${id}:feedback`,
    onConfirm: (_kind, files) => setPendingFiles(prev => [...prev, ...files]),
  });
  cancelPreparationRef.current = attach.cancelPreparation;
  closeAttachmentRef.current = attach.closeModal;

  const handleSaveFeedback = async () => {
    if (savingRef.current || !isDirtyRef.current) return;
    const onlyDeleting = deletedFileNames.length > 0 && pendingFiles.length === 0 && feedbackText === savedFeedbackText;
    if (!onlyDeleting && !feedbackText.trim() && pendingFiles.length === 0 && retainedFiles.length === 0) {
      toast.error('피드백 내용이나 파일을 추가해주세요.');
      return;
    }
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    const operation = ++operationRef.current;
    const current = () => operation === operationRef.current && isAuthScopeCurrent(auth);
    savingRef.current = true;
    setSaving(true);
    setSaveProgress({ stage: pendingFiles.length ? 'checking' : 'saving' });
    const wasFeedback = hasFeedback;
    const deletedNames = [...deletedFileNames];
    try {
      const prepared = pendingFiles.length > 0 ? await attach.prepareForSubmit(pendingFiles, {
        onStage: state => { if (current()) setSaveProgress(state); },
      }) : [];
      if (prepared === null || !current()) return;

      // 삭제·추가는 최종 저장 시에만 적용한다. 새로 생긴 타 작업자의 파일도 보존한다.
      let existingFiles;
      let savedExisting = hw?.feedbackFiles ?? [];
      if (prepared.length > 0 || deletedNames.length > 0) {
        const fresh = await getPage(id);
        if (!current()) return;
        existingFiles = (fresh.properties['피드백 파일']?.files ?? []).filter(file => !deletedNames.includes(file.name));
        savedExisting = parseHomework(fresh).feedbackFiles.filter(file => !deletedNames.includes(file.name));
      }
      const existingNames = savedExisting.map(file => file.name);
      const newNames = dedupeFileNames([...existingNames, ...prepared.map(file => file.baseName + file.ext)]).slice(existingNames.length);
      const uploaded = [];
      for (let i = 0; i < prepared.length; i += 1) {
        if (!current()) return;
        const pending = prepared[i];
        const fullName = newNames[i];
        const cached = uploadedRef.current.get(pending.tempId);
        if (cached && isAuthScopeCurrent(cached.auth) && cached.requestedFileName === fullName && Date.now() - cached.at < 50 * 60 * 1000) {
          uploaded.push(cached.result);
          continue;
        }
        setSaveProgress({ stage: 'uploading', detail: `${prepared.length}개 중 ${i + 1}번째 파일 전송 중` });
        const result = await uploadTeacherFile(pending.file, fullName);
        if (!current()) return;
        const uploadedFile = { ...result, fileName: result.fileName || fullName, size: pending.file.size };
        uploadedRef.current.set(pending.tempId, { auth, requestedFileName: fullName, at: Date.now(), result: uploadedFile });
        uploaded.push(uploadedFile);
      }
      if (!current()) return;
      setSaveProgress({ stage: 'saving', detail: '피드백 내용과 파일을 저장 중' });
      await saveFeedback(id, {
        feedbackText,
        files: existingFiles !== undefined ? uploaded : undefined,
        existingFiles,
        ...(onlyDeleting ? { filesOnly: true } : {}),
      });
      if (!current()) return;
      const hasNewText = feedbackText.trim() && feedbackText.trim() !== savedFeedbackText.trim();
      if (uploaded.length > 0 || hasNewText) {
        void notifyHomework('feedback', id).then(result => {
          if (isAuthScopeCurrent(auth) && !result.ok && !result.ignored) toast.warning(result.message);
        });
      }
      setHw(prev => ({
        ...prev,
        feedbackText,
        feedbackFiles: [...savedExisting, ...uploaded.map(({ fileName, size }) => ({ name: fileName, size, url: null }))],
        ...(onlyDeleting ? {} : { status: '피드백완료', feedbackDate: new Date().toISOString() }),
      }));
      setSavedFeedbackText(feedbackText);
      setPendingFiles([]);
      setDeletedFileNames([]);
      uploadedRef.current.clear();
      isDirtyRef.current = false;
      invalidateCache('homework');
      attach.closeModal();
      leaveGuard.markSaved();
      setView(wasFeedback ? 'updated' : 'complete');
    } catch (e) {
      if (current()) toast.error(`저장 실패: ${e.message}`);
    } finally {
      if (operation === operationRef.current) {
        savingRef.current = false;
        setSaving(false);
        setSaveProgress(null);
      }
    }
  };

  const handleDelete = async () => {
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    setDeleting(true);
    try {
      await deletePage(id);
      if (!isAuthScopeCurrent(auth)) return;
      invalidateCache('homework');
      finish();
    } catch (e) {
      if (isAuthScopeCurrent(auth)) toast.error(`삭제 실패: ${e.message}`);
      setShowDeleteConfirm(false);
    } finally { setDeleting(false); }
  };

  if (loading || (hw && hw.id !== id)) return <><PageHeader title="숙제 상세" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="숙제 상세" back /><ErrorMessage message={error} onRetry={load} /></>;
  if (!hw) return null;
  if (view === 'complete' || view === 'updated') return (
    <HomeworkCompleteScreen title={view === 'updated' ? '피드백을 수정했어요' : '피드백을 저장했어요'} name={hw.title} onConfirm={finish} />
  );

  const editing = view === 'edit';
  const rawName = studentNameMap[hw.studentIds?.[0]] || '';
  const studentName = rawName.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim();
  const renderFile = (file, kind, index = 0) => (
    <FilePreview
      key={`${kind}-${index}-${file.name}`}
      file={file}
      neutral
      plain={editing && kind === 'feedback'}
      onGetFreshUrl={async () => {
        const parsed = await getFreshParsed();
        return parsed[`${kind}Files`]?.find(item => item.name === file.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileTeacher(id, file.name, kind)}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlTeacher(id, file.name, kind)}
      onDelete={editing && kind === 'feedback' ? () => {
        if (!savingRef.current) setDeletedFileNames(prev => prev.includes(file.name) ? prev : [...prev, file.name]);
      } : undefined}
      deleteDisabled={saving}
    />
  );

  return <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[480px] items-center gap-2 px-4">
        <button type="button" aria-label="뒤로가기" onClick={handleBack} className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-transform active:scale-95 focus-visible:border-muted-foreground focus-visible:outline-none">
          <CaretLeftIcon size={20} weight="bold" />
        </button>
        <h1 ref={pageHeadingRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-[17px] font-semibold outline-none">
          {editing ? hasFeedback ? '피드백 수정' : '피드백 작성' : '숙제 상세'}
        </h1>
        {!editing && <Button variant="ghost" className="text-muted-foreground" onClick={() => setShowDeleteConfirm(true)}>삭제</Button>}
      </div>
    </header>

    <main className="mx-auto max-w-[480px] px-4 pt-5" style={{ paddingBottom: `calc(${ABOVE_BOTTOM_NAV} + 88px)` }}>
      {editing ? <>
        <p className="mb-6 text-base font-semibold leading-6">{hw.title}</p>
        <label htmlFor="homework-feedback-text" className="mb-2 block text-sm font-semibold">피드백 내용</label>
        <Textarea id="homework-feedback-text" value={feedbackText} onChange={event => setFeedbackText(event.target.value)} placeholder="피드백을 작성해주세요" rows={5} maxLength={2000} disabled={saving} />
        <p className="mt-1 text-right text-xs text-muted-foreground"><span className="tabular-nums">{feedbackText.length}</span> / 2000</p>
        <div className="mt-6">
          <HomeworkAttachmentFields attach={attach} files={pendingFiles} onRemove={tempId => {
            if (!savingRef.current) setPendingFiles(prev => prev.filter(file => file.tempId !== tempId));
          }} disabled={saving} count={retainedFiles.length + pendingFiles.length}>
            {(hw.feedbackFiles ?? []).map((file, index) => <li key={file.name} className="border-b border-border last:border-b-0">
              {deletedFileNames.includes(file.name) ? <div className="flex min-h-16 items-center gap-3 py-2">
                <span className="min-w-0 flex-1 break-all text-sm text-muted-foreground line-through">{file.name}</span>
                <button type="button" disabled={saving} onClick={() => {
                  if (retainedFiles.length + pendingFiles.length >= MAX_FILES) { toast.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return; }
                  setDeletedFileNames(prev => prev.filter(name => name !== file.name));
                }} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-transparent px-2 text-sm font-semibold text-muted-foreground transition-transform active:scale-95 focus-visible:border-muted-foreground focus-visible:outline-none">
                  <ArrowCounterClockwiseIcon size={20} />되돌리기
                </button>
              </div> : renderFile(file, 'feedback', index)}
            </li>)}
          </HomeworkAttachmentFields>
        </div>
      </> : <>
        <div className="mb-6 border-b border-border pb-5">
          {studentName && <p className="mb-1 text-sm font-semibold text-muted-foreground">{studentName}</p>}
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 text-xl font-semibold leading-7">{hw.title}</h2>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{hw.status}</span>
          </div>
          {hw.createdTime && <p className="mt-2 text-xs text-muted-foreground">등록일: <span className="tabular-nums">{formatDateTimeCompact(hw.createdTime)}</span></p>}
        </div>
        <DetailSection title="부여한 숙제">
          {hw.content && <p className="whitespace-pre-wrap text-sm leading-7"><AutoLink text={hw.content} /></p>}
          {hw.assignmentFiles?.length > 0 && <div className="mt-4 space-y-2">{hw.assignmentFiles.map((file, index) => renderFile(file, 'assignment', index))}</div>}
          {!hw.content && !hw.assignmentFiles?.length && <p className="text-sm text-muted-foreground">등록된 내용이 없습니다.</p>}
        </DetailSection>
        <DetailSection title="학생 제출">
          {hw.submitFiles?.length > 0 ? <div className="space-y-2">{hw.submitFiles.map((file, index) => renderFile(file, 'submit', index))}</div> : <p className="text-sm text-muted-foreground">아직 제출하지 않았습니다.</p>}
          {hw.submitDate && <p className="mt-3 text-xs text-muted-foreground">제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span></p>}
        </DetailSection>
        <DetailSection title="피드백">
          {hw.feedbackText && <p className="whitespace-pre-wrap text-sm leading-7"><AutoLink text={hw.feedbackText} /></p>}
          {hw.feedbackFiles?.length > 0 && <div className="mt-3 space-y-2">{hw.feedbackFiles.map((file, index) => renderFile(file, 'feedback', index))}</div>}
          {!hasFeedback && <p className="text-sm text-muted-foreground">아직 작성한 피드백이 없습니다.</p>}
          {hw.feedbackDate && <p className="mt-3 text-xs text-muted-foreground">피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span></p>}
        </DetailSection>
      </>}
    </main>

    <div className="fixed left-0 right-0 z-40 bg-background px-4 py-3" style={{ bottom: ABOVE_BOTTOM_NAV }}>
      <div className="mx-auto max-w-[448px]">
        <Button block size="lg" className="disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" disabled={editing && (!isDirty || saving)} loading={saving} onClick={editing ? handleSaveFeedback : () => setView('edit')}>
          {editing ? hasFeedback ? '수정 내용 저장하기' : '피드백 저장하기' : hasFeedback ? '피드백 수정하기' : '피드백 작성하기'}
        </Button>
      </div>
    </div>
    <FileAttachModal attach={attach} compact titles={{ audio: '녹음 파일', document: '이미지·PDF', fallback: '피드백 파일' }} hints={{ audio: '추가할 녹음 파일을 선택해주세요', document: '추가할 이미지 또는 PDF 파일을 선택해주세요' }} />
    <HomeworkProgressOverlay stage={showLeaveConfirm ? null : saving ? saveProgress?.stage : null} message={saving && saveProgress?.stage === 'saving' ? '피드백을 저장하고 있어요' : saveProgress?.message} detail={saveProgress?.detail} />
    {showDeleteConfirm && <ConfirmDialog title="숙제를 삭제하시겠습니까?" message="삭제한 데이터는 복구할 수 없습니다." onConfirm={handleDelete} onCancel={() => setShowDeleteConfirm(false)} loading={deleting} />}
    {showLeaveConfirm && <ConfirmDialog title={saving ? '저장을 중단할까요?' : '페이지를 나가시겠습니까?'} message={saving ? '파일 준비를 중단하고 작성 중인 내용을 버립니다. 이미 전송된 요청은 처리될 수 있습니다.' : '저장하지 않은 피드백 수정사항이 있습니다. 지금 나가면 변경 내용이 사라집니다.'} confirmLabel={saving ? '중단하기' : '나가기'} cancelLabel="계속 작성" onConfirm={leaveGuard.confirmLeave} onCancel={leaveGuard.cancelLeave} />}
  </>;
}

function DetailSection({ title, children }) {
  return <section className="mb-7">
    <h2 className="mb-3 text-[15px] font-semibold text-muted-foreground">{title}</h2>
    {children}
  </section>;
}
