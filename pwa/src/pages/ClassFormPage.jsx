import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Input, Select, Typography } from 'antd';
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
  LOCATION_OPTIONS,
} from '../api/classes.js';
import { toDatetimeLocal, toNotionDate } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import { fetchTimeSlotsForTeacher } from '../api/bookingApi.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

/** 강사용 충돌 검사: 기존 수업 ±30분 버퍼와 겹치면 { conflict: true, conflictTime } 반환 */
async function checkConflict(date, startTime, duration, excludeId = '') {
  const params = new URLSearchParams({ date, startTime, duration: String(duration) });
  if (excludeId) params.set('excludeId', excludeId);
  const res = await fetch(`${WORKER_URL}/booking/check-conflict?${params}`);
  if (!res.ok) return { conflict: false };
  return res.json();
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
// JS getDay(): 0=일,1=월,2=화,3=수,4=목,5=금,6=토
const DAY_JS = [0, 1, 2, 3, 4, 5, 6];

/** 반복 수업 날짜 목록 생성 (시작일~종료일 범위) */
function generateRecurringDates(startDate, endDate, selectedDays, time) {
  if (!selectedDays.length || !startDate || !endDate) return [];
  const [h, m] = time.split(':').map(Number);
  const dates = [];
  const cur = new Date(startDate + 'T00:00:00+09:00');
  const end = new Date(endDate + 'T23:59:59+09:00');
  while (cur <= end) {
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
  const { students, classTypes, refresh: refreshAll } = useData();
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
    location: '강남사무실',
    locationMemo: '',
    // 일회성
    datetime: '',
    // 반복
    recurDays: [],        // JS 요일 숫자 배열 (0=일 ~ 6=토)
    recurTime: '10:00',
    recurStartDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
    recurEndDate: '',
  });

  const [availableSlots, setAvailableSlots] = useState(null); // null=미조회, []~[...]=조회완료

  // 날짜 변경 시 가용 슬롯 조회 (일회성만)
  const selectedDate = form.datetime ? form.datetime.slice(0, 10) : '';
  useEffect(() => {
    if (!selectedDate || recurring) { setAvailableSlots(null); return; }
    let cancelled = false;
    fetchTimeSlotsForTeacher(selectedDate, isEdit ? id : '')
      .then(slots => { if (!cancelled) setAvailableSlots(slots); })
      .catch(() => { if (!cancelled) setAvailableSlots(null); });
    return () => { cancelled = true; };
  }, [selectedDate, isEdit, id, recurring]);

  const selectedHour = form.datetime ? form.datetime.slice(11, 13) : '';
  const selectedMin = form.datetime ? form.datetime.slice(14, 16) : '00';

  /** 해당 시(HH)에 가용 슬롯이 하나라도 있는지 */
  const isHourAvailable = (h) => {
    if (!availableSlots) return true;
    return availableSlots.some(s => s.startsWith(h + ':'));
  };
  /** 선택된 시+분 조합이 가용한지 */
  const isMinAvailable = (min) => {
    if (!availableSlots || !selectedHour) return true;
    return availableSlots.includes(`${selectedHour}:${min}`);
  };

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
          location: cls.location || '강남사무실',
          locationMemo: cls.locationMemo || '',
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
  const maxCount = Math.floor(minRemaining / sessionsPerLesson);
  const recurDates = recurring
    ? generateRecurringDates(form.recurStartDate, form.recurEndDate, form.recurDays, form.recurTime)
    : [];
  const recurCount = recurDates.length;

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
        if (!form.recurEndDate) {
          setError('종료일을 입력하세요.');
          setSaving(false);
          return;
        }
        if (form.recurEndDate < form.recurStartDate) {
          setError('종료일은 시작일 이후여야 합니다.');
          setSaving(false);
          return;
        }
        if (recurCount <= 0) {
          setError('선택한 날짜 범위에 해당 요일 수업이 없습니다.');
          setSaving(false);
          return;
        }
        if (recurCount * sessionsPerLesson > minRemaining) {
          setError(`잔여 회차(${minRemaining})가 부족합니다. 최대 ${maxCount}개 수업 등록 가능합니다.`);
          setSaving(false);
          return;
        }
        const items = recurDates.map((date) => ({
          studentIds: form.studentIds,
          classTypeId: form.classTypeId,
          datetime: toISOLocal(date),
          duration: form.duration,
          notes: form.notes || null,
          location: form.location || null,
          locationMemo: form.locationMemo || '',
        }));
        // 반복 수업 충돌 검사
        const pad = (n) => String(n).padStart(2, '0');
        const conflicts = [];
        for (const date of recurDates) {
          const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
          const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
          const result = await checkConflict(dateStr, timeStr, parseInt(form.duration));
          if (result.conflict) conflicts.push(`${dateStr} ${timeStr} (기존 수업 ${result.conflictTime} 근접)`);
        }
        if (conflicts.length > 0) {
          setError(`다음 날짜가 기존 수업과 30분 이내 겹칩니다:\n${conflicts.join('\n')}`);
          setSaving(false);
          return;
        }
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
          location: form.location || null,
          locationMemo: form.locationMemo || '',
        };
        // 일회성 수업 충돌 검사
        const [dateStr, timeStr] = form.datetime.split('T');
        const conflictRes = await checkConflict(dateStr, timeStr.slice(0, 5), parseInt(form.duration), isEdit ? id : '');
        if (conflictRes.conflict) {
          setError(`기존 수업(${conflictRes.conflictTime})과 30분 이내 겹칩니다. 시간을 조정해주세요.`);
          setSaving(false);
          return;
        }
        if (isEdit) {
          await updateClass(id, payload);
        } else {
          await createClass(payload);
        }
      }
      refreshAll();
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
          <div style={{ padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
            {error}
          </div>
        )}

        {/* 학생 선택 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            학생 선택 (2:1 수업 시 두 명 선택)
          </Typography.Text>
          <Input
            type="text"
            placeholder="학생 이름 검색..."
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            size="large"
            style={{ borderRadius: 12, marginBottom: 8 }}
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
                    <span className="text-xs text-gray-500 ml-auto">{s.status}</span>
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
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            수업 유형
          </Typography.Text>
          <Select
            value={form.classTypeId || undefined}
            onChange={(value) => setForm((f) => ({ ...f, classTypeId: value }))}
            style={{ width: '100%' }}
            size="large"
            placeholder="선택하세요"
          >
            {classTypes.map((ct) => (
              <Select.Option key={ct.id} value={ct.id}>
                {ct.title} ({ct.classType} · {ct.unitPrice.toLocaleString()}원)
              </Select.Option>
            ))}
          </Select>
        </div>

        {/* 수업 시간 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            수업 시간
          </Typography.Text>
          <div className="grid grid-cols-5 gap-2">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setForm((f) => ({ ...f, duration: d }))}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
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
              <p className="text-xs text-gray-500 mt-0.5">
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
              <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
                수업 요일 (복수 선택 가능)
              </Typography.Text>
              <div className="grid grid-cols-7 gap-1.5">
                {DAY_LABELS.map((label, i) => {
                  const day = DAY_JS[i];
                  const active = form.recurDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
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
              <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
                수업 시작 시간
              </Typography.Text>
              <div className="flex gap-2">
                <Select
                  value={form.recurTime ? form.recurTime.slice(0, 2) : undefined}
                  onChange={(h) => {
                    const min = form.recurTime ? form.recurTime.slice(3, 5) : '00';
                    setForm((f) => ({ ...f, recurTime: `${h}:${min}` }));
                  }}
                  size="large"
                  style={{ flex: 1 }}
                  placeholder="시"
                >
                  {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => (
                    <Select.Option key={h} value={String(h).padStart(2, '0')}>
                      {h}시
                    </Select.Option>
                  ))}
                </Select>
                {['00', '30'].map((min) => {
                  const curMin = form.recurTime ? form.recurTime.slice(3, 5) : '00';
                  return (
                    <button
                      key={min}
                      type="button"
                      onClick={() => {
                        const hour = form.recurTime ? form.recurTime.slice(0, 2) : '10';
                        setForm((f) => ({ ...f, recurTime: `${hour}:${min}` }));
                      }}
                      className={`px-4 rounded-xl text-sm font-medium border-2 transition-colors ${
                        curMin === min
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-gray-200 bg-white text-gray-600'
                      }`}
                    >
                      :{min}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 시작일 / 종료일 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
                  시작일
                </Typography.Text>
                <Input
                  type="date"
                  value={form.recurStartDate}
                  onChange={(e) => setForm((f) => ({ ...f, recurStartDate: e.target.value }))}
                  size="large"
                  style={{ borderRadius: 12 }}
                />
              </div>
              <div>
                <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
                  종료일
                </Typography.Text>
                <Input
                  type="date"
                  value={form.recurEndDate}
                  min={form.recurStartDate}
                  onChange={(e) => setForm((f) => ({ ...f, recurEndDate: e.target.value }))}
                  size="large"
                  style={{ borderRadius: 12 }}
                />
              </div>
            </div>

            {/* 등록 예정 수업 수 안내 */}
            {(() => {
              const overLimit = recurCount > 0 && recurCount * sessionsPerLesson > minRemaining;
              const boxColor = !form.recurEndDate || recurCount === 0
                ? 'bg-gray-50 text-gray-500'
                : overLimit
                ? 'bg-yellow-50 text-yellow-700'
                : 'bg-brand-50 text-brand-600';
              return (
                <div className={`p-3 rounded-xl text-sm ${boxColor}`}>
                  {selectedStudents.length === 0 ? (
                    '학생을 선택하면 등록 가능한 수업 수가 표시됩니다.'
                  ) : !form.recurEndDate ? (
                    '종료일을 선택하면 등록 예정 수업 수가 표시됩니다.'
                  ) : recurCount === 0 ? (
                    '선택한 날짜 범위에 해당 요일 수업이 없습니다.'
                  ) : overLimit ? (
                    <>
                      범위 내 수업 <span className="font-semibold">{recurCount}개</span>
                      {' '}({recurCount * sessionsPerLesson}회차) — 잔여 {minRemaining}회차 초과!{' '}
                      최대 <span className="font-semibold">{maxCount}개</span> 등록 가능
                    </>
                  ) : (
                    <>
                      잔여 {minRemaining}회차 충분 →{' '}
                      <span className="font-semibold">수업 {recurCount}개</span> 등록 예정
                      {form.recurDays.length > 0 && recurDates.length > 0 && (
                        <div className="mt-2 text-xs text-brand-600 space-y-0.5">
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
              );
            })()}
          </div>
        )}

        {/* 일회성: 수업 일시 */}
        {!recurring && (
          <div>
            <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
              수업 일시
            </Typography.Text>
            <div className="flex gap-2">
              <Input
                type="date"
                value={form.datetime ? form.datetime.slice(0, 10) : ''}
                onChange={(e) => {
                  const date = e.target.value;
                  const time = form.datetime ? form.datetime.slice(11) : '09:00';
                  setForm((f) => ({ ...f, datetime: date ? `${date}T${time}` : '' }));
                }}
                size="large"
                style={{ borderRadius: 12, flex: 1 }}
              />
              <Select
                value={selectedHour || undefined}
                onChange={(h) => {
                  const date = form.datetime ? form.datetime.slice(0, 10) : '';
                  const min = form.datetime ? form.datetime.slice(14, 16) : '00';
                  setForm((f) => ({ ...f, datetime: `${date}T${h}:${min}` }));
                }}
                size="large"
                style={{ width: 80 }}
                placeholder="시"
              >
                {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => {
                  const hStr = String(h).padStart(2, '0');
                  const unavailable = !isHourAvailable(hStr);
                  return (
                    <Select.Option key={h} value={hStr} disabled={unavailable}>
                      {h}시{unavailable ? ' ✕' : ''}
                    </Select.Option>
                  );
                })}
              </Select>
              {['00', '30'].map((min) => {
                const unavailable = !isMinAvailable(min);
                return (
                  <button
                    key={min}
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      const date = form.datetime ? form.datetime.slice(0, 10) : '';
                      const hour = form.datetime ? form.datetime.slice(11, 13) : '09';
                      setForm((f) => ({ ...f, datetime: `${date}T${hour}:${min}` }));
                    }}
                    className={`px-3 rounded-xl text-sm font-medium border-2 transition-colors ${
                      unavailable
                        ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                        : selectedMin === min
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    :{min}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 수업 장소 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            수업 장소
          </Typography.Text>
          <div className="grid grid-cols-2 gap-2">
            {LOCATION_OPTIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setForm((f) => ({ ...f, location: loc }))}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
                  form.location === loc
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
          <Input
            type="text"
            placeholder="상세 장소 메모 (예: 스타벅스 강남역점)"
            value={form.locationMemo}
            onChange={(e) => setForm((f) => ({ ...f, locationMemo: e.target.value }))}
            size="large"
            style={{ borderRadius: 12, marginTop: 8 }}
          />
        </div>

        {/* 특이사항 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
            특이사항 (선택)
          </Typography.Text>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, notes: '' }))}
              className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
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
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
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

        <Button
          type="primary"
          block
          htmlType="submit"
          disabled={saving}
          style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8 }}
        >
          {saving
            ? '저장 중...'
            : recurring
            ? `수업 ${recurCount}개 일괄 등록`
            : isEdit
            ? '수정하기'
            : '수업 추가'}
        </Button>

        {isEdit && (
          <Button
            danger
            block
            type="primary"
            onClick={() => setShowDeleteConfirm(true)}
            style={{ borderRadius: 12, height: 44, marginTop: 4 }}
          >
            수업 삭제
          </Button>
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
