import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Card, DatePicker, Select, message } from 'antd';
import { useCachedResource, invalidateCache } from '../hooks/useCachedResource.js';
import dayjs from 'dayjs';
import { MagnifyingGlassIcon, MapPinIcon, WarningCircleIcon, CalendarBlankIcon, InfoIcon } from '@phosphor-icons/react';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, BORDER_DEFAULT, PRIMARY_ALPHA_25, STATUS_ERROR_TEXT, STATUS_ERROR_BG, STATUS_WARNING_TEXT, STATUS_WARNING_BG } from '../constants/theme.js';
import { createLessonLog } from '../api/lessonLogs.js';
import { queryAll } from '../api/notionClient.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import { fetchClassesPage, parseClass, classStatusColor, notesColor, CLASSES_DB } from '../api/classes.js';
import { formatDateTime, formatTime, KST } from '../utils/dateUtils.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

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

// 날짜 필터 빠른 선택 — getValue()로 매 렌더 시 dayjs() 호출 (오늘 기준 갱신)
const QUICK_RANGES = [
  { label: '오늘', getValue: () => [dayjs(), dayjs()] },
  { label: '내일', getValue: () => [dayjs().add(1, 'day'), dayjs().add(1, 'day')] },
  { label: '다음 7일', getValue: () => [dayjs(), dayjs().add(7, 'day')] },
  { label: '다음 30일', getValue: () => [dayjs(), dayjs().add(30, 'day')] },
  { label: '지난 7일', getValue: () => [dayjs().subtract(7, 'day'), dayjs()] },
  { label: '지난 30일', getValue: () => [dayjs().subtract(30, 'day'), dayjs()] },
];

