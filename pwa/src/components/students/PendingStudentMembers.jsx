import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Button } from '../shadcn/button';
import { Card, CardContent } from '../shadcn/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../shadcn/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shadcn/select';
import { getSiteStudentMembers, approveSiteStudentMember } from '../../api/siteStudentMembers.js';
import { getToken } from '../../api/authUtils.js';
import { captureAuthScope, getAuthRevision, isAuthScopeCurrent, subscribeAuthChanges } from '../../api/authState.js';
import { GRAY_100, PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY } from '../../constants/theme.js';
import { SECTION_HEADING } from '../../constants/styles.js';

const joinDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : `${date.toLocaleDateString('ko-KR')} 가입`;
};
const matchesQuery = (member, query) => !query || [member.name, member.email, member.phone]
  .some(value => String(value || '').toLowerCase().includes(query.trim().toLowerCase()));
const enrollmentAttempt = member => member.enrollment?.idempotencyKey ? {
  mode: member.enrollment.mode, idempotencyKey: member.enrollment.idempotencyKey,
  ...(member.enrollment.mode === 'existing' ? { studentId: member.enrollment.studentId } : {}),
} : null;

const PendingStudentMembers = forwardRef(function PendingStudentMembers({ search = '', students, onApproved, active = true, onSummaryChange }, ref) {
  const revision = useSyncExternalStore(subscribeAuthChanges, getAuthRevision, () => 0);
  const [query, setQuery] = useState(search);
  const [data, setData] = useState({ members: [], nextCursor: '', token: '', revision: -1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const request = useRef(0);
  const controller = useRef(null);
  const attempts = useRef(new Map());

  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer); }, [search]);

  const load = useCallback(async (cursor = '') => {
    const auth = captureAuthScope();
    if (auth.revision !== revision || !isAuthScopeCurrent(auth)) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const sequence = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getSiteStudentMembers({ query, cursor, signal: active.signal });
      if (active.signal.aborted || sequence !== request.current || !isAuthScopeCurrent(auth)) return;
      setData(previous => ({
        members: cursor ? [...previous.members, ...result.members.filter(member => !previous.members.some(row => row.id === member.id))] : result.members,
        nextCursor: result.nextCursor, token: auth.credential, revision: auth.revision,
      }));
    } catch (cause) {
      if (!active.signal.aborted && sequence === request.current && isAuthScopeCurrent(auth)) {
        setError(cause.message || '가입한 학생 목록을 불러오지 못했어요.');
      }
    } finally {
      if (!active.signal.aborted && sequence === request.current && isAuthScopeCurrent(auth)) setLoading(false);
    }
  }, [query, revision]);

  useImperativeHandle(ref, () => ({ refresh: () => load() }), [load]);
  useEffect(() => {
    setSelected(null); attempts.current.clear();
    return () => { controller.current?.abort(); request.current += 1; };
  }, [revision]);
  useEffect(() => {
    load();
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') load(); };
    const timer = setInterval(refreshVisible, 30_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      controller.current?.abort(); request.current += 1; clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);

  const current = !!data.token && data.token === getToken() && data.revision === revision;
  const members = current ? data.members.filter(member => matchesQuery(member, search)) : [];
  useEffect(() => {
    if (!current) onSummaryChange?.(null);
    else if (!search.trim() && !query.trim() && !loading && !error) onSummaryChange?.({ count: data.members.length, hasMore: !!data.nextCursor });
  }, [current, search, query, loading, error, data.members.length, data.nextCursor, onSummaryChange]);
  useEffect(() => { if (!active) setSelected(null); }, [active]);
  async function approved() {
    setSelected(null);
    // 홈페이지 회원 ID를 Notion 학생 캐시에 섞지 않고 두 원본을 각각 다시 조회한다.
    await Promise.allSettled([load(), onApproved?.()]);
  }

  return <section className="px-4 pt-5" aria-labelledby="student-members-heading">
    <h2 id="student-members-heading" style={{ ...SECTION_HEADING, marginBottom: 4 }}>학생앱 승인 대기</h2>
    <p className="text-xs leading-relaxed mb-3" style={{ color: TEXT_SECONDARY }}>홈페이지에 가입한 학생이에요. 사용을 허용하면 학생앱에서 숙제를 받고 제출할 수 있어요.</p>
    {error ? <div role="alert" className="rounded-lg p-4 space-y-2" style={{ background: GRAY_100 }}>
      <p className="text-sm" style={{ color: TEXT_SECONDARY }}>{error}</p>
      <Button variant="outline" onClick={() => load()}>다시 시도</Button>
    </div> : <>
      {loading && !current && <p role="status" className="text-sm py-3" style={{ color: TEXT_SECONDARY }}>가입한 학생을 확인하고 있어요.</p>}
      {current && members.length === 0 && <p className="text-sm py-3" style={{ color: TEXT_SECONDARY }}>{search.trim() ? '검색한 승인 대기 학생이 없어요.' : '승인을 기다리는 학생이 없어요.'}</p>}
      <ul className="space-y-3">
        {members.map(member => <li key={member.id}><Card><CardContent className="p-4 space-y-3">
          <div className="min-w-0">
            <p className="font-semibold text-base" style={{ color: TEXT_PRIMARY }}>{member.name}</p>
            <p className="text-sm mt-1 break-words" style={{ color: TEXT_SECONDARY }}>{[member.phone, member.email].filter(Boolean).join(' · ') || '연락처 미등록'}</p>
            {joinDate(member.createdAt) && <p className="text-xs mt-1" style={{ color: TEXT_SECONDARY }}>{joinDate(member.createdAt)}</p>}
          </div>
          {['creating', 'created', 'unknown'].includes(member.enrollment?.state) && <p className="text-xs leading-relaxed" style={{ color: TEXT_SECONDARY }}>학생 등록 결과를 확인해야 해요. 다시 확인해도 학생이 중복 등록되지 않아요.</p>}
          <Button block variant={['creating', 'created', 'unknown'].includes(member.enrollment?.state) ? 'outline' : 'default'} onClick={() => setSelected({ member, auth: captureAuthScope() })}>
            {['creating', 'created', 'unknown'].includes(member.enrollment?.state) ? '학생 등록 상태 확인' : '학생앱 사용 허용'}
          </Button>
        </CardContent></Card></li>)}
      </ul>
      {current && data.nextCursor && <Button block variant="ghost" className="mt-2" loading={loading} onClick={() => load(data.nextCursor)}>더 보기</Button>}
    </>}
    {selected && isAuthScopeCurrent(selected.auth) && <ApproveStudentMemberDialog
      key={selected.member.id} member={selected.member} students={students} auth={selected.auth}
      priorAttempt={attempts.current.get(selected.member.id) || enrollmentAttempt(selected.member)}
      onAttempt={attempt => { if (attempt) attempts.current.set(selected.member.id, attempt); else attempts.current.delete(selected.member.id); }}
      onCancel={() => setSelected(null)} onApproved={approved} onFailed={() => Promise.allSettled([load(), onApproved?.()])}
    />}
  </section>;
});
export default PendingStudentMembers;

