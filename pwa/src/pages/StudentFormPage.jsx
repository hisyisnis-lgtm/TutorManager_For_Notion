import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import { createStudent, STATUS_OPTIONS } from '../api/students.js';

const LEVEL_OPTIONS = ['입문', '초급', '중급', '고급'];

export default function StudentFormPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    level: '',
    goal: '',
    status: '🟢 수강중',
    memo: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
      await createStudent({ ...form, name: form.name.trim() });
      navigate('/students');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="학생 추가" back />

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
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  form.status === s
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200'
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
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, level: '' }))}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                !form.level
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              미지정
            </button>
            {LEVEL_OPTIONS.map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setForm((f) => ({ ...f, level: lv }))}
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  form.level === lv
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
        </div>

        {/* 목표 */}
        <div>
          <label className="label">목표 (선택)</label>
          <input
            type="text"
            value={form.goal}
            onChange={set('goal')}
            placeholder="예: 수능 1등급, 회화 향상"
            className="input-field"
          />
        </div>

        {/* 메모 */}
        <div>
          <label className="label">메모 (선택)</label>
          <textarea
            value={form.memo}
            onChange={set('memo')}
            placeholder="특이사항, 참고 정보 등"
            rows={3}
            className="input-field resize-none"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving ? '저장 중...' : '학생 추가'}
        </button>
      </form>
    </>
  );
}
