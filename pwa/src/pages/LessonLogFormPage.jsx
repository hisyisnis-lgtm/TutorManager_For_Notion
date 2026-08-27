import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Typography } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import SubmitButton from '../components/ui/SubmitButton.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseLessonLog, updateLessonLog, ENGAGEMENT_OPTIONS } from '../api/lessonLogs.js';
import { useData } from '../context/DataContext.jsx';
import { TEXT_SECONDARY } from '../constants/theme.js';

const { Text } = Typography;

const LABEL_STYLE = { fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6, fontWeight: 600 };

export default function LessonLogFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { studentNameMap } = useData();

  const [log, setLog] = useState(null);
  const [form, setForm] = useState({
    content: '',
    homework: '',
    nextPrepare: '',
    engagement: '',
    memo: '',
  });
  // 저장 버튼 비활성 판정용 원본 스냅샷 — 바뀐 게 없으면 저장할 이유가 없다.
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const page = await getPage(id);
        const parsed = parseLessonLog(page);
        setLog(parsed);
        const loaded = {
          content: parsed.content,
          homework: parsed.homework,
          nextPrepare: parsed.nextPrepare,
          engagement: parsed.engagement || '',
          memo: parsed.memo,
        };
        setForm(loaded);
        setInitial(loaded);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const isDirty = !initial || JSON.stringify(form) !== JSON.stringify(initial);
  const blockedReason = !isDirty ? '변경된 내용이 없어요.' : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateLessonLog(id, form);
      invalidateCache('lessonLogs');
      invalidateCache('class'); // 수업 상세의 일지 연결 정보도 stale 방지
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      invalidateCache('lessonLogs');
      invalidateCache('class');
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  if (loading) return <><PageHeader title="수업 일지" back /><LoadingSpinner /></>;

  const studentNames = log?.studentIds?.map((sid) => studentNameMap[sid] || '').filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title={log?.title || '수업 일지'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {studentNames && (
          <Text type="secondary" style={{ fontSize: 14 }}>학생: {studentNames}</Text>
        )}

        {error && (
          <Alert type="error" title={error} showIcon style={{ borderRadius: 12 }} />
        )}

        <div>
          <Text strong style={LABEL_STYLE}>오늘 내용</Text>
          <Input.TextArea
            value={form.content}
            onChange={set('content')}
            rows={4}
            placeholder="이번 수업에서 다룬 내용을 입력하세요"
            style={{ borderRadius: 12 }}
          />
        </div>

        <div>
          <Text strong style={LABEL_STYLE}>숙제</Text>
          <Input.TextArea
            value={form.homework}
            onChange={set('homework')}
            rows={3}
            placeholder="내준 숙제를 입력하세요"
            style={{ borderRadius: 12 }}
          />
        </div>

        <div>
          <Text strong style={LABEL_STYLE}>다음 수업 준비</Text>
          <Input.TextArea
            value={form.nextPrepare}
            onChange={set('nextPrepare')}
            rows={3}
            placeholder="다음 수업 계획을 입력하세요"
            style={{ borderRadius: 12 }}
          />
        </div>

        <div>
          <Text strong style={LABEL_STYLE}>학생 참여도</Text>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, engagement: '' }))}
              className={`seg-option py-3 rounded-xl text-sm font-semibold ${
                !form.engagement ? 'seg-on-neutral' : 'seg-off'
              }`}
            >
              미선택
            </button>
            {ENGAGEMENT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setForm((f) => ({ ...f, engagement: opt }))}
                className={`seg-option py-3 rounded-xl text-sm font-semibold ${
                  form.engagement === opt
                    ? 'seg-on'
                    : 'seg-off'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Text strong style={LABEL_STYLE}>메모 (특이사항)</Text>
          <Input.TextArea
            value={form.memo}
            onChange={set('memo')}
            rows={2}
            placeholder="특이사항이 있으면 입력하세요"
            style={{ borderRadius: 12 }}
          />
        </div>

        <SubmitButton htmlType="submit" loading={saving} blockedReason={blockedReason} style={{ marginTop: 8 }}>
          저장하기
        </SubmitButton>

        <Button
          danger block
          onClick={() => setShowDeleteConfirm(true)}
          style={{ borderRadius: 12, height: 44, marginTop: 4 }}
        >
          수업 일지 삭제
        </Button>
      </form>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="수업 일지를 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}
