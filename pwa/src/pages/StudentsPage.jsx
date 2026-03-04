import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchAllStudents, parseStudent, statusColor, STATUS_OPTIONS } from '../api/students.js';
import { formatKRW } from '../utils/dateUtils.js';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

const FILTER_TABS = ['전체', '🟢 수강중', '🟡 일시중단', '⚫ 수강종료'];

export default function StudentsPage() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('전체');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchAllStudents();
      setStudents(raw.map(parseStudent));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = students
    .filter((s) => {
      const matchStatus = filter === '전체' || s.status === filter;
      const matchSearch = !search || s.name.includes(search);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => b.remainingSessions - a.remainingSessions);

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader
        title="학생 관리"
        action={
          <button
            onClick={() => navigate('/students/new')}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-white text-sm font-medium rounded-lg active:bg-brand-700 transition-colors"
          >
            <span className="text-base leading-none">+</span> 학생 추가
          </button>
        }
      />

      <div className="px-4 pt-3 pb-2">
        <input
          type="search"
          placeholder="이름으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field"
        />
      </div>

      {/* 상태 필터 탭 */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === tab
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon="👥" title="학생이 없습니다" description="노션에서 학생을 추가하세요." />
          ) : (
            <ul className="px-4 space-y-3 pb-4">
              {filtered.map((student) => (
                <StudentCard key={student.id} student={student} />
              ))}
            </ul>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function StudentCard({ student }) {
  const { bg, text } = statusColor(student.status);
  return (
    <li>
      <Link to={`/students/${student.id}`} className="card block p-4 active:bg-gray-50">
        <div className="flex items-start justify-between mb-2">
          <span className="text-base font-bold text-gray-900">{student.name}</span>
          <Badge label={student.status} bg={bg} text={text} />
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          {student.level && (
            <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
              <span className="text-gray-400 mr-0.5">레벨</span>{student.level}
            </span>
          )}
          {student.goal && (
            <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
              <span className="text-gray-400 mr-0.5">목표</span>{student.goal}
            </span>
          )}
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs">잔여 회차 </span>
            <span
              className={`font-semibold ${
                student.remainingSessions <= 1 ? 'text-red-500' : 'text-gray-800'
              }`}
            >
              {student.remainingSessions}회
            </span>
          </div>
          {student.unpaidAmount > 0 && (
            <div>
              <span className="text-gray-400 text-xs">미수금 </span>
              <span className="font-semibold text-red-500">{formatKRW(student.unpaidAmount)}</span>
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
