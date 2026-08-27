import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Card, Select, message } from 'antd';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { MagnifyingGlassIcon, ReceiptIcon, CreditCardIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { fetchPaymentsPage, parsePayment, PAYMENTS_DB } from '../api/payments.js';
import PaymentCard from '../components/payments/PaymentCard.jsx';
import { queryAll } from '../api/notionClient.js';
import { formatKRW, KST } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import PaymentTrendChart from '../components/payments/PaymentTrendChart.jsx';
import IncomeSummary from '../components/payments/IncomeSummary.jsx';
import { TEXT_SECONDARY, TEXT_TERTIARY, BORDER_NEUTRAL, GRAY_100 } from '../constants/theme.js';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';

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
      <PageHeader title="결제 내역" />

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

      <div className="px-4 pt-5 space-y-2">
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
                <div className="absolute top-full left-0 right-0 z-10 bg-white rounded-xl shadow-[var(--shadow-modal)] mt-1 overflow-hidden">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setNameInput(s.name); setStudentFilter(s.id); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-800 hover:bg-brand-50 active:bg-brand-100"
                    >
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs text-gray-500">{stripEmoji(s.status)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="absolute top-full left-0 right-0 z-10 bg-white rounded-xl shadow-[var(--shadow-modal)] mt-1 px-4 py-3 text-sm text-gray-400 text-center">
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
            <EmptyState icon={<ReceiptIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="결제 내역이 없습니다" />
          ) : (
            <ul className="px-4 pt-5 space-y-3" style={{ paddingBottom: hasMore ? 12 : 152 }}>
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
            <div className="px-4" style={{ paddingBottom: 152 }}>
              {/* 숙제·수업·수업 일지와 같은 회색 면 버튼 — 목록을 늘리는 보조 동작이라 튀지 않는다 */}
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full"
                style={{
                  height: 40, borderRadius: 12, background: GRAY_100, border: 'none',
                  cursor: loadingMore ? 'default' : 'pointer', fontSize: 13, fontWeight: 600,
                  color: TEXT_SECONDARY, WebkitTapHighlightColor: 'transparent',
                }}
              >
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </>
      )}

      {/* 결제 추가 — 수업 캘린더·숙제 관리와 같은 원형 FAB(브랜드 채움).
          ⛔ 헤더 '+ 결제 입력' 채움 버튼으로 되돌리지 말 것(2026-08-27 사용자 지시) */}
      <div
        style={{
          position: 'fixed', right: 16,
          bottom: `calc(${ABOVE_BOTTOM_NAV} + 16px)`,
          zIndex: 40,
        }}
      >
        <Link to="/payments/new">
          <Button
            type="primary"
            shape="circle"
            aria-label="결제 추가"
            style={{
              width: 56, height: 56,
              boxShadow: 'var(--shadow-brand-button)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {/* 2026-08-27 사용자 선택. ⛔ 영수증(그냥 '문서'로 읽힘)·₩(하단탭 결제와 겹침) 재제안 금지.
                phosphor엔 CalendarPlus 같은 '돈+plus' 아이콘이 없어 결제 수단으로 뜻을 세운다. */}
            <CreditCardIcon weight="fill" size={24} />
          </Button>
        </Link>
      </div>
    </PullToRefresh>
  );
}
