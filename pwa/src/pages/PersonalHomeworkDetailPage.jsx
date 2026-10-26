import {
  useState,
  useEffect,
  useCallback,
  useRef } from 'react';
import { toast } from 'sonner';
import { captureAuthScope, isAuthScopeCurrent } from '../api/authState.js';
import { useStudentAppContext } from '../context/StudentAppContext.jsx';
import { useParams,
  useNavigate } from 'react-router-dom';
import { Button } from '../components/shadcn/button';
import { CaretLeftIcon,
  MicrophoneIcon,
  PlusIcon,
  PaperclipIcon,
  XIcon,
  ArrowCounterClockwiseIcon,
  PaperPlaneTiltIcon,
  CheckIcon,
  ChatTeardropTextIcon } from '@phosphor-icons/react';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import AutoLink from '../components/ui/AutoLink.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import HomeworkProgressOverlay from '../components/homework/HomeworkProgressOverlay.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import SectionEntryButton from '../components/ui/SectionEntryButton.jsx';
import './PersonalHomeworkDetailPage.css';
import {
  fetchMyHomework,
  parseHomework,
  submitHomework,
  uploadStudentFile,
  markFeedbackSeen,
  downloadHomeworkFileStudent,
  fetchHomeworkFileBlobUrlStudent,
  fetchHomeworkFileSizesStudent,
  } from '../api/homework.js';
import { retryTransient } from '../api/fetchTimeout.js';
import { reportHandledError } from '../utils/errorReporter.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import { markViewed } from '../utils/homeworkViewed.js';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';
import { peekCache, peekCacheSavedAt, writeCacheValue, trackRevalidation, pruneRevalidations } from '../hooks/useCachedResource.js';
import useFileAttach,
  { MAX_FILES } from '../hooks/useFileAttach.js';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_INACTIVE,
  BG_APP,
  INK_900,
  } from '../constants/theme.js';
import {
  dedupeFileNames,
  isImageByName,
  isPdfByName,
  MAX_FILE_MB,
} from '../utils/audioFile.js';
import { MAX_TOTAL_FILE_MB } from '../utils/homeworkLimits.js';

// Notion file_upload는 생성 후 1시간 안에 첨부해야 만료되지 않는다 — 여유를 두고 50분까지만 재사용.
const REUSE_WINDOW_MS = 50 * 60 * 1000;

function genStudentName(title, index) {
  // 한자(\p{Script=Han})도 보존 — "声调练习" 같은 중국어 제목이 통째로 지워지지 않게
  const base = title.replace(/[^\w가-힣\p{Script=Han}]/gu, '').slice(0, 20) || '숙제';
  return `${base}_${String(index).padStart(2, '0')}`;
}

