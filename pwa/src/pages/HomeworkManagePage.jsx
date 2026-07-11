import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from 'antd';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import Card from 'antd/es/card/Card';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { statusColor } from '../api/students.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { HOMEWORK_DB, parseHomework } from '../api/homework.js';
import {
  TEXT_TERTIARY,
  STATUS_ERROR_TEXT,
  STATUS_INFO_DARK,
} from '../constants/theme.js';

const FILTER_TABS = [
  { value: '전체', label: '전체' },
  { value: '피드백 대기', label: '피드백 대기' },
  { value: '미제출', label: '미제출' },
  { value: '완료·없음', label: '완료·없음' },
];

export default function HomeworkManagePage() {
  const { students, loading: studentsLoading, error: studentsError, refresh: refreshStudents } = useData();
  const [filter, setFilter] = useState('전체');
  const [search, setSearch] = useState('');

  // 학생별 진행중 숙제 카운트 { [studentId]: { pending, submitted } } — 캐시(기억+갱신).
  const countsRes = useCachedResource('homework:counts', async () => {
    // 진행 중 숙제만 (미제출 / 제출완료) — 피드백완료는 강사 액션 불필요
    const data = await queryPage(
      HOMEWORK_DB,
      {
        or: [
          { property: '제출 상태', select: { equals: '미제출' } },
          { property: '제출 상태', select: { equals: '제출완료' } },
        ],
      },
      undefined,
      undefined,
      100,
    );
    const map = {};
    for (const page of data?.results ?? []) {
      const hw = parseHomework(page);
      for (const sid of hw.studentIds) {
        if (!map[sid]) map[sid] = { pending: 0, submitted: 0 };
        if (hw.status === '미제출') map[sid].pending += 1;
        else if (hw.status === '제출완료') map[sid].submitted += 1;
      }
    }
    return map;
  });
  const counts = countsRes.data ?? {};
  const countsLoading = countsRes.loading;
  const countsError = countsRes.error;

  const handleRefresh = async () => {
    await Promise.all([refreshStudents(), countsRes.refresh()]);
  };

  const filtered = students
    .filter((s) => {
      const c = counts[s.id] || { pending: 0, submitted: 0 };
      const matchFilter =
        filter === '전체' ||
        (filter === '피드백 대기' && c.submitted > 0) ||
        (filter === '미제출' && c.pending > 0) ||
        (filter === '완료·없음' && c.pending === 0 && c.submitted === 0);
      const matchSearch = !search || s.name.includes(search);
      return matchFilter && matchSearch;
    })
    .sort((a, b) => {
      // 수강중 학생 우선 → 피드백 대기 많은 순 → 미제출 많은 순 → 잔여 회차 많은 순
      const activeA = a.status === '🟢 수강중' ? 0 : 1;
      const activeB = b.status === '🟢 수강중' ? 0 : 1;
      if (activeA !== activeB) return activeA - activeB;
      const ca = counts[a.id] || { pending: 0, submitted: 0 };
      const cb = counts[b.id] || { pending: 0, submitted: 0 };
      if (cb.submitted !== ca.submitted) return cb.submitted - ca.submitted;
      if (cb.pending !== ca.pending) return cb.pending - ca.pending;
      return b.remainingSessions - a.remainingSessions;
    });

  const loading = studentsLoading || countsLoading;
  const error = studentsError || countsError;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader title="숙제 관리" back />

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

      <div role="group" aria-label="수강 상태 필터" className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {FILTER_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`flex-shrink-0 px-3 py-3 rounded-full text-sm font-medium transition-[background-color,color] duration-150 ease-out ${
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
      {error && students.length === 0 && <ErrorMessage message={error} onRetry={handleRefresh} />}

      {students.length > 0 && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon="👥" title="학생이 없습니다" description="학생 관리에서 학생을 추가하세요." />
          ) : (
            <ul className="px-4 space-y-3 pb-24">
              {filtered.map((student) => (
                <HomeworkStudentCard
                  key={student.id}
                  student={student}
                  count={counts[student.id] || { pending: 0, submitted: 0 }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function HomeworkStudentCard({ student, count }) {
  const { bg, text } = statusColor(student.status);
  return (
    <li>
      <Link
        to={`/students/${student.id}/homework`}
        className="block duration-150 ease-out"
      >
        <Card
          variant="borderless"
          style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
          styles={{ body: { padding: '16px' } }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-base font-bold text-gray-900">{student.name}</span>
            <Badge label={stripEmoji(student.status)} bg={bg} text={text} />
          </div>
          <div className="flex gap-4 text-sm">
            {count.submitted > 0 && (
              <div>
                <span className="text-gray-500 text-xs">피드백 대기 </span>
                <span className="font-semibold tabular-nums" style={{ color: STATUS_INFO_DARK }}>
                  {count.submitted}건
                </span>
              </div>
            )}
            {count.pending > 0 && (
              <div>
                <span className="text-gray-500 text-xs">미제출 </span>
                <span className="font-semibold tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>
                  {count.pending}건
                </span>
              </div>
            )}
            {count.submitted === 0 && count.pending === 0 && (
              <div>
                <span className="text-gray-400 text-xs">진행 중 숙제 없음</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
