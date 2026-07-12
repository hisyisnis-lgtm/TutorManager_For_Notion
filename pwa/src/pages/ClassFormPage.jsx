import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stripEmoji } from '../utils/stringUtils.js';
import { Alert, Button, Input, Select, Typography } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
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
import { toDatetimeLocal, toNotionDate, DAY_KR, toISOLocalKST } from '../utils/dateUtils.js';
import { isOnlineGroupTitle, isFreeConsultTitle, isFixedPriceTitle } from '../utils/classTypeKind.js';
import { useData } from '../context/DataContext.jsx';
import { fetchTimeSlotsForTeacher, checkConflict } from '../api/bookingApi.js';
import { TEXT_SECONDARY, TEXT_INACTIVE } from '../constants/theme.js';

// JS getDay(): 0=일,1=월,2=화,3=수,4=목,5=금,6=토
const DAY_JS = [0, 1, 2, 3, 4, 5, 6];

// 수업 시작 시각 분(分) 옵션 — 5분 단위
const MINUTE_OPTIONS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

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

/** 날짜를 "M/D(요일)" 형태로 표시 */
function formatDateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_KR[date.getDay()]})`;
}

export default function ClassFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { students, classTypes, refresh: refreshAll } = useData();
  const isEdit = Boolean(id);

  const [studentSearch, setStudentSearch] = useState('');
  const selectedStudentRef = useRef(null);

  // 반복/단일 선택 ('' = 미선택, 'single' = 단일, 'recur' = 반복). 반복 가능 유형에서 일시 입력 전에 선택.
  const [recurMode, setRecurMode] = useState('');
  const recurring = recurMode === 'recur';

  // 공통 폼
  const [form, setForm] = useState({
    studentIds: [],
    classTypeId: '',
    duration: '60',
    notes: '',
    noteMemo: '',         // 특이사항 상세 메모 (rich_text)
    location: '강남사무실',
    locationMemo: '',
    guestName: '',        // 무료상담 상담자 이름 (노션 제목)
    guestPhone: '',       // 무료상담 전화번호 (D-1 카카오 알림용)
    // 일회성
    datetime: '',
    // 반복
    recurDays: [],        // JS 요일 숫자 배열 (0=일 ~ 6=토)
    recurTime: '10:00',
    recurStartDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
    recurEndDate: '',
  });

  const [availableSlots, setAvailableSlots] = useState(null); // null=미조회
  const [busyIntervals, setBusyIntervals] = useState([]); // 당일 수업 구간 (클라이언트 충돌 계산용)

  const selectedDate = form.datetime ? form.datetime.slice(0, 10) : '';
  const selectedHour = form.datetime ? form.datetime.slice(11, 13) : '';
  const selectedMin  = form.datetime ? form.datetime.slice(14, 16) : '00';

  // 날짜 변경 시 가용 슬롯 조회 (일회성만)
  useEffect(() => {
    if (!selectedDate || recurring) { setAvailableSlots(null); setBusyIntervals([]); return; }
    let cancelled = false;
    fetchTimeSlotsForTeacher(selectedDate, isEdit ? id : '')
      .then(data => {
        if (!cancelled) {
          setAvailableSlots(data.available ?? data);
          setBusyIntervals(data.busyIntervals ?? []);
        }
      })
      .catch(() => { if (!cancelled) { setAvailableSlots(null); setBusyIntervals([]); } });
    return () => { cancelled = true; };
  }, [selectedDate, isEdit, id, recurring]);

  // 수업 시간별 충돌 여부를 클라이언트에서 즉시 계산 (API 호출 없음)
  const availableDurations = useMemo(() => {
    if (recurring || !selectedDate || !selectedHour || !selectedMin) return null;
    const startMin = parseInt(selectedHour) * 60 + parseInt(selectedMin);
    return new Set(
      ['30', ...DURATION_OPTIONS].filter(d => {
        const dur = parseInt(d);
        const endMin = startMin + dur;
        return !busyIntervals.some(({ startMin: cs, dur: cd }) =>
          startMin < cs + cd + 30 && endMin > cs - 30
        );
      })
    );
  }, [selectedDate, selectedHour, selectedMin, recurring, busyIntervals]);

  /** (startMin, durationMin) 조합이 busyIntervals와 충돌하지 않는지 */
  const noConflict = (startMin, durationMin) => {
    const endMin = startMin + durationMin;
    return !busyIntervals.some(({ startMin: cs, dur: cd }) =>
      startMin < cs + cd + 30 && endMin > cs - 30
    );
  };

  /** 해당 시(HH)에 어떤 수업 시간으로든 시작 가능한 슬롯이 있는지 */
  const isHourAvailable = (h) => {
    if (availableSlots === null) return true; // 아직 미조회
    return MINUTE_OPTIONS.some(min => {
      const startMin = parseInt(h) * 60 + parseInt(min);
      return displayDurationOptions.some(d => noConflict(startMin, parseInt(d)));
    });
  };
  /** 선택된 시+분 조합에서 어떤 수업 시간이든 가능한지 */
  const isMinAvailable = (min) => {
    if (availableSlots === null || !selectedHour) return true;
    const startMin = parseInt(selectedHour) * 60 + parseInt(min);
    return displayDurationOptions.some(d => noConflict(startMin, parseInt(d)));
  };
  /** 해당 수업 시간이 선택된 시작 시각에서 가능한지 */
  const isDurationAvailable = (d) => {
    if (!availableDurations) return true;
    return availableDurations.has(d);
  };

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);
  // 충돌 확인 팝업 상태 — { kind: 'single' | 'recurring', payload?, items?, message }
  const [pendingSubmit, setPendingSubmit] = useState(null);

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
          noteMemo: cls.noteMemo || '',
          location: cls.location || '강남사무실',
          locationMemo: cls.locationMemo || '',
          guestName: cls.title || '',
          guestPhone: cls.phone || '',
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

  // 수업 유형별 분기
  const selectedClassType = classTypes.find(ct => ct.id === form.classTypeId);
  // 무료상담: 신규 방문자 대상이라 학생 선택 없이 이름/전화번호 입력 허용
  const isFreeConsult = isFreeConsultTitle(selectedClassType?.title);
  // 원데이클래스: 기존 등록된 학생만 선택 가능 (일반 수업과 동일)
  const isOneDayClass = isFixedPriceTitle(selectedClassType?.title);
  // 온라인그룹수업: 학생앱 미등록자 대상. 학생 선택 없이 제목(이름)만 입력해 일정 생성 (전화번호·D-1 알림 없음)
  const isOnlineGroup = isOnlineGroupTitle(selectedClassType?.title);
  // 학생 없이 제목만으로 진행 가능한 유형 (무료상담·온라인그룹수업)
  const isGuestType = isFreeConsult || isOnlineGroup;
  // 30/60/90분 짧은 시간 옵션을 쓰는 체험성 수업
  const hasShortDuration = isFreeConsult || isOneDayClass;

  const displayDurationOptions = hasShortDuration ? ['30', '60', '90'] : DURATION_OPTIONS;

  // 체험성 수업은 일회성이라 반복 등록 비활성화. 온라인그룹수업은 학생 없이도 매주 반복 등록 허용
  const canRecur = !hasShortDuration && (form.studentIds.length > 0 || isOnlineGroup) && Boolean(form.classTypeId);

  // 단계별 표시 조건
  const showStudent = Boolean(form.classTypeId);
  // 무료상담·온라인그룹수업은 학생 선택 없어도 이름(제목) 입력으로 진행, 원데이클래스는 학생 선택 필수
  const studentDone = isGuestType || form.studentIds.length > 0;
  // 반복/단일 선택 섹션: 반복 가능 유형(일반 학생수업·온라인그룹수업)에서만, 선행(학생/수업종류) 완료 후. 편집·일회성 제외.
  const showRecurChoice = !isEdit && canRecur && studentDone;
  // 반복 선택이 필요없으면(일회성·편집) 바로 일시. 필요하면 단일/반복을 골라야 일시 표시.
  const recurChosen = !showRecurChoice || recurMode !== '';
  const showDatetime = showStudent && studentDone && recurChosen;
  const datetimeDone = recurring ? Boolean(form.recurTime) : Boolean(form.datetime);
  const showDuration = showDatetime && datetimeDone;
  const sessionsPerLesson = parseInt(form.duration) / 60;
  const maxCount = Math.floor(minRemaining / sessionsPerLesson);
  const recurDates = recurring
    ? generateRecurringDates(form.recurStartDate, form.recurEndDate, form.recurDays, form.recurTime)
    : [];
  const recurCount = recurDates.length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.studentIds.length && !isGuestType) {
      setError('학생을 최소 한 명 선택하세요.');
      return;
    }
    if (isFreeConsult && !form.studentIds.length && !form.guestName.trim()) {
      setError('이름을 입력하거나 학생을 선택하세요.');
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
        // 강사용 폼: 잔여 회차 초과해도 등록 가능 (경고는 UI에서 표시)
        const items = recurDates.map((date) => ({
          studentIds: form.studentIds,
          classTypeId: form.classTypeId,
          datetime: toISOLocalKST(date),
          duration: form.duration,
          notes: form.notes || null,
          location: form.location || null,
          locationMemo: form.locationMemo || '',
          noteMemo: form.noteMemo || '',
          title: (isOnlineGroup ? '온라인그룹수업' : form.guestName.trim()) || undefined,
        }));
        // 반복 수업 충돌 검사 — 충돌 있어도 확인 팝업 후 진행
        const pad = (n) => String(n).padStart(2, '0');
        const conflicts = [];
        let checkFailedCount = 0;
        for (const date of recurDates) {
          const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
          const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
          const result = await checkConflict(dateStr, timeStr, parseInt(form.duration));
          if (result.conflict) conflicts.push(`${dateStr} ${timeStr} (기존 수업 ${result.conflictTime} 근접)`);
          if (result.checkFailed) checkFailedCount += 1;
        }
        if (conflicts.length > 0 || checkFailedCount > 0) {
          const parts = [];
          if (conflicts.length > 0) parts.push(`다음 ${conflicts.length}개 수업이 기존 수업과 30분 이내 겹칩니다:\n${conflicts.join('\n')}`);
          if (checkFailedCount > 0) parts.push(`${checkFailedCount}개 날짜는 네트워크 문제로 충돌 확인에 실패했어요 (겹침 여부 알 수 없음).`);
          setPendingSubmit({
            kind: 'recurring',
            items,
            message: `${parts.join('\n\n')}\n\n그래도 등록하시겠습니까?`,
          });
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
          noteMemo: form.noteMemo || '',
          title: (isOnlineGroup ? '온라인그룹수업' : form.guestName.trim()) || undefined,
          phone: isFreeConsult ? form.guestPhone : undefined,
        };
        // 일회성 수업 충돌 검사 — 충돌 있어도 확인 팝업 후 진행
        const [dateStr, timeStr] = form.datetime.split('T');
        const conflictRes = await checkConflict(dateStr, timeStr.slice(0, 5), parseInt(form.duration), isEdit ? id : '');
        if (conflictRes.conflict || conflictRes.checkFailed) {
          setPendingSubmit({
            kind: 'single',
            payload,
            message: conflictRes.conflict
              ? `기존 수업(${conflictRes.conflictTime})과 30분 이내 겹칩니다.\n\n그래도 등록하시겠습니까?`
              : '네트워크 문제로 기존 수업과의 겹침 확인에 실패했어요.\n\n확인 없이 등록하시겠습니까?',
          });
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
      invalidateCache('class');
      invalidateCache('pending');
      navigate(-1);
    } catch (e) {
      setError(e.message);
      // 반복 등록 부분 실패 — 이미 생성된 수업이 목록에 바로 보이도록 캐시 무효화
      if (e.createdCount > 0) {
        invalidateCache('class');
        invalidateCache('pending');
      }
    } finally {
      setSaving(false);
    }
  };

  const proceedSave = async () => {
    if (!pendingSubmit) return;
    setSaving(true);
    setError(null);
    try {
      if (pendingSubmit.kind === 'recurring') {
        await bulkCreateClasses(pendingSubmit.items);
      } else if (isEdit) {
        await updateClass(id, pendingSubmit.payload);
      } else {
        await createClass(pendingSubmit.payload);
      }
      refreshAll();
      invalidateCache('class');
      invalidateCache('pending');
      navigate(-1);
    } catch (e) {
      setError(e.message);
      setPendingSubmit(null);
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePage(id);
      invalidateCache('class');
      invalidateCache('pending');
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
          <Alert type="error" message={error} showIcon style={{ borderRadius: 12 }} />
        )}

        {/* ① 수업 유형 — 항상 표시 */}
        <div>
          <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
            수업 유형
          </Typography.Text>
          <Select
            value={form.classTypeId || undefined}
            onChange={(value) => {
              const ct = classTypes.find(c => c.id === value);
              const isShortDur = isFreeConsultTitle(ct?.title) || isFixedPriceTitle(ct?.title);
              setForm((f) => ({
                ...f,
                classTypeId: value,
                duration: isShortDur ? '30' : (f.duration === '30' ? '60' : f.duration),
              }));
              setRecurMode(''); // 수업 종류 바뀌면 반복/단일 선택 초기화
            }}
            style={{ width: '100%' }}
            size="large"
            placeholder="선택하세요"
          >
            {classTypes.map((ct) => (
              <Select.Option key={ct.id} value={ct.id}>
                {ct.title}
              </Select.Option>
            ))}
          </Select>
        </div>

        {/* ② 학생 선택 — 수업 유형 선택 후 표시 (온라인그룹수업은 학생/이름 입력 없이 건너뜀) */}
        {showStudent && !isOnlineGroup && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            {/* 무료상담: 상담자 이름 + 전화번호(D-1 알림용) */}
            {isFreeConsult && (
              <div style={{ marginBottom: 20 }}>
                <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
                  이름
                </Typography.Text>
                <Input
                  placeholder="이름을 입력하세요 (노션 수업 제목)"
                  value={form.guestName}
                  onChange={(e) => setForm((f) => ({ ...f, guestName: e.target.value }))}
                  size="large"
                  style={{ borderRadius: 12, marginBottom: 12 }}
                />
                <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
                  전화번호 <Typography.Text style={{ fontSize: 12, color: TEXT_INACTIVE, fontWeight: 400 }}>(D-1 카카오 알림톡 발송용)</Typography.Text>
                </Typography.Text>
                <Input
                  placeholder="01012345678"
                  type="tel"
                  value={form.guestPhone}
                  onChange={(e) => setForm((f) => ({ ...f, guestPhone: e.target.value.replace(/\D/g, '') }))}
                  maxLength={11}
                  size="large"
                  style={{ borderRadius: 12 }}
                />
              </div>
            )}
            {!isOnlineGroup && (<>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              학생 선택 {isFreeConsult ? <span style={{ fontWeight: 400, color: TEXT_INACTIVE }}>(선택 사항)</span> : '(2:1 수업 시 두 명 선택)'}
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
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-[background-color,border-color] duration-150 ease-out ${
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
                      <span className="text-xs text-gray-500 ml-auto">{stripEmoji(s.status)}</span>
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
            </>)}
          </div>
        )}

        {/* 반복/단일 선택 — 일시 입력 전. 학생수업: 학생 선택 후 / 온라인그룹수업: 수업 종류 후 */}
        {showRecurChoice && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              수업 등록 방식
            </Typography.Text>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRecurMode('single')}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
                  recurMode === 'single' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                단일 수업
              </button>
              <button
                type="button"
                onClick={() => setRecurMode('recur')}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
                  recurMode === 'recur' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                반복 수업
              </button>
            </div>
          </div>
        )}

        {/* ③ 일시(단일) 또는 요일·기간·시각(반복) — 등록 방식 선택 후 표시 */}
        {showDatetime && !recurring && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              수업 일시
            </Typography.Text>
            <div className="flex gap-2">
              <Input
                type="date"
                value={form.datetime ? form.datetime.slice(0, 10) : ''}
                onChange={(e) => {
                  const date = e.target.value;
                  const time = form.datetime ? form.datetime.slice(11) : '08:00';
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
                virtual={false}
                popupRender={(menu) => (
                  <div ref={(el) => { if (el) el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false }); }}>
                    {menu}
                  </div>
                )}
              >
                {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => {
                  const hStr = String(h).padStart(2, '0');
                  const conflict = !isHourAvailable(hStr);
                  return (
                    <Select.Option key={h} value={hStr}>
                      {h}시{conflict ? ' ⚠' : ''}
                    </Select.Option>
                  );
                })}
              </Select>
              <Select
                value={form.datetime ? selectedMin : undefined}
                onChange={(min) => {
                  const date = form.datetime ? form.datetime.slice(0, 10) : '';
                  const hour = form.datetime ? form.datetime.slice(11, 13) : '08';
                  setForm((f) => ({ ...f, datetime: `${date}T${hour}:${min}` }));
                }}
                size="large"
                style={{ width: 92 }}
                placeholder="분"
                virtual={false}
                popupRender={(menu) => (
                  <div ref={(el) => { if (el) el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false }); }}>
                    {menu}
                  </div>
                )}
              >
                {MINUTE_OPTIONS.map((min) => {
                  const conflict = !isMinAvailable(min);
                  return (
                    <Select.Option key={min} value={min}>
                      {min}분{conflict ? ' ⚠' : ''}
                    </Select.Option>
                  );
                })}
              </Select>
            </div>
          </div>
        )}

        {/* ③-반복: 요일 → 기간 → 시작 시각 */}
        {showDatetime && recurring && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }} className="space-y-4">
            <div>
              <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
                수업 요일 (복수 선택 가능)
              </Typography.Text>
              <div className="grid grid-cols-7 gap-1.5">
                {DAY_KR.map((label, i) => {
                  const day = DAY_JS[i];
                  const active = form.recurDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
                        active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>시작일</Typography.Text>
                <Input type="date" value={form.recurStartDate} onChange={(e) => setForm((f) => ({ ...f, recurStartDate: e.target.value }))} size="large" style={{ borderRadius: 12, width: '100%' }} />
              </div>
              <div className="min-w-0">
                <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>종료일</Typography.Text>
                <Input type="date" value={form.recurEndDate} min={form.recurStartDate} onChange={(e) => setForm((f) => ({ ...f, recurEndDate: e.target.value }))} size="large" style={{ borderRadius: 12, width: '100%' }} />
              </div>
            </div>

            <div>
              <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
                수업 시작 시각
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
                  virtual={false}
                  popupRender={(menu) => (
                    <div ref={(el) => { if (el) el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false }); }}>
                      {menu}
                    </div>
                  )}
                >
                  {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => (
                    <Select.Option key={h} value={String(h).padStart(2, '0')}>
                      {h}시
                    </Select.Option>
                  ))}
                </Select>
                <Select
                  value={form.recurTime ? form.recurTime.slice(3, 5) : undefined}
                  onChange={(min) => {
                    const hour = form.recurTime ? form.recurTime.slice(0, 2) : '10';
                    setForm((f) => ({ ...f, recurTime: `${hour}:${min}` }));
                  }}
                  size="large"
                  style={{ flex: 1 }}
                  placeholder="분"
                  virtual={false}
                  popupRender={(menu) => (
                    <div ref={(el) => { if (el) el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false }); }}>
                      {menu}
                    </div>
                  )}
                >
                  {MINUTE_OPTIONS.map((min) => (
                    <Select.Option key={min} value={min}>
                      {min}분
                    </Select.Option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* ④ 수업 시간 — 일시 입력 후 표시 */}
        {showDuration && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              수업 시간
            </Typography.Text>
            <div className="grid grid-cols-5 gap-2">
              {displayDurationOptions.map((d) => {
                const conflict = !recurring && !isDurationAvailable(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, duration: d }))}
                    className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
                      form.duration === d
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : conflict
                        ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {d}분
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ⑤ 등록 예정 수업 수 — 반복 수업, 시간 입력 후 표시 */}
        {showDuration && recurring && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
                {/* 등록 예정 수업 수 안내 */}
                {(() => {
                  // 온라인그룹수업은 학생(잔여 회차) 개념이 없어 회차 초과 판정에서 제외
                  const overLimit = !isOnlineGroup && recurCount > 0 && recurCount * sessionsPerLesson > minRemaining;
                  const boxColor = !form.recurEndDate || recurCount === 0 ? 'bg-gray-50 text-gray-500' : overLimit ? 'bg-yellow-50 text-yellow-700' : 'bg-brand-50 text-brand-600';
                  const datePreview = recurDates.length > 0 && (
                    <div className="mt-2 text-xs text-brand-600 space-y-0.5">
                      {recurDates.slice(0, 5).map((d, i) => <div key={i}>{formatDateLabel(d)} {form.recurTime}</div>)}
                      {recurDates.length > 5 && <div className="text-blue-400">... 외 {recurDates.length - 5}개</div>}
                    </div>
                  );
                  return (
                    <div className={`p-3 rounded-xl text-sm ${boxColor}`}>
                      {isOnlineGroup ? (
                        !form.recurEndDate ? '종료일을 선택하면 등록 예정 수업 수가 표시됩니다.'
                        : recurCount === 0 ? '선택한 날짜 범위에 해당 요일 수업이 없습니다.'
                        : (<><span className="font-semibold">수업 {recurCount}개</span> 등록 예정{datePreview}</>)
                      )
                        : selectedStudents.length === 0 ? '학생을 선택하면 등록 가능한 수업 수가 표시됩니다.'
                        : !form.recurEndDate ? '종료일을 선택하면 등록 예정 수업 수가 표시됩니다.'
                        : recurCount === 0 ? '선택한 날짜 범위에 해당 요일 수업이 없습니다.'
                        : overLimit ? (<>범위 내 수업 <span className="font-semibold">{recurCount}개</span>{' '}({recurCount * sessionsPerLesson}회차) — 잔여 {minRemaining}회차 초과 (등록은 가능)</>)
                        : (<>잔여 {minRemaining}회차 충분 →{' '}<span className="font-semibold">수업 {recurCount}개</span> 등록 예정{datePreview}</>)
                      }
                    </div>
                  );
                })()}
          </div>
        )}

        {/* ⑥ 수업 장소 — 일시 입력 후 표시 */}
        {showDuration && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              수업 장소
            </Typography.Text>
            <div className="grid grid-cols-2 gap-2">
              {LOCATION_OPTIONS.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setForm((f) => ({
                    ...f,
                    location: loc,
                    // 카페/외부 장소가 아닌 옵션 선택 시 메모 자동 리셋
                    locationMemo: loc?.includes('카페') ? f.locationMemo : '',
                  }))}
                  className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
                    form.location === loc
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-gray-200 bg-white text-gray-600'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
            {form.location?.includes('카페') && (
              <div style={{ animation: 'fadeSlideUp 0.25s ease both', marginTop: 8 }}>
                <Input
                  type="text"
                  placeholder="상세 장소 (예: 스타벅스 강남역점)"
                  value={form.locationMemo}
                  onChange={(e) => setForm((f) => ({ ...f, locationMemo: e.target.value }))}
                  size="large"
                  style={{ borderRadius: 12 }}
                />
              </div>
            )}
          </div>
        )}

        {/* ⑦ 특이사항 — 일시 입력 후 표시 */}
        {showDuration && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              특이사항 (선택)
            </Typography.Text>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, notes: '' }))}
                className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
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
                  className={`py-3 rounded-xl text-sm font-medium border-2 transition-[background-color,color,border-color] duration-150 ease-out ${
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
        )}

        {/* ⑧ 메모 — 특이사항 상세 내용 (자유 텍스트) */}
        {showDuration && (
          <div style={{ animation: 'fadeSlideUp 0.35s ease both' }}>
            <Typography.Text strong style={{ fontSize: 14, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>
              메모 (선택)
            </Typography.Text>
            <Input.TextArea
              placeholder="특이사항 상세 내용을 입력하세요 (예: 결석 사유, 보강 일정, 학생 요청사항 등)"
              value={form.noteMemo}
              onChange={(e) => setForm((f) => ({ ...f, noteMemo: e.target.value }))}
              autoSize={{ minRows: 2, maxRows: 6 }}
              style={{ borderRadius: 12 }}
            />
          </div>
        )}

        {showDuration && (
          <Button
            type="primary"
            block
            htmlType="submit"
            disabled={saving}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8, animation: 'fadeSlideUp 0.35s ease both' }}
          >
            {saving
              ? '저장 중...'
              : recurring
              ? `수업 ${recurCount}개 일괄 등록`
              : isEdit
              ? '수정하기'
              : '수업 추가'}
          </Button>
        )}

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

      {pendingSubmit && (
        <ConfirmDialog
          title="기존 수업과 시간이 겹칩니다"
          message={pendingSubmit.message}
          confirmLabel="그대로 등록"
          cancelLabel="시간 조정"
          danger={false}
          onConfirm={proceedSave}
          onCancel={() => setPendingSubmit(null)}
          loading={saving}
        />
      )}
    </>
  );
}
