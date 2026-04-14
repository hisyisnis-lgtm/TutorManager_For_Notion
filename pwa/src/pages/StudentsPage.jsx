import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Card from 'antd/es/card/Card';
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
          <Button
            type="primary"
            onClick={() => navigate('/students/new')}
            style={{ borderRadius: 12, fontWeight: 600 }}
          >
            + 학생 추가
          </Button>
        }
      />

      <div className="px-4 pt-3 pb-2">
        <Input
          size="large"
          placeholder="이름으로 검색"
          prefix={<SearchOutlined style={{ color: '#767676' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ borderRadius: 12 }}
          allowClear
        />
      </div>

      {/* 상태 필터 탭 */}
      <div role="group" aria-label="수강 상태 필터" className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            aria-pressed={filter === tab}
            className={`flex-shrink-0 px-3 py-3 rounded-full text-sm font-medium transition-colors ${
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
            <ul className="px-4 space-y-3 pb-24">
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
      <Link to={`/students/${student.id}`}>
        <Card
          variant="borderless"
          style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
          styles={{ body: { padding: '16px' } }}
          className="active:bg-gray-50"
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-base font-bold text-gray-900">{student.name}</span>
            <Badge label={student.status} bg={bg} text={text} />
          </div>
          <div className="flex gap-2 flex-wrap mb-3">
            {student.level && (
              <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
                <span className="text-gray-500 mr-0.5">레벨</span>{student.level}
              </span>
            )}
            {student.goal && (
              <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
                <span className="text-gray-500 mr-0.5">목표</span>{student.goal}
              </span>
            )}
          </div>
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-gray-500 text-xs">잔여 회차 </span>
              <span
                className={`font-semibold tabular-nums ${
                  student.remainingSessions <= 1 ? 'text-red-500' : 'text-gray-800'
                }`}
              >
                {student.remainingSessions}회
              </span>
            </div>
            {student.unpaidAmount > 0 && (
              <div>
                <span className="text-gray-500 text-xs">미수금 </span>
                <span className="font-semibold text-red-500 tabular-nums">{formatKRW(student.unpaidAmount)}</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
