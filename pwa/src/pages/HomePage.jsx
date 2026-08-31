import {
  useState,
  useEffect,
  useMemo } from 'react';
import { BellIcon,
  GearSixIcon,
  CalendarPlusIcon,
  CreditCardIcon,
  NotePencilIcon,
  CaretRightIcon,
  CaretDownIcon,
  CalendarCheckIcon,
  NotebookIcon } from '@phosphor-icons/react';
import { Link,
  useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/shadcn/card';
import useEmblaCarousel from 'embla-carousel-react';
import { useData } from '../context/DataContext.jsx';
import { queryPage,
  queryAll } from '../api/notionClient.js';
import { swrLoad } from '../hooks/useCachedResource.js';
import { CLASSES_DB,
  parseClass } from '../api/classes.js';
import { formatSessions } from '../api/payments.js';
import { HOMEWORK_DB,
  parseHomework } from '../api/homework.js';
import { CONSULT_DB } from '../constants.js';
import { STATUS_ACTIVE } from '../api/students.js';
import { formatShort,
  formatDateTime,
  formatTime,
  formatDuration,
  KST } from '../utils/dateUtils.js';
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
  STATUS_WARNING_TEXT_DARK } from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { getInstructorName, getNtfyTopic } from './SettingsPage.jsx';

// 잔여 시간 부족을 며칠 앞까지 살필지. 좁게 잡아 홈 로딩·Notion 쿼터 부담을 줄인다
// (주 25건쯤 되는 수업 밀도에서 30일이면 queryAll 2페이지 안쪽).
const SHORTAGE_WINDOW_DAYS = 30;

// 결제 안내를 '결제가 필요해지는 날'로부터 며칠 전에 띄울지.
// 30일 창을 그대로 쓰면 9월 말 수업까지 미리 잡아둔 학생이 8월에 벌써 경고로 뜬다
// (2026-08-27 실측: 초과 9명 중 8명이 D-11 이상 남은 상태였다). 임박한 것만 남긴다.
const PAYMENT_DUE_LEAD_DAYS = 10;

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

