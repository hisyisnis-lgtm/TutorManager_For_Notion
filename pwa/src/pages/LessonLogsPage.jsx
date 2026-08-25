import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Card, message } from 'antd';
import { MagnifyingGlassIcon, NotebookIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchLessonLogsPage, parseLessonLog, isEmpty } from '../api/lessonLogs.js';
import { useData } from '../context/DataContext.jsx';
import { useCachedResource } from '../hooks/useCachedResource.js';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { TEXT_TERTIARY, BORDER_NEUTRAL } from '../constants/theme.js';

export default function LessonLogsPage() {
  const { studentNameMap } = useData();
  const [search, setSearch] = useState('');

  // 첫 페이지는 캐시(기억+갱신) → 재방문 시 즉시 표시. "더 보기"로 받은 다음
  // 페이지들은 라이브로 이어붙인다(extra). 새로고침/갱신 시 extra는 리셋.
  // 저장은 Notion 원본이 아니라 가공한 최소 데이터만 → localStorage 용량 부담 최소화.
  const firstPage = useCachedResource('lessonLogs:first', async () => {
    const data = await fetchLessonLogsPage({ cursor: null });
    return {
      logs: data.results.map(parseLessonLog),
      hasMore: data.has_more,
      nextCursor: data.next_cursor,
    };
  });
  const [extra, setExtra] = useState([]);
  const [pageCursor, setPageCursor] = useState(undefined); // undefined = 아직 '더 보기' 안 함
  const [pageHasMore, setPageHasMore] = useState(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const firstLogs = firstPage.data?.logs ?? [];
  const logs = useMemo(() => [...firstLogs, ...extra], [firstLogs, extra]);
  const hasMore = pageHasMore ?? firstPage.data?.hasMore ?? false;
  const nextCursor = pageCursor ?? firstPage.data?.nextCursor ?? null;

  const loading = firstPage.loading;
  const error = firstPage.error;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchLessonLogsPage({ cursor: nextCursor });
      setExtra((prev) => [...prev, ...data.results.map(parseLessonLog)]);
      setPageHasMore(data.has_more);
      setPageCursor(data.next_cursor);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRefresh = async () => {
    setExtra([]);
    setPageCursor(undefined);
    setPageHasMore(undefined);
    await firstPage.refresh();
  };

  const filteredLogs = logs.filter((log) => {
    if (!search.trim()) return true;
    const names = log.studentIds.map((sid) => studentNameMap[sid] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader title="수업 일지" back />

      {/* 학생 검색 */}
      <div className="px-4 pt-4 pb-3">
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

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={firstPage.refresh} />}

      {!loading && !error && (
        <>
          {filteredLogs.length === 0 ? (
            <EmptyState
              icon={<NotebookIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
              title="수업 일지가 없습니다"
              description="수업 완료 후 자동으로 빈 일지가 생성됩니다."
            />
          ) : (
            <ul className={`px-4 space-y-3 ${hasMore ? 'pb-2' : 'pb-24'}`}>
              {filteredLogs.map((log) => (
                <LogCard key={log.id} log={log} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="px-4 pb-24">
              <Button
                block
                loading={loadingMore}
                onClick={loadMore}
                style={{ borderRadius: 12, height: 44 }}
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

function LogCard({ log, studentNameMap }) {
  const empty = isEmpty(log);
  const studentNames = log.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');

  return (
    <li>
      <Link
        to={`/logs/${log.id}/edit`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 16 }}
          styles={{ body: { padding: 16 } }}
        >
          <div className="flex items-start justify-between mb-1.5">
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
