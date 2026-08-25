import {
  useState,
  useEffect,
  useMemo } from 'react';
import { BellIcon,
  GearSixIcon,
  CalendarPlusIcon,
  ReceiptIcon,
  UsersThreeIcon,
  CaretRightIcon,
  HourglassLowIcon,
  CalendarCheckIcon,
  NotebookIcon } from '@phosphor-icons/react';
import { Link,
  useNavigate } from 'react-router-dom';
import { Card } from 'antd';
import useEmblaCarousel from 'embla-carousel-react';
import { useData } from '../context/DataContext.jsx';
import { queryPage,
  queryAll,
  getPage } from '../api/notionClient.js';
import { swrLoad } from '../hooks/useCachedResource.js';
import { CLASSES_DB,
  parseClass } from '../api/classes.js';
import { HOMEWORK_DB,
  parseHomework } from '../api/homework.js';
import { parseLessonLog } from '../api/lessonLogs.js';
import { CONSULT_DB } from '../constants.js';
import { STATUS_ACTIVE } from '../api/students.js';
import { formatShort,
  formatDateTime,
  formatTime,
  KST } from '../utils/dateUtils.js';
import { isOnlineGroupTitle,
  isFreeConsultTitle,
  isFixedPriceTitle } from '../utils/classTypeKind.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import PendingClassCard from '../components/home/PendingClassCard.jsx';
import { usePendingClassState } from '../hooks/usePendingClassState.js';
import {
  PRIMARY,
  PRIMARY_BG,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  STATUS_ERROR_TEXT,
  STATUS_ERROR_BG,
  STATUS_WARNING_BG,
  STATUS_WARNING_BORDER,
  STATUS_WARNING_TEXT,
  STATUS_WARNING_TEXT_DARK,
  GRAY_100 } from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { getInstructorName, getNtfyTopic } from './SettingsPage.jsx';

// 회차 부족을 며칠 앞까지 살필지. 좁게 잡아 홈 로딩·Notion 쿼터 부담을 줄인다
// (주 25건쯤 되는 수업 밀도에서 30일이면 queryAll 2페이지 안쪽).
const SHORTAGE_WINDOW_DAYS = 30;

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

