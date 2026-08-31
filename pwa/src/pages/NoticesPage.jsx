import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../components/shadcn/button';
import { Input } from '../components/shadcn/input';
import { Textarea } from '../components/shadcn/textarea';
import { Switch } from '../components/shadcn/switch';
import { PlusIcon, EyeSlashIcon, MegaphoneIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import AutoLink from '../components/ui/AutoLink.jsx';
import { fetchNotices, createNotice, updateNotice, deleteNotice } from '../api/notices.js';
import { formatDateDot } from '../utils/dateUtils.js';
import { BADGE_SMALL } from '../constants/styles.js';
import {
  PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, GRAY_100, INK_900, BORDER_NEUTRAL } from '../constants/theme.js';

const LABEL = { fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6, fontWeight: 600 };
const TITLE_MAX = 120;
const CONTENT_MAX = 2000;

const emptyDraft = { title: '', content: '', visible: true, important: false };

export default function NoticesPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | { id?, title, content, visible, important }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setError('');
    try {
      setList(await fetchNotices());
    } catch (e) {
      setError(e.message || '공지를 불러오지 못했어요');
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    const title = editing.title.trim();
    if (!title) { toast.error('제목을 입력해주세요'); return; }
    setSaving(true);
    try {
      const payload = {
        title,
        content: editing.content?.trim() || null,
        visible: editing.visible,
        important: editing.important,
      };
      if (editing.id) await updateNotice(editing.id, payload);
      else await createNotice(payload);
      toast.success(editing.id ? '공지를 수정했어요' : '공지를 올렸어요');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e.message || '저장하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteNotice(confirmDelete.id);
      toast.success('공지를 삭제했어요');
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(e.message || '삭제하지 못했어요');
    } finally {
      setSaving(false);
    }
  };

  // ===== 작성·수정 폼 =====
  if (editing) {
    return (
      <>
        <PageHeader title={editing.id ? '공지 수정' : '공지 작성'} back onBack={() => setEditing(null)} />
        <div className="px-4 py-4 space-y-4">
          <div>
            <label style={LABEL}>제목</label>
            <Input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="예) 추석 연휴 휴강 안내"
              maxLength={TITLE_MAX}
            />
          </div>

          <div>
            <label style={LABEL}>내용</label>
            <Textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder="학생들에게 전할 내용을 적어주세요"
              maxLength={CONTENT_MAX}
              showCount
              autoSize={{ minRows: 6, maxRows: 14 }}
            />
            <p className="text-xs mt-1.5" style={{ color: TEXT_TERTIARY }}>
              주소(https://…)를 적으면 학생 앱에서 눌러서 열 수 있어요.
            </p>
          </div>

          <div className="flex items-center justify-between" style={{ minHeight: 44 }}>
            <div>
              <p className="text-sm" style={{ color: TEXT_PRIMARY, margin: 0 }}>학생에게 보이기</p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_TERTIARY, margin: 0 }}>끄면 나만 볼 수 있어요</p>
            </div>
            <Switch checked={editing.visible} onCheckedChange={(v) => setEditing({ ...editing, visible: v })} />
          </div>

          <div className="flex items-center justify-between" style={{ minHeight: 44 }}>
            <div>
              <p className="text-sm" style={{ color: TEXT_PRIMARY, margin: 0 }}>중요 공지</p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_TERTIARY, margin: 0 }}>학생 앱 목록 맨 위에 고정돼요</p>
            </div>
            <Switch checked={editing.important} onCheckedChange={(v) => setEditing({ ...editing, important: v })} />
          </div>

          {/* 알림을 보내지 않는다는 점을 여기서 분명히 알린다 —
              급한 공지를 앱에만 올리고 전달됐다고 오해하면 사고가 난다. */}
          <div style={{ background: PRIMARY_BG, borderRadius: 12, padding: '12px 14px' }}>
            <p className="text-xs" style={{ color: TEXT_SECONDARY, margin: 0, lineHeight: 1.6 }}>
              공지를 올려도 <strong>따로 알림이 가지 않아요.</strong> 학생이 앱에 들어와야 보이니,
              당일 휴강처럼 급한 소식은 카톡으로도 보내주세요.
            </p>
          </div>

          <Button
            block
            size="lg"
            loading={saving}
            onClick={handleSave}
          >
            {editing.id ? '수정 완료' : '공지 올리기'}
          </Button>
        </div>
      </>
    );
  }

  // ===== 목록 =====
  return (
    <>
      <PageHeader
        title="공지"
        back
        action={(
          <Button
            onClick={() => setEditing({ ...emptyDraft })}
            className="h-9 rounded-full px-3 text-[13px]"
          >
            <PlusIcon size={16} weight="bold" />
            공지 작성
          </Button>
        )}
      />

      {error ? (
        <ErrorMessage message={error} onRetry={load} />
      ) : list === null ? (
        <LoadingSpinner />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MegaphoneIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
          title="아직 올린 공지가 없어요"
          description="휴강·일정 변경처럼 모두에게 알릴 내용을 적어두면 학생 앱 공지 탭에 표시돼요."
        />
      ) : (
        // 하단 여유는 전역 .page-container pb-24가 담당
        <ul className="px-4 py-4 space-y-3" style={{ listStyle: 'none', margin: 0 }}>
          {list.map((n) => (
            <li
              key={n.id}
              style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: 'var(--shadow-border)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                {n.important && (
                  <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY, flexShrink: 0 }}>중요</span>
                )}
                {!n.visible && (
                  <span
                    style={{ ...BADGE_SMALL, background: GRAY_100, color: TEXT_TERTIARY, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <EyeSlashIcon size={12} weight="fill" /> 숨김
                  </span>
                )}
                <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, flex: 1, minWidth: 0 }}>
                  {n.title}
                </p>
              </div>

              {n.content && (
                <p style={{ fontSize: 14, color: INK_900, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>
                  <AutoLink text={n.content} />
                </p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums" style={{ color: TEXT_TERTIARY }}>
                  {n.publishedAt ? formatDateDot(n.publishedAt) : ''}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing({ id: n.id, title: n.title, content: n.content, visible: n.visible, important: n.important })}
                  >
                    수정
                  </Button>
                  <Button
                    variant="destructiveOutline"
                    size="sm"
                    onClick={() => setConfirmDelete(n)}
                  >
                    삭제
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="공지를 삭제하시겠습니까?"
          message={`"${confirmDelete.title}" 공지가 학생 앱에서도 사라집니다.`}
          loading={saving}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
