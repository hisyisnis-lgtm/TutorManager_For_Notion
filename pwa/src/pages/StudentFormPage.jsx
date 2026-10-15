import { SITE_ORIGIN } from '../constants.js';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { Alert, AlertDescription } from '../components/shadcn/alert';
import { Button } from '../components/shadcn/button';
import { Input } from '../components/shadcn/input';
import { Textarea } from '../components/shadcn/textarea';
import PageHeader from '../components/layout/PageHeader.jsx';
import SubmitButton from '../components/ui/SubmitButton.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import { createStudent, updateStudent, parseStudent, STATUS_OPTIONS, markStudentSharedIfEmpty } from '../api/students.js';
import { fetchUnlinkedConsults, matchConsults, linkConsultToStudent } from '../api/consults.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { getPage } from '../api/notionClient.js';
import { useData } from '../context/DataContext.jsx';
import { PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY } from '../constants/theme.js';
import { LinkIcon } from '@phosphor-icons/react';

// 0/O, 1/I/l 제외 — 혼동 없는 대문자+숫자 32자
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function formatApplied(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function emptyStudentForm(isEdit) {
  return {
    name: '',
    phone: '',
    email: '',
    level: '',
    goal: '',
    status: '🟢 수강중',
    memo: '',
    bookingCode: isEdit ? '' : generateCode(),
  };
}

export default function StudentFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { refresh: refreshAll } = useData();

  const [form, setForm] = useState(() => emptyStudentForm(isEdit));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [initial, setInitial] = useState(null);
  const [savedCode, setSavedCode] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [loadedId, setLoadedId] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!isEdit) {
      setForm(emptyStudentForm(false));
      setLoading(false);
      setLoadError(null);
      setError(null);
      setLoadedId(null);
      setInitial(null);
      setSavedCode('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setLoadedId(null);
    setInitial(null);
    const load = async () => {
      try {
        const page = await getPage(id);
        if (cancelled) return;
        const s = parseStudent(page);
        setSavedCode(s.bookingCode || '');
        const loaded = {
          name: s.name,
          phone: s.phone || '',
          email: s.email || '',
          level: s.level || '',
          goal: s.goal || '',
          status: s.status || '🟢 수강중',
          memo: s.memo || '',
          bookingCode: s.bookingCode || generateCode(),
        };
        setForm(loaded);
        // 저장 버튼 비활성 판정의 기준점. 자동 발급한 코드까지 포함한 "불러온 그대로"라
        // 손대지 않았는데 변경된 것으로 잡히지 않는다.
        setInitial(loaded);
        setLoadedId(id);
      } catch (e) {
        if (!cancelled) setLoadError(e.message || '학생 정보를 불러오지 못했어요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, isEdit, loadAttempt]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // 바뀐 값이 없으면 저장할 것도 없다 → 수정 버튼 비활성.
  // 키 순서가 같은 리터럴로 만든 객체끼리 비교라 JSON 문자열 비교로 충분하다.
  const canEdit = !isEdit || (!loading && loadedId === id && initial !== null);
  const isDirty = !isEdit || (canEdit && JSON.stringify(form) !== JSON.stringify(initial));
  // 비활성 버튼을 눌렀을 때 무엇이 모자란지 말해주려고 이유를 문자열로 들고 있는다.
  const blockedReason = !form.name.trim() ? '이름을 입력하세요.' : !isDirty ? '변경된 내용이 없어요.' : null;

  // 이름만 일치한 상담 — 자동 연결 대신 한 번 묻는다. { consult, studentId }
  const [nameMatch, setNameMatch] = useState(null);
  const [linking, setLinking] = useState(false);

  const linkConsultAfterCreate = async (studentId, { name, phone }) => {
    if (!studentId) return false;
    let consults;
    try { consults = await fetchUnlinkedConsults(); } catch { return false; }
    const { byPhone, byName } = matchConsults(consults, { name, phone });
    if (byPhone) {
      try {
        await linkConsultToStudent(byPhone.id, studentId);
        invalidateCache('consult:');
        toast.success(`무료상담 신청(${formatApplied(byPhone.appliedAt)})과 연결했어요`);
      } catch (e) {
        toast.error(`상담 연결 실패: ${e.message}`);
      }
      return false;
    }
    if (byName.length > 0) {
      setNameMatch({ consult: byName[0], studentId });
      return true; // 다이얼로그가 닫힐 때 이동
    }
    return false;
  };

  const confirmNameMatch = async () => {
    const { consult, studentId } = nameMatch;
    setLinking(true);
    try {
      await linkConsultToStudent(consult.id, studentId);
      invalidateCache('consult:');
      toast.success('무료상담 신청과 연결했어요');
    } catch (e) {
      toast.error(`상담 연결 실패: ${e.message}`);
    } finally {
      setLinking(false);
      setNameMatch(null);
      navigate('/students');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canEdit || saving || (isEdit && !isDirty)) return;
    if (!form.name.trim()) {
      setError('이름을 입력하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateStudent(id, { ...form, name: form.name.trim() });
        refreshAll();
        navigate(-1);
      } else {
        const created = await createStudent({ ...form, name: form.name.trim() });
        refreshAll();
        // 무료상담 자동 연결(2026-09-04) — 같은 전화번호의 신청을 찾아 학생을 붙이고 '완료'로.
        // 이름만 같으면 묻는다(동명이인). 연결 실패는 등록 자체를 막지 않는다.
        const asked = await linkConsultAfterCreate(created?.id, { name: form.name.trim(), phone: form.phone });
        if (!asked) navigate('/students');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && loading) return <><PageHeader title="학생 수정" back /><LoadingSpinner /></>;
  if (!canEdit) return (
    <>
      <PageHeader title="학생 수정" back />
      <ErrorMessage
        message={loadError || '학생 정보를 불러오지 못했어요.'}
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      />
    </>
  );

  return (
    <>
      <PageHeader title={isEdit ? '학생 수정' : '학생 추가'} back />

      {/* 필드가 9개 연속으로 같은 간격이면 어디까지가 한 묶음인지 안 보인다(2026-08-26 정리).
          그룹 안은 16px, 그룹 사이는 28px로 리듬을 준다. 하단은 BottomNav를 피해 96px. */}
      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-24" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {error && (
          <Alert variant="destructive">
            <WarningCircleIcon size={16} weight="fill" aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── 누구인가 ───────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 이름 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            이름 *
          </span>
          <Input
            value={form.name}
            onChange={set('name')}
            placeholder="홍길동"
            required
          />
        </div>

        {/* 전화번호 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            전화번호 (선택)
          </span>
          <Input
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="010-0000-0000"
          />
        </div>

        {/* 이메일 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            이메일 (선택)
          </span>
          <Input
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="example@email.com"
          />
        </div>

        </div>

        {/* ── 학습 정보 (서술형) ───────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 레벨 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            레벨 (선택)
          </span>
          <Textarea
            value={form.level}
            onChange={set('level')}
            placeholder="예: 초급, 중급, 고급"
            rows={3}
          />
        </div>

        {/* 목표 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            목표 (선택)
          </span>
          <Textarea
            value={form.goal}
            onChange={set('goal')}
            placeholder="예: 수능 1등급, 회화 향상"
            rows={3}
          />
        </div>

        {/* 메모 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            메모 (선택)
          </span>
          <Textarea
            value={form.memo}
            onChange={set('memo')}
            placeholder="특이사항, 참고 정보 등"
            rows={3}
          />
        </div>

        </div>

        {/* ── 분류·액션 ───────────────────────
            상태는 원래 이름 바로 밑에 있었는데, 신규 등록 시 항상 기본값(수강중)이고
            수정도 드물어 연락처보다 앞설 이유가 없었다(2026-08-26 정리). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 상태 */}
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            상태
          </span>
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className="px-2 py-3 rounded-xl text-sm bg-white"
                style={{
                  flex: 1, minWidth: 0,
                  // 선택 표현은 면(파스텔)·2px 컬러 보더가 아니라 브랜드 링 그림자로 — 앱 공통 어법.
                  // 보더가 아니라 box-shadow라 선택/해제 때 1px도 밀리지 않는다.
                  border: 'none',
                  boxShadow: form.status === s ? 'var(--shadow-border-selected)' : 'var(--shadow-border)',
                  color: form.status === s ? TEXT_PRIMARY : TEXT_SECONDARY,
                  fontWeight: form.status === s ? 700 : 500,
                  cursor: 'pointer',
                  transitionProperty: 'box-shadow, color',
                  transitionDuration: '150ms',
                  transitionTimingFunction: 'var(--ease-out)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: TEXT_SECONDARY }}>학생앱 제공은 학생 상세에서 설정할 수 있어요. 켜면 숙제 관리도 함께 시작해요.</p>

        <p className="text-xs leading-relaxed" style={{ color: TEXT_SECONDARY }}>홈페이지 학생앱은 계정 연결을 마친 학생에게 안내해 주세요.</p>
        {/* 학생앱은 홈페이지 계정으로 로그인한다. 내부 예약 코드는 전달하지 않는다. */}
        {isEdit && (
          <Button
            type="button"
            block
            variant="outline"
            disabled={saving}
            onClick={async () => {
              const text = 'https://tiantianchinese.com/personal/\n홈페이지 계정으로 로그인해 주세요. 선생님이 학생앱을 제공한 계정에서 이용할 수 있어요.';
              try {
                await navigator.clipboard.writeText(text);
                toast.success('학생앱 로그인 안내를 복사했어요.');
                // 첫 안내 공유 시점은 기존과 같이 먹이 계산의 시작점으로 유지한다.
                markStudentSharedIfEmpty(id).catch(() => toast.warning('로그인 안내는 복사했지만 공유일을 기록하지 못했어요.'));
              } catch {
                toast.error('로그인 안내를 복사하지 못했어요.');
              }
            }}
          >
            {/* antd의 icon prop 대신 children으로 넣는다 — 우리 Button은 gap-2로 간격을 준다.
                사슬 모양은 획으로 읽히는 구조 아이콘이라 fill이면 뭉갠다 → bold(§19.3).
                크기는 버튼 안 아이콘 토큰 20px(§19.2, 16은 인라인 메타용). */}
            <LinkIcon weight="bold" size={20} color={PRIMARY} />
            홈페이지 학생앱 안내 복사
          </Button>
        )}

        </div>


        {isEdit && savedCode && (
          <Button type="button" block variant="outline" disabled={saving} onClick={async () => {
            const personalUrl = SITE_ORIGIN + '/personal/' + encodeURIComponent(savedCode);
            const cleanName = form.name.replace(/[\u200B-\u200D\uFE0F\uFEFF]/g, '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
            try {
              await navigator.clipboard.writeText(personalUrl + '\n[' + cleanName + '님 학생코드 - ' + savedCode + ']');
              toast.success('기존 접속 링크를 복사했어요.');
              markStudentSharedIfEmpty(id).catch(() => toast.warning('링크는 복사했지만 공유일을 기록하지 못했어요.'));
            } catch { toast.error('기존 접속 링크를 복사하지 못했어요.'); }
          }}>
            <LinkIcon weight="bold" size={20} color={PRIMARY} />
            기존 접속 링크 복사
          </Button>
        )}
        <SubmitButton htmlType="submit" loading={saving} blockedReason={blockedReason}>
          {isEdit ? '수정 완료' : '학생 추가'}
        </SubmitButton>
      </form>
      {nameMatch && (
        <ConfirmDialog
          title="무료상담 신청 기록이 있어요"
          message={`${nameMatch.consult.name}님이 ${formatApplied(nameMatch.consult.appliedAt)}에 신청한 상담이 있어요.\n같은 분이면 이 학생과 연결할까요? (전화번호가 달라 자동 연결하지 않았어요)`}
          confirmLabel="연결"
          cancelLabel="아니요"
          danger={false}
          loading={linking}
          onConfirm={confirmNameMatch}
          onCancel={() => { setNameMatch(null); navigate('/students'); }}
        />
      )}
    </>
  );
}
