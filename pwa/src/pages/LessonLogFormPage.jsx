import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseLessonLog, updateLessonLog, ENGAGEMENT_OPTIONS } from '../api/lessonLogs.js';
import { useData } from '../context/DataContext.jsx';

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
          <p className="text-sm text-gray-500">학생: {studentNames}</p>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className="label">오늘 내용</label>
          <textarea
            value={form.content}
            onChange={set('content')}
            rows={4}
            placeholder="이번 수업에서 다룬 내용을 입력하세요"
            className="textarea-field"
          />
        </div>

        <div>
          <label className="label">숙제</label>
          <textarea
            value={form.homework}
            onChange={set('homework')}
            rows={3}
            placeholder="내준 숙제를 입력하세요"
            className="textarea-field"
          />
        </div>

        <div>
          <label className="label">다음 수업 준비</label>
          <textarea
            value={form.nextPrepare}
            onChange={set('nextPrepare')}
            rows={3}
            placeholder="다음 수업 계획을 입력하세요"
            className="textarea-field"
          />
        </div>

        <div>
          <label className="label">학생 참여도</label>
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
                className={`py-3 rounded-xl text-sm font-medium border transition-colors ${
                  form.engagement === opt
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">메모 (특이사항)</label>
          <textarea
            value={form.memo}
            onChange={set('memo')}
            rows={2}
            placeholder="특이사항이 있으면 입력하세요"
            className="textarea-field"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving ? '저장 중...' : '저장하기'}
        </button>

        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full py-3 rounded-xl text-sm font-medium text-red-500 border border-red-200 bg-white active:bg-red-50 mt-1"
        >
          수업 일지 삭제
        </button>
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