// 빠른 선택 칩 스타일 — 디자인 토큰 기반
const CHIP_BASE = {
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1,
  height: 36,
  padding: '0 14px',
  borderRadius: 980,
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition: 'background-color 150ms ease-out, color 150ms ease-out, border-color 150ms ease-out, box-shadow 150ms ease-out',
};
const CHIP_ACTIVE = {
  ...CHIP_BASE,
  backgroundColor: PRIMARY,
  color: '#ffffff',
  border: '1px solid transparent',
  boxShadow: `0 2px 8px ${PRIMARY_ALPHA_25}`,
};
const CHIP_INACTIVE = {
  ...CHIP_BASE,
  backgroundColor: '#ffffff',
  color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_DEFAULT}`,
};
const CHIP_RESET = {
  ...CHIP_BASE,
  backgroundColor: 'transparent',
  color: TEXT_TERTIARY,
  border: `1px dashed ${BORDER_DEFAULT}`,
  fontSize: 12,
};

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
      <PageHeader
        title="수업 캘린더"
        action={
          <Link to="/classes/new">
            <Button
              type="primary"
              style={{ borderRadius: 12, fontWeight: 600 }}
            >
              + 수업 추가
            </Button>
          </Link>
        }
      />

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
                          className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 active:bg-gray-100"
                        >
                          <span className="text-xs font-semibold text-brand-600 shrink-0">
                            {timeStr}{endTimeStr && `~${endTimeStr}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800 truncate block">
                              {names || cls.title || '학생 미정'}
                            </span>
                            {(classType || cls.location) && (
                              <span className="text-xs text-gray-500">
                                {classType && `${classType} · `}{cls.duration}분
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
            className={`flex-1 py-3 rounded-full text-sm font-medium transition-[background-color,color] duration-150 ease-out ${
              period === key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 날짜 범위 필터 — 페이지 배경에 직접 배치 (필터는 content가 아니라 control) */}
      <div className="px-4 pb-3">
        {/* 빠른 선택 칩 (가로 스크롤, 페이지 좌우 패딩 흡수) */}
        <div
          className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ marginLeft: -16, marginRight: -16, paddingLeft: 16, paddingRight: 16, paddingBottom: 10 }}
        >
          {QUICK_RANGES.map(({ label, getValue }) => {
            const [from, to] = getValue();
            const fromStr = from.format('YYYY-MM-DD');
            const toStr = to.format('YYYY-MM-DD');
            const isActive = dateFrom === fromStr && dateTo === toStr;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  // 활성 상태에서 다시 누르면 필터 해제 (토글)
                  if (isActive) { setDateFrom(''); setDateTo(''); }
                  else { setDateFrom(fromStr); setDateTo(toStr); }
                }}
                style={{ ...(isActive ? CHIP_ACTIVE : CHIP_INACTIVE), flexShrink: 0 }}
                className="tabular-nums"
                aria-pressed={isActive}
              >
                {label}
              </button>
            );
          })}
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              style={{ ...CHIP_RESET, flexShrink: 0 }}
              aria-label="날짜 필터 초기화"
            >
              × 초기화
            </button>
          )}
        </div>

        {/* 정밀 날짜 선택 (시작일 ~ 종료일) */}
        <div className="flex items-center gap-2">
          <DatePicker
            value={dateFrom ? dayjs(dateFrom) : null}
            onChange={(d) => setDateFrom(d ? d.format('YYYY-MM-DD') : '')}
            disabledDate={(d) => (dateTo ? d.isAfter(dayjs(dateTo), 'day') : false)}
            placeholder="시작일"
            format="YYYY-MM-DD"
            style={{ flex: 1, minWidth: 0, borderRadius: 12 }}
            size="middle"
            inputReadOnly
            allowClear
            suffixIcon={<CalendarBlankIcon size={14} weight="fill" color={TEXT_TERTIARY} />}
          />
          <span style={{ color: TEXT_TERTIARY, fontSize: 13, userSelect: 'none' }}>~</span>
          <DatePicker
            value={dateTo ? dayjs(dateTo) : null}
            onChange={(d) => setDateTo(d ? d.format('YYYY-MM-DD') : '')}
            disabledDate={(d) => (dateFrom ? d.isBefore(dayjs(dateFrom), 'day') : false)}
            placeholder="종료일"
            format="YYYY-MM-DD"
            style={{ flex: 1, minWidth: 0, borderRadius: 12 }}
            size="middle"
            inputReadOnly
            allowClear
            suffixIcon={<CalendarBlankIcon size={14} weight="fill" color={TEXT_TERTIARY} />}
          />
        </div>
      </div>

      {/* 학생 검색 + 수업 종류 필터 */}
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
          {filteredClasses.length === 0 ? (
            <EmptyState
              icon="📅"
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
            <ul className={`px-4 space-y-3 ${hasMore ? 'pb-2' : 'pb-24'}`}>
              {filteredClasses.map((cls) => (
                <ClassCard key={cls.id} cls={cls} studentNameMap={studentNameMap} />
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
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </Button>
            </div>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function ClassCard({ cls, studentNameMap }) {
  const navigate = useNavigate();
  const now = new Date();
  const isOngoing = !cls.notes?.includes('취소')
    && cls.datetime && cls.endTime
    && now >= new Date(cls.datetime)
    && now < new Date(cls.endTime);
  const { bg, text } = isOngoing ? { bg: 'bg-brand-50', text: 'text-brand-700' } : classStatusColor(cls.status);
  const statusLabel = isOngoing ? '수업중' : stripEmoji(cls.status);
  const studentNames = cls.studentIds.map((id) => studentNameMap[id] || '(알 수 없음)').join(', ');
  const isCompleted = cls.datetime && new Date(cls.datetime) <= new Date();
  const logId = cls.lessonLogIds?.[0];
  const [creatingLog, setCreatingLog] = useState(false);

  const handleLogClick = async (e) => {
    e.stopPropagation();
    if (logId) {
      navigate(`/logs/${logId}/edit`);
      return;
    }
    setCreatingLog(true);
    try {
      const names = cls.studentIds.map((id) => studentNameMap[id]).filter(Boolean).join(', ');
      const dateStr = cls.datetime
        ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
        : '';
      const created = await createLessonLog({
        title: `${names} ${dateStr}`.trim(),
        classId: cls.id,
        studentIds: cls.studentIds,
      });
      invalidateCache('lessonLogs');
      navigate(`/logs/${created.id}/edit`);
    } catch (e) {
      message.error(`일지 생성 실패: ${e.message}`);
      setCreatingLog(false);
    }
  };

  return (
    <li
      className="duration-150 ease-out"
    >
      <Card
        variant="borderless"
        style={{ borderRadius: 16, cursor: 'pointer', boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
        styles={{ body: { padding: '14px 16px' } }}
        onClick={() => navigate(`/classes/${cls.id}`)}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {studentNames || cls.title || '학생 미정'}
            </p>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 2px' }} className="tabular-nums">
              {cls.datetime ? formatDateTime(cls.datetime) : '일시 미정'}
              {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
              {cls.duration && ` · ${cls.duration}분`}
            </p>
            {cls.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <MapPinIcon size={12} weight="fill" color={TEXT_TERTIARY} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                  {cls.location}{cls.locationMemo && ` — ${cls.locationMemo}`}
                </span>
              </div>
            )}
            {cls.noteMemo && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 2 }}>
                <InfoIcon size={12} weight="fill" color={TEXT_TERTIARY} style={{ flexShrink: 0, marginTop: 3 }} />
                <span style={{ fontSize: 12, color: TEXT_TERTIARY, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', lineHeight: 1.5 }}>
                  {cls.noteMemo}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
            <Badge label={statusLabel} bg={bg} text={text} />
            {cls.notes && (() => {
              const nc = notesColor(cls.notes);
              return nc ? <Badge label={stripEmoji(cls.notes)} bg={nc.bg} text={nc.text} /> : null;
            })()}
          </div>
        </div>
        {(cls.sessionShortage || cls.conflictDetected) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {cls.sessionShortage && (
              <span style={{ fontSize: 12, color: STATUS_WARNING_TEXT, background: STATUS_WARNING_BG, padding: '2px 8px', borderRadius: 20 }}>
                {cls.sessionShortage}
              </span>
            )}
            {cls.conflictDetected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: STATUS_ERROR_TEXT, background: STATUS_ERROR_BG, padding: '2px 8px', borderRadius: 20 }}>
                <WarningCircleIcon size={12} weight="fill" />
                시간 충돌
              </span>
            )}
          </div>
        )}
        {isCompleted && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleLogClick}
              disabled={creatingLog}
              style={{
                fontSize: 12, fontWeight: 600,
                padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: logId ? PRIMARY_BG : '#f5f5f5',
                color: logId ? PRIMARY : TEXT_SECONDARY,
                transition: 'background-color 150ms ease-out',
                opacity: creatingLog ? 0.5 : 1,
              }}
              className="transition-[background-color] duration-150 ease-out"
            >
              {creatingLog ? '생성 중...' : logId ? '일지 보기' : '일지 작성'}
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}
