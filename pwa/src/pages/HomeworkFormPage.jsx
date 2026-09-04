import {
  useState,
  useEffect } from 'react';
import { useNavigate,
  useSearchParams } from 'react-router-dom';
import { CircleNotchIcon, WarningCircleIcon, WarningIcon } from '@phosphor-icons/react';
import { Alert, AlertTitle, AlertDescription } from '../components/shadcn/alert';
import { Input } from '../components/shadcn/input';
import { Textarea } from '../components/shadcn/textarea';
import SelectField from '../components/ui/SelectField.jsx';
import { MicrophoneIcon,
  ImageSquareIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import FileAttachModal from '../components/homework/FileAttachModal.jsx';
import SubmitButton from '../components/ui/SubmitButton.jsx';
import SectionEntryButton from '../components/ui/SectionEntryButton.jsx';
import { markPendingHwDone } from '../hooks/usePendingClassState.js';
import { createHomework,
  notifyHomework,
  uploadTeacherFile } from '../api/homework.js';
import { queryAll } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import useFileAttach,
  { MAX_FILES } from '../hooks/useFileAttach.js';
import { parseStudent,
  STUDENTS_DB } from '../api/students.js';
import {
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  STATUS_SUCCESS_BG,
  STATUS_SUCCESS_BORDER } from '../constants/theme.js';

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
  const [error, setError] = useState(null);

  // 카테고리별 외부 pending
  const [pendingAudio, setPendingAudio] = useState([]);
  const [pendingDocs, setPendingDocs] = useState([]);

  useEffect(() => {
    // 숙제는 VIP(숙제 관리 대상) 학생만 — 일반 학생 오등록/알림톡 오발송 방지
    queryAll(STUDENTS_DB, {
      and: [
        { property: '상태', select: { equals: '🟢 수강중' } },
        { property: 'VIP', checkbox: { equals: true } },
      ],
    }, [
      { property: '이름', direction: 'ascending' },
    ]).then((pages) => {
      setStudents(pages.map(parseStudent));
    }).catch(() => {
      // 무음 실패 금지 — 로드 실패를 "비VIP 학생"으로 오판(presetBlocked)하지 않도록 구분
      setStudentsLoadError(true);
    }).finally(() => setStudentsLoaded(true));
  }, []);

  const pendingTotal = pendingAudio.length + pendingDocs.length;
  const fixedCount = pendingTotal; // 등록 단계라 "기존 저장본"이 없음

  // 파일 첨부 모달 로직 — 공용 훅 (state·picker·검증·이름 짓기)
  const attach = useFileAttach({
    genName: (index) => genAssignmentName(title, index),
    fixedCount,
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

  const handleSubmit = async () => {
    if (presetBlocked) { setError('숙제 관리 대상(VIP) 학생이 아니에요.'); return; }
    if (!studentId) { setError('학생을 선택해주세요.'); return; }
    if (!title.trim()) { setError('숙제 제목을 입력해주세요.'); return; }

    setSaving(true);
    setError(null);
    try {
      const all = [...pendingAudio, ...pendingDocs];
      const uploaded = [];
      for (const pf of all) {
        const fullName = pf.baseName + pf.ext;
        // 원본 File 그대로 전달하고 이름만 지정 — 재포장하면 안드로이드에서 뒤가 잘린다.
        const { fileUploadId } = await uploadTeacherFile(pf.file, fullName);
        uploaded.push({ fileUploadId, fileName: fullName });
      }
      const created = await createHomework({
        studentPageId: studentId,
        title: title.trim(),
        content: content.trim(),
        files: uploaded.length > 0 ? uploaded : undefined,
        classId: fromClassId || undefined,
      });
      if (created?.id) notifyHomework('assign', created.id);
      if (fromClassId) markPendingHwDone(fromClassId);
      invalidateCache('homework');
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setSaving(false);
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

  return (
    <>
      <PageHeader title="숙제 추가" back />

      <div className="px-4 pt-4 pb-24 space-y-5">
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
          />
        </div>

        {/* 숙제 파일 — 카테고리별 섹션 */}
        <div>
          <label style={LABEL}>숙제 파일 <span style={{ fontWeight: 400, color: TEXT_TERTIARY }}>(선택)</span></label>

          {pendingAudio.length > 0 && (
            <PendingCard
              label={`새 녹음 파일 (${pendingAudio.length}/${MAX_FILES})`}
              items={pendingAudio}
              onRemove={removePendingAudio}
            />
          )}
          {fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<MicrophoneIcon size={20} weight="fill" />}
              label="녹음 파일 추가"
              onClick={() => openModal('audio')}
            />
          )}

          {pendingDocs.length > 0 && (
            <PendingCard
              label={`새 이미지·PDF (${pendingDocs.length}/${MAX_FILES})`}
              items={pendingDocs}
              onRemove={removePendingDoc}
            />
          )}
          {fixedCount < MAX_FILES && (
            <SectionEntryButton
              icon={<ImageSquareIcon size={20} weight="fill" />}
              label="이미지·PDF 추가"
              onClick={() => openModal('document')}
            />
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <WarningCircleIcon size={16} weight="fill" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <SubmitButton onClick={handleSubmit} loading={saving} blockedReason={blockedReason}>
          등록하기{pendingTotal > 0 ? ` (${pendingTotal}개 파일)` : ''}
        </SubmitButton>
      </div>

      {/* ===== 파일 추가 팝업 — 공용 모달 (kind 분기) ===== */}
      <FileAttachModal
        attach={attach}
        titles={{ audio: '녹음 파일', document: '이미지·PDF', fallback: '숙제 파일' }}
        hints={{
          audio: '추가할 녹음 파일을 선택하거나 직접 녹음해주세요',
          document: '추가할 이미지 또는 PDF 파일을 선택해주세요',
        }}
      />

      {/* 업로드 중 딤 오버레이 */}
      {saving && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <CircleNotchIcon size={24} weight="bold" className="animate-spin" color="#fff" aria-hidden />
        </div>
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

