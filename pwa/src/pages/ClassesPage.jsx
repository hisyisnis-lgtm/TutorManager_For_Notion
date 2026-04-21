import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Card } from 'antd';
import { MagnifyingGlassIcon, MapPinIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { createLessonLog } from '../api/lessonLogs.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchClassesPage, parseClass, classStatusColor, notesColor } from '../api/classes.js';
import { formatDateTime, formatTime } from '../utils/dateUtils.js';
import { getWeekStart, getMonthStart, getTodayStart } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
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