export default function HomePage() {
  const navigate = useNavigate();
  const { studentNameMap, students, remainingByStudent, refresh: refreshData } = useData();
  // loadShortage가 채우는 수업 인덱스.
  //  firstShortage: 학생별 '가장 이른 시간부족 수업' 일시 — 이미 결제한 시간을 넘긴 경우
  //  lastClass    : 학생별 '가장 늦은 예정 수업' 일시 — 언제까지 커버되는지 알려주는 용도
  const [classIndex, setClassIndex] = useState({ firstShortage: {}, lastClass: {} });
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
  //  ① 초과: 이미 잡아둔 수업이 결제한 시간을 넘었다 (수업 formula '시간 회차 부족')
  //  ② 여유 없음: 잔여 0시간 이하 — 수업을 더 잡으려면 결제가 필요하다
  // ②를 빼면 "다음 수업도 안 잡힌 잔여 0시간" 학생을 통째로 놓친다(2026-08-25 실측 3명).
  const paymentDueRows = useMemo(() => {
    // '결제가 필요해지는 날' 기준 D-PAYMENT_DUE_LEAD_DAYS 안에 든 학생만 띄운다.
    //  ① 초과: 그 날 = 첫 '시간 회차 부족' 수업일
    //  ② 여유 없음: 그 날 = 마지막 예정 수업일 (그 뒤로는 수업을 못 잡으니 그때까지는 결제 필요)
    //     예정 수업이 아예 없으면 이미 끊긴 상태라 날짜를 오늘로 본다 = 항상 표시.
    const cutoff = Date.now() + PAYMENT_DUE_LEAD_DAYS * 24 * 60 * 60 * 1000;
    const withinLead = (iso) => !iso || new Date(iso).getTime() <= cutoff;

    const rows = [];
    for (const s of students) {
      if (s.status !== STATUS_ACTIVE) continue;
      const shortageAt = classIndex.firstShortage[s.id];
      const remaining = remainingByStudent[s.id] ?? 0;
      if (shortageAt) {
        if (!withinLead(shortageAt)) continue;
        rows.push({ id: s.id, name: s.name, urgent: true, dueAt: shortageAt, reason: `${formatShort(shortageAt)} 수업부터 초과` });
      } else if (remaining <= 0) {
        const lastAt = classIndex.lastClass[s.id];
        if (!withinLead(lastAt)) continue;
        rows.push({
          id: s.id,
          name: s.name,
          urgent: false,
          dueAt: lastAt,
          reason: lastAt ? `잔여 ${formatSessions(remaining)}시간 · ${formatShort(lastAt)} 수업까지` : `잔여 ${formatSessions(remaining)}시간 · 다음 수업 없음`,
        });
      }
    }
    // 이미 넘긴 사람 먼저, 그다음 결제가 필요해지는 날이 이른 순.
    return rows.sort((a, b) => (b.urgent === true) - (a.urgent === true) || String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? '')));
  }, [students, classIndex, remainingByStudent]);

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

  const { state: pendingState } = usePendingClassState();

  // 결제 안내가 필요한 학생 찾기.
  //
  // ⚠️ 학생의 '잔여 시간 회차'로 판단하면 안 된다 — 강사가 앞으로의 수업을 미리 등록해두면
  //    아직 하지도 않은 수업까지 사용 시간으로 잡혀 잔여가 0이나 음수가 된다. 그래서 이 기준으로는
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
      console.error('[홈] 잔여 시간 부족 수업 불러오기 오류', e); setLoadFailed(true);
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
    { label: '결제 추가', Icon: CreditCardIcon, path: '/payments/new' },
    { label: '숙제 추가', Icon: NotePencilIcon, path: '/homework/new' },
    { label: '수업 일지', Icon: NotebookIcon, path: '/logs' },
  ];

  // 인사 위 오늘 날짜 한 줄 — "오늘 수업 3개"가 어느 날의 이야기인지 화면 안에서 닫히게
  const todayLabel = new Date().toLocaleDateString('ko-KR', {
    timeZone: KST, month: 'long', day: 'numeric', weekday: 'long',
  });
  // 시간대별 중국어 인사 — 브랜드(중국어)가 하루의 인사를 건넨다.
  // 실사용 표현만 쓴다(하늘쌤 규칙): 早上好(아침)·你好(낮)·晚上好(저녁).
  const kstHour = Number(new Date().toLocaleString('en-US', { timeZone: KST, hour: 'numeric', hour12: false }));
  const cnGreeting = kstHour >= 5 && kstHour < 11 ? '早上好' : kstHour >= 11 && kstHour < 18 ? '你好' : '晚上好';
  const HANZI_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      {/* 헤더 */}
      <div className="px-4 pt-8 pb-2 flex items-start justify-between">
        <div>
          <p className="text-[13px] mb-1.5 tabular-nums" style={{ color: TEXT_TERTIARY }}>
            {todayLabel}
          </p>
          <h1 className="text-2xl font-bold tracking-tight break-keep" style={{ color: TEXT_PRIMARY }}>
            <span className="text-brand-600" style={{ fontFamily: HANZI_FONT }}>{cnGreeting}</span><br />
            {instructorName ? `${instructorName} 강사님` : '강사님'}
          </h1>
        </div>
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

      {/* 빠른 실행 — 타일이 40ms 간격으로 순서대로 떠오르는 캐스케이드 진입 */}
      <div className="px-4 pt-4 pb-1 grid grid-cols-2 gap-2">
        {QUICK_ACTIONS.map(({ label, Icon, path }, i) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className="press flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-white active:bg-gray-50 transition-[background-color] duration-150 ease-out"
            style={{
              boxShadow: 'var(--shadow-border)',
              animation: 'fade-in-up 400ms var(--ease-out) both',
              animationDelay: `${i * 40}ms`,
            }}
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
        <Card className="rounded-2xl">
          <CardContent>
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
                <span className="text-xs tabular-nums text-gray-400">총 {formatDuration(totalMinutes)}</span>
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
                    {/* 내일 수업 준비와 같은 카드 화면을 오늘치로 연다. 누른 수업의 학생 카드부터
                        시작하도록 ?student= 를 붙인다(2026-08-27). */}
                    <Link
                      to={`/home/today-prep${cls.studentIds?.[0] ? `?student=${cls.studentIds[0]}` : ''}`}
                      className="press flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 active:bg-gray-100 transition-[background-color] duration-150"
                    >
                      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: TEXT_PRIMARY }}>
                        {timeStr}{endTimeStr && `~${endTimeStr}`}
                      </span>
                      <span className="flex-1 text-sm font-semibold text-gray-800 truncate">
                        {names || cls.title || '학생 미정'}
                      </span>
                      {cls.duration && (
                        <span className="text-xs tabular-nums text-gray-400 shrink-0">{formatDuration(parseInt(cls.duration))}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          </CardContent>
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
              className="rounded-2xl shadow-[shadow:var(--shadow-brand-card)]"
              style={{ backgroundColor: PRIMARY }}
            >
              {/* 오른쪽 캐럿은 시각 무게가 가벼워 좌우 패딩이 같으면 더 떠 보인다 → 아이콘 쪽만 2px 덜 */}
              <CardContent className="py-3.5 pl-4 pr-3.5">
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
              </CardContent>
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
              className="rounded-2xl shadow-[shadow:var(--shadow-danger-border)]"
              style={{ backgroundColor: STATUS_ERROR_BG }}
            >
              <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-lg">📩</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>
                    미확인 상담 신청 {consultCount}건
                  </span>
                </div>
                <span className="text-xs text-gray-400">확인하기 ›</span>
              </div>
              </CardContent>
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
            className="rounded-2xl shadow-[shadow:var(--shadow-warning-border)]"
            style={{ backgroundColor: STATUS_WARNING_BG }}
          >
            {/* 바로 위 '내일 수업 준비'와 같은 뼈대 — 캐럿 쪽만 2px 덜 준다 */}
            <CardContent className="py-3.5 pl-4 pr-3.5">
            <button
              type="button"
              onClick={() => setLowSessionOpen((v) => !v)}
              aria-expanded={lowSessionOpen}
              aria-label={`결제 안내 필요 ${paymentDueRows.length}명 ${lowSessionOpen ? '접기' : '펼치기'}`}
              className="w-full flex items-center justify-between"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', minHeight: 24, WebkitTapHighlightColor: 'transparent' }}
            >
              <div className="flex items-center gap-2.5">
                {/* 색이 '주의'를 말하니 아이콘은 '무엇에 대한'을 맡는다 — 결제는 앱 전체가 카드 아이콘 */}
                <CreditCardIcon size={24} weight="fill" color={STATUS_WARNING_TEXT} />
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: STATUS_WARNING_TEXT_DARK }}>
                    결제 안내 필요
                  </span>
                  <span className="tabular-nums" style={{ fontSize: 13, color: STATUS_WARNING_TEXT, marginLeft: 8 }}>
                    {paymentDueRows.length}명
                  </span>
                </div>
              </div>
              {/* 캐럿만 둔다 — 위 카드가 캐럿 하나인데 여기만 '누구인지 보기 ›'면 둘이 다른 물건으로 보인다.
                  방향은 ⌄ — 이건 이동이 아니라 펼침이다(오른쪽 화살표는 "페이지가 바뀌나?"로 읽힌다). */}
              <CaretDownIcon
                size={20}
                weight="bold"
                color={STATUS_WARNING_TEXT}
                style={{
                  transform: lowSessionOpen ? 'rotate(180deg)' : 'none',
                  transitionProperty: 'transform',
                  transitionDuration: '0.2s',
                  transitionTimingFunction: 'var(--ease-out)' }}
              />
            </button>

            {/* 펼침은 grid-template-rows 트랜지션 — 내용 높이를 몰라도 되고,
                펼치는 중에 다시 눌러도 그 자리에서 되감긴다(키프레임은 처음부터 다시 시작). */}
            <div className="reveal" data-open={lowSessionOpen}>
              <div>
                <div style={{ marginTop: 10, paddingTop: 4, borderTop: `1px solid ${STATUS_WARNING_BORDER}` }}>
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
            </CardContent>
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

      {/* '다가오는 수업' 섹션은 제거됐다(2026-08-27 사용자 지시) — 수업 캘린더 탭과 중복.
          하단 여백은 이 섹션이 들고 있던 pb-24를 대신한다. */}
      <div className="pb-24" />
    </PullToRefresh>
  );
}