function ApproveStudentMemberDialog({ member, students, auth, priorAttempt, onAttempt, onCancel, onApproved, onFailed }) {
  const [mode, setMode] = useState(priorAttempt?.mode || 'new');
  const [studentId, setStudentId] = useState(priorAttempt?.studentId || '');
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState(priorAttempt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  const controller = useRef(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  async function approve() {
    if (busy.current || !isAuthScopeCurrent(auth) || (!attempt && mode === 'existing' && (!studentId || !confirmed))) return;
    busy.current = true; setSaving(true); setError('');
    const body = attempt || { mode, idempotencyKey: crypto.randomUUID(), ...(mode === 'existing' ? { studentId } : {}) };
    setAttempt(body); onAttempt(body);
    const requestController = new AbortController(); controller.current = requestController;
    try {
      await approveSiteStudentMember(member.id, body, { signal: requestController.signal });
      if (!active.current || requestController.signal.aborted || !isAuthScopeCurrent(auth)) return;
      toast.success(`${member.name} 학생의 학생앱 사용을 허용했어요.`);
      await onApproved();
    } catch (cause) {
      if (!active.current || requestController.signal.aborted || !isAuthScopeCurrent(auth)) return;
      // 확정 거절이면서 서버가 등록 작업 미생성을 확인한 경우에만 다른 학생을 선택한다.
      if (cause.canChangeSelection === true) {
        setAttempt(null); onAttempt(null); setStudentId(''); setConfirmed(false);
      }
      setError(['enrollment_unknown', 'enrollment_in_progress'].includes(cause.code)
        ? '학생 등록 결과를 아직 확인하지 못했어요. 기존 학생 목록을 확인하거나 같은 요청으로 다시 확인해 주세요.'
        : cause.message || '처리 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      // Notion 학생 생성 후 숙제 설정에서 멈췄을 수 있으므로 원본 두 목록을 갱신한다.
      void onFailed?.();
    } finally {
      busy.current = false;
      if (active.current && !requestController.signal.aborted && isAuthScopeCurrent(auth)) setSaving(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onCancel(); }}>
    <DialogContent showClose={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      onPointerDownOutside={event => { if (saving) event.preventDefault(); }} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>학생앱 사용 허용</DialogTitle>
        <DialogDescription>{member.name} 학생의 학생앱과 숙제 관리를 함께 시작해요.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg p-3 text-sm space-y-1" style={{ background: GRAY_100 }}>
        <p className="font-semibold" style={{ color: TEXT_PRIMARY }}>{member.name}</p>
        <p className="break-words" style={{ color: TEXT_SECONDARY }}>{[member.phone, member.email].filter(Boolean).join(' · ') || '연락처 미등록'}</p>
      </div>
      <fieldset disabled={saving || !!attempt} className="space-y-2">
        <legend className="sr-only">학생 등록 방법</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm cursor-pointer">
          <input type="radio" name="student-member-mode" value="new" checked={mode === 'new'} onChange={() => { setMode('new'); setConfirmed(false); }} style={{ accentColor: PRIMARY }} />새 학생으로 등록
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm cursor-pointer">
          <input type="radio" name="student-member-mode" value="existing" checked={mode === 'existing'} onChange={() => { setMode('existing'); setConfirmed(false); }} style={{ accentColor: PRIMARY }} />기존 학생과 연결
        </label>
      </fieldset>
      {mode === 'existing' ? <div className="space-y-3">
        <Select value={studentId} onValueChange={value => { setStudentId(value); setConfirmed(false); }} disabled={saving || !!attempt || !students.length}>
          <SelectTrigger aria-label="연결할 기존 학생"><SelectValue placeholder="학생을 선택해 주세요" /></SelectTrigger>
          <SelectContent>{students.map(student => <SelectItem key={student.id} value={student.id}>{student.name}{student.phone ? ` · ${student.phone}` : ''}</SelectItem>)}</SelectContent>
        </Select>
        {!students.length && <p className="text-xs" style={{ color: TEXT_SECONDARY }}>등록된 기존 학생이 없어요.</p>}
        <label className="flex min-h-11 items-center gap-3 text-sm leading-relaxed cursor-pointer">
          <input type="checkbox" checked={confirmed} disabled={saving || !!attempt} onChange={event => setConfirmed(event.target.checked)} style={{ accentColor: PRIMARY }} />회원과 기존 학생이 같은 사람임을 확인했어요
        </label>
      </div> : <p className="text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>가입한 이름과 연락처로 학생 목록에 등록해요. 이미 등록한 학생이라면 기존 학생과 연결해 주세요.</p>}
      {attempt && <p className="text-xs leading-relaxed" style={{ color: TEXT_SECONDARY }}>앞서 요청한 등록 결과를 확인해요. 학생을 새로 중복 등록하지 않아요.</p>}
      {error && <p role="alert" className="text-sm leading-relaxed" style={{ color: TEXT_SECONDARY }}>{error}</p>}
      <div className="flex gap-3">
        <Button block variant="outline" disabled={saving} onClick={onCancel}>취소</Button>
        <Button block loading={saving} disabled={!attempt && mode === 'existing' && (!studentId || !confirmed)} onClick={approve}>{attempt ? '등록 상태 확인' : '사용 허용'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
