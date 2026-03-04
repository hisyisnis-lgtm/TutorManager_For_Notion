import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import {
  parseClass,
  createClass,
  updateClass,
  bulkCreateClasses,
  DURATION_OPTIONS,
  NOTES_OPTIONS,
} from '../api/classes.js';
import { toDatetimeLocal, toNotionDate } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';

const DAY_LABELS = ['월', '화', '수', '목', '금'];
// JS getDay(): 0=일,1=월,2=화,3=수,4=목,5=금,6=토
const DAY_JS = [1, 2, 3, 4, 5];

/** 반복 수업 날짜 목록 생성 */
function generateRecurringDates(startDate, selectedDays, count, time) {
  if (!selectedDays.length || !count || count <= 0) return [];
  const [h, m] = time.split(':').map(Number);
  const dates = [];
  const cur = new Date(startDate + 'T00:00:00');
  while (dates.length < count) {
    if (selectedDays.includes(cur.getDay())) {
      const d = new Date(cur);
      d.setHours(h, m, 0, 0);
      dates.push(d);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Date → Notion ISO string (KST offset) */
function toISOLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00+09:00`;
}

/** 날짜를 "M/D(요일)" 형태로 표시 */
function formatDateLabel(date) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}/${date.getDate()}(${days[date.getDay()]})`;
}

export default function ClassFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { students, classTypes } = useData();
  const isEdit = Boolean(id);

  const [studentSearch, setStudentSearch] = useState('');
  const selectedStudentRef = useRef(null);

  // 반복 여부
  const [recurring, setRecurring] = useState(false);

  // 공통 폼
  const [form, setForm] = useState({
    studentIds: [],
    classTypeId: '',
    duration: '60',
    notes: '',
    // 일회성
    datetime: '',
    // 반복
    recurDays: [],        // JS 요일 숫자 배열 (1=월 ~ 5=금)
    recurTime: '10:00',
    recurStartDate: new Date().toISOString().slice(0, 10),
  });

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  // 편집 모드: 선택된 학생 항목 스크롤
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
        setForm((f) => ({
          ...f,
          studentIds: cls.studentIds,
          classTypeId: cls.classTypeId || '',
          datetime: toDatetimeLocal(cls.datetime),
          duration: cls.duration || '60',
          notes: cls.notes || '',
        }));
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

  const toggleDay = (day) => {
    setForm((f) => ({
      ...f,
      recurDays: f.recurDays.includes(day)
        ? f.recurDays.filter((d) => d !== day)
        : [...f.recurDays, day],
    }));
  };

  // 선택 학생의 잔여 회차 최솟값
  const selectedStudents = students.filter((s) => form.studentIds.includes(s.id));
  const minRemaining =
    selectedStudents.length > 0
      ? Math.min(...selectedStudents.map((s) => s.remainingSessions ?? 0))
      : 0;

  const canRecur = form.studentIds.length > 0 && Boolean(form.classTypeId);
  const sessionsPerLesson = parseInt(form.duration) / 60;
  const recurCount = Math.floor(minRemaining / sessionsPerLesson);
  const recurDates = recurring
    ? generateRecurringDates(form.recurStartDate, form.recurDays, recurCount, form.recurTime)
    : [];

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

    setSaving(true);
    setError(null);

    try {
      if (recurring) {
        // 반복 수업 일괄 등록
        if (!form.recurDays.length) {
          setError('요일을 최소 하나 선택하세요.');
          setSaving(false);
          return;
        }
        if (recurCount <= 0) {
          setError('잔여 시간 회차가 부족하여 등록할 수업이 없습니다.');
          setSaving(false);
          return;
        }
        const items = recurDates.map((date) => ({
          studentIds: form.studentIds,
          classTypeId: form.classTypeId,
          datetime: toISOLocal(date),
          duration: form.duration,
          notes: form.notes || null,
        }));
        await bulkCreateClasses(items);
      } else {
        // 일회성 수업 등록/수정
        if (!form.datetime) {
          setError('수업 일시를 입력하세요.');
          setSaving(false);
          return;
        }
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

        {/* 학생 선택 */}
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
                      checked={isSelected}
                      onChange={() => toggleStudent(s.id)}
                      className="w-4 h-4 accent-brand-600"
                    />
                    <span className="text-sm font-medium text-gray-800">{s.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{s.status}</span>
                    {recurring && isSelected && (
                      <span className="text-xs text-brand-600 font-medium">
                        잔여 {s.remainingSessions ?? 0}회차
                      </span>
                    )}
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

        {/* 수업 시간 */}
        <div>
          <label className="label">수업 시간</label>
          <div className="grid grid-cols-5 gap-2">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setForm((f) => ({ ...f, duration: d }))}
                className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                  form.duration === d
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {d}분
              </button>
            ))}
          </div>
        </div>

        {/* 반복 수업 토글 (편집 모드에서는 숨김) */}
        {!isEdit && (
          <div
            className={`flex items-center justify-between p-3 rounded-xl border-2 transition-colors ${
              !canRecur
                ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                : recurring
                ? 'border-brand-500 bg-brand-50 cursor-pointer'
                : 'border-gray-200 bg-white cursor-pointer'
            }`}
            onClick={() => canRecur && setRecurring((v) => !v)}
          >
            <div>
              <p className="text-sm font-medium text-gray-800">반복 수업 등록</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {recurring ? '요일·시간 지정 → 잔여 회차만큼 자동 등록' : '매 주 같은 요일에 반복 등록'}
              </p>
            </div>
            <div
              className={`w-11 h-6 rounded-full transition-colors flex items-center px-0.5 ${
                recurring ? 'bg-brand-500' : 'bg-gray-300'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  recurring ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </div>
        )}

        {/* 반복 수업 설정 */}
        {recurring && !isEdit && (
          <div className="space-y-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
            {/* 요일 선택 */}
            <div>
              <label className="label">수업 요일 (복수 선택 가능)</label>
              <div className="grid grid-cols-5 gap-2">
                {DAY_LABELS.map((label, i) => {
                  const day = DAY_JS[i];
                  const active = form.recurDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                        active
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-gray-200 bg-white text-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 시작 시간 */}
            <div>
              <label className="label">수업 시작 시간</label>
              <input
                type="time"
                value={form.recurTime}
                onChange={(e) => setForm((f) => ({ ...f, recurTime: e.target.value }))}
                className="input-field"
              />
            </div>

            {/* 시작일 */}
            <div>
              <label className="label">첫 수업 시작일</label>
              <input
                type="date"
                value={form.recurStartDate}
                onChange={(e) => setForm((f) => ({ ...f, recurStartDate: e.target.value }))}
                className="input-field"
              />
            </div>

            {/* 등록 예정 수업 수 안내 */}
            <div className={`p-3 rounded-xl text-sm ${recurCount > 0 ? 'bg-blue-50 text-blue-700' : 'bg-yellow-50 text-yellow-700'}`}>
              {selectedStudents.length === 0 ? (
                '학생을 선택하면 등록 가능한 수업 수가 표시됩니다.'
              ) : recurCount <= 0 ? (
                `잔여 시간 회차 ${minRemaining}회차 — ${form.duration}분 수업 기준 등록 가능한 수업이 없습니다.`
              ) : (
                <>
                  잔여 {minRemaining}회차 기준 →{' '}
                  <span className="font-semibold">수업 {recurCount}개</span> 등록 예정
                  {form.recurDays.length > 0 && recurDates.length > 0 && (
                    <div className="mt-2 text-xs text-blue-600 space-y-0.5">
                      {recurDates.slice(0, 5).map((d, i) => (
                        <div key={i}>{formatDateLabel(d)} {form.recurTime}</div>
                      ))}
                      {recurDates.length > 5 && (
                        <div className="text-blue-400">... 외 {recurDates.length - 5}개</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 일회성: 수업 일시 */}
        {!recurring && (
          <div>
            <label className="label">수업 일시</label>
            <input
              type="datetime-local"
              value={form.datetime}
              onChange={(e) => setForm((f) => ({ ...f, datetime: e.target.value }))}
              className="input-field"
              required={!recurring}
            />
          </div>
        )}

        {/* 특이사항 */}
        <div>
          <label className="label">특이사항 (선택)</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, notes: '' }))}
              className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                !form.notes
                  ? 'border-gray-700 bg-gray-100 text-gray-800'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              없음
            </button>
            {NOTES_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setForm((f) => ({ ...f, notes: n }))}
                className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                  form.notes === n
                    ? 'border-gray-700 bg-gray-100 text-gray-800'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-2">
          {saving
            ? '저장 중...'
            : recurring
            ? `수업 ${recurCount}개 일괄 등록`
            : isEdit
            ? '수정하기'
            : '수업 추가'}
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="btn-danger mt-1"
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
