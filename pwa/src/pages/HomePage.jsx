import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { formatShort } from '../utils/dateUtils.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

export default function HomePage() {
  const { studentNameMap } = useData();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const now = new Date().toISOString();
      const data = await queryPage(
        CLASSES_DB,
        { property: '수업 일시', date: { on_or_after: now } },
        [{ property: '수업 일시', direction: 'ascending' }],
        undefined,
        5
      );
      setClasses((data?.results ?? []).map(parseClass));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="px-4 pt-8 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">안녕하세요 강사님</h1>
      </div>

      <div className="px-4 pt-5 pb-24">
        <p className="text-xs font-semibold text-gray-400 tracking-wider mb-3">다가오는 수업</p>

        {loading ? (
          <LoadingSpinner />
        ) : classes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">예정된 수업이 없습니다.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {classes.map((cls) => {
                const names = cls.studentIds
                  .map((id) => studentNameMap[id])
                  .filter(Boolean)
                  .join(', ');
                const title = cls.title || names || '수업';
                return (
                  <li key={cls.id}>
                    <Link
                      to="/classes"
                      className="card flex items-center justify-between px-4 py-2.5 active:bg-gray-50"
                    >
                      <span className="text-sm font-medium text-gray-800 truncate">{title}</span>
                      <span className="text-xs text-gray-400 ml-3 shrink-0">
                        {formatShort(cls.datetime)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-col items-center gap-1.5 pt-3 pb-1">
              <span className="w-1 h-1 rounded-full bg-gray-300" />
              <span className="w-1 h-1 rounded-full bg-gray-300" />
              <span className="w-1 h-1 rounded-full bg-gray-300" />
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