export default function HomePage() {
  const navigate = useNavigate();
  const { studentNameMap, classTypeMap, students, remainingByStudent, refresh: refreshData } = useData();
  // loadShortage가 채우는 수업 인덱스.
  //  firstShortage: 학생별 '가장 이른 회차부족 수업' 일시 — 이미 회차를 넘긴 경우
  //  lastClass    : 학생별 '가장 늦은 예정 수업' 일시 — 언제까지 커버되는지 알려주는 용도
  const [classIndex, setClassIndex] = useState({ firstShortage: {}, lastClass: {} });
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [consultCount, setConsultCount] = useState(0);
  const [submittedHomework, setSubmittedHomework] = useState([]);
  const [todayClasses, setTodayClasses] = useState([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [tomorrowPrepCount, setTomorrowPrepCount] = useState(0);
  // 로더 실패 시 빈 상태("오늘 수업 없음")로 위장하지 않도록 실패 배너 표시용
  const [loadFailed, setLoadFailed] = useState(false);
  const [instructorName, setInstructorName] = useState(getInstructorName);
  const [lowSessionOpen, setLowSessionOpen] = useState(false);

  // 결제 안내가 필요한 학생 — 성격이 다른 두 신호를 합친다.
  //  ① 초과: 이미 잡아둔 수업이 결제 회차를 넘었다 (수업 formula '시간 회차 부족')
  //  ② 여유 없음: 잔여 0회 이하 — 수업을 더 잡으려면 결제가 필요하다
  // ②를 빼면 "다음 수업도 안 잡힌 잔여 0회" 학생을 통째로 놓친다(2026-08-25 실측 3명).
  const paymentDueRows = useMemo(() => {
    const rows = [];
    for (const s of students) {
      if (s.status !== STATUS_ACTIVE) continue;
      const shortageAt = classIndex.firstShortage[s.id];
      const remaining = remainingByStudent[s.id] ?? 0;
      if (shortageAt) {
        rows.push({ id: s.id, name: s.name, urgent: true, reason: `${formatShort(shortageAt)} 수업부터 초과` });
      } else if (remaining <= 0) {
        const lastAt = classIndex.lastClass[s.id];
        rows.push({
          id: s.id,
          name: s.name,
          urgent: false,
          reason: lastAt ? `잔여 ${remaining}회 · ${formatShort(lastAt)} 수업까지` : `잔여 ${remaining}회 · 다음 수업 없음`,
        });
      }
    }
    // 이미 넘긴 사람 먼저, 그다음 잔여가 적은 순.
    return rows.sort((a, b) => (b.urgent === true) - (a.urgent === true));
  }, [students, classIndex]);

  // 피드백 대기 숙제 가로 스크롤 (Embla 자유 스크롤 — 드래그·관성·끝 저항, 마우스+터치)
  const [hwEmblaRef] = useEmblaCarousel({ dragFree: true, containScroll: 'trimSnaps' });

  const today = getKSTToday();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;
  const [unreadCount, setUnreadCount] = useState(() => {
    try {
      const notifications = JSON.parse(localStorage.getItem('ntfy_notifications') || '[]');
      const lastRead = parseInt(localStorage.getItem('ntfy_last_read') || '0', 10);
      return notifications.filter((n) => n.time > lastRead).length;
    } catch {
      return 0;
    }
  });

  const { state: pendingState, setHwDone, setDismissed } = usePendingClassState();

  const [upcomingPrep, setUpcomingPrep] = useState(null);

  const loadUpcoming = async () => {
    setLoading(true);
    try {
      // 날짜 키를 붙여 자정을 넘기면 지난 수업이 남지 않게 한다.
      await swrLoad(`home:upcoming:${todayStr}`, async () => {
        const data = await queryPage(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: new Date().toISOString() } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          [{ property: '수업 일시', direction: 'ascending' }],
          undefined,
          5
        );
        return (data?.results ?? []).map(parseClass);
      }, (list, { fromCache }) => {
        setClasses(list);
        setLoading(false);
        // 준비 메모는 새로 받은 목록으로만 조회한다 — 캐시로 두 번 부르지 않게.
        if (!fromCache) loadUpcomingPrep(list[0]);
      });
    } catch (e) {
      console.error('[홈] 수업 불러오기 오류', e); setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // 결제 안내가 필요한 학생 찾기.
  //
  // ⚠️ 학생의 '잔여 시간 회차'로 판단하면 안 된다 — 강사가 앞으로의 수업을 미리 등록해두면
  //    아직 하지도 않은 수업까지 사용 회차로 잡혀 잔여가 0이나 음수가 된다. 그래서 이 기준으로는
  //    수강중 21명 중 13명이 "부족"으로 뜨고(2026-08-25 실측) 경고가 신호 구실을 못 했다.
  //    수업 단위 formula '시간 회차 부족'은 그 수업 시점 기준이라 실제로 결제가 필요한 건만 잡힌다
  //    (같은 시점 실측 1건). 수업 캘린더가 쓰는 뱃지와 같은 출처다.
  const loadShortage = async () => {
    try {
      // ⚠️ '시간 회차 부족'은 서버 필터를 걸 수 없다 — Notion이
      //    "Unable to filter based on a formula of unknown type"으로 400을 준다(2026-08-25 확인).
      //    그래서 앞으로 SHORTAGE_WINDOW_DAYS치를 받아 클라이언트에서 거른다. 범위를 좁게 잡는 이유는
      //    전체 미래 수업(수백 건)을 매번 끌어오면 홈 로딩과 Notion 쿼터에 부담이 되기 때문.
      // 홈 로더 중 유일하게 queryAll(여러 페이지)이라 가장 무겁다 → 캐시 효과도 제일 크다.
      await swrLoad(`home:shortage:${todayStr}`, async () => {
        const from = new Date();
        const to = new Date(from.getTime() + SHORTAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const results = await queryAll(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: from.toISOString() } },
              { property: '수업 일시', date: { on_or_before: to.toISOString() } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          [{ property: '수업 일시', direction: 'ascending' }]
        );
        // 수업 일시 오름차순이므로, 처음 만난 부족 수업이 '가장 이른' 것이고
        // 마지막까지 덮어쓴 값이 '가장 늦은 예정 수업'이 된다.
        // 캐시에는 이 인덱스만 담는다(수업 수백 건 원본은 localStorage에 들어가지 않는다).
        const firstShortage = {};
        const lastClass = {};
        for (const cls of results.map(parseClass)) {
          for (const id of cls.studentIds ?? []) {
            if (cls.sessionShortage && !firstShortage[id]) firstShortage[id] = cls.datetime;
            lastClass[id] = cls.datetime;
          }
        }
        return { firstShortage, lastClass };
      }, setClassIndex);
    } catch (e) {
      console.error('[홈] 회차 부족 수업 불러오기 오류', e); setLoadFailed(true);
    }
  };

  const loadUpcomingPrep = async (nextClass) => {
    if (!nextClass || !nextClass.studentIds?.length) { setUpcomingPrep(null); return; }
    try {
      const firstStudentId = nextClass.studentIds[0];
      const prevData = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '학생', relation: { contains: firstStudentId } },
            { property: '수업 일시', date: { before: new Date().toISOString() } },
            { property: '수업 일지', relation: { is_not_empty: true } },
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
          ] },
        [{ property: '수업 일시', direction: 'descending' }],
        undefined,
        1
      );
      const prevPage = (prevData?.results ?? [])[0];
      if (!prevPage) { setUpcomingPrep(null); return; }
      const prevClass = parseClass(prevPage);
      const logId = prevClass.lessonLogIds?.[0];
      if (!logId) { setUpcomingPrep(null); return; }
      const logPage = await getPage(logId);
      const log = parseLessonLog(logPage);
      const text = log.nextPrepare?.trim();
      if (!text) { setUpcomingPrep(null); return; }
      setUpcomingPrep({ classId: nextClass.id, logId, text });
    } catch (e) {
      console.error('[홈] 준비사항 로드 오류', e);
      setUpcomingPrep(null);
    }
  };

  const loadSubmittedHomework = async () => {
    try {
      await swrLoad('home:submittedHw', async () => {
        const data = await queryPage(
          HOMEWORK_DB,
          { property: '제출 상태', select: { equals: '제출완료' } },
          [{ property: '제출일', direction: 'descending' }],
          undefined,
          20
        );
        return (data?.results ?? []).map(parseHomework);
      }, setSubmittedHomework);
    } catch (e) {
      console.error('[홈] 제출된 숙제 불러오기 오류', e); setLoadFailed(true);
    }
  };

  const loadConsultCount = async () => {
    try {
      await swrLoad('home:consultCount', async () => {
        const data = await queryPage(
          CONSULT_DB,
          { property: '상태', select: { equals: '신청됨' } },
          undefined,
          undefined,
          100
        );
        return data?.results?.length ?? 0;
      }, setConsultCount);
    } catch (e) {
      console.error('[홈] 상담 수 불러오기 오류', e); setLoadFailed(true);
    }
  };

  const loadTodayClasses = async () => {
    setTodayLoading(true);
    try {
      // 키에 날짜를 넣어 날이 바뀌면 어제 캐시를 쓰지 않게 한다.
      await swrLoad(`home:today:${todayStr}`, async () => {
        const data = await queryPage(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: `${todayStr}T00:00:00+09:00` } },
              { property: '수업 일시', date: { on_or_before: `${todayStr}T23:59:59+09:00` } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          [{ property: '수업 일시', direction: 'ascending' }],
          undefined,
          20
        );
        return (data?.results ?? []).map(parseClass);
      }, (list) => {
        setTodayClasses(list);
        setTodayLoading(false); // 캐시가 있으면 여기서 이미 화면이 찬다
      });
    } catch (e) {
      console.error('[홈] 오늘 수업 불러오기 오류', e); setLoadFailed(true);
    } finally {
      setTodayLoading(false);
    }
  };

  const loadTomorrowPrep = async () => {
    try {
      const tmr = new Date(today.year, today.month, today.day + 1);
      const tomorrowStr = `${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}`;
      await swrLoad(`home:tomorrowPrep:${tomorrowStr}`, async () => {
        const data = await queryPage(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
              { property: '수업 일시', date: { on_or_before: `${tomorrowStr}T23:59:59+09:00` } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          undefined,
          undefined,
          50
        );
        // 캐시에는 학생 수만 담는다 — 수업 원본을 통째로 넣을 이유가 없다.
        const ids = new Set();
        (data?.results ?? []).map(parseClass).forEach((c) => c.studentIds.forEach((id) => ids.add(id)));
        return ids.size;
      }, setTomorrowPrepCount);
    } catch (e) {
      console.error('[홈] 내일 수업 수 불러오기 오류', e); setLoadFailed(true);
    }
  };

  useEffect(() => {
    loadUpcoming();
    loadConsultCount();
    loadSubmittedHomework();
    loadTodayClasses();
    loadTomorrowPrep();
    loadShortage();
  }, []);

  // 설정/알림 페이지에서 돌아올 때 이름 및 뱃지 갱신 (마운트 시 1회)
  useEffect(() => {
    setInstructorName(getInstructorName());
    try {
      const notifications = JSON.parse(localStorage.getItem('ntfy_notifications') || '[]');
      const lastRead = parseInt(localStorage.getItem('ntfy_last_read') || '0', 10);
      setUnreadCount(notifications.filter((n) => n.time > lastRead).length);
    } catch {}
  }, []);

  const handleRefresh = async () => {
    setLoadFailed(false);
    await Promise.all([
      loadUpcoming(),
      loadConsultCount(),
      loadSubmittedHomework(),
      loadTodayClasses(),
      loadTomorrowPrep(),
      loadShortage(),
      refreshData(),
    ]);
  };

  // 최근 완료된 수업 (오늘 종료된 수업) - 수업 마무리 카드용
  const nowMs = Date.now();
  const recentlyCompleted = todayClasses.filter((cls) => {
    if (!cls.endTime) return false;
    if (new Date(cls.endTime).getTime() > nowMs) return false;
    const s = pendingState[cls.id] || {};
    if (s.dismissed) return false;
    const logDone = (cls.lessonLogIds?.length ?? 0) > 0;
    if (s.hwDone && logDone) return false;
    return true;
  });
  const visiblePending = recentlyCompleted.slice(0, 5);
  const overflowCount = Math.max(0, recentlyCompleted.length - 5);

  // 오늘 수업 요약
  const totalMinutes = todayClasses.reduce((sum, cls) => sum + (parseInt(cls.duration) || 0), 0);

  // 숙제 관리는 하단 탭으로 올라갔다. 그 자리에 수업 일지를 둔다 —
  // 화면·데이터는 진작 있었는데 앱 어디에서도 갈 수 없는 고아 화면이었다(2026-08-24 검수).
  const QUICK_ACTIONS = [
    { label: '수업 추가', Icon: CalendarPlusIcon, path: '/classes/new' },
    { label: '결제 입력', Icon: ReceiptIcon, path: '/payments/new' },
    { label: '학생 관리', Icon: UsersThreeIcon, path: '/students' },
    { label: '수업 일지', Icon: NotebookIcon, path: '/logs' },
  ];

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      {/* 헤더 */}
      <div className="px-4 pt-8 pb-2 flex items-start justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요<br />
          {instructorName
            ? <><span className="text-brand-600">{instructorName}</span> 강사님</>
            : <span className="text-brand-600">강사님</span>}
        </h1>
        <div className="flex items-center gap-0.5">
        {/* 알림 버튼 */}
        <button
          onClick={() => { setUnreadCount(0); navigate('/notifications'); }}
          className="p-2 relative text-gray-400 active:text-gray-600 transition-[color] duration-150 ease-out"
          aria-label="알림"
        >
          <BellIcon weight="fill" size={24} />
          {unreadCount > 0 && (
            <span
              className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none tabular-nums"
              style={{ animation: 'badge-in 300ms cubic-bezier(0.2, 0, 0, 1) both' }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {/* 설정 버튼 */}
        <button
          onClick={() => navigate('/settings')}
          className="p-2 -mr-1 text-gray-400 active:text-gray-600 transition-[color] duration-150 ease-out"
          aria-label="설정"
        >
          <GearSixIcon weight="fill" size={24} />
        </button>
        </div>
      </div>

      {/* 로드 실패 배너 — 오류를 "수업 없음" 빈 상태로 위장하지 않기 */}
      {loadFailed && (
        <div className="px-4 pt-2">
          <div
            role="alert"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '10px 14px', borderRadius: 12,
              background: STATUS_ERROR_BG,
              color: STATUS_ERROR_TEXT, fontSize: 13, fontWeight: 600,
            }}
          >
            <span>일부 정보를 불러오지 못했어요 — 표시가 실제와 다를 수 있어요.</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="hit-40"
              style={{
                flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                color: STATUS_ERROR_TEXT, fontWeight: 700, fontSize: 13, padding: '6px 4px', minHeight: 32,
              }}
            >
              다시 시도
            </button>
          </div>
        </div>
      )}

      {/* 빠른 실행 */}
      <div
        className="px-4 pt-4 pb-1 grid grid-cols-2 gap-2"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '0ms' }}
      >
        {QUICK_ACTIONS.map(({ label, Icon, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className="press flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-white active:bg-gray-50 transition-[background-color] duration-150 ease-out"
            style={{ boxShadow: 'var(--shadow-border)' }}
          >
            <Icon size={24} weight="fill" color={PRIMARY} />
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>

      {/* 오늘 수업 요약 */}
      <div
        className="px-4 pt-3"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '80ms' }}
      >
        <Card
          variant="borderless"
          style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}
          styles={{ body: { padding: '14px 16px' } }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">오늘 수업</span>
            {todayLoading ? (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            ) : todayClasses.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums" style={{ color: TEXT_PRIMARY }}>
                  {todayClasses.length}개
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-xs tabular-nums text-gray-400">총 {totalMinutes}분</span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">없음</span>
            )}
          </div>
          {!todayLoading && todayClasses.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {todayClasses.map((cls) => {
                const names = cls.studentIds
                  .map((id) => studentNameMap[id])
                  .filter(Boolean)
                  .map((n) => n.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                  .join(', ');
                const timeStr = cls.datetime
                  ? new Date(cls.datetime).toLocaleTimeString('ko-KR', {
                      timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
                  : '';
                const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
                return (
                  <li key={cls.id}>
                    <Link
                      to={`/classes/${cls.id}/edit`}
                      className="press flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 active:bg-gray-100 transition-[background-color] duration-150"
                    >
                      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: TEXT_PRIMARY }}>
                        {timeStr}{endTimeStr && `~${endTimeStr}`}
                      </span>
                      <span className="flex-1 text-sm font-semibold text-gray-800 truncate">
                        {names || cls.title || '학생 미정'}
                      </span>
                      {cls.duration && (
                        <span className="text-xs tabular-nums text-gray-400 shrink-0">{cls.duration}분</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* 내일 수업 준비 */}
      {tomorrowPrepCount > 0 && (
        <div
          className="px-4 pt-3"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '80ms' }}
        >
          <button
            type="button"
            onClick={() => navigate('/home/tomorrow-prep')}
            className="block w-full text-left transition-[background-color] duration-150 ease-out"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <Card
              variant="borderless"
              style={{ borderRadius: 16, backgroundColor: PRIMARY, boxShadow: 'var(--shadow-brand-card)' }}
              /* 오른쪽 캐럿은 시각 무게가 가벼워 좌우 패딩이 같으면 더 떠 보인다 → 아이콘 쪽만 2px 덜 */
              styles={{ body: { padding: '14px 14px 14px 16px' } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CalendarCheckIcon size={24} weight="fill" color="#ffffff" />
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                      내일 수업 준비
                    </span>
                    <span className="tabular-nums" style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginLeft: 8 }}>
                      {tomorrowPrepCount}명
                    </span>
                  </div>
                </div>
                <CaretRightIcon size={20} weight="bold" color="rgba(255,255,255,0.8)" />
              </div>
            </Card>
          </button>
        </div>
      )}

      {/* 미확인 무료상담 신청 */}
      {consultCount > 0 && (
        <div
          className="px-4 pt-3"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '80ms' }}
        >
          <Link
            to="/consult"
            className="block"
          >
            <Card
              variant="borderless"
              style={{ borderRadius: 16, backgroundColor: STATUS_ERROR_BG, boxShadow: 'var(--shadow-danger-border)' }}
              styles={{ body: { padding: '14px 16px' } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-lg">📩</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>
                    미확인 상담 신청 {consultCount}건
                  </span>
                </div>
                <span className="text-xs text-gray-400">확인하기 ›</span>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {/* 결제 안내가 필요한 학생 — 목록으로 보내지 않고 여기서 바로 누구인지·언제부터인지 펼친다.
          (필터 없는 /students로 보내면 "몇 명"만 알고 "누구"는 끝내 알 수 없었다.) */}
      {paymentDueRows.length > 0 && (
        <div
          className="px-4 pt-3"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '100ms' }}
        >
          <Card
            variant="borderless"
            style={{ borderRadius: 16, backgroundColor: STATUS_WARNING_BG, boxShadow: `0 0 0 1px ${STATUS_WARNING_BORDER} inset` }}
            styles={{ body: { padding: '14px 16px' } }}
          >
            <button
              type="button"
              onClick={() => setLowSessionOpen((v) => !v)}
              aria-expanded={lowSessionOpen}
              className="w-full flex items-center justify-between"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', minHeight: 24, WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="flex items-center gap-2">
                <HourglassLowIcon size={20} weight="fill" color={STATUS_WARNING_TEXT} />
                <span className="text-sm font-semibold tabular-nums" style={{ color: STATUS_WARNING_TEXT_DARK }}>
                  결제 안내 필요 {paymentDueRows.length}명
                </span>
              </span>
              <span className="text-xs flex items-center gap-0.5" style={{ color: STATUS_WARNING_TEXT }}>
                {lowSessionOpen ? '접기' : '누구인지 보기'}
                <CaretRightIcon
                  size={12}
                  weight="bold"
                  style={{
                    transform: lowSessionOpen ? 'rotate(90deg)' : 'none',
                    transitionProperty: 'transform',
                    transitionDuration: '0.2s',
                    transitionTimingFunction: 'var(--ease-out)' }}
                />
              </span>
            </button>

            {/* 펼침은 grid-template-rows 트랜지션 — 내용 높이를 몰라도 되고,
                펼치는 중에 다시 눌러도 그 자리에서 되감긴다(키프레임은 처음부터 다시 시작). */}
            <div className="reveal" data-open={lowSessionOpen}>
              <div>
                <div style={{ marginTop: 6 }}>
                {paymentDueRows.map((row) => (
                  <Link
                    key={row.id}
                    to={`/students/${row.id}`}
                    className="flex items-center justify-between gap-3"
                    style={{ padding: '10px 0', minHeight: 44, textDecoration: 'none' }}
                  >
                    <span
                      className="text-sm shrink-0"
                      style={{ color: TEXT_PRIMARY, fontWeight: row.urgent ? 600 : 400 }}
                    >
                      {row.name}
                    </span>
                    <span
                      className="text-xs tabular-nums text-right"
                      style={{ color: row.urgent ? STATUS_WARNING_TEXT_DARK : TEXT_TERTIARY }}
                    >
                      {row.reason}
                    </span>
                  </Link>
                ))}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* 수업 마무리 */}
      {!todayLoading && recentlyCompleted.length > 0 && (
        <div
          className="px-4 pt-6"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '120ms' }}
        >
          <SectionHeading style={{ marginBottom: 12 }}>수업 마무리</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visiblePending.map((cls) => {
              const names = cls.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .map((n) => n.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                .join(', ');
              const s = pendingState[cls.id] || {};
              return (
                <PendingClassCard
                  key={cls.id}
                  cls={cls}
                  studentName={names}
                  hwDone={!!s.hwDone}
                  onHwClick={setHwDone}
                  onDismiss={setDismissed}
                />
              );
            })}
            {overflowCount > 0 && (
              <Link
                to="/home/pending"
                className="transition-[background-color] duration-150 ease-out"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  height: 40, borderRadius: 10, background: '#fff',
                  boxShadow: 'var(--shadow-border)',
                  color: PRIMARY, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none' }}
              >
                더보기 <span className="tabular-nums">+{overflowCount}</span>
                <CaretRightIcon size={16} weight="bold" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 제출된 숙제 */}
      {submittedHomework.length > 0 && (
        <div
          className="pt-6"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '160ms' }}
        >
          <SectionHeading style={{ marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
            피드백 대기 숙제 <span className="tabular-nums" style={{ color: TEXT_PRIMARY }}>{submittedHomework.length}</span>
          </SectionHeading>
          <div ref={hwEmblaRef} className="overflow-hidden pull-isolate">
            <div style={{
              display: 'flex', gap: 10, padding: '4px 16px 8px 16px' }}>
            {submittedHomework.map((hw) => {
              const studentName = hw.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .join(', ')
                .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
                .trim();
              const submitDate = hw.submitDate
                ? new Date(hw.submitDate).toLocaleString('ko-KR', {
                    timeZone: KST, month: 'numeric', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false })
                : null;
              return (
                <Link
                  key={hw.id}
                  to={`/homework/${hw.id}`}
                  style={{ flexShrink: 0, textDecoration: 'none', display: 'block' }}
                  className=""
                >
                  <div style={{
                    width: 136, height: 136, borderRadius: 12, padding: 12,
                    background: '#fff', boxShadow: 'var(--shadow-border)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    boxSizing: 'border-box' }}>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {studentName || '—'}
                      </p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY, margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {hw.title}
                      </p>
                    </div>
                    <div>
                      <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY }}>
                        제출완료
                      </span>
                      {submitDate && (
                        <p style={{ fontSize: 11, color: TEXT_DISABLED, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{submitDate}</p>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* 다가오는 수업 */}
      <div
        className="px-4 pt-6 pb-24"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '240ms' }}
      >
        <SectionHeading style={{ marginBottom: 12 }}>다가오는 수업</SectionHeading>

        {loading ? (
          <LoadingSpinner />
        ) : classes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">예정된 수업이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((cls) => {
              const names = cls.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .map((n) => n.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                .join(', ');
              const title = cls.title || names || '수업';
              const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
              const timeStr = cls.datetime
                ? new Date(cls.datetime).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
              const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
              const dateStr = cls.datetime
                ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric', weekday: 'short' })
                : '';
              return (
                <li key={cls.id}>
                  <Link
                    to={`/classes/${cls.id}/edit`}
                    className="block tap-wrap"
                  >
                    <Card
                      variant="borderless"
                      className="card-tap"
                      style={{ borderRadius: 16 }}
                      styles={{ body: { padding: '14px 16px' } }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                        <p style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                          {title}
                        </p>
                        <span style={{ fontSize: 13, color: TEXT_SECONDARY, fontWeight: 400, flexShrink: 0 }} className="tabular-nums">
                          {dateStr} {timeStr}{endTimeStr && `–${endTimeStr}`}
                        </span>
                      </div>
                      {(classType || cls.location) && (
                        <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[classType, cls.location].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {(() => {
                        const typeTitle = classTypeMap[cls.classTypeId]?.title ?? '';
                        const isFree = isFreeConsultTitle(typeTitle);
                        const isOneDay = isFixedPriceTitle(typeTitle);
                        const isGroup = isOnlineGroupTitle(typeTitle);
                        if (isFree || isOneDay || isGroup) {
                          return (
                            <div style={{ marginTop: 8 }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 8px', borderRadius: 6,
                                background: GRAY_100,
                                color: TEXT_TERTIARY,
                                fontSize: 11, fontWeight: 600 }}>
                                {isFree ? '무료상담' : isGroup ? '그룹수업' : typeTitle.includes('체험') ? '체험수업' : '원데이클래스'}
                              </span>
                            </div>
                          );
                        }
                        if (classes[0]?.id === cls.id && upcomingPrep && cls.id === upcomingPrep.classId) {
                          return (
                            <div style={{
                              marginTop: 10, paddingTop: 10,
                              borderTop: `1px solid ${GRAY_100}` }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 11, color: TEXT_TERTIARY, flexShrink: 0, lineHeight: 1.45, marginTop: 1 }}>
                                  준비
                                </span>
                                <span style={{ fontSize: 13, color: TEXT_PRIMARY, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {upcomingPrep.text}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PullToRefresh>
  );
}
