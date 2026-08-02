import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Modal, Spin, App } from 'antd';
import { CaretLeftIcon, MicrophoneIcon, ImageSquareIcon, ClipboardTextIcon, PaperPlaneTiltIcon, ChatTeardropTextIcon } from '@phosphor-icons/react';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import FilePreview from '../components/ui/FilePreview.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
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
import { retryTransient } from '../api/fetchTimeout.js';
import { reportHandledError } from '../utils/errorReporter.js';
import { formatDateTimeCompact } from '../utils/dateUtils.js';
import { markViewed } from '../utils/homeworkViewed.js';
import { writeCacheValue } from '../hooks/useCachedResource.js';
import useFileAttach, { MAX_FILES } from '../hooks/useFileAttach.js';
import {
  PRIMARY, PRIMARY_BG, PRIMARY_ALPHA_20,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_INACTIVE,
  BG_APP, BORDER_NEUTRAL,
  STATUS_ERROR, STATUS_SUCCESS_BG,
} from '../constants/theme.js';
import {
  dedupeFileNames,
  isImageByName,
  isPdfByName,
} from '../utils/audioFile.js';

// Notion file_upload는 생성 후 1시간 안에 첨부해야 만료되지 않는다 — 여유를 두고 50분까지만 재사용.
const REUSE_WINDOW_MS = 50 * 60 * 1000;

function genStudentName(title, index) {
  // 한자(\p{Script=Han})도 보존 — "声调练习" 같은 중국어 제목이 통째로 지워지지 않게
  const base = title.replace(/[^\w가-힣\p{Script=Han}]/gu, '').slice(0, 20) || '숙제';
  return `${base}_${String(index).padStart(2, '0')}`;
}

