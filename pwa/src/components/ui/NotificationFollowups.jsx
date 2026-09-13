import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../shadcn/button';
import { Card, CardContent } from '../shadcn/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../shadcn/select';
import { fetchNotificationFollowups, resolveNotificationFollowup } from '../../api/notificationFollowups.js';
import { captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges } from '../../api/authState.js';
import { formatDateTimeCompact } from '../../utils/dateUtils.js';
import { TEXT_SECONDARY, STATUS_ERROR_TEXT, STATUS_WARNING_TEXT_DARK } from '../../constants/theme.js';

const LABELS = { 'consult-kakao': '상담 접수 카카오 알림', 'consult-relay': '상담 접수 강사 알림',
  'homework-assign': '숙제 안내', 'homework-feedback': '피드백 안내', 'homework-submit': '숙제 제출 강사 알림',
  'student-tomorrow': '학생 전날 수업 알림', 'consult-tomorrow': '상담 전날 알림' };
const STATES = { accepted: '접수됨', queued: '릴레이 접수됨', failed: '접수 실패', unknown: '확인 필요' };
const RESOLUTIONS = { provider_checked: '발송 내역 확인', contacted: '별도 연락으로 확인', no_action_needed: '추가 안내 불필요 확인' };
const date = value => formatDateTimeCompact(new Date(value * 1000).toISOString());

