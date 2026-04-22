import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Card } from 'antd';
import { MagnifyingGlassIcon, MapPinIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { createLessonLog } from '../api/lessonLogs.js';
import { queryPage } from '../api/notionClient.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import { fetchClassesPage, parseClass, classStatusColor, notesColor, CLASSES_DB } from '../api/classes.js';
import { formatDateTime, formatTime } from '../utils/dateUtils.js';
import { getWeekStart, getMonthStart, getTodayStart } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

const KST = 'Asia/Seoul';

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function getClassDay(isoString) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, day: 'numeric',
  }).formatToParts(new Date(isoString));
  return parseInt(parts.find((p) => p.type === 'day')?.value ?? '0');
}

const PERIOD_TABS = [
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'all', label: '전체' },
  { key: 'completed', label: '완료' },
];

function getDateFrom(period) {
  if (period === 'week') return getWeekStart();
  if (period === 'month') return getMonthStart();
  if (period === 'completed') return null;
  return getTodayStart(); // '전체' 탭도 오늘부터 다가오는 수업 순으로
}

export default function ClassesPage() {
  const { studentNameMap, classTypeMap } = useData();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('week');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [search, setSearch] = useState('');

  const today = getKSTToday();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;
  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month);
  const [calClasses, setCalClasses] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const load = useCallback(async (reset = true, nextCursor = null) => {
    if (reset) setLoading(true);
    setError(null);
    try {
      const dateFrom = getDateFrom(period);
      const completedOnly = period === 'completed';
      const excludeCompleted = !completedOnly;
      const data = await fetchClassesPage({ dateFrom, cursor: nextCursor, completedOnly, excludeCompleted });
      const parsed = data.results.map(parseClass);
      setClasses((prev) => (reset ? parsed : [...prev, ...parsed]));
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadCalendar = useCallback(async (year, month) => {
    setCalLoading(true);
    try {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(new Date(year, month + 1, 0).getDate()).padStart(2, '0');
      const data = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '수업 일시', date: { on_or_after: `${year}-${mm}-01T00:00:00+09:00` } },
            { property: '수업 일시', date: { on_or_before: `${year}-${mm}-${dd}T23:59:59+09:00` } },
          ],
        },
        [{ property: '수업 일시', direction: 'ascending' }],
        undefined,
        100
      );
      setCalClasses((data?.results ?? []).map(parseClass));
    } catch {
      setCalClasses([]);
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => { loadCalendar(calYear, calMonth); }, [calYear, calMonth, loadCalendar]);

  const classCountMap = {};
  calClasses.forEach((cls) => {
    if (cls.datetime) {
      const day = getClassDay(cls.datetime);
      classCountMap[day] = (classCountMap[day] || 0) + 1;
    }
  });

  const selectedDayClasses = selectedDay
    ? calClasses.filter((cls) => cls.datetime && getClassDay(cls.datetime) === selectedDay)
    : [];

  const prevMonth = () => {
    setSelectedDay(null);
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    setSelectedDay(null);
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };
  const handleDayClick = (day) => {
    if (!classCountMap[day]) return;
    setSelectedDay((prev) => (prev === day ? null : day));
  };

  const filteredClasses = classes.filter((cls) => {
    if (!search.trim()) return true;
    const names = cls.studentIds.map((id) => studentNameMap[id] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  const handleRefresh = async () => {
    await Promise.all([load(true), loadCalendar(calYear, calMonth)]);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader
        title="수업 캘린더"
        action={
          <Link to="/classes/new">
            <Button
              type="primary"
              style={{ borderRadius: 12, fontWeight: 600 }}
            >
              + 수업 추가
            </Button>
          </Link>
        }
      />

      {/* 월별 캘린더 */}
      <div className="px-4 pt-4">
        <MonthCalendar
          year={calYear}
          month={calMonth + 1}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={handleDayClick}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          loading={calLoading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {calMonth + 1}월 {selectedDay}일 수업
              </p>
              {selectedDayClasses.length === 0 ? (
                <p className="text-sm text-gray-400 py-1 text-center">수업 없음</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedDayClasses.map((cls) => {
                    const names = cls.studentIds
                      .map((id) => studentNameMap[id])
                      .filter(Boolean)
                      .join(', ');
                    const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
                    const timeStr = cls.datetime
                      ? new Date(cls.datetime).toLocaleTimeString('ko-KR', {
                          timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false,
                        })
                      : '';
                    const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
                    return (
                      <li key={cls.id}>
                        <Link
                          to={`/classes/${cls.id}/edit`}
                          className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 active:bg-gray-100"
                        >
                          <span className="text-xs font-semibold text-brand-600 shrink-0">
                            {timeStr}{endTimeStr && `~${endTimeStr}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800 truncate block">
                              {names || cls.title || '학생 미정'}
                            </span>
                            {(classType || cls.location) && (
                              <span className="text-xs text-gray-500">
                                {classType && `${classType} · `}{cls.duration}분
                                {cls.location && ` · ${cls.location}${cls.locationMemo ? ` — ${cls.locationMemo}` : ''}`}
                              </span>
                            )}
                          </div>
                          {cls.notes && (
                            <span className="text-xs text-gray-500 shrink-0">{cls.notes}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        />
      </div>

      {/* 기간 필터 */}
      <div className="flex gap-2 px-4 pt-4 pb-3">
        {PERIOD_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 py-3 rounded-full text-sm font-medium transition-[scale,background-color,color] duration-150 ease-out active:scale-[0.96] ${
              period === key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 학생 검색 */}
      <div className="px-4 pb-3">
        <Input
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: '#767676' }} />}
          placeholder="학생 이름으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="large"
          style={{ borderRadius: 12 }}
        />
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={() => load(true)} />}

      {!loading && !error && (
        <>
          {filteredClasses.length === 0 ? (
            <EmptyState icon="📅" title="수업이 없습니다" description={search.trim() ? '검색 결과가 없습니다.' : '+ 수업 추가로 새 수업을 등록하세요.'} />
          ) : (
            <ul className={`px-4 space-y-3 ${hasMore && !search.trim() ? 'pb-2' : 'pb-24'}`}>
              {filteredClasses.map((cls) => (
                <ClassCard key={cls.id} cls={cls} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {hasMore && !search.trim() && (
            <div className="px-4 pb-24">
              <Button
                block
                onClick={() => load(false, cursor)}
                style={{ borderRadius: 12 }}
              >
                더 보기
              </Button>
            </div>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function ClassCard({ cls, studentNameMap }) {
  const navigate = useNavigate();
  const now = new Date();
  const isOngoing = !cls.notes?.includes('취소')
    && cls.datetime && cls.endTime
    && now >= new Date(cls.datetime)
    && now < new Date(cls.endTime);
  const { bg, text } = isOngoing ? { bg: 'bg-brand-50', text: 'text-brand-700' } : classStatusColor(cls.status);
  const statusLabel = isOngoing ? '수업중' : stripEmoji(cls.status);
  const studentNames = cls.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  const isCompleted = cls.datetime && new Date(cls.datetime) <= new Date();
  const logId = cls.lessonLogIds?.[0];
  const [creatingLog, setCreatingLog] = useState(false);

  const handleLogClick = async (e) => {
    e.stopPropagation();
    if (logId) {
      navigate(`/logs/${logId}/edit`);
      return;
    }
    setCreatingLog(true);
    try {
      const names = cls.studentIds.map((id) => studentNameMap[id]).filter(Boolean).join(', ');
      const dateStr = cls.datetime
        ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
        : '';
      const created = await createLessonLog({
        title: `${names} ${dateStr}`.trim(),
        classId: cls.id,
        studentIds: cls.studentIds,
      });
      navigate(`/logs/${created.id}/edit`);
    } catch {
      setCreatingLog(false);
    }
  };

  return (
    <li
      className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
    >
      <Card
        variant="borderless"
        style={{ borderRadius: 16, cursor: 'pointer', boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
        styles={{ body: { padding: '14px 16px' } }}
        onClick={() => navigate(`/classes/${cls.id}/edit`)}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1d1d1f', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {studentNames || cls.title || '학생 미정'}
            </p>
            <p style={{ fontSize: 13, color: '#595959', margin: '0 0 2px' }} className="tabular-nums">
              {cls.datetime ? formatDateTime(cls.datetime) : '일시 미정'}
              {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
              {cls.duration && ` · ${cls.duration}분`}
            </p>
            {cls.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <MapPinIcon size={12} weight="fill" color="#767676" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#767676' }}>
                  {cls.location}{cls.locationMemo && ` — ${cls.locationMemo}`}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
            <Badge label={statusLabel} bg={bg} text={text} />
            {cls.notes && (() => {
              const nc = notesColor(cls.notes);
              return nc ? <Badge label={stripEmoji(cls.notes)} bg={nc.bg} text={nc.text} /> : null;
            })()}
          </div>
        </div>
        {(cls.sessionShortage || cls.conflictDetected) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {cls.sessionShortage && (
              <span style={{ fontSize: 12, color: '#d46b08', background: '#fff7e6', padding: '2px 8px', borderRadius: 20 }}>
                {cls.sessionShortage}
              </span>
            )}
            {cls.conflictDetected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#cf1322', background: '#fff2f0', padding: '2px 8px', borderRadius: 20 }}>
                <WarningCircleIcon size={12} weight="fill" />
                시간 충돌
              </span>
            )}
          </div>
        )}
        {isCompleted && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleLogClick}
              disabled={creatingLog}
              style={{
                fontSize: 12, fontWeight: 600,
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: logId ? '#fff0f1' : '#f5f5f5',
                color: logId ? '#7f0005' : '#595959',
                transition: 'background-color 150ms ease-out',
                opacity: creatingLog ? 0.5 : 1,
              }}
              className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
            >
              {creatingLog ? '생성 중...' : logId ? '일지 보기' : '일지 작성'}
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}