export default function PersonalHomeworkDetailPage() {
  const { studentToken, hwId } = useParams();
  const navigate = useNavigate();
  // 정적 message는 테마 컨텍스트를 못 받아 콘솔 경고 + 스타일 불일치 — App.useApp() 사용(강사판과 통일)
  const { message } = App.useApp();

  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 외부 페이지에 표시되는 저장 대기 — 카테고리별 분리.
  // 항목: { tempId, file, baseName, ext } — ext는 점 포함(`.mp3`) 또는 빈 문자열
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);

  const [uploading, setUploading] = useState(false);
  // 업로드 진행 표시 — { done, total }. 스피너만 돌면 학생이 "멈췄다"고 판단해 앱을 닫는다.
  const [progress, setProgress] = useState(null);
  const [deletingFileName, setDeletingFileName] = useState(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);

  // 이번 화면에서 이미 Notion에 올라간 파일 — tempId → { fileUploadId, fileName, at }.
  // 중간에 실패해도 성공한 파일은 다시 올리지 않는다(Notion file_upload는 1시간 유효).
  const uploadedRef = useRef(new Map());

  // 저장 전 이탈 차단 — pending 파일이 하나라도 있으면 dirty.
  // 강사 페이지(HomeworkDetailPage)와 동일 패턴: handleBack 가드 + popstate 가드 + ConfirmDialog.
  const isDirty = pendingAudio.length + pendingDocs.length > 0;
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingNavRef = useRef(null);

  // 브라우저 뒤로가기(swipe·Android back) 차단 — HashRouter 는 useBlocker 미지원이라
  // history.pushState 더미 entry + popstate 리스너로 가드.
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
    setLoading(true);
    setError(null);
    try {
      const pages = await fetchMyHomework(studentToken);
      const list = pages.map(parseHomework);
      const found = list.find((h) => h.id === hwId) ?? null;
      if (!found) throw new Error('숙제를 찾을 수 없습니다.');
      setHw(found);
      // 전체 목록을 이미 받아왔으니 홈/보관함 목록 캐시도 갱신 — 제출 직후 홈 복귀 시
      // 방금 제출한 숙제가 "제출 전"으로 잠깐 보이는 stale 플래시 방지
      writeCacheValue(`student:homework:${studentToken}`, list);
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

  // 외부 페이지·기존 저장본 합산 — 5개 제한 판정에 쓰인다.
  const fixedCount = (hw?.submitFiles?.length ?? 0) + pendingAudio.length + pendingDocs.length;

  // 파일 첨부 모달 로직 — 공용 훅 (state·picker·검증·이름 짓기)
  const attach = useFileAttach({
    genName: (index) => genStudentName(hw?.title ?? '숙제', index),
    fixedCount,
    message,
    onConfirm: (kind, files) => {
      if (kind === 'audio') {
        setPendingAudio((prev) => [...prev, ...files]);
      } else if (kind === 'document') {
        setPendingDocs((prev) => [...prev, ...files]);
      }
    },
  });
  const { openModal } = attach;

  const removePendingAudio = (tempId) => setPendingAudio((prev) => prev.filter((f) => f.tempId !== tempId));
  const removePendingDoc = (tempId) => setPendingDocs((prev) => prev.filter((f) => f.tempId !== tempId));

  // 저장 — 양쪽 카테고리 pending 합쳐서 한 번에 업로드 + Notion PATCH.
  const handleSaveSubmit = async () => {
    const all = [...pendingAudio, ...pendingDocs];
    if (all.length === 0) return;
    const isFirstSubmit = !hw?.submitMark;
    // 진행률은 파일 개수가 아니라 실제 전송 바이트 기준 — 큰 파일 하나를 올릴 때도 숫자가 움직인다.
    const totalBytes = all.reduce((sum, pf) => sum + (pf.file?.size || 0), 0) || 1;
    let bytesDone = 0;
    // 마지막 제출 요청이 남아 있으므로 업로드만으로 100%를 보여주지 않는다.
    const pct = (bytes) => Math.min(99, Math.round((bytes / totalBytes) * 100));
    setUploading(true);
    setProgress({ done: 0, total: all.length, percent: 0 });
    try {
      // 동명 파일 충돌 방지 — 기존 제출본 + 이번 pending 이름을 합쳐 유일화한다.
      // (다운로드/미리보기가 파일을 이름으로 찾으므로 같은 이름이면 전부 첫 번째로만 조회됨)
      // 기존 이름은 보존되고 새 파일에만 ` (2)` 접미사가 붙는다. 서버도 한 번 더 dedup.
      const existingNames = (hw?.submitFiles ?? []).map((f) => f.name);
      const allNames = dedupeFileNames([...existingNames, ...all.map((pf) => pf.baseName + pf.ext)]);
      const newNames = allNames.slice(existingNames.length);
      const uploaded = [];
      for (let i = 0; i < all.length; i += 1) {
        const pf = all[i];
        const fullName = newNames[i];
        // 앞선 시도에서 이미 올라간 파일은 건너뛴다 — 3개 중 2개를 올리고 실패했을 때
        // 처음부터 다시 올리느라 또 오래 기다리는 일을 막는다.
        const done = uploadedRef.current.get(pf.tempId);
        if (done && done.fileName === fullName && Date.now() - done.at < REUSE_WINDOW_MS) {
          bytesDone += pf.file?.size || 0;
          uploaded.push({ fileUploadId: done.fileUploadId, fileName: done.fileName });
          setProgress({ done: i + 1, total: all.length, percent: pct(bytesDone) });
          continue;
        }
        const namedFile = new File([pf.file], fullName, { type: pf.file.type });
        // 업로드만 재시도한다 — 제출 PATCH는 이미 올린 file_upload를 다시 붙이는 요청이라
        // 재시도가 오히려 중복 첨부 오류를 부를 수 있다. 실패해도 여기 캐시가 남아 재시도가 빠르다.
        // 재시도로 같은 파일을 다시 올려도 bytesDone은 그대로라 진행률이 뒤로 가지 않는다.
        const { fileUploadId } = await retryTransient(() => uploadStudentFile(studentToken, namedFile, {
          onProgress: (loaded) => setProgress({ done: i, total: all.length, percent: pct(bytesDone + loaded) }),
        }));
        bytesDone += pf.file?.size || 0;
        uploadedRef.current.set(pf.tempId, { fileUploadId, fileName: fullName, at: Date.now() });
        uploaded.push({ fileUploadId, fileName: fullName });
        setProgress({ done: i + 1, total: all.length, percent: pct(bytesDone) });
      }
      await submitHomework(studentToken, hwId, uploaded);
      uploadedRef.current.clear();
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
      setUploading(false);
      setProgress(null);
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
      onClick={handleBack}
      aria-label="뒤로"
      className="transition-[color] duration-150 ease-out"
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

  // 저장본을 카테고리별로 분리 — PDF/이미지가 아닌 모든 파일은 녹음 섹션으로.
  // 옛 데이터(확장자 누락 등)도 누락 없이 표시되도록 명시적 document 만 분리하고 나머지는 audio.
  const isDoc = (f) => isImageByName(f.name) || isPdfByName(f.name);
  const submitAudio = (hw.submitFiles ?? []).filter((f) => !isDoc(f));
  const submitDocs = (hw.submitFiles ?? []).filter(isDoc);
  const feedbackAudio = (hw.feedbackFiles ?? []).filter((f) => !isDoc(f));
  const feedbackDocs = (hw.feedbackFiles ?? []).filter(isDoc);

  const pendingTotal = pendingAudio.length + pendingDocs.length;

  // 학생이 저장한 파일 한 행 — FilePreview wrapper.
  // kind: 'submit' | 'feedback' | 'assignment'
  const renderStoredFile = (f, kind, idx = 0) => (
    <FilePreview
      key={`${kind}-${idx}-${f.name}`}
      file={f}
      onGetFreshUrl={async () => {
        const h = await getFreshHw();
        const arr = kind === 'submit' ? h?.submitFiles
                  : kind === 'feedback' ? h?.feedbackFiles
                  : h?.assignmentFiles;
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

        {/* ===== 1. 부여한 숙제 ===== */}
        <AreaHeading icon={<ClipboardTextIcon size={18} weight="fill" />} label="부여한 숙제" first />
        {hw.content && (
          <SectionCard label="숙제 내용">
            <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{hw.content}</p>
          </SectionCard>
        )}
        {hw.assignmentFiles?.length > 0 && (
          <SectionCard label="숙제 파일">
            {hw.assignmentFiles.map((f, i) => (
              <div key={`assignment-${i}-${f.name}`} style={{ marginBottom: 8 }}>
                {renderStoredFile(f, 'assignment', i)}
              </div>
            ))}
          </SectionCard>
        )}

        {/* ===== 2. 내 제출 ===== */}
        <AreaHeading icon={<PaperPlaneTiltIcon size={18} weight="fill" />} label="내 제출" />
        {(submitAudio.length > 0 || submitDocs.length > 0) && (
          <SectionCard label="내 제출 파일">
            {[...submitAudio, ...submitDocs].map((f, i) => (
              <div key={`submit-${i}-${f.name}`} style={{ marginBottom: 8 }}>
                {renderStoredFile(f, 'submit', i)}
              </div>
            ))}
            {hw.submitDate && (
              <p style={{ fontSize: 12, color: TEXT_TERTIARY, marginTop: 4 }}>
                제출일: <span className="tabular-nums">{formatDateTimeCompact(hw.submitDate)}</span>
              </p>
            )}
          </SectionCard>
        )}
        {/* "내 숙제 제출" 추가 업로드 영역 — 미제출/제출완료 시. 학생이 더 올리거나 수정할 수 있도록. */}
        {canEdit && (
          <SectionCard label="내 숙제 제출">
            <p style={{ fontSize: 13, color: TEXT_INACTIVE, lineHeight: 1.6, margin: '-2px 0 14px' }}>
              {hw.status === '미제출'
                ? '공부한 내용을 녹음·사진·PDF로 올려주세요'
                : '더 올리거나 수정할 수 있어요'}
            </p>

            {pendingAudio.length > 0 && (
              <PendingInline
                label={`새 녹음 파일 (${pendingAudio.length}/${MAX_FILES})`}
                items={pendingAudio}
                onRemove={removePendingAudio}
                disabled={uploading}
              />
            )}
            {fixedCount < MAX_FILES && (
              <SectionEntryButton
                icon={<MicrophoneIcon size={18} weight="fill" />}
                label="녹음 제출하기"
                onClick={() => openModal('audio')}
                disabled={uploading}
              />
            )}

            <div style={{ height: 8 }} />

            {pendingDocs.length > 0 && (
              <PendingInline
                label={`새 이미지·PDF (${pendingDocs.length}/${MAX_FILES})`}
                items={pendingDocs}
                onRemove={removePendingDoc}
                disabled={uploading}
              />
            )}
            {fixedCount < MAX_FILES && (
              <SectionEntryButton
                icon={<ImageSquareIcon size={18} weight="fill" />}
                label="사진·문서 제출하기"
                onClick={() => openModal('document')}
                disabled={uploading}
              />
            )}
          </SectionCard>
        )}

        {/* ===== 3. 선생님 피드백 ===== */}
        {(hw.feedbackText || feedbackAudio.length > 0 || feedbackDocs.length > 0) && (
          <>
            <AreaHeading icon={<ChatTeardropTextIcon size={18} weight="fill" />} label="선생님 피드백" />
            <SectionCard label={null}>
              {hw.feedbackText && (
                <p style={{ fontSize: 14, color: '#262626', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: (feedbackAudio.length + feedbackDocs.length) > 0 ? '0 0 12px' : 0 }}>
                  {hw.feedbackText}
                </p>
              )}
              {[...feedbackAudio, ...feedbackDocs].map((f, i) => (
                <div key={`feedback-${i}-${f.name}`} style={{ marginBottom: 8 }}>
                  {renderStoredFile(f, 'feedback', i)}
                </div>
              ))}
              {hw.feedbackDate && (
                <p style={{ fontSize: 12, color: TEXT_INACTIVE, marginTop: 8 }}>
                  피드백일: <span className="tabular-nums">{formatDateTimeCompact(hw.feedbackDate)}</span>
                </p>
              )}
            </SectionCard>
          </>
        )}

        {/* 숙제 제출 — 두 카테고리 pending 을 한 번에 업로드 (카드 외부에 둬서 액션 강조) */}
        {canEdit && pendingTotal > 0 && (
          <Button
            type="primary"
            block
            onClick={handleSaveSubmit}
            loading={uploading}
            style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15, marginTop: 4 }}
          >
            숙제 제출하기 ({pendingTotal}개 파일)
          </Button>
        )}

        </div>
      </div>

      {/* ===== 파일 추가 팝업 — 공용 모달 (modalKind 에 따라 audio/document 분기) ===== */}
      <FileAttachModal
        attach={attach}
        titles={{ audio: '녹음 제출', document: '사진·문서 제출', fallback: '파일 제출' }}
        hints={{
          audio: '선생님께 보낼 녹음을 선택하거나 직접 녹음해주세요',
          document: '선생님께 보낼 사진이나 PDF를 선택해주세요',
        }}
      />

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
            className="duration-150 ease-out"
            style={{ flex: 1, height: 44, borderRadius: 12, border: 'none', background: STATUS_ERROR, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            삭제
          </button>
        </div>
      </Modal>

      {/* 업로드/삭제 중 딤 오버레이
          zIndex는 antd Modal(기본 1000)보다 낮아야 한다 — 예전 9999에서는 업로드 중 뒤로가기를
          눌렀을 때 이탈 확인창이 이 딤 뒤에 깔려 보이지도 눌리지도 않았다. 학생 눈엔 화면이
          멈춘 것처럼 보여 앱을 강제 종료하게 만들던 경로다. (BottomNav는 50이라 여전히 위) */}
      {(uploading || deletingFileName !== null) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: '0 32px' }}>
          {/* 문구는 어두운 패널 안에 — 반투명 딤 위에 흰 글씨만 얹으면 뒤 카드와 겹쳐 읽히지 않는다 */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            background: 'rgba(0,0,0,0.78)', borderRadius: 16, padding: uploading ? '24px 28px' : 20,
          }}>
            {/* 스피너는 진행률이 잠시 멈춰도 "살아 있다"는 신호를 준다 — 막대와 함께 둔다 */}
            <Spin size="large" />
            {uploading && (
              <>
                <p aria-live="polite" style={{ margin: 0, color: '#fff', fontSize: 14, fontWeight: 600, textAlign: 'center', lineHeight: 1.7 }}>
                  {/* 지금 올리는 중인 파일 번호(1-base) — 0/2로 시작하면 멈춘 것처럼 보인다 */}
                  {progress && progress.total > 1
                    ? `${Math.min(progress.done + 1, progress.total)}/${progress.total} 파일 올리는 중이에요`
                    : '파일 올리는 중이에요'}
                  <br />
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>화면을 닫지 말고 잠시만 기다려주세요</span>
                </p>
                {/* 실제 전송량 기준 막대 — 큰 파일 하나를 올리는 동안에도 눈에 보이게 움직인다 */}
                <div
                  role="progressbar"
                  aria-valuenow={progress?.percent ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{ width: 200, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}
                >
                  <div
                    className="transition-[width] duration-200 ease-out"
                    style={{ width: `${progress?.percent ?? 0}%`, height: '100%', borderRadius: 999, background: '#fff' }}
                  />
                </div>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: -4 }}>
                  {progress?.percent ?? 0}%
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 저장 전 이탈 확인 — pending 파일이 있는 상태에서 뒤로가기 시도 시 */}
      {showLeaveConfirm && (
        <ConfirmDialog
          title={uploading ? '제출 중이에요' : '페이지를 나가시겠습니까?'}
          message={uploading
            ? '지금 나가면 제출이 중단될 수 있어요. 잠시만 기다려주세요.'
            : '저장하지 않은 파일이 있어요. 지금 나가면 추가한 파일이 사라집니다.'}
          confirmLabel={uploading ? '그래도 나가기' : '나가기'}
          cancelLabel={uploading ? '기다리기' : '계속 작성'}
          onConfirm={handleLeaveConfirm}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </>
  );
}

// ===== 보조 컴포넌트 =====

function SectionCard({ label, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '16px', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
      {label && <SectionHeading style={{ marginBottom: 12 }}>{label}</SectionHeading>}
      {children}
    </div>
  );
}

// 3영역(부여한 숙제 / 내 제출 / 선생님 피드백) 시각 구분용 헤더.
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

// SectionCard 내부에서 쓰는 인라인 버전 — 카드 중첩 방지 (boxShadow·padding 없음)
function PendingInline({ label, items, onRemove, disabled }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: TEXT_INACTIVE, margin: '0 0 6px' }}>{label}</p>
      {items.map((pf) => (
        <div key={pf.tempId} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: STATUS_SUCCESS_BG, border: '1px solid #b7eb8f',
          borderRadius: 12, marginBottom: 6,
        }}>
          <span style={{ fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        background: PRIMARY_BG, border: `1.5px solid ${PRIMARY_ALPHA_20}`,
        color: PRIMARY, fontSize: 14, fontWeight: 600,
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
