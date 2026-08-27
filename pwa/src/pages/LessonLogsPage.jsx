import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Input, Card } from 'antd';
import { MagnifyingGlassIcon, NotebookIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchAllLessonLogs, parseLessonLog, isEmpty } from '../api/lessonLogs.js';
import MonthRangeFilter, { yearsOf, filterByMonthRange } from '../components/ui/MonthRangeFilter.jsx';
import { useData } from '../context/DataContext.jsx';
import { useCachedResource } from '../hooks/useCachedResource.js';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { TEXT_SECONDARY, TEXT_TERTIARY, BORDER_NEUTRAL, GRAY_100 } from '../constants/theme.js';

/** 한 번에 그릴 일지 수. '더 보기'를 누를 때마다 이만큼씩 늘린다 */
const PAGE = 20;

export default function LessonLogsPage() {
  const { studentNameMap } = useData();
  const [search, setSearch] = useState('');

  // 날짜 범위 필터가 "불러온 것만" 거르면 거짓말이 되므로 전량을 받는다.
  // 대신 화면에는 PAGE개씩만 그린다(469건을 한 번에 그리면 느리다).
  const res = useCachedResource('lessonLogs:all', async () => ({
    logs: (await fetchAllLessonLogs()).map(parseLessonLog),
  }));
  const logs = useMemo(() => res.data?.logs ?? [], [res.data]);
  const [range, setRange] = useState({ sy: '', sm: '', ey: '', em: '' });
  const [limit, setLimit] = useState(PAGE);

  const loading = res.loading;
  const error = res.error;

  const handleRefresh = async () => {
    setLimit(PAGE);
    await res.refresh();
  };

  const years = yearsOf(logs.map((l) => l.createdTime));
  const inRange = filterByMonthRange(logs, (l) => l.createdTime, range, years);
  const filteredLogs = inRange.filter((log) => {
    if (!search.trim()) return true;
    const names = log.studentIds.map((sid) => studentNameMap[sid] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader title="수업 일지" back />

      {/* 학생 검색 */}
      <div className="px-4 pt-4">
        <Input
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
          placeholder="학생 이름으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="large"
          style={{ borderRadius: 12 }}
        />
      </div>

      {/* 날짜 범위 필터 — 일지 DB엔 날짜 속성이 없어 **생성 시각** 기준이다(목록 정렬과 같은 기준) */}
      {years.length > 0 && (
        <div className="px-4 pt-3">
          <MonthRangeFilter years={years} value={range} onChange={setRange} />
        </div>
      )}

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={res.refresh} />}

      {!loading && !error && (
        <>
          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={<NotebookIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
              title="수업 일지가 없습니다"
              description="수업 완료 후 자동으로 빈 일지가 생성됩니다."
            />
          ) : (
            <ul className={`px-4 pt-5 space-y-3 ${filteredLogs.length > limit ? 'pb-3' : 'pb-24'}`}>
              {filteredLogs.slice(0, limit).map((log) => (
                <LogCard key={log.id} log={log} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {filteredLogs.length > limit && (
            <div className="px-4 pb-24">
              {/* 숙제 페이지와 같은 회색 면 버튼 — 목록을 늘리는 보조 동작이라 테두리 버튼처럼 튀지 않는다 */}
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE)}
                className="w-full"
                style={{
                  height: 40, borderRadius: 12, background: GRAY_100, border: 'none',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY,
                  WebkitTapHighlightColor: 'transparent',
                }}
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

function LogCard({ log, studentNameMap }) {
  const empty = isEmpty(log);
  const studentNames = log.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');

  return (
    <li>
      <Link
        to={`/logs/${log.id}`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 16 }}
          styles={{ body: { padding: 16 } }}
        >
          <div className="flex items-start justify-between mb-1">
            <span className="text-base font-bold text-gray-900">{log.title || '제목 없음'}</span>
            {empty ? (
              <span className="text-xs bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full font-semibold">
                작성 필요
              </span>
            ) : (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-semibold">
                작성 완료
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-2">{studentNames}</p>
          {log.content ? (
            <p className="text-sm text-gray-600 line-clamp-2">{log.content}</p>
          ) : (
            <p className="text-sm italic" style={{ color: TEXT_TERTIARY }}>내용 없음</p>
          )}
          {log.engagement && (
            <p className="text-xs text-gray-500 mt-2">참여도 {log.engagement}</p>
          )}
        </Card>
      </Link>
    </li>
  );
}
