import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { MagnifyingGlassIcon, UsersThreeIcon } from '@phosphor-icons/react';
import Card from 'antd/es/card/Card';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { statusColor } from '../api/students.js';
import { formatKRW } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { useData } from '../context/DataContext.jsx';
import { TEXT_TERTIARY, BORDER_NEUTRAL } from '../constants/theme.js';

const FILTER_TABS = [
  { value: '전체', label: '전체' },
  { value: '🟢 수강중', label: '수강중' },
  { value: '🟡 일시중단', label: '일시중단' },
  { value: '⚫ 수강종료', label: '수강종료' },
];

export default function StudentsPage() {
  const navigate = useNavigate();
  // DataContext의 학생 데이터를 그대로 사용 → 다른 페이지가 학생 추가/수정해도 자동 반영
  // stale 캐시가 있으면 즉시 표시하고 백그라운드에서 새로고침되는 패턴
  const { students, loading, error, refresh } = useData();
  const [filter, setFilter] = useState('전체');
  const [search, setSearch] = useState('');

  const filtered = students
    .filter((s) => {
      const matchStatus = filter === '전체' || s.status === filter;
      const matchSearch = !search || s.name.includes(search);
      return matchStatus && matchSearch;
    })
    .sort((a, b) => {
      // 수강중 학생 우선 → 잔여 회차 많은 순
      const activeA = a.status === '🟢 수강중' ? 0 : 1;
      const activeB = b.status === '🟢 수강중' ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      return b.remainingSessions - a.remainingSessions;
    });

  return (
    <PullToRefresh onRefresh={refresh}>
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
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ borderRadius: 12 }}
          allowClear
        />
      </div>

      {/* 상태 필터 탭 */}
      <div role="group" aria-label="수강 상태 필터" className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {FILTER_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`flex-shrink-0 px-3 py-3 rounded-full text-sm font-semibold transition-[background-color,color] duration-150 ease-out ${
              filter === value
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && students.length === 0 && <LoadingSpinner />}
      {error && students.length === 0 && <ErrorMessage message={error} onRetry={refresh} />}

      {students.length > 0 && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon={<UsersThreeIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="학생이 없습니다" description="노션에서 학생을 추가하세요." />
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
      <Link
        to={`/students/${student.id}`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 16 }}
          styles={{ body: { padding: '16px' } }}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-base font-bold text-gray-900">{student.name}</span>
            <Badge label={stripEmoji(student.status)} bg={bg} text={text} />
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
