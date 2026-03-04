import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { createStudent, updateStudent, parseStudent, STATUS_OPTIONS } from '../api/students.js';
import { getPage } from '../api/notionClient.js';
import { useData } from '../context/DataContext.jsx';

export default function StudentFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { refresh: refreshAll } = useData();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    level: '',
    goal: '',
    status: '🟢 수강중',
    memo: '',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      try {
        const page = await getPage(id);
        const s = parseStudent(page);
        setForm({
          name: s.name,
          phone: s.phone || '',
          email: s.email || '',
          level: s.level || '',
          goal: s.goal || '',
          status: s.status || '🟢 수강중',
          memo: s.memo || '',
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
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
        await createStudent({ ...form, name: form.name.trim() });
        refreshAll();
        navigate('/students');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <><PageHeader title="학생 수정" back /><LoadingSpinner /></>;

  return (
    <>
      <PageHeader title={isEdit ? '학생 수정' : '학생 추가'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 이름 */}
        <div>
          <label className="label">이름 *</label>
          <input
            type="text"
            value={form.name}
            onChange={set('name')}
            placeholder="홍길동"
            className="input-field"
            required
          />
        </div>

        {/* 상태 */}
        <div>
          <label className="label">상태</label>
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className={`px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                  form.status === s
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 전화번호 */}
        <div>
          <label className="label">전화번호 (선택)</label>
          <input
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="010-0000-0000"
            className="input-field"
          />
        </div>

        {/* 이메일 */}
        <div>
          <label className="label">이메일 (선택)</label>
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="example@email.com"
            className="input-field"
          />
        </div>

        {/* 레벨 */}
        <div>
          <label className="label">레벨 (선택)</label>
          <textarea
            value={form.level}
            onChange={set('level')}
            placeholder="예: 초급, 중급, 고급"
            rows={5}
            className="input-field resize-none"
          />
        </div>

        {/* 목표 */}
        <div>
          <label className="label">목표 (선택)</label>
          <textarea
            value={form.goal}
            onChange={set('goal')}
            placeholder="예: 수능 1등급, 회화 향상"
            rows={5}
            className="input-field resize-none"
          />
        </div>

        {/* 메모 */}
        <div>
          <label className="label">메모 (선택)</label>
          <textarea
            value={form.memo}
            onChange={set('memo')}
            placeholder="특이사항, 참고 정보 등"
            rows={5}
            className="input-field resize-none"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving ? '저장 중...' : isEdit ? '수정 완료' : '학생 추가'}
        </button>
      </form>
    </>
  );
}
