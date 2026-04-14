import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Input, Typography } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseLessonLog, updateLessonLog, ENGAGEMENT_OPTIONS } from '../api/lessonLogs.js';
import { useData } from '../context/DataContext.jsx';

const { Text } = Typography;

const LABEL_STYLE = { fontSize: 14, color: '#595959', display: 'block', marginBottom: 6, fontWeight: 600 };

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
        setForm({
          content: parsed.content,
          homework: parsed.homework,
          nextPrepare: parsed.nextPrepare,
          engagement: parsed.engagement || '',
          memo: parsed.memo,
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateLessonLog(id, form);
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
          <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} />
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
              className={`py-3 rounded-xl text-sm font-medium border transition-colors ${
                !form.engagement ? 'bg-gray-200 text-gray-800 border-gray-300' : 'bg-white text-gray-500 border-gray-200'
              }`}
            >
              미선택
            </button>
            {ENGAGEMENT_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setForm((f) => ({ ...f, engagement: opt }))}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
                  form.engagement === opt
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600'
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

        <Button
          type="primary" htmlType="submit" block loading={saving}
          style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8 }}
        >
          저장하기
        </Button>

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