export default function PersonalHomeworkDetailPage() {
  const { hwId, studentToken: legacyStudentToken } = useParams();
  const studentToken = useStudentAppContext()?.scope || legacyStudentToken;
  const navigate = useNavigate();

  const [hw, setHw] = useState(() => peekCache(`student:homework:${studentToken}`)?.find(item => item.id === hwId) ?? null);
  const [loading, setLoading] = useState(() => !peekCache(`student:homework:${studentToken}`)?.some(item => item.id === hwId));
  const [error, setError] = useState(null);
  const [verifiedHwId, setVerifiedHwId] = useState(null);
  const homeworkRef = useRef(hw);
  homeworkRef.current = hw;
  const requestId = useRef(0);

  // 외부 페이지에 표시되는 저장 대기 — 카테고리별 분리.
  // 항목: { tempId, file, baseName, ext } — ext는 점 포함(`.mp3`) 또는 빈 문자열
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);
  const [view, setView] = useState('detail');
  const completionHeadingRef = useRef(null);
  const pageHeadingRef = useRef(null);
  const [deletedFileNames, setDeletedFileNames] = useState([]);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (view !== 'submit' && view !== 'detail') return;
    window.scrollTo?.({ top: 0, behavior: 'instant' });
    pageHeadingRef.current?.focus({ preventScroll: true });
  }, [view]);

  useEffect(() => {
    if (view !== 'submitted' && view !== 'updated') return undefined;
    // 진행 딤이 닫히며 포커스를 돌려놓은 다음 새 화면의 완료 제목을 읽는다.
    const timer = window.setTimeout(() => completionHeadingRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [view]);

  const [uploading, setUploading] = useState(false);
  const [operationStage, setOperationStage] = useState(null);
  const [preparationProgress, setPreparationProgress] = useState(null);
  // 업로드 진행 표시 — { done, total }. 스피너만 돌면 학생이 "멈췄다"고 판단해 앱을 닫는다.
  const [progress, setProgress] = useState(null);
  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;
  const operationIdRef = useRef(0);
  const cancelPreparationRef = useRef(null);

  // 이번 화면에서 이미 Notion에 올라간 파일 — tempId → { fileUploadId, fileName, uploadReceipt, requestedFileName, at }.
  // 중간에 실패해도 성공한 파일은 다시 올리지 않는다(Notion file_upload는 1시간 유효).
  const uploadedRef = useRef(new Map());

  // 저장 전 이탈 차단 — pending 파일이 하나라도 있으면 dirty.
  // 강사 페이지(HomeworkDetailPage)와 동일 패턴: handleBack 가드 + popstate 가드 + ConfirmDialog.
  const isDirty = pendingAudio.length + pendingDocs.length + deletedFileNames.length > 0;
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingNavRef = useRef(null);
  const resetDraft = useCallback(() => {
    operationIdRef.current += 1;
    cancelPreparationRef.current?.();
    uploadedRef.current.clear();
    setPendingAudio([]);
    setPendingDocs([]);
    setDeletedFileNames([]);
    setUploading(false);
    setOperationStage(null);
    setPreparationProgress(null);
    setProgress(null);
    setShowLeaveConfirm(false);
    setView('detail');
    viewRef.current = 'detail';
    isDirtyRef.current = false;
  }, []);

  // 브라우저 뒤로가기(swipe·Android back) 차단 — HashRouter 는 useBlocker 미지원이라
  // history.pushState 더미 entry + popstate 리스너로 가드.
  // ⚠️ 떠나기로 결정한 뒤의 pop이 만드는 popstate에 리스너가 또 navigate(-1)을 쏘면
  // pop이 초과되어 SPA 히스토리 범위를 벗어나 **문서 전체 리로드**가 걸렸다
  // ("뒤로가기하면 로딩" 2026-08-31). 해법:
  //  · pushedRef — 지금 위에 쌓인 더미 개수(StrictMode는 이펙트를 두 번 돌려 2개가 된다)
  //  · leave() — 더미 + 이 페이지를 navigate 한 번으로 빠져나간다
  //  · leavingRef — 이탈 pop이 만드는 popstate는 무시
  const leavingRef = useRef(false);
  const pushedRef = useRef(0);
  const returningHomeRef = useRef(false);
  const navigateHome = useCallback(() => {
    navigate(legacyStudentToken ? `/personal/${encodeURIComponent(legacyStudentToken)}` : '/personal/', { replace: true, state: { tab: '홈' } });
  }, [navigate, legacyStudentToken]);
  const finish = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    // 이탈 가드용 더미와 현재 상세를 접어 완료 화면이 뒤로가기에 다시 나타나지 않게 한다.
    if (pushedRef.current > 0) {
      returningHomeRef.current = true;
      window.history.go(-pushedRef.current);
    } else navigateHome();
  }, [navigateHome]);
  const leave = useCallback(() => {
    leavingRef.current = true;
    navigate(-(pushedRef.current + 1));
  }, [navigate]);
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    pushedRef.current += 1;
    const onPopState = () => {
      if (returningHomeRef.current) {
        returningHomeRef.current = false;
        pushedRef.current = 0;
        navigateHome();
        return;
      }
      if (leavingRef.current) return;
      pushedRef.current -= 1; // 방금 pop으로 더미 하나 소진
      if (viewRef.current === 'submitted' || viewRef.current === 'updated') {
        finish();
      } else if (viewRef.current === 'submit') {
        // 상세에서 숙제 내용을 다시 읽고 돌아와도 파일 초안은 유지한다.
        window.history.pushState(null, '', window.location.href);
        pushedRef.current += 1;
        if (uploadingRef.current) {
          setShowLeaveConfirm(true);
          pendingNavRef.current = resetDraft;
        } else setView('detail');
      } else if (isDirtyRef.current) {
        // 상세에서 실제로 숙제를 떠날 때만 초안 폐기를 확인한다.
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
  }, [navigate, leave, resetDraft, finish, navigateHome]);

  const handleBack = () => {
    if (viewRef.current === 'submitted' || viewRef.current === 'updated') { finish(); return; }
    if (uploadingRef.current) {
      setShowLeaveConfirm(true);
      pendingNavRef.current = resetDraft;
    } else if (viewRef.current === 'submit') setView('detail');
    else if (isDirtyRef.current) {
      setShowLeaveConfirm(true);
      pendingNavRef.current = leave;
    } else leave();
  };

  useEffect(() => {
    if (!isDirty) return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  // 업로드 중 뒤로가기를 눌러 확인창이 떠 있는 동안 제출이 끝나는 경우가 있다.
  // 그 시점엔 경고할 내용("저장하지 않은 파일이 있어요")이 더 이상 사실이 아니므로 창을 닫는다.
  useEffect(() => {
    if (showLeaveConfirm && !uploading && !isDirty) setShowLeaveConfirm(false);
  }, [showLeaveConfirm, uploading, isDirty]);

  const handleLeaveConfirm = () => {
    setShowLeaveConfirm(false);
    pendingNavRef.current?.();
  };

  const load = useCallback(async () => {
    const auth = captureAuthScope(`student:${studentToken}`);
    if (!isAuthScopeCurrent(auth)) return;
    const request = ++requestId.current;
    const isCurrent = () => request === requestId.current && isAuthScopeCurrent(auth);
    const CK = `student:homework:${studentToken}`;
    const cached = peekCache(CK)?.find(item => item.id === hwId);
    const hasCurrent = homeworkRef.current?.id === hwId;
    if (!hasCurrent) setHw(cached ?? null);
    setLoading(!hasCurrent && !cached);
    setError(null);
    try {
      const pages = await trackRevalidation(() => fetchMyHomework(studentToken), {
        key: CK, label: '숙제', lastSuccessAt: peekCacheSavedAt(CK), retry: () => load(), isCurrent,
      });
      if (!isCurrent()) return;
      const list = pages.map(parseHomework);
      // 전체 목록을 이미 받아왔으니 홈/보관함 목록 캐시도 갱신 — 삭제되거나 제출된
      // 숙제가 복귀 화면에서 이전 상태로 다시 나타나지 않게 한다.
      writeCacheValue(CK, list, auth);
      const found = list.find((h) => h.id === hwId) ?? null;
      if (!found) { setHw(null); throw new Error('숙제를 찾을 수 없습니다.'); }
      setHw(found);
      setVerifiedHwId(hwId);
      markViewed(studentToken, hwId);
      return found;
    } catch (e) {
      if (!isCurrent()) return;
      if (e.status === 404) setHw(null);
      setError(e.message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [studentToken, hwId]);

  useEffect(() => {
    if ((view === 'submit' || isDirty) && !uploading && hw && !['미제출', '제출완료'].includes(hw.status)) resetDraft();
  }, [view, hw, uploading, isDirty, resetDraft]);

  useEffect(() => {
    resetDraft();
    setVerifiedHwId(null);
    load();
    return () => { requestId.current += 1; operationIdRef.current += 1; pruneRevalidations(); };
  }, [load, resetDraft]);

  // 학생이 피드백완료 숙제를 처음 열어본 시점 기록 — Worker가 비어있을 때만 PATCH(idempotent).
  useEffect(() => {
    if (verifiedHwId === hwId && hw?.status === '피드백완료' && !hw.feedbackSeenDate) {
      const auth = captureAuthScope(`student:${studentToken}`);
      let active = true;
      markFeedbackSeen(studentToken, hwId)
        .then(() => {
          if (!active || !isAuthScopeCurrent(auth)) return;
          setHw(prev => prev ? { ...prev, feedbackSeenDate: new Date().toISOString() } : prev);
          toast.success('피드백 확인 완료 · 먹이 +1');
        })
        .catch(e => console.warn('피드백 확인 기록 실패:', e?.message));
      return () => { active = false; };
    }
  }, [hw?.status, hw?.feedbackSeenDate, studentToken, hwId, verifiedHwId]);

  const getFreshHw = useCallback(async () => {
    const pages = await fetchMyHomework(studentToken);
    const list = pages.map(parseHomework);
    return list.find((h) => h.id === hwId) ?? null;
  }, [studentToken, hwId]);

  // 외부 페이지·기존 저장본을 합산해 개수와 총용량을 판정한다.
  const retainedFiles = (hw?.submitFiles ?? []).filter((file) => !deletedFileNames.includes(file.name));
  const fixedCount = retainedFiles.length + pendingAudio.length + pendingDocs.length;

  // 파일 첨부 모달 로직 — 공용 훅 (state·picker·검증·이름 짓기)
  const attach = useFileAttach({
    directSelection: true,
    genName: (index) => genStudentName(hw?.title ?? '숙제', index),
    fixedFiles: [...retainedFiles, ...pendingAudio, ...pendingDocs],
    loadFileSizes: () => fetchHomeworkFileSizesStudent(studentToken, hwId, 'submit'),
    attachmentScope: `${studentToken}:${hwId}:submit`,
    onConfirm: (kind, files) => {
      if (kind === 'audio') {
        setPendingAudio((prev) => [...prev, ...files]);
      } else if (kind === 'document') {
        setPendingDocs((prev) => [...prev, ...files]);
      }
    },
  });
  const { tryOpenFilePicker, tryOpenRecord } = attach;
  cancelPreparationRef.current = attach.cancelPreparation;

  const removePendingAudio = (tempId) => { if (!uploading) setPendingAudio((prev) => prev.filter((f) => f.tempId !== tempId)); };
  const removePendingDoc = (tempId) => { if (!uploading) setPendingDocs((prev) => prev.filter((f) => f.tempId !== tempId)); };

  // 저장 — 양쪽 카테고리 pending 합쳐서 한 번에 업로드 + Notion PATCH.
  const handleSaveSubmit = async () => {
    const auth = captureAuthScope(`student:${studentToken}`);
    if (!isAuthScopeCurrent(auth)) return;
    let all = [...pendingAudio, ...pendingDocs];
    if (!isDirty || !['미제출', '제출완료'].includes(hw?.status)) return;
    if (uploading) return;
    const operation = ++operationIdRef.current;
    const isCurrent = () => operation === operationIdRef.current && isAuthScopeCurrent(auth);
    const deletedNames = [...deletedFileNames];
    const isFirstSubmit = !hw?.submitMark;
    const completedView = hw.status === '미제출' ? 'submitted' : 'updated';
    setUploading(true);
    setOperationStage(all.length ? 'checking' : 'saving');
    setPreparationProgress(null);
    setProgress({ done: 0, total: all.length, percent: 0 });
    try {
      const prepared = all.length > 0 ? await attach.prepareForSubmit(all, {
        onStage: (state) => {
          if (!isCurrent()) return;
          setOperationStage(state.stage);
          setPreparationProgress(state);
        },
      }) : [];
      if (prepared === null || !isCurrent()) return;
      all = prepared;
      // 실제 압축 결과의 바이트로 계산해야 압축 전 용량 때문에 전송률이 낮게 보이지 않는다.
      const totalBytes = all.reduce((sum, pf) => sum + (pf.file?.size || 0), 0) || 1;
      let bytesDone = 0;
      // 마지막 제출 요청이 남아 있으므로 업로드만으로 100%를 보여주지 않는다.
      const pct = (bytes) => Math.min(99, Math.round((bytes / totalBytes) * 100));
      setPreparationProgress(null);
      // 동명 파일 충돌 방지 — 기존 제출본 + 이번 pending 이름을 합쳐 유일화한다.
      // (다운로드/미리보기가 파일을 이름으로 찾으므로 같은 이름이면 전부 첫 번째로만 조회됨)
      // 기존 이름은 보존되고 새 파일에만 ` (2)` 접미사가 붙는다. 서버도 한 번 더 dedup.
      const existingNames = retainedFiles.map((f) => f.name);
      const allNames = dedupeFileNames([...existingNames, ...all.map((pf) => pf.baseName + pf.ext)]);
      const newNames = allNames.slice(existingNames.length);
      const uploaded = [];
      for (let i = 0; i < all.length; i += 1) {
        if (!isCurrent()) return;
        const pf = all[i];
        const fullName = newNames[i];
        // 앞선 시도에서 이미 올라간 파일은 건너뛴다 — 3개 중 2개를 올리고 실패했을 때
        // 처음부터 다시 올리느라 또 오래 기다리는 일을 막는다.
        const done = uploadedRef.current.get(pf.tempId);
        if (done && isAuthScopeCurrent(done.auth) && done.requestedFileName === fullName && Date.now() - done.at < REUSE_WINDOW_MS) {
          bytesDone += pf.file?.size || 0;
          uploaded.push({ fileUploadId: done.fileUploadId, fileName: done.fileName, uploadReceipt: done.uploadReceipt });
          setProgress({ done: i + 1, total: all.length, percent: pct(bytesDone) });
          continue;
        }
        // 업로드만 재시도한다 — 제출 PATCH는 이미 올린 file_upload를 다시 붙이는 요청이라
        // 재시도가 오히려 중복 첨부 오류를 부를 수 있다. 실패해도 여기 캐시가 남아 재시도가 빠르다.
        // 재시도로 같은 파일을 다시 올려도 bytesDone은 그대로라 진행률이 뒤로 가지 않는다.
        // 원본 File 그대로 전달하고 이름만 지정 — 재포장하면 안드로이드에서 뒤가 잘린다.
        setOperationStage('uploading');
        const { fileUploadId, fileName, uploadReceipt } = await retryTransient(() => uploadStudentFile(studentToken, pf.file, {
          fileName: fullName,
          onProgress: (loaded) => { if (isCurrent()) setProgress({ done: i, total: all.length, percent: pct(bytesDone + loaded) }); },
        }));
        if (!isCurrent()) return;
        bytesDone += pf.file?.size || 0;
        // multipart 전송에서 따옴표 등이 바뀔 수 있으므로 영수증에 서명된 서버 파일명을 그대로 쓴다.
        // 재사용 여부는 사용자가 요청한 이름으로 따로 비교한다.
        uploadedRef.current.set(pf.tempId, { auth, fileUploadId, fileName, uploadReceipt, requestedFileName: fullName, at: Date.now() });
        uploaded.push({ fileUploadId, fileName, uploadReceipt });
        setProgress({ done: i + 1, total: all.length, percent: pct(bytesDone) });
      }
      if (!isCurrent()) return;
      setOperationStage('saving');
      const saved = await submitHomework(studentToken, hwId, uploaded, deletedNames);
      if (!isCurrent()) return;
      if (saved?.id === hwId && saved.properties) {
        // 저장 응답이 확정한 페이지를 즉시 반영한다. 직후 GET의 이전 값으로 덮지 않는다.
        const parsed = parseHomework(saved);
        requestId.current += 1;
        setError(null);
        setHw(parsed);
        homeworkRef.current = parsed;
        setVerifiedHwId(hwId);
        const key = `student:homework:${studentToken}`;
        const cached = peekCache(key) ?? [];
        const next = cached.some((item) => item.id === hwId)
          ? cached.map((item) => item.id === hwId ? parsed : item) : [parsed, ...cached];
        writeCacheValue(key, next, auth);
        markViewed(studentToken, hwId);
      } else await load();
      if (!isCurrent()) return;
      resetDraft();
      setView(completedView);
      viewRef.current = completedView;
      window.scrollTo?.({ top: 0, behavior: 'instant' });
      if (isFirstSubmit && uploaded.length > 0) {
        toast.success('먹이 +1');
      }
    } catch (err) {
      if (!isCurrent()) return;
      if (err.status === 409) {
        const latest = await load();
        if (!isCurrent()) return;
        if (latest && !['미제출', '제출완료'].includes(latest.status)) {
          resetDraft();
          toast.error('피드백이 완료되어 제출을 수정할 수 없어요.');
          return;
        }
      }
      toast.error(`제출 실패: ${err.message}`);
      // 토스트는 화면을 나가면 사라진다 — 강사가 볼 수 있게 원인을 원격에도 남긴다.
      // 파일 크기를 함께 보내야 "무슨 파일을 올리다 막혔는지"를 추측 없이 알 수 있다.
      reportHandledError(`숙제 제출 실패: ${err.message}`, {
        source: 'PersonalHomeworkDetailPage.handleSaveSubmit',
        detail: [
          `status=${err.status ?? '없음(네트워크·타임아웃)'}`,
          `files=${all.map((pf) => `${pf.baseName}${pf.ext}(${((pf.file?.size ?? 0) / 1024 / 1024).toFixed(1)}MB)`).join(' / ')}`,
        ].join('\n'),
      });
    } finally {
      if (operation === operationIdRef.current) {
        setUploading(false);
        setOperationStage(null);
        setPreparationProgress(null);
        setProgress(null);
      }
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
      onClick={handleBack}
      aria-label="뒤로"
      className="transition-[color] duration-150 ease-out"
      style={backBtnStyle}
    >
      <CaretLeftIcon weight="bold" size={20} />
    </button>
  );

  if (loading || (hw && hw.id !== hwId)) return (
    <div style={{ minHeight: '100dvh', background: BG_APP }}>
      <div style={headerStyle}>
        <div style={innerStyle}><BackButton /></div>
      </div>
      <LoadingSpinner />
    </div>
  );

  if (error && !hw) return (
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

  if (view === 'submitted' || view === 'updated') return (
    <div className="homework-complete" style={{ background: BG_APP }}>
      <div style={headerStyle}>
        <div style={innerStyle}><BackButton /></div>
      </div>
      <div className="homework-complete-body" style={{ paddingBottom: `calc(${ABOVE_BOTTOM_NAV} + 72px)` }}>
        <div className="homework-complete-message">
          <div className="homework-complete-icon text-foreground" aria-hidden>
            <span className="homework-complete-disc bg-muted" />
            <CheckIcon className="homework-complete-check" size={44} weight="bold" />
          </div>
          <h1 ref={completionHeadingRef} tabIndex={-1} className="homework-complete-title" style={{ color: TEXT_PRIMARY }}>
            {view === 'submitted' ? '숙제를 제출했어요' : '숙제를 수정했어요'}
          </h1>
          <p className="homework-complete-name" style={{ color: TEXT_SECONDARY }}>{hw.title}</p>
        </div>
      </div>
      <div className="homework-actions" style={{ bottom: ABOVE_BOTTOM_NAV, background: BG_APP }}>
        <div style={{ maxWidth: 448, margin: '0 auto' }}>
          <Button block size="lg" onClick={finish}>
            확인
          </Button>
        </div>
      </div>
    </div>
  );

  // 피드백완료 후에는 학생이 파일 추가·삭제 불가 — 강사가 피드백을 단 결과물을 보존.
  const canEdit = hw.status === '미제출' || hw.status === '제출완료';
  const editing = view === 'submit' && canEdit;

  // 저장본을 카테고리별로 분리 — PDF/이미지가 아닌 모든 파일은 녹음 섹션으로.
  // 옛 데이터(확장자 누락 등)도 누락 없이 표시되도록 명시적 document 만 분리하고 나머지는 audio.
  const isDoc = (f) => isImageByName(f.name) || isPdfByName(f.name);
  const shownSubmitFiles = editing ? retainedFiles : (hw.submitFiles ?? []);
  const submitAudio = shownSubmitFiles.filter((f) => !isDoc(f));
  const submitDocs = shownSubmitFiles.filter(isDoc);
  const feedbackAudio = (hw.feedbackFiles ?? []).filter((f) => !isDoc(f));
  const feedbackDocs = (hw.feedbackFiles ?? []).filter(isDoc);

  // 학생이 저장한 파일 한 행 — FilePreview wrapper.
  // kind: 'submit' | 'feedback' | 'assignment'
  const renderStoredFile = (f, kind, idx = 0) => (
    <FilePreview
      key={`${kind}-${idx}-${f.name}`}
      file={f}
      neutral
      plain={kind === 'submit' && editing}
      onGetFreshUrl={async () => {
        const h = await getFreshHw();
        const arr = kind === 'submit' ? h?.submitFiles
                  : kind === 'feedback' ? h?.feedbackFiles
                  : h?.assignmentFiles;
        return arr?.find((x) => x.name === f.name)?.url ?? null;
      }}
      onDownload={() => downloadHomeworkFileStudent(studentToken, hwId, f.name, kind)}
      fetchInlineBlobUrl={() => fetchHomeworkFileBlobUrlStudent(studentToken, hwId, f.name, kind)}
      onDelete={kind === 'submit' && editing ? () => {
        if (!uploading) setDeletedFileNames((prev) => prev.includes(f.name) ? prev : [...prev, f.name]);
      } : undefined}
      deleteDisabled={uploading}
    />
  );

  return (
    <>
      {/* 헤더 */}
      <div style={{ ...headerStyle, position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={innerStyle}>
          <BackButton />
          <h1 ref={pageHeadingRef} tabIndex={-1} className="outline-none" style={{ flex: 1, fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {editing ? hw.status === '미제출' ? '숙제 제출' : '숙제 수정' : hw.title}
          </h1>
          <span className="bg-muted text-muted-foreground"
            style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 }}>
            {editing && isDirty ? hw.status === '미제출' ? '제출 전' : '수정 중' : hw.status}
          </span>
        </div>
      </div>

      <div style={{ background: BG_APP, minHeight: 'calc(100dvh - 56px)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px', paddingBottom: canEdit ? `calc(${ABOVE_BOTTOM_NAV} + 72px)` : 80 }}>

        {error && <ErrorMessage message={error} onRetry={load} />}

        {/* ===== 1. 숙제 내용 ===== */}
        {editing ? (
          <p className="mb-6 text-base font-semibold leading-6">{hw.title}</p>
        ) : (
          <>
        {/* 등록일은 제출·피드백 이후에도 계속 보여준다(2026-09-01 요청). */}
        {hw.createdTime && (
          <p style={{ fontSize: 12, color: TEXT_INACTIVE, margin: '0 0 10px' }}>
            등록일: <span className="tabular-nums">{formatDateTimeCompact(hw.createdTime)}</span>
          </p>
        )}
        {hw.content && (
          <ContentSection label={null}>
            <p style={{ fontSize: 14, color: INK_900, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}><AutoLink text={hw.content} /></p>
          </ContentSection>
        )}
        {hw.assignmentFiles?.length > 0 && (
          <ContentSection label="선생님이 보낸 파일">
            {hw.assignmentFiles.map((f, i) => (
              <div key={`assignment-${i}-${f.name}`} className="mb-2 last:mb-0">
                {renderStoredFile(f, 'assignment', i)}
              </div>
            ))}
          </ContentSection>
        )}
          </>
        )}

        {/* ===== 2. 제출 파일 ===== */}
        {view === 'detail' && shownSubmitFiles.length > 0 && (
          <AreaHeading icon={<PaperPlaneTiltIcon size={20} weight="fill" />} label="제출한 파일" />
        )}
        {view === 'detail' && (submitAudio.length > 0 || submitDocs.length > 0) && (
          <ContentSection label={null}>
            {[...submitAudio, ...submitDocs].map((f, i) => (
              <div key={`submit-${i}-${f.name}`} className="mb-2 last:mb-0">
                {renderStoredFile(f, 'submit', i)}
              </div>
            ))}
            {hw.submitDate && (
              <p style={{ fontSize: 12, color: TEXT_TERTIARY, marginTop: 4 }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </ContentSection>
        )}
        {editing && (
          <section aria-label="제출할 파일">
          <ContentSection label={
            <span className="flex items-center justify-between gap-3">
              <span>제출할 파일</span>
              <span className="text-sm tabular-nums text-muted-foreground" role={uploading ? undefined : 'status'} aria-live={uploading ? undefined : 'polite'} aria-atomic="true"
                aria-label={`제출할 파일 ${fixedCount}개, 최대 ${MAX_FILES}개`}>{fixedCount}/{MAX_FILES}</span>
            </span>
          }>
            <p className="mb-3 text-xs text-muted-foreground">최대 {MAX_FILES}개 · 파일당 {MAX_FILE_MB}MB · 총 {MAX_TOTAL_FILE_MB}MB</p>
            <div className="space-y-3">
              <SectionEntryButton
                icon={<MicrophoneIcon size={24} className="text-muted-foreground" aria-hidden />}
                label={<><span className="flex-1 text-left">녹음하기</span><PlusIcon size={20} className="text-muted-foreground" aria-hidden /></>}
                onClick={tryOpenRecord}
                disabled={uploading || fixedCount >= MAX_FILES}
                className="mb-0 h-14 justify-start gap-3 border-input bg-card px-4 text-foreground hover:bg-accent"
              />
              <SectionEntryButton
                icon={<PaperclipIcon size={24} className="text-muted-foreground" aria-hidden />}
                label={<><span className="flex-1 text-left">파일 추가</span><PlusIcon size={20} className="text-muted-foreground" aria-hidden /></>}
                onClick={tryOpenFilePicker}
                disabled={uploading || fixedCount >= MAX_FILES}
                className="mb-0 h-14 justify-start gap-3 border-input bg-card px-4 text-foreground hover:bg-accent"
              />
            </div>
            {((hw.submitFiles?.length ?? 0) + pendingAudio.length + pendingDocs.length) > 0 && (
              <ul className="mt-6 border-t border-border" aria-label="제출할 파일 목록">
                {(hw.submitFiles ?? []).map((file, index) => (
                  <li key={`draft-${index}-${file.name}`} className="border-b border-border last:border-b-0">
                    {deletedFileNames.includes(file.name) ? (
                      <div className="flex min-h-14 items-center justify-between gap-3 py-1">
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">
                          <span className="sr-only">삭제 예정: </span>{file.name}
                        </span>
                        <Button variant="link" className="shrink-0 px-2 text-muted-foreground hover:text-foreground" onClick={() => {
                          if (fixedCount >= MAX_FILES) { toast.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있어요`); return; }
                          setDeletedFileNames((prev) => prev.filter((name) => name !== file.name));
                        }} disabled={uploading} aria-label={`${file.name} 삭제 취소`}>
                          <ArrowCounterClockwiseIcon size={16} aria-hidden />되돌리기
                        </Button>
                      </div>
                    ) : renderStoredFile(file, 'submit', index)}
                  </li>
                ))}
                {[...pendingAudio, ...pendingDocs].map(file => (
                  <PendingFileRow key={file.tempId} file={file} disabled={uploading} onRemove={tempId => {
                    if (pendingAudio.some(item => item.tempId === tempId)) removePendingAudio(tempId);
                    else removePendingDoc(tempId);
                  }} />
                ))}
              </ul>
            )}
          </ContentSection>
          </section>
        )}

        {/* ===== 3. 선생님 피드백 ===== */}
        {view === 'detail' && (hw.feedbackText || feedbackAudio.length > 0 || feedbackDocs.length > 0) && (
          <>
            <AreaHeading icon={<ChatTeardropTextIcon size={20} weight="fill" />} label="선생님 피드백" />
            <ContentSection label={null}>
              {hw.feedbackText && (
                <p style={{ fontSize: 14, color: INK_900, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: (feedbackAudio.length + feedbackDocs.length) > 0 ? '0 0 12px' : 0 }}>
                  <AutoLink text={hw.feedbackText} />
                </p>
              )}
              {[...feedbackAudio, ...feedbackDocs].map((f, i) => (
                <div key={`feedback-${i}-${f.name}`} className="mb-2 last:mb-0">
                  {renderStoredFile(f, 'feedback', i)}
                </div>
              ))}
              {hw.feedbackDate && (
                <p style={{ fontSize: 12, color: TEXT_INACTIVE, marginTop: 8 }}>
                  피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
                </p>
              )}
            </ContentSection>
          </>
        )}

        </div>
      </div>

      {canEdit && (
        <div className="homework-actions" style={{ bottom: ABOVE_BOTTOM_NAV, background: BG_APP }}>
          <div style={{ maxWidth: 448, margin: '0 auto' }}>
            <Button block size="lg"
              className="disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100" loading={uploading} disabled={editing && !isDirty}
              onClick={editing ? handleSaveSubmit : () => setView('submit')}>
              {editing ? hw.status === '미제출' ? `파일 제출하기 · ${fixedCount}개` : '수정 내용 저장하기'
                : hw.status === '미제출' ? '숙제 제출하기' : '숙제 수정하기'}
            </Button>
          </div>
        </div>
      )}

      {/* 파일 선택 input은 항상 준비하고, 직접 녹음할 때만 녹음창을 연다. */}
      <FileAttachModal
        attach={attach}
        compact
        titles={{ audio: '녹음 파일 추가', document: '이미지·PDF 추가', fallback: '파일 추가' }}
      />

      {/* 이탈 확인이 열리면 진행 딤을 숨겨 확인창의 포커스·클릭을 보존한다. */}
      <HomeworkProgressOverlay
        stage={showLeaveConfirm ? null : uploading ? operationStage : null}
        message={operationStage === 'saving' ? '제출을 마무리하고 있어요'
          : operationStage === 'uploading' ? '숙제 파일을 올리고 있어요' : preparationProgress?.message}
        detail={operationStage === 'uploading' && progress
          ? `${Math.min(progress.done + 1, progress.total)}/${progress.total}개 파일 · 전송 ${progress.percent}%`
          : operationStage === 'saving' ? undefined : preparationProgress?.detail}
      />

      {/* 저장 전 이탈 확인 — pending 파일이 있는 상태에서 뒤로가기 시도 시 */}
      {showLeaveConfirm && (
        <ConfirmDialog
          title={uploading ? '제출 중이에요' : '변경 내용을 버릴까요?'}
          message={uploading
            ? '지금 나가면 제출이 중단될 수 있어요. 잠시만 기다려주세요.'
            : '추가한 파일과 삭제 변경이 사라져요. 저장된 제출 파일은 그대로 유지돼요.'}
          confirmLabel={uploading ? '그래도 나가기' : '변경 버리기'}
          cancelLabel={uploading ? '기다리기' : '계속 작성'}
          onConfirm={handleLeaveConfirm}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </>
  );
}

// ===== 보조 컴포넌트 =====

function ContentSection({ label, children }) {
  return (
    <div className="mb-6 last:mb-0">
      {label && <SectionHeading as="h2" style={{ marginTop: 0, marginBottom: 12 }}>{label}</SectionHeading>}
      {children}
    </div>
  );
}

// 제출 파일과 선생님 피드백의 시각 구분용 헤더.
function AreaHeading({ icon, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginTop: 24,
      marginBottom: 12,
      color: TEXT_SECONDARY,
    }}>
      {icon}
      <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

// 선택 파일은 정보 행으로 표시하고, 행 끝의 삭제 버튼만 조작 대상으로 구분한다.
function PendingFileRow({ file, onRemove, disabled }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-border py-1 last:border-b-0">
      <PaperclipIcon size={20} className="shrink-0 text-muted-foreground" aria-hidden />
      <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.baseName + file.ext}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(file.tempId)}
        className="shrink-0 text-muted-foreground"
        aria-label="삭제"
        disabled={disabled}
      ><XIcon size={16} aria-hidden /></Button>
    </li>
  );
}

