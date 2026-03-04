import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchLessonLogsPage, parseLessonLog, isEmpty } from '../api/lessonLogs.js';
import { useData } from '../context/DataContext.jsx';

export default function LessonLogsPage() {
  const { students, studentNameMap } = useData();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);

  const load = useCallback(async (reset = true, nextCursor = null) => {
    if (reset) setLoading(true);
    setError(null);
    try {
      const data = await fetchLessonLogsPage({ cursor: nextCursor });
      const parsed = data.results.map(parseLessonLog);
      setLogs((prev) => (reset ? parsed : [...prev, ...parsed]));
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  const filteredLogs = logs.filter((log) => {
    if (!search.trim()) return true;
    const names = log.studentIds.map((sid) => studentNameMap[sid] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <>
      <PageHeader title="수업 일지" />

      {/* 학생 검색 */}
      <div className="px-4 pt-3 pb-3">
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
          {filteredLogs.length === 0 ? (
            <EmptyState
              icon="📝"
              title="수업 일지가 없습니다"
              description="수업 완료 후 자동으로 빈 일지가 생성됩니다."
            />
          ) : (
            <ul className="px-4 space-y-3 pb-4">
              {filteredLogs.map((log) => (
                <LogCard key={log.id} log={log} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {hasMore && (
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
    </>
  );
}

function LogCard({ log, studentNameMap }) {
  const empty = isEmpty(log);
  const studentNames = log.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');

  return (
    <li>
      <Link to={`/logs/${log.id}/edit`} className="card block p-4 active:bg-gray-50">
        <div className="flex items-start justify-between mb-1.5">
          <span className="text-base font-bold text-gray-900">{log.title || '제목 없음'}</span>
          {empty ? (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              작성 필요
            </span>
          ) : (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              작성 완료
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-2">{studentNames}</p>
        {log.content ? (
          <p className="text-sm text-gray-600 line-clamp-2">{log.content}</p>
        ) : (
          <p className="text-sm text-gray-300 italic">내용 없음</p>
        )}
        {log.engagement && (
          <p className="text-xs text-gray-400 mt-2">참여도 {log.engagement}</p>
        )}
      </Link>
    </li>
  );
}
