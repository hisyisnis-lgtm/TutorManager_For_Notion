import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, createPage, updatePage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { parseClass, createClass, updateClass, DURATION_OPTIONS, NOTES_OPTIONS, CLASSES_DB } from '../api/classes.js';
import { toDatetimeLocal, toNotionDate } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

export default function ClassFormPage() {
  const { id } = useParams(); // 없으면 신규 추가
  const navigate = useNavigate();
  const { students, classTypes } = useData();
  const isEdit = Boolean(id);

  const [studentSearch, setStudentSearch] = useState('');
  const selectedStudentRef = useRef(null);

  const [form, setForm] = useState({
    studentIds: [],
    classTypeId: '',
    datetime: '',
    duration: '60',
    notes: '',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  // 편집 모드: 선택된 학생 항목이 스크롤 뷰 안에 오도록 스크롤
  useEffect(() => {
    if (!loading && students.length > 0 && selectedStudentRef.current) {
      selectedStudentRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [loading, students]);

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      try {
        const page = await getPage(id);
        const cls = parseClass(page);
        setForm({
          studentIds: cls.studentIds,
          classTypeId: cls.classTypeId || '',
          datetime: toDatetimeLocal(cls.datetime),
          duration: cls.duration || '60',
          notes: cls.notes || '',
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit]);

  const toggleStudent = (studentId) => {
    setForm((f) => ({
      ...f,
      studentIds: f.studentIds.includes(studentId)
        ? f.studentIds.filter((sid) => sid !== studentId)
        : [...f.studentIds, studentId],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.studentIds.length) {
      setError('학생을 최소 한 명 선택하세요.');
      return;
    }
    if (!form.classTypeId) {
      setError('수업 유형을 선택하세요.');
      return;
    }
    if (!form.datetime) {
      setError('수업 일시를 입력하세요.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        studentIds: form.studentIds,
        classTypeId: form.classTypeId,
        datetime: toNotionDate(form.datetime),
        duration: form.duration,
        notes: form.notes || null,
      };

      if (isEdit) {
        await updateClass(id, payload);
      } else {
        await createClass(payload);
      }
      navigate(-1);
    } catch (e) {
      setError(e.message);
    } finally {
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

  if (loading) return <><PageHeader title="수업 편집" back /><LoadingSpinner /></>;

  return (
    <>
      <PageHeader title={isEdit ? '수업 편집' : '수업 추가'} back />

      <form onSubmit={handleSubmit} className="px-4 pt-4 pb-8 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 학생 선택 (멀티 - 2:1 수업 지원) */}
        <div>
          <label className="label">학생 선택 (2:1 수업 시 두 명 선택)</label>
          <input
            type="text"
            placeholder="학생 이름 검색..."
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            className="input-field mb-2"
          />
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {students
              .filter((s) => s.name.includes(studentSearch))
              .map((s) => {
                const isSelected = form.studentIds.includes(s.id);
                const isFirstSelected = isSelected && form.studentIds[0] === s.id;
                return (
                <label
                  key={s.id}
                  ref={isFirstSelected ? selectedStudentRef : null}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.studentIds.includes(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    className="w-4 h-4 accent-brand-600"
                  />
                  <span className="text-sm font-medium text-gray-800">{s.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{s.status}</span>
                </label>
                );
              })}
            {students.filter((s) => s.name.includes(studentSearch)).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-3">검색 결과 없음</p>
            )}
          </div>
        </div>

        {/* 수업 유형 */}
        <div>
          <label className="label">수업 유형</label>
          <select
            value={form.classTypeId}
            onChange={(e) => setForm((f) => ({ ...f, classTypeId: e.target.value }))}
            className="select-field"
            required
          >
            <option value="">선택하세요</option>
            {classTypes.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.title} ({ct.classType} · {ct.unitPrice.toLocaleString()}원)
              </option>
            ))}
          </select>
        </div>

        {/* 수업 일시 */}
        <div>
          <label className="label">수업 일시</label>
          <input
            type="datetime-local"
            value={form.datetime}
            onChange={(e) => setForm((f) => ({ ...f, datetime: e.target.value }))}
            className="input-field"
            required
          />
        </div>

        {/* 수업 시간 */}
        <div>
          <label className="label">수업 시간</label>
          <div className="grid grid-cols-5 gap-2">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setForm((f) => ({ ...f, duration: d }))}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.duration === d
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {d}분
              </button>
            ))}
          </div>
        </div>

        {/* 특이사항 */}
        <div>
          <label className="label">특이사항 (선택)</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, notes: '' }))}
              className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                !form.notes
                  ? 'bg-gray-700 text-white border-gray-700'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              없음
            </button>
            {NOTES_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setForm((f) => ({ ...f, notes: n }))}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  form.notes === n
                    ? 'bg-gray-700 text-white border-gray-700'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving ? '저장 중...' : isEdit ? '수정하기' : '수업 추가'}
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-3 rounded-xl text-sm font-medium text-red-500 border border-red-200 bg-white active:bg-red-50 mt-1"
          >
            수업 삭제
          </button>
        )}
      </form>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="수업을 삭제하시겠습니까?"
          message="삭제한 데이터는 복구할 수 없습니다."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}