function FollowupRow({ item, busy, onResolve }) {
  const [resolution, setResolution] = useState('');
  const delayedRelay = item.state === 'queued' && item.needsAttention;
  const actionable = !item.resolvedAt && (item.needsAttention || ['failed', 'unknown'].includes(item.state));
  const isBatch = ['student-tomorrow', 'consult-tomorrow'].includes(item.kind);
  const target = item.referenceId && /^homework-/.test(item.kind) ? `/homework/${item.referenceId}` : null;
  return (
    <Card><CardContent className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{LABELS[item.kind] || '발송 기록'}</h3>
        <span className="text-xs font-semibold" style={{ color: item.state === 'failed' ? STATUS_ERROR_TEXT : item.state === 'unknown' || delayedRelay ? STATUS_WARNING_TEXT_DARK : TEXT_SECONDARY }}>
          {delayedRelay ? '확인 필요' : STATES[item.state] || '확인 필요'}
        </span>
      </div>
      <p className="text-xs" style={{ color: TEXT_SECONDARY }}>{date(item.createdAt)}</p>
      {item.state === 'unknown' && <p className="text-sm" style={{ color: TEXT_SECONDARY }}>이미 접수됐을 수 있어요. 다시 보내기 전에 발송 내역이나 수신 여부를 확인해 주세요.</p>}
      {item.state === 'queued' && <p className="text-sm" style={{ color: TEXT_SECONDARY }}>{delayedRelay
        ? '릴레이 접수 후 15분 동안 발행 결과가 확인되지 않았어요. 발송 내역을 확인해 주세요. 자동으로 다시 보내지는 않아요.'
        : '릴레이 작업이 접수됐어요. 실제 알림 발행 결과는 아직 확인되지 않았어요.'}</p>}
      {item.counts && <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
        접수 {item.counts.sent} · 기존 접수 {item.counts.alreadyAccepted} · 실패 {item.counts.failed} · 확인 필요 {item.counts.unknown}
      </p>}
      <div className="flex flex-wrap gap-2">
        {target && <Button asChild variant="outline"><Link to={target}>숙제 확인</Link></Button>}
        {item.kind.startsWith('consult-') && !isBatch && <Button asChild variant="outline"><Link to="/consult">상담 목록</Link></Button>}
        {isBatch && /^\d{1,20}$/.test(item.referenceId || '') && <Button asChild variant="outline">
          <a href={`https://github.com/hisyisnis-lgtm/TutorManager_For_Notion/actions/runs/${item.referenceId}`} target="_blank" rel="noreferrer">실행 내역</a>
        </Button>}
      </div>
      {item.resolvedAt && <p className="text-sm" role="status">운영자 처리 완료 · {RESOLUTIONS[item.resolutionKind]} · {date(item.resolvedAt)}</p>}
      {actionable && <div className="flex flex-col gap-2">
        <Select value={resolution} onValueChange={setResolution} disabled={busy}>
          <SelectTrigger aria-label={`${LABELS[item.kind]} 처리 방법`}><SelectValue placeholder="확인한 방법을 선택해 주세요" /></SelectTrigger>
          <SelectContent>{Object.entries(RESOLUTIONS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" disabled={!resolution || busy} onClick={() => onResolve(item.id, resolution)}>
          {busy ? '처리 기록 저장 중…' : '처리 완료로 기록'}
        </Button>
      </div>}
    </CardContent></Card>
  );
}

export default function NotificationFollowups() {
  const [filter, setFilter] = useState('open');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const auth = useRef(captureAuthScope());
  const generation = useRef(0);
  const controller = useRef(null);
  const pending = useRef(new Set());
  const load = useCallback(async (before) => {
    if (!isAuthScopeCurrent(auth.current)) return;
    const request = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true); setError('');
    try {
      const data = await fetchNotificationFollowups(filter, before, controller.current.signal);
      if (request !== generation.current || !isAuthScopeCurrent(auth.current)) return;
      if (!Array.isArray(data.items)) throw new Error('발송 후속 기록을 확인하지 못했어요.');
      setItems(previous => before ? [...previous, ...data.items.filter(item => !previous.some(existing => existing.id === item.id))] : data.items);
      setNextCursor(data.nextCursor || null);
    } catch (failure) {
      if (request === generation.current && isAuthScopeCurrent(auth.current)) setError(failure.message);
    } finally { if (request === generation.current) setLoading(false); }
  }, [filter]);
  useEffect(() => {
    setItems([]); setNextCursor(null);
    void load();
    return () => { generation.current++; controller.current?.abort(); };
  }, [load]);
  useEffect(() => subscribeAuthChanges(() => {
    if (!isAuthScopeCurrent(auth.current)) {
      generation.current++; controller.current?.abort(); setItems([]); setNextCursor(null); setError(''); setBusy(null); setLoading(false);
    }
  }), []);
  const resolve = async (id, resolutionKind) => {
    if (pending.current.size > 0 || loading || !isAuthScopeCurrent(auth.current)) return;
    pending.current.add(id); setBusy(id); setError('');
    const request = generation.current;
    try {
      const { item } = await resolveNotificationFollowup(id, resolutionKind);
      if (request !== generation.current || !isAuthScopeCurrent(auth.current)) return;
      if (!item?.resolvedAt) throw new Error('처리 기록을 확인하지 못했어요.');
      setItems(previous => filter === 'open' ? previous.filter(row => row.id !== id) : previous.map(row => row.id === id ? item : row));
    } catch (failure) { if (request === generation.current && isAuthScopeCurrent(auth.current)) setError(failure.message); }
    finally { pending.current.delete(id); setBusy(null); }
  };
  return (
    <section aria-label="발송 후속 확인" className="space-y-3 px-4 py-4 border-b border-gray-100">
      <h2 className="font-semibold">발송 후속 확인</h2>
      <p className="text-sm" style={{ color: TEXT_SECONDARY }}>접수 여부와 운영자가 확인한 결과를 기록해요. 처리 완료로 표시해도 알림이 다시 발송되지는 않아요.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="발송 기록 보기">
        {[['open', '확인할 발송'], ['resolved', '처리 완료'], ['all', '전체 발송']].map(([value, label]) =>
          <Button key={value} variant={filter === value ? 'secondary' : 'outline'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      <Button variant="ghost" disabled={loading || busy !== null} onClick={() => load()}>발송 기록 새로고침</Button>
      {error && <div role="alert" className="space-y-2"><p className="text-sm" style={{ color: STATUS_ERROR_TEXT }}>{error}</p><Button variant="outline" onClick={() => load()}>발송 기록 다시 시도</Button></div>}
      {loading && <p role="status" className="text-sm">발송 기록 확인 중…</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm" style={{ color: TEXT_SECONDARY }}>{filter === 'open' ? '확인할 발송 기록이 없어요.' : '해당 발송 기록이 없어요.'}</p>}
      {items.map(item => <FollowupRow key={item.id} item={item} busy={busy !== null || loading} onResolve={resolve} />)}
      {nextCursor && <Button variant="outline" disabled={loading} onClick={() => load(nextCursor)}>이전 발송 더 보기</Button>}
    </section>
  );
}
