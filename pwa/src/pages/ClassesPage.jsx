import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select, message } from 'antd';
import { useCachedResource } from '../hooks/useCachedResource.js';
import dayjs from 'dayjs';
import { MagnifyingGlassIcon, CalendarBlankIcon, CalendarPlusIcon } from '@phosphor-icons/react';
import { TEXT_SECONDARY, TEXT_TERTIARY, BORDER_NEUTRAL, GRAY_100 } from '../constants/theme.js';
import { queryAll } from '../api/notionClient.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import { fetchClassesPage, parseClass, CLASSES_DB } from '../api/classes.js';
import { formatTime, formatDuration, KST } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import ClassCard from '../components/classes/ClassCard.jsx';
import MonthRangeFilter, { resolveMonthRange } from '../components/ui/MonthRangeFilter.jsx';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function getClassDay(isoString) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, day: 'numeric',
  }).formatToParts(new Date(isoString));
  return parseInt(parts.find((p) => p.type === 'day')?.value ?? '0');
}

const PERIOD_TABS = [
  { key: 'upcoming', label: '예정' },
  { key: 'completed', label: '완료' },
];

function getDateRange(period) {
  if (period === 'completed') return { dateFrom: null, dateTo: null };
  // '예정' 탭: 현재 시각 이후 시작하는 수업만 (CLASS_DB 상태 formula의 "🔵예정" 정의와 동일).
  // getTodayStart()(오늘 00:00)를 쓰면 오늘 이미 끝난 수업도 포함되어 부정확함.
  return { dateFrom: new Date().toISOString(), dateTo: null };
}

