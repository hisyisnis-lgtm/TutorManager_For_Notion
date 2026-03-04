import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createLessonLog } from '../api/lessonLogs.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchClassesPage, parseClass, classStatusColor, notesColor } from '../api/classes.js';
import { formatDateTime, formatTime } from '../utils/dateUtils.js';
import { getWeekStart, getMonthStart, getTodayStart } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

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
  const { studentNameMap } = useData();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('week');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [search, setSearch] = useState('');

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

  useEffect(() => { load(true); }, [load]);

  const filteredClasses = classes.filter((cls) => {
    if (!search.trim()) return true;
    const names = cls.studentIds.map((id) => studentNameMap[id] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader
        title="수업 캘린더"
        action={
          <Link
            to="/classes/new"
            className="flex items-center gap-1 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-1.5 rounded-lg active:bg-brand-100 transition-colors"
          >
            <span>+</span> 수업 추가
          </Link>
        }
      />

      {/* 기간 필터 */}
      <div className="flex gap-2 px-4 pt-3 pb-3">
        {PERIOD_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              period === key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 학생 검색 */}
      <div className="px-4 pb-3">
        <input
          type="search"
          placeholder="학생 이름으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
        />
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={() => load(true)} />}

      {!loading && !error && (
        <>
          {filteredClasses.length === 0 ? (
            <EmptyState icon="📅" title="수업이 없습니다" description={search.trim() ? '검색 결과가 없습니다.' : '+ 수업 추가로 새 수업을 등록하세요.'} />
          ) : (
            <ul className="px-4 space-y-3 pb-4">
              {filteredClasses.map((cls) => (
                <ClassCard key={cls.id} cls={cls} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {hasMore && !search.trim() && (
            <div className="px-4 pb-4">
              <button
                onClick={() => load(false, cursor)}
                className="w-full py-3 text-sm font-medium text-gray-500 bg-gray-100 rounded-xl active:bg-gray-200"
              >
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function ClassCard({ cls, studentNameMap }) {
  const navigate = useNavigate();
  const { bg, text } = classStatusColor(cls.status);
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
    <li>
      <div
        onClick={() => navigate(`/classes/${cls.id}/edit`)}
        className="card block p-4 active:bg-gray-50 cursor-pointer"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-gray-900 truncate">
              {studentNames || '학생 미정'}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {cls.datetime ? formatDateTime(cls.datetime) : '일시 미정'}
              {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
              {cls.duration && ` · ${cls.duration}분`}
            </p>
          </div>
          <div className="flex flex-col gap-1 items-end ml-3">
            <Badge label={cls.status} bg={bg} text={text} />
            {cls.notes && (() => {
              const nc = notesColor(cls.notes);
              return nc ? <Badge label={cls.notes} bg={nc.bg} text={nc.text} /> : null;
            })()}
          </div>
        </div>
        {(cls.sessionShortage || cls.conflictDetected) && (
          <div className="flex gap-2 flex-wrap mt-2">
            {cls.sessionShortage && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                {cls.sessionShortage}
              </span>
            )}
            {cls.conflictDetected && (
              <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">⚠️ 시간 충돌</span>
            )}
          </div>
        )}
        {isCompleted && (
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex justify-end">
            <button
              onClick={handleLogClick}
              disabled={creatingLog}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                logId
                  ? 'text-brand-600 bg-brand-50 active:bg-brand-100'
                  : 'text-gray-500 bg-gray-100 active:bg-gray-200'
              } disabled:opacity-50`}
            >
              {creatingLog ? '생성 중...' : logId ? '📝 일지 보기' : '📝 일지 작성'}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
