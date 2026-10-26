import {
  useState,
  useEffect,
  useRef } from 'react';
import { useNavigate,
  useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { WarningCircleIcon, WarningIcon } from '@phosphor-icons/react';
import { Alert, AlertTitle, AlertDescription } from '../components/shadcn/alert';
import { Input } from '../components/shadcn/input';
import { Textarea } from '../components/shadcn/textarea';
import SelectField from '../components/ui/SelectField.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import HomeworkProgressOverlay from '../components/homework/HomeworkProgressOverlay.jsx';
import HomeworkAttachmentFields from '../components/homework/HomeworkAttachmentFields.jsx';
import HomeworkCompleteScreen from '../components/homework/HomeworkCompleteScreen.jsx';
import SubmitButton from '../components/ui/SubmitButton.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import useUnsavedChanges from '../hooks/useUnsavedChanges.js';
import { markPendingHwDone } from '../hooks/usePendingClassState.js';
import { createHomework,
  notifyHomework,
  uploadTeacherFile } from '../api/homework.js';
import { queryAll } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { captureAuthScope, isAuthScopeCurrent } from '../api/authState.js';
import useFileAttach from '../hooks/useFileAttach.js';
import { dedupeFileNames } from '../utils/audioFile.js';
import { parseStudent,
  STUDENTS_DB } from '../api/students.js';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  BG_APP } from '../constants/theme.js';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';

const LABEL = { fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6, fontWeight: 600 };

function genAssignmentName(title, index) {
  // 한자(\p{Script=Han})도 보존 — 중국어 과외 특성상 "声调练习" 같은 제목이 통째로 지워지면 안 됨
  const base = (title || '숙제').replace(/[^\w가-힣\p{Script=Han}]/gu, '').slice(0, 20) || '숙제';
  return `${base}_숙제_${String(index).padStart(2, '0')}`;
}

