import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Card } from 'antd';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchPaymentsPage, parsePayment, paymentStatusColor, PAYMENTS_DB } from '../api/payments.js';
import { queryAll } from '../api/notionClient.js';
import { formatKRW } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import PaymentTrendChart from '../components/payments/PaymentTrendChart.jsx';
import IncomeSummary from '../components/payments/IncomeSummary.jsx';
import { TEXT_PRIMARY, TEXT_TERTIARY, STATUS_ERROR_TEXT } from '../constants/theme.js';

const KST = 'Asia/Seoul';

const STATUS_FILTERS = [
  { value: '전체', label: '전체' },
  { value: '🟢완료', label: '완료' },
  { value: '🔴미완료', label: '미완료' },
  { value: '⬛미결제', label: '미결제' },
  { value: '⚠️초과금', label: '초과금' },
];

export default function PaymentsPage() {
  const { students, studentNameMap, classTypeMap } = useData();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  // 차트용 최근 6개월 결제 (페이지네이션과 별도 fetch)
  const [trendPayments, setTrendPayments] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const incomeRef = useRef(null);

  const load = useCallback(async (reset = true, nextCursor = null) => {
    if (reset) setLoading(true);
    setError(null);
    try {
      const data = await fetchPaymentsPage({
        studentId: studentFilter || undefined,
        cursor: nextCursor,
      });
      const parsed = data.results.map(parsePayment);
      setPayments((prev) => (reset ? parsed : [...prev, ...parsed]));
      setHasMore(data.has_more);
      setCursor(data.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentFilter]);

  useEffect(() => { load(true); }, [load]);

  // 차트용 — 최근 6개월 결제 fetch (학생 필터와 무관, client-side에서 필터 적용)
  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    try {
      const todayKstStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
      const [y, m] = todayKstStr.split('-').map(Number);
      // 5개월 전 1일 KST → on_or_after
      const start = new Date(y, m - 1 - 5, 1);
      const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01T00:00:00+09:00`;
      const results = await queryAll(
        PAYMENTS_DB,
        { property: '결제일', date: { on_or_after: startStr } },
        [{ property: '결제일', direction: 'descending' }]
      );
      setTrendPayments(results.map(parsePayment));
    } catch (e) {
      console.error('[결제] 추이 데이터 오류', e);
    } finally {
      setTrendLoading(false);
    }
  }, []);

  useEffect(() => { loadTrend(); }, [loadTrend]);

  const sortByDate = (arr) =>
    [...arr].sort((a, b) => {
      if (!a.paymentDate && !b.paymentDate) return 0;
      if (!a.paymentDate) return 1;
      if (!b.paymentDate) return -1;
      return b.paymentDate.localeCompare(a.paymentDate);
    });

  const filtered = sortByDate(
    statusFilter === '전체'
      ? payments
      : payments.filter((p) => p.paymentStatus?.startsWith(statusFilter))
  );

  return (
    <PullToRefresh onRefresh={() => Promise.all([load(true), loadTrend(), incomeRef.current?.reload()])}>
      <PageHeader
        title="결제 내역"
        action={
          <Link to="/payments/new">
            <Button
              type="primary"
              style={{ borderRadius: 12, fontWeight: 600 }}
            >
              + 결제 입력
            </Button>
          </Link>
        }
      />

      {/* 최근 6개월 결제 추이 */}
      <div className="px-4 pt-4">
        <PaymentTrendChart
          payments={trendPayments}
          studentFilter={studentFilter}
          loading={trendLoading}
        />
      </div>

      {/* 수입 현황 (이번 달 결제 수입 · 예상 수익) */}
      <IncomeSummary ref={incomeRef} />

      <div className="px-4 pt-3 pb-3 space-y-2">
        {/* 학생 검색 필터 */}
        <div className="relative">
          <Input
            prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
            placeholder="학생 이름으로 검색"
            value={nameInput}
            onChange={(e) => {
              setNameInput(e.target.value);
              if (!e.target.value) setStudentFilter('');
            }}
            allowClear
            size="large"
            style={{ borderRadius: 12 }}
          />
          {nameInput && !studentFilter && (
            (() => {
              const suggestions = students.filter((s) => s.name.includes(nameInput));
              return suggestions.length > 0 ? (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setNameInput(s.name); setStudentFilter(s.id); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-800 hover:bg-brand-50 active:bg-brand-100"
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-gray-500">{stripEmoji(s.status)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 px-4 py-3 text-sm text-gray-400 text-center">
                  검색 결과 없음
                </div>
              );
            })()
          )}
        </div>

        {/* 상태 필터 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`flex-shrink-0 px-3 py-3 rounded-full text-sm font-medium transition-[background-color,color] duration-150 ease-out ${
                statusFilter === value ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={() => load(true)} />}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon="💰" title="결제 내역이 없습니다" />
          ) : (
            <ul className={`px-4 space-y-3 ${hasMore ? 'pb-2' : 'pb-24'}`}>
              {filtered.map((p) => (
                <PaymentCard
                  key={p.id}
                  payment={p}
                  studentNameMap={studentNameMap}
                  classTypeMap={classTypeMap}
                />
              ))}
            </ul>
          )}
          {hasMore && (
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

function PaymentCard({ payment, studentNameMap, classTypeMap }) {
  const { bg, text } = paymentStatusColor(payment.paymentStatus);
  const studentName =
    payment.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  const classTypeName = payment.classTypeId ? classTypeMap[payment.classTypeId]?.title : null;

  return (
    <li>
      <Link
        to={`/payments/${payment.id}/edit`}
        className="block duration-150 ease-out"
      >
        <Card
          variant="borderless"
          style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
          styles={{ body: { padding: '14px 16px' } }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {studentName || '학생 없음'}
              </p>
              {classTypeName && (
                <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0' }}>{classTypeName}</p>
              )}
            </div>
            <Badge label={stripEmoji(payment.paymentStatus)} bg={bg} text={text} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>시간 회차 </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{payment.sessionCount}회</span>
            </div>
            <div>
              <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>결제 금액 </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{formatKRW(payment.paymentAmount)}</span>
            </div>
            {payment.unpaid > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>미수금 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_ERROR_TEXT }} className="tabular-nums">{formatKRW(payment.unpaid)}</span>
              </div>
            )}
          </div>
          {payment.paymentDate && (
            <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '8px 0 0' }} className="tabular-nums">결제일 {payment.paymentDate}</p>
          )}
        </Card>
      </Link>
    </li>
  );
}