export default function ClassesPage() {
  const { studentNameMap, classTypeMap, classTypes } = useData();
  const [period, setPeriod] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [classTypeFilter, setClassTypeFilter] = useState('');
  // 날짜 범위 필터 (YYYY-MM-DD). 비어있으면 period 기본값 사용.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const today = getKSTToday();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;
  // 다른 목록(학생별 수업·결제·수업 일지)과 같은 날짜 범위 필터를 쓴다.
  // 다만 여기 필터는 **서버 쿼리 조건**이라(dateFrom/dateTo → Notion filter) 로드된 데이터에서
  // 연도를 뽑을 수 없다 — 완료 탭 첫 페이지엔 최근 것만 있어 작년이 선택지에서 빠져 버린다.
  // 그래서 연도는 데이터가 아니라 **올해 기준 -2 ~ +1**로 만든다(서비스 시작 2025년 포함).
  const years = useMemo(
    () => Array.from({ length: 4 }, (_, i) => String(today.year - 2 + i)),
    [today.year]
  );
  // dateFrom/dateTo가 단일 출처 — 필터 UI는 그 값을 월 단위로 비춰 보여줄 뿐이다.
  // 안 건드린 기본 표시는 **올해 1~12월**. 전 구간(2024~2027)을 기본으로 두면 년 상자가 둘 다 떠서
  // 375px에서 글자가 잘린다. 다른 해는 시작 년을 바꾸는 순간 종료 년 상자가 따라 나온다.
  const curYear = String(today.year);
  const monthRange = dateFrom || dateTo
    ? { sy: dateFrom.slice(0, 4), sm: dateFrom.slice(5, 7), ey: dateTo.slice(0, 4), em: dateTo.slice(5, 7) }
    : { sy: curYear, sm: '01', ey: curYear, em: '12' };
  const setMonthRange = (r) => {
    const { sy, sm, ey, em } = resolveMonthRange(r, years);
    // 올해 전체를 고른 건 "필터 없음"이다 → 비워서 탭 기본값(예정=지금 이후)으로 되돌린다.
    // 여기서 안 비우면 12월에 잡은 내년 1월 수업이 예정 탭에서 사라진다.
    if (sy === curYear && sm === '01' && ey === curYear && em === '12') {
      setDateFrom(''); setDateTo('');
      return;
    }
    setDateFrom(`${sy}-${sm}-01`);
    setDateTo(dayjs(`${ey}-${em}-01`).endOf('month').format('YYYY-MM-DD'));
  };

  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month);
  const [selectedDay, setSelectedDay] = useState(null);

  // ── 수업 목록: 필터 조합별로 첫 페이지를 캐시(기억+갱신) → 재방문 즉시 표시.
  //    "더 보기"로 받은 다음 페이지는 라이브로 이어붙인다(extra). 필터가 바뀌면 리셋.
  const listKey = `classes:list:${period}:${dateFrom}:${dateTo}:${classTypeFilter}`;
  const buildRange = () => {
    const range = getDateRange(period);
    return {
      finalFrom: dateFrom ? `${dateFrom}T00:00:00+09:00` : range.dateFrom,
      finalTo: dateTo ? `${dateTo}T23:59:59+09:00` : range.dateTo,
      completedOnly: period === 'completed',
    };
  };
  const listRes = useCachedResource(listKey, async () => {
    const { finalFrom, finalTo, completedOnly } = buildRange();
    const data = await fetchClassesPage({
      dateFrom: finalFrom, dateTo: finalTo, cursor: null,
      completedOnly, classTypeId: classTypeFilter || undefined,
    });
    return {
      classes: data.results.map(parseClass),
      hasMore: data.has_more,
      nextCursor: data.next_cursor,
    };
  });

  const [extra, setExtra] = useState([]);
  const [pageCursor, setPageCursor] = useState(undefined);
  const [pageHasMore, setPageHasMore] = useState(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  // 필터 조합(listKey)이 바뀌면 페이지네이션 이어붙임 상태를 초기화.
  useEffect(() => {
    setExtra([]);
    setPageCursor(undefined);
    setPageHasMore(undefined);
  }, [listKey]);

  const firstClasses = listRes.data?.classes ?? [];
  const classes = useMemo(() => [...firstClasses, ...extra], [firstClasses, extra]);
  const hasMore = pageHasMore ?? listRes.data?.hasMore ?? false;
  const nextCursor = pageCursor ?? listRes.data?.nextCursor ?? null;
  const loading = listRes.loading;
  const error = listRes.error;

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const { finalFrom, finalTo, completedOnly } = buildRange();
      const data = await fetchClassesPage({
        dateFrom: finalFrom, dateTo: finalTo, cursor: nextCursor,
        completedOnly, classTypeId: classTypeFilter || undefined,
      });
      setExtra((prev) => [...prev, ...data.results.map(parseClass)]);
      setPageHasMore(data.has_more);
      setPageCursor(data.next_cursor);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── 월별 캘린더: 연-월별로 캐시. 같은 달 재방문 시 즉시 표시.
  //    queryAll: 자동 페이지네이션. 한 달 수업이 100건을 넘어도 월말까지 전부 가져온다.
  const mm = String(calMonth + 1).padStart(2, '0');
  const calRes = useCachedResource(`classes:cal:${calYear}-${mm}`, async () => {
    const dd = String(new Date(calYear, calMonth + 1, 0).getDate()).padStart(2, '0');
    const results = await queryAll(
      CLASSES_DB,
      {
        and: [
          { property: '수업 일시', date: { on_or_after: `${calYear}-${mm}-01T00:00:00+09:00` } },
          { property: '수업 일시', date: { on_or_before: `${calYear}-${mm}-${dd}T23:59:59+09:00` } },
        ],
      },
      [{ property: '수업 일시', direction: 'ascending' }],
    );
    return (results ?? []).map(parseClass);
  });
  const calClasses = calRes.data ?? [];
  const calLoading = calRes.loading;

  const classCountMap = {};
  calClasses.forEach((cls) => {
    if (cls.datetime) {
      const day = getClassDay(cls.datetime);
      classCountMap[day] = (classCountMap[day] || 0) + 1;
    }
  });

  const selectedDayClasses = selectedDay
    ? calClasses.filter((cls) => cls.datetime && getClassDay(cls.datetime) === selectedDay)
    : [];

  const prevMonth = () => {
    setSelectedDay(null);
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    setSelectedDay(null);
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };
  const handleDayClick = (day) => {
    if (!classCountMap[day]) return;
    setSelectedDay((prev) => (prev === day ? null : day));
  };

  const filteredClasses = classes.filter((cls) => {
    if (!search.trim()) return true;
    const names = cls.studentIds.map((id) => studentNameMap[id] || '').join(' ');
    return names.toLowerCase().includes(search.trim().toLowerCase());
  });

  const handleRefresh = async () => {
    setExtra([]);
    setPageCursor(undefined);
    setPageHasMore(undefined);
    await Promise.all([listRes.refresh(), calRes.refresh()]);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader title="수업 캘린더" />

      {/* 월별 캘린더 */}
      <div className="px-4 pt-4">
        <MonthCalendar
          year={calYear}
          month={calMonth + 1}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={handleDayClick}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          loading={calLoading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {calMonth + 1}월 {selectedDay}일 수업
              </p>
              {selectedDayClasses.length === 0 ? (
                <p className="text-sm text-gray-400 py-1 text-center">수업 없음</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedDayClasses.map((cls) => {
                    const names = cls.studentIds
                      .map((id) => studentNameMap[id])
                      .filter(Boolean)
                      .join(', ');
                    const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
                    const timeStr = cls.datetime
                      ? new Date(cls.datetime).toLocaleTimeString('ko-KR', {
                          timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false,
                        })
                      : '';
                    const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
                    return (
                      <li key={cls.id}>
                        <Link
                          to={`/classes/${cls.id}`}
                          className="press flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 active:bg-gray-100 transition-[background-color] duration-150 ease-out"
                        >
                          <span className="text-xs font-semibold text-gray-900 shrink-0 tabular-nums">
                            {timeStr}{endTimeStr && `~${endTimeStr}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-semibold text-gray-800 truncate block">
                              {names || cls.title || '학생 미정'}
                            </span>
                            {(classType || cls.location) && (
                              <span className="text-xs text-gray-500">
                                {classType && `${classType} · `}{formatDuration(parseInt(cls.duration))}
                                {cls.location && ` · ${cls.location}${cls.locationMemo ? ` — ${cls.locationMemo}` : ''}`}
                              </span>
                            )}
                          </div>
                          {cls.notes && (
                            <span className="text-xs text-gray-500 shrink-0">{cls.notes}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        />
      </div>

      {/* 기간 필터 */}
      <div className="flex gap-2 px-4 pt-4 pb-3">
        {PERIOD_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPeriod(key)}
            className={`flex-1 py-3 rounded-full text-sm font-semibold transition-[background-color,color] duration-150 ease-out ${
              period === key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 학생 검색 + 수업 종류 */}
      <div className="px-4 pb-3 space-y-2">
        <Input
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
          placeholder="학생 이름으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="large"
          style={{ borderRadius: 12 }}
        />
        {/* '상세 필터' 접이식은 없앴다(2026-08-27) — 안에 든 게 수업 종류 하나뿐이라
            한 번 더 누르게 할 이유가 없었다. 정밀 날짜(DatePicker 2개)는 월 범위 필터로 대체. */}
        <Select
          value={classTypeFilter || undefined}
          onChange={(v) => setClassTypeFilter(v || '')}
          placeholder="수업 종류 전체"
          allowClear
          size="large"
          style={{ width: '100%' }}
          options={classTypes.map((ct) => ({ value: ct.id, label: ct.title }))}
        />
      </div>

      {/* 날짜 범위 — 다른 목록과 같은 공용 필터. 여기서 고른 값은 그대로 Notion 쿼리 조건이 된다 */}
      <div className="px-4 pb-3">
        <MonthRangeFilter years={years} value={monthRange} onChange={setMonthRange} />
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={listRes.refresh} />}

      {!loading && !error && (
        <>
          {filteredClasses.length === 0 ? (
            <EmptyState
              icon={<CalendarBlankIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
              title="수업이 없습니다"
              description={
                search.trim()
                  ? hasMore
                    ? '현재 페이지에 결과가 없습니다. "더 보기"로 추가 수업을 불러와 검색해 보세요.'
                    : '검색 결과가 없습니다.'
                  : '+ 수업 추가로 새 수업을 등록하세요.'
              }
            />
          ) : (
            <ul className="px-4 pt-5 space-y-3" style={{ paddingBottom: hasMore ? 12 : 152 }}>
              {filteredClasses.map((cls) => (
                <ClassCard key={cls.id} cls={cls} studentNameMap={studentNameMap} />
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="px-4" style={{ paddingBottom: 152 }}>
              {/* 숙제·수업 일지와 같은 회색 면 버튼 — 목록을 늘리는 보조 동작이라 튀지 않는다 */}
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

      {/* 수업 추가 — 학생별 수업 관리·숙제 관리와 같은 원형 FAB(브랜드 채움).
          ⛔ 헤더 '+ 수업 추가' 채움 버튼으로 되돌리지 말 것(2026-08-27 사용자 지시) */}
      <div
        style={{
          position: 'fixed', right: 16,
          bottom: `calc(${ABOVE_BOTTOM_NAV} + 16px)`,
          zIndex: 40,
        }}
      >
        <Link to="/classes/new">
          <Button
            type="primary"
            shape="circle"
            aria-label="수업 추가"
            style={{
              width: 56, height: 56,
              boxShadow: 'var(--shadow-brand-button)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CalendarPlusIcon weight="fill" size={24} />
          </Button>
        </Link>
      </div>
    </PullToRefresh>
  );
}