export default function HomeworkFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetStudentId = searchParams.get('studentId');
  // 홈 '수업 준비' 카드에서 온 경우 — 저장 성공 시에만 그 수업의 '숙제 부여 완료'를 기록한다
  const fromClassId = searchParams.get('fromClassId');

  const [students, setStudents] = useState([]);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [studentsLoadError, setStudentsLoadError] = useState(false);
  const [studentId, setStudentId] = useState(presetStudentId || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [error, setError] = useState(null);
  const [complete, setComplete] = useState(null);
  const mountedRef = useRef(false);
  const savingRef = useRef(false);
  const saveIdRef = useRef(0);

  // 카테고리별 외부 pending
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);
  const uploadedRef = useRef(new Map());

  useEffect(() => {
    mountedRef.current = true;
    // 숙제는 VIP(숙제 관리 대상) 학생만 — 일반 학생 오등록/알림톡 오발송 방지
    queryAll(STUDENTS_DB, {
      and: [
        { property: '상태', select: { equals: '🟢 수강중' } },
        { property: 'VIP', checkbox: { equals: true } },
      ],
    }, [
      { property: '이름', direction: 'ascending' },
    ]).then((pages) => {
      if (!mountedRef.current) return;
      setStudents(pages.map(parseStudent));
    }).catch(() => {
      // 무음 실패 금지 — 로드 실패를 "비VIP 학생"으로 오판(presetBlocked)하지 않도록 구분
      if (mountedRef.current) setStudentsLoadError(true);
    }).finally(() => { if (mountedRef.current) setStudentsLoaded(true); });
    return () => {
      mountedRef.current = false;
      saveIdRef.current += 1;
    };
  }, []);

  const pendingTotal = pendingAudio.length + pendingDocs.length;
  const fixedCount = pendingTotal; // 등록 단계라 "기존 저장본"이 없음
  const isDirty = !complete && (!!title.trim() || !!content.trim() || pendingTotal > 0 || studentId !== (presetStudentId || ''));
  const leaveGuard = useUnsavedChanges(isDirty || saving);

  // 파일 첨부 모달 로직 — 공용 훅 (state·picker·검증·이름 짓기)
  const attach = useFileAttach({
    directSelection: true,
    genName: (index) => genAssignmentName(title, index),
    fixedFiles: [...pendingAudio, ...pendingDocs],
    onConfirm: (kind, files) => {
      if (savingRef.current || !mountedRef.current) return;
      if (kind === 'audio') {
        setPendingAudio((prev) => [...prev, ...files]);
      } else if (kind === 'document') {
        setPendingDocs((prev) => [...prev, ...files]);
      }
    },
  });

  const removePending = (tempId) => {
    if (savingRef.current) return;
    setPendingAudio((prev) => prev.filter((file) => file.tempId !== tempId));
    setPendingDocs((prev) => prev.filter((file) => file.tempId !== tempId));
    uploadedRef.current.delete(tempId);
  };

  const handleBack = () => {
    leaveGuard.requestLeave(() => navigate(-1));
  };

  const handleLeaveConfirm = () => {
    saveIdRef.current += 1;
    attach.cancelPreparation();
    leaveGuard.confirmLeave();
  };

  const handleSubmit = async () => {
    if (savingRef.current || complete) return;
    if (presetBlocked) { setError('숙제 관리 대상(VIP) 학생이 아니에요.'); return; }
    if (!studentId) { setError('학생을 선택해주세요.'); return; }
    if (!title.trim()) { setError('숙제 제목을 입력해주세요.'); return; }
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    const saveId = ++saveIdRef.current;
    const current = () => mountedRef.current && saveId === saveIdRef.current && isAuthScopeCurrent(auth);

    savingRef.current = true;
    setSaving(true);
    setSaveProgress({ stage: pendingTotal > 0 ? 'checking' : 'saving' });
    setError(null);
    try {
      const pending = [...pendingAudio, ...pendingDocs];
      const all = pending.length > 0
        ? await attach.prepareForSubmit(pending, { onStage: (state) => { if (current()) setSaveProgress(state); } }) : [];
      if (all === null || !current()) return;
      const fileNames = dedupeFileNames(all.map((pf) => pf.baseName + pf.ext));
      const uploaded = [];
      for (let i = 0; i < all.length; i += 1) {
        if (!current()) return;
        const pf = all[i];
        const fullName = fileNames[i];
        // 원본 File 그대로 전달하고 이름만 지정 — 재포장하면 안드로이드에서 뒤가 잘린다.
        const cached = uploadedRef.current.get(pf.tempId);
        if (cached && isAuthScopeCurrent(cached.auth) && cached.requestedFileName === fullName && Date.now() - cached.at < 50 * 60 * 1000) {
          uploaded.push(cached.result);
          continue;
        }
        setSaveProgress({ stage: 'uploading', detail: `${all.length}개 중 ${i + 1}번째 파일 전송 중` });
        const result = await uploadTeacherFile(pf.file, fullName);
        if (!current()) return;
        const uploadedFile = { ...result, fileName: result.fileName || fullName };
        uploadedRef.current.set(pf.tempId, { auth, requestedFileName: fullName, at: Date.now(), result: uploadedFile });
        uploaded.push(uploadedFile);
      }
      if (!current()) return;
      setSaveProgress({ stage: 'saving', detail: '숙제 내용과 첨부 파일을 저장 중' });
      const created = await createHomework({
        studentPageId: studentId,
        title: title.trim(),
        content: content.trim(),
        files: uploaded.length > 0 ? uploaded : undefined,
        classId: fromClassId || undefined,
      });
      if (!current()) return;
      if (created?.id) void notifyHomework('assign', created.id).then(result => {
        if (current() && !result.ok && !result.ignored) toast.warning(result.message);
      });
      if (fromClassId) markPendingHwDone(fromClassId);
      invalidateCache('homework');
      leaveGuard.markSaved();
      setComplete({ title: title.trim() });
    } catch (e) {
      if (current()) setError(e.message);
    } finally {
      if (mountedRef.current && saveId === saveIdRef.current) {
        savingRef.current = false;
        setSaving(false);
        setSaveProgress(null);
      }
    }
  };

  const studentOptions = students.map((s) => ({
    value: s.id,
    label: s.name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim(),
  }));

  // presetStudentId(상세화면·직접 URL)가 VIP 목록에 없으면 비VIP → 등록 차단
  // 로드 실패 시엔 판정 보류 (실패를 "비VIP"로 오판하면 VIP 학생 등록이 오탐 차단됨)
  const presetOption = presetStudentId ? studentOptions.find((o) => o.value === presetStudentId) : null;
  const presetBlocked = !!presetStudentId && studentsLoaded && !studentsLoadError && !presetOption;

  // 제출 버튼이 '왜 비활성인지' 말할 수 있게, handleSubmit의 검사 순서를 그대로 문구로 갖는다.
  const blockedReason =
    presetBlocked ? '숙제 관리 대상(VIP) 학생이 아니에요.'
    : !studentId ? '학생을 선택해주세요.'
    : !title.trim() ? '숙제 제목을 입력해주세요.'
    : null;

  if (complete) return <HomeworkCompleteScreen
    title="숙제를 등록했어요"
    name={complete.title}
    onConfirm={() => navigate('/homework', { replace: true })}
  />;

  return (
    <>
      <PageHeader title="숙제 추가" back onBack={handleBack} />

      <div className="px-4 pt-4 space-y-6" style={{ paddingBottom: `calc(${ABOVE_BOTTOM_NAV} + 88px)` }}>
        {/* 학생 선택 */}
        <div>
          <label style={LABEL}>학생</label>
          {studentsLoadError && (
            <Alert variant="destructive" className="mb-2">
              <WarningCircleIcon size={16} weight="fill" aria-hidden />
              <AlertTitle>학생 목록을 불러오지 못했어요</AlertTitle>
              <AlertDescription>네트워크 확인 후 페이지를 새로고침해주세요.</AlertDescription>
            </Alert>
          )}
          {presetStudentId ? (
            presetBlocked ? (
              <Alert variant="warning">
                <WarningIcon size={16} weight="fill" aria-hidden />
                <AlertTitle>숙제 관리 대상 학생이 아니에요</AlertTitle>
                <AlertDescription>숙제는 VIP(숙제 관리 대상) 학생에게만 등록할 수 있어요.</AlertDescription>
              </Alert>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, padding: '8px 0' }}>
                {presetOption?.label ?? '…'}
              </div>
            )
          ) : (
            <SelectField
              value={studentId || undefined}
              onChange={setStudentId}
              placeholder="학생 선택"
              searchable
              searchPlaceholder="학생 이름 검색"
              options={studentOptions}
              disabled={saving}
            />
          )}
        </div>

        {/* 숙제 제목 */}
        <div>
          <label htmlFor="hw-title" style={LABEL}>숙제 제목</label>
          <Input
            id="hw-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 1과 본문 읽기"
            maxLength={100}
            disabled={saving}
          />
        </div>

        {/* 숙제 내용 */}
        <div>
          <label htmlFor="hw-content" style={LABEL}>숙제 내용</label>
          <Textarea
            id="hw-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="학생에게 전달할 숙제 내용을 입력하세요"
            rows={5}
            maxLength={1000}
            showCount
            disabled={saving}
          />
        </div>

        {/* 숙제 파일 */}
        <div>
          <label style={LABEL}>숙제 파일 <span style={{ fontWeight: 400, color: TEXT_TERTIARY }}>(선택)</span></label>

          <HomeworkAttachmentFields
            attach={attach}
            files={[...pendingAudio, ...pendingDocs]}
            onRemove={removePending}
            disabled={saving}
            count={fixedCount}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <WarningCircleIcon size={16} weight="fill" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

      </div>

      <div className="fixed inset-x-0 z-40 border-t border-border px-4 py-3" style={{ bottom: ABOVE_BOTTOM_NAV, background: BG_APP }}>
        <div className="mx-auto max-w-[448px]">
          <SubmitButton size="lg" onClick={handleSubmit} loading={saving} blockedReason={blockedReason}>
            숙제 등록하기
          </SubmitButton>
        </div>
      </div>

      {/* ===== 파일 추가 팝업 — 공용 모달 (kind 분기) ===== */}
      <FileAttachModal
        attach={attach}
        compact
        titles={{ audio: '녹음 파일', document: '이미지·PDF', fallback: '숙제 파일' }}
        hints={{
          audio: '추가할 녹음 파일을 선택하거나 직접 녹음해주세요',
          document: '추가할 이미지 또는 PDF 파일을 선택해주세요',
        }}
      />

      <HomeworkProgressOverlay
        stage={leaveGuard.showLeaveConfirm ? null : saving ? saveProgress?.stage : null}
        message={saveProgress?.stage === 'saving' ? '숙제를 등록하고 있어요' : saveProgress?.message}
        detail={saveProgress?.detail}
      />

      {leaveGuard.showLeaveConfirm && <ConfirmDialog
        title={saving ? '등록 중이에요' : '작성을 그만둘까요?'}
        message={saving ? '지금 나가면 등록이 중단될 수 있어요. 잠시만 기다려주세요.' : '작성한 내용과 추가한 파일이 사라져요.'}
        confirmLabel={saving ? '그래도 나가기' : '나가기'}
        cancelLabel={saving ? '기다리기' : '취소'}
        onConfirm={handleLeaveConfirm}
        onCancel={leaveGuard.cancelLeave}
      />}
    </>
  );
}
