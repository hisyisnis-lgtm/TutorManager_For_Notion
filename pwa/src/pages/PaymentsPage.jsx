import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Card, Select, message } from 'antd';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchPaymentsPage, parsePayment, paymentStatusColor, refundSessions, formatSessions, PAYMENTS_DB } from '../api/payments.js';
import { queryAll } from '../api/notionClient.js';
import { formatKRW } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import PaymentTrendChart from '../components/payments/PaymentTrendChart.jsx';
import IncomeSummary from '../components/payments/IncomeSummary.jsx';
import { TEXT_PRIMARY, TEXT_TERTIARY, STATUS_ERROR_TEXT } from '../constants/theme.js';

const KST = 'Asia/Seoul';

export default function PaymentsPage() {
  const { students, classTypes, studentNameMap, classTypeMap } = useData();
  const [nameInput, setNameInput] = useState('');
  const [studentFilter, setStudentFilter] = useState('');
  const [classTypeFilter, setClassTypeFilter] = useState('');
  const incomeRef = useRef(null);

  // 결제 목록: 필터 조합별 첫 페이지 캐시(기억+갱신) + "더 보기" 라이브 이어붙임.
  const listKey = `payments:list:${studentFilter}:${classTypeFilter}`;
  const listRes = useCachedResource(listKey, async () => {
    const data = await fetchPaymentsPage({
      studentId: studentFilter || undefined,
      classTypeId: classTypeFilter || undefined,
      cursor: null,
    });
    return {
      payments: data.results.map(parsePayment),
      hasMore: data.has_more,
      nextCursor: data.next_cursor,
    };
  });

  const [extra, setExtra] = useState([]);
  const [pageCursor, setPageCursor] = useState(undefined);
  const [pageHasMore, setPageHasMore] = useState(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setExtra([]);
    setPageCursor(undefined);
    setPageHasMore(undefined);
  }, [listKey]);

  const firstPayments = listRes.data?.payments ?? [];
  const payments = useMemo(() => [...firstPayments, ...extra], [firstPayments, extra]);
  const hasMore = pageHasMore ?? listRes.data?.hasMore ?? false;
  const nextCursor = pageCursor ?? listRes.data?.nextCursor ?? null;
  const loading = listRes.loading;
  const error = listRes.error;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchPaymentsPage({
        studentId: studentFilter || undefined,
        classTypeId: classTypeFilter || undefined,
        cursor: nextCursor,
      });
      setExtra((prev) => [...prev, ...data.results.map(parsePayment)]);
      setPageHasMore(data.has_more);
      setPageCursor(data.next_cursor);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  // 차트용 최근 6개월 결제 — 캐시(학생 필터와 무관, client-side에서 필터 적용).
  const trendRes = useCachedResource('payments:trend', async () => {
    const todayKstStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
    const [y, m] = todayKstStr.split('-').map(Number);
    // 5개월 전 1일 KST → on_or_after
    const start = new Date(y, m - 1 - 5, 1);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01T00:00:00+09:00`;
    const results = await queryAll(
      PAYMENTS_DB,
      { property: '결제일', date: { on_or_after: startStr } },
      [{ property: '결제일', direction: 'descending' }],
    );
    return results.map(parsePayment);
  });
  const trendPayments = trendRes.data ?? [];
  const trendLoading = trendRes.loading;

  const sortByDate = (arr) =>
    [...arr].sort((a, b) => {
      if (!a.paymentDate && !b.paymentDate) return 0;
      if (!a.paymentDate) return 1;
      if (!b.paymentDate) return -1;
      return b.paymentDate.localeCompare(a.paymentDate);
    });

  const filtered = sortByDate(payments);

  const handleRefresh = async () => {
    setExtra([]);
    setPageCursor(undefined);
    setPageHasMore(undefined);
    await Promise.all([listRes.refresh(), trendRes.refresh(), incomeRef.current?.reload()]);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
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

        {/* 수업 종류 필터 */}
        <Select
          value={classTypeFilter || undefined}
          onChange={(v) => setClassTypeFilter(v || '')}
          placeholder="수업 종류 전체"
          allowClear
          size="large"
          style={{ width: '100%' }}
        >
          {classTypes.map((ct) => (
            <Select.Option key={ct.id} value={ct.id}>{ct.title}</Select.Option>
          ))}
        </Select>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={listRes.refresh} />}

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
                loading={loadingMore}
                onClick={loadMore}
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
  // 학생 없는 결제(온라인그룹수업 등)는 타이틀(수강생 이름)을 표시
  const displayName = studentName || payment.note || '학생 없음';
  const classTypeName = payment.classTypeId ? classTypeMap[payment.classTypeId]?.title : null;

  return (
    <li>
      <Link
        to={`/payments/${payment.id}`}
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
                {displayName}
              </p>
              {classTypeName && (
                <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0' }}>{classTypeName}</p>
              )}
            </div>
            {payment.studentIds.length > 0 && <Badge label={stripEmoji(payment.paymentStatus)} bg={bg} text={text} />}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* 학생 없는 결제(온라인그룹수업)는 시간회차·미수금 개념이 없어 실제 결제 금액만 표시 */}
            {payment.studentIds.length > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>시간 회차 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{payment.sessionCount}회</span>
              </div>
            )}
            <div>
              <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>결제 금액 </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">{formatKRW(payment.studentIds.length ? payment.paymentAmount : payment.actualAmount)}</span>
            </div>
            {payment.studentIds.length > 0 && payment.unpaid > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>미수금 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_ERROR_TEXT }} className="tabular-nums">{formatKRW(payment.unpaid)}</span>
              </div>
            )}
            {payment.refundAmount > 0 && (
              <div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>환불 </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }} className="tabular-nums">
                  −{formatKRW(payment.refundAmount)}
                  {payment.studentIds.length > 0 && refundSessions(payment) > 0 && ` · ${formatSessions(refundSessions(payment))}회`}
                </span>
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
