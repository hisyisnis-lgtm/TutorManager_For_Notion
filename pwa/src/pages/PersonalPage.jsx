import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button } from '../components/shadcn/button';
import { Card, CardContent } from '../components/shadcn/card';
import { HouseIcon, BookOpenIcon, BellIcon, GearSixIcon, ArchiveIcon, UserIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import { peekCache, writeCacheValue, trackRevalidation } from '../hooks/useCachedResource.js';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { fetchMyHomework, parseHomework } from '../api/homework.js';
import { fetchStudentNotices } from '../api/notices.js';
import { clearStudentSession } from '../api/studentAuth.js';
import { getViewedMap, HW_VIEWED_KEY, isFeedbackArchived } from '../utils/homeworkViewed.js';
import { PANDA_FEED_KEY } from '../components/ui/PandaWidget.jsx';
import InstallBanner from '../components/ui/InstallBanner.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import OnboardingCarousel, { ONBOARDING_KEY } from '../components/ui/OnboardingCarousel.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';
import CoachMarkOverlay from '../components/ui/CoachMarkOverlay.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { useTabTip, resetAllTabTips } from '../hooks/useTabTip.js';
import HomeTab from './personal/HomeTab.jsx';
import MyClassesTab from './personal/MyClassesTab.jsx';
import ArchiveTab from './personal/ArchiveTab.jsx';
import NoticeTab from './personal/NoticeTab.jsx';
import HanulTab from './personal/HanulTab.jsx';
import MyTab from './personal/MyTab.jsx';
import {
  PRIMARY,
  TEXT_PRIMARY, TEXT_INACTIVE, TEXT_TERTIARY,
  BG_APP, BORDER_SUBTLE,
  STATUS_ERROR_TEXT,
} from '../constants/theme.js';

const SAVED_TOKEN_KEY = 'personal_student_token';

// ===== 메인 페이지 =====
export default function PersonalPage() {
  const navigate = useNavigate();
  const { studentToken } = useParams();
  const routerLocation = useLocation();

  // 캐시 우선 — 숙제 상세 등에 갔다 돌아올 때마다(재마운트) 전체 화면 스피너가 걸리던 것
  // (2026-08-31 지적). 수업·공지와 같은 어법: 캐시 즉시 표시 + 뒤에서 최신화.
  const [student, setStudent] = useState(() => peekCache(`student:info:${studentToken}`) ?? null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState(() => {
    const t = routerLocation.state?.tab;
    return ['홈', '내 수업', '보관함', '공지', '하늘하늘', 'MY'].includes(t) ? t : '홈';
  });
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(ONBOARDING_KEY));
  // 앱 숙제는 VIP 전용(2026-09-04) — 비VIP는 숙제 섹션·보관함 탭·숙제 코치마크를 숨긴다.
  // 서버 응답에 필드가 없는 옛 캐시(undefined)는 켜진 것으로 본다.
  const homeworkEnabled = student?.homeworkEnabled !== false;

  const [classRefreshKey, setClassRefreshKey] = useState(0);
  const [myClassesMonth, setMyClassesMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const install = useInstallPrompt();

  // 탭 레드닷
  const [archiveDot, setArchiveDot] = useState(false);
  const [classDot, setClassDot] = useState(false);
  const [noticeDot, setNoticeDot] = useState(false);

  // 홈 탭 숙제 섹션 (제출 전 / 제출 완료 / 피드백 완료)
  const [hwAlerts, setHwAlerts] = useState({ pending: [], submitted: [], feedback: [] });
  const prevTabRef = useRef(tab);
  const lastUpcomingIdsRef = useRef(null);

  const ARCHIVE_SEEN_KEY = `archive_last_seen_${studentToken}`;
  const NOTICE_SEEN_KEY = `notice_last_seen_${studentToken}`;
  const CLASS_SEEN_KEY = `classes_seen_ids_${studentToken}`;

  // 옛 공통 팬더 EXP 키(`panda_fed_total`) 정리 — 학생별 키 도입 전 누적된 잔존물.
  // 어느 학생 것인지 식별 불가능하므로 단순 삭제. 이미 없으면 무동작.
  useEffect(() => {
    try { localStorage.removeItem(PANDA_FEED_KEY); } catch {}
  }, []);

  // viewedMap 마이그레이션 (2026-05-21) — 옛 forceArchive 가 viewedAt 을 가짜로 "24h+1s 전" 시점에 기록하던
  // hack 때문에, 강사 피드백일이 그 사이에 끼면 feedbackDate > viewedAt 으로 잘못 판정돼 홈에 다시 등장.
  // 학생 입장에선 "이미 본 카드"이므로 일괄 Date.now() 로 보정 → 강사가 그 이후 새 피드백 주면 재등장.
  useEffect(() => {
    if (!studentToken) return;
    const MIGRATION_KEY = `hw_viewed_migrated_v2_${studentToken}`;
    if (localStorage.getItem(MIGRATION_KEY)) return;
    try {
      const map = getViewedMap(studentToken);
      const now = Date.now();
      const shifted = {};
      for (const id of Object.keys(map)) shifted[id] = now;
      localStorage.setItem(HW_VIEWED_KEY(studentToken), JSON.stringify(shifted));
      localStorage.setItem(MIGRATION_KEY, '1');
    } catch { /* ignore */ }
  }, [studentToken]);

  const checkDots = useCallback(async () => {
    const CK = `student:homework:${studentToken}`;
    // 홈 숙제 섹션(제출전/제출완료/피드백) 계산 — 표시용.
    const computeAlerts = (list) => {
      setHwAlerts({
        pending: list.filter(h => h.status === '미제출'),
        submitted: list.filter(h => h.status === '제출완료'),
        // 피드백 완료 — 아직 확인 안 함 + 강사가 viewedAt 이후 새 피드백 준 항목.
        feedback: list.filter(h => h.status === '피드백완료' && !isFeedbackArchived(studentToken, h.id, h.feedbackDate, h.feedbackSeenDate)),
      });
    };
    // 캐시 있으면 즉시 표시(홈 빠르게). '새 피드백' 여부는 아래 fresh로 ~1초 뒤 갱신.
    const cached = peekCache(CK);
    if (cached) computeAlerts(cached);
    try {
      const pages = await trackRevalidation(fetchMyHomework(studentToken));
      const list = pages.map(parseHomework);
      writeCacheValue(CK, list); // ArchiveTab과 캐시 공유
      computeAlerts(list);

      // 보관함 dot: 마지막 보관함 방문 이후 새로 archived된 항목 (최신 기준)
      const viewedMap = getViewedMap(studentToken);
      const lastSeenTime = parseInt(localStorage.getItem(ARCHIVE_SEEN_KEY) || '0', 10);
      setArchiveDot(
        list.some(h => {
          if (h.status !== '피드백완료') return false;
          const viewedAt = viewedMap[h.id];
          return viewedAt && isFeedbackArchived(studentToken, h.id, h.feedbackDate, h.feedbackSeenDate) && viewedAt > lastSeenTime;
        })
      );
    } catch { /* ignore */ }

    // 공지 dot: 마지막으로 공지 탭을 본 시각 이후에 게시된 공지가 있으면 점을 켠다.
    // 실패해도 조용히 넘어간다 — 배지는 부가 정보라 홈 로딩을 막을 이유가 없다.
    try {
      const notices = await fetchStudentNotices(studentToken);
      writeCacheValue(`student:notices:${studentToken}`, notices); // NoticeTab과 캐시 공유
      const lastSeen = parseInt(localStorage.getItem(NOTICE_SEEN_KEY) || '0', 10);
      setNoticeDot(notices.some((n) => n.publishedAt && new Date(n.publishedAt).getTime() > lastSeen));
    } catch { /* ignore */ }
  }, [studentToken]);

  // 내 수업 dot: HomeTab에서 upcoming classes 로드 시 호출
  const handleUpcomingLoaded = useCallback((classes) => {
    const currentIds = classes.map(c => c.id).sort().join(',');
    lastUpcomingIdsRef.current = currentIds;
    const seenIds = localStorage.getItem(CLASS_SEEN_KEY);
    if (seenIds === null) {
      // 최초 방문 — 스냅샷 저장, dot 없음
      localStorage.setItem(CLASS_SEEN_KEY, currentIds);
    } else if (currentIds !== seenIds) {
      setClassDot(true);
    }
  }, [studentToken]);

  useEffect(() => { checkDots(); }, [checkDots]);

  // 탭 이탈/방문 시 dot 처리
  useEffect(() => {
    if (!homeworkEnabled && tab === '보관함') setTab('홈');
  }, [homeworkEnabled, tab]);

  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = tab;

    // 보관함 탭에서 나올 때 숙제 목록 재확인 (확인 처리된 항목 반영)
    if (prev === '보관함' && tab !== '보관함') checkDots();

    // 보관함 탭 방문 시 dot 해제 + 타임스탬프 저장
    if (tab === '보관함') {
      localStorage.setItem(ARCHIVE_SEEN_KEY, String(Date.now()));
      setArchiveDot(false);
    }

    // 공지 탭 방문 시 dot 해제 — 기준은 '본 시각'이라 이후 올라온 공지만 다시 점을 켠다.
    if (tab === '공지') {
      localStorage.setItem(NOTICE_SEEN_KEY, String(Date.now()));
      setNoticeDot(false);
    }

    // 내 수업 탭 방문 시 dot 해제 + 스냅샷 갱신
    if (tab === '내 수업' && lastUpcomingIdsRef.current !== null) {
      localStorage.setItem(CLASS_SEEN_KEY, lastUpcomingIdsRef.current);
      setClassDot(false);
    }
  }, [tab, checkDots]);

  // 탭이 바뀌면 현재 history entry 의 state 도 갱신해 두어, 학생이 카드 → detail → 뒤로가기
  // 흐름에서 이전 entry 의 routerLocation.state.tab 으로 복원되도록 한다. (replace 라 history 스택 변동 없음)
  useEffect(() => {
    if (routerLocation.state?.tab === tab) return;
    navigate(routerLocation.pathname, {
      state: { ...routerLocation.state, tab },
      replace: true,
    });
    // routerLocation, navigate 는 stable 한 ref 라 deps 에는 tab 만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 탭별 튜토리얼 팁 (온보딩 완료 후 활성화)
  const [tipResetKey, setTipResetKey] = useState(0);
  const onboardingDone = !showOnboarding;
  const tipHome     = useTabTip('홈',     onboardingDone, tipResetKey);
  const tipClasses  = useTabTip('내 수업', onboardingDone, tipResetKey);
  const tipArchive  = useTabTip('보관함', onboardingDone, tipResetKey);

  // 코치마크 표시 여부 — 오버레이가 떠 있는 동안에는 설치 배너를 내보내지 않는다.
  // (배너가 코치마크의 '건너뛰기/다음' 버튼과 같은 높이에 겹쳐 글자가 뭉개졌다.)
  const coachHome    = tab === '홈'      && tipHome.visible;
  const coachClasses = tab === '내 수업' && tipClasses.visible;
  const coachArchive = tab === '보관함'  && homeworkEnabled && tipArchive.visible;
  const coachVisible = coachHome || coachClasses || coachArchive;
  const settingsRef = useRef(null);

  // 외부 클릭 or 탭 변경 시 설정 메뉴 닫기
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [settingsOpen]);

  useEffect(() => { setSettingsOpen(false); }, [tab]);

  const handleInstallAction = async () => {
    if (install.isInstalled) {
      toast.success('이미 홈 화면에 추가되어 있어요!');
      return;
    }
    if (install.canPrompt) {
      const accepted = await install.promptInstall();
      if (accepted) toast.success('홈 화면에 추가되었어요!');
      return;
    }
    setShowIOSGuide(true);
  };

  const loadStudent = useCallback(async () => {
    try {
      const data = await trackRevalidation(fetchStudentByToken(studentToken));
      localStorage.setItem(SAVED_TOKEN_KEY, studentToken);
      writeCacheValue(`student:info:${studentToken}`, data);
      setStudent(data);
    } catch (e) {
      localStorage.removeItem(SAVED_TOKEN_KEY);
      setStudentError(e.status === 404 ? '등록된 학생 코드가 아닙니다.' : e.message);
    }
  }, [studentToken]);

  useEffect(() => {
    if (!studentToken) {
      navigate('/personal', { replace: true });
      return;
    }
    loadStudent();
  }, [studentToken, navigate, loadStudent]);

  const handlePullRefresh = useCallback(async () => {
    setClassRefreshKey(k => k + 1);
    await Promise.all([loadStudent(), checkDots()]);
  }, [loadStudent, checkDots]);

  const { pullY, refreshing: pullRefreshing } = usePullToRefresh(handlePullRefresh);

  if (studentError) {
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center px-4">
        <Card className="w-full max-w-[360px] text-center shadow-[shadow:var(--shadow-card)]">
          <CardContent className="p-6">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <WarningCircleIcon size={44} weight="fill" color={STATUS_ERROR_TEXT} />
          </div>
          <p style={{ fontSize: 14, color: STATUS_ERROR_TEXT, margin: 0 }}>{studentError}</p>
          <Button
            block
            onClick={() => navigate('/personal')}
            className="mt-4"
          >
            다시 입력
          </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!student) {
    return (
      <div style={{ minHeight: '100dvh', backgroundColor: BG_APP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner />
      </div>
    );
  }

  // 오늘 날짜 한 줄 — 강사앱 홈 인사 섹션과 같은 어법(2026-08-31)
  const todayLabel = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long',
  });
  // 시간대별 중국어 인사 — 강사앱 홈과 동일(사용자 지시로 두 앱 통일, 2026-08-31).
  // 실사용 표현만: 早上好(아침)·你好(낮)·晚上好(저녁).
  const kstHour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }));
  const cnGreeting = kstHour >= 5 && kstHour < 11 ? '早上好' : kstHour >= 11 && kstHour < 18 ? '你好' : '晚上好';
  const HANZI_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

  // 설정 기어 + 플로팅 패널 — 홈 탭(인사 섹션 우측)과 다른 탭(고정 헤더 우측) 공용.
  // 아이콘 색은 강사앱 홈 헤더 아이콘과 맞춘다(2026-08-31).
  const settingsControl = (
    <div ref={settingsRef} style={{ position: 'relative' }}>
      {/* 강사앱 홈 헤더 아이콘 버튼과 동일 스타일(p-2·gray-400·active 진해짐, 2026-08-31) */}
      <button
        onClick={() => setSettingsOpen(v => !v)}
        aria-label="설정"
        aria-expanded={settingsOpen}
        className="p-2 -mr-1 text-gray-400 active:text-gray-600 transition-[color] duration-150 ease-out"
        style={{
          border: 'none', background: 'none', display: 'flex',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          outline: 'none' }}
      >
        <GearSixIcon weight="fill" size={24} />
      </button>

      {/* 플로팅 패널 */}
      <div style={{
        position: 'absolute', top: 44, right: 0,
        background: '#fff', borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        padding: '6px',
        minWidth: 140,
        zIndex: 110,
        transformOrigin: 'top right',
        transform: settingsOpen ? 'scale(1)' : 'scale(0.85)',
        opacity: settingsOpen ? 1 : 0,
        pointerEvents: settingsOpen ? 'auto' : 'none',
        transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease' }}>
        {[
          ...(install.isInstalled ? [] : [{ label: '홈 화면에 추가', onClick: handleInstallAction }]),
          { label: '가이드 보기', onClick: () => { resetAllTabTips(); setTipResetKey(k => k + 1); } },
          // 폼이 버그 제보 → 서비스 개선의견으로 넓어져 라벨도 통일(2026-08-31, MY 탭과 같은 폼)
          { label: '피드백 남기기', onClick: () => window.open('https://forms.gle/dCwXvZAdfG12AxoJ9', '_blank', 'noopener,noreferrer') },
          // 공용 기기 대비 — 저장 토큰과 함께 OTP 출입 세션도 정리
          { label: '로그아웃', onClick: () => { localStorage.removeItem(SAVED_TOKEN_KEY); clearStudentSession(studentToken); navigate('/personal'); } },
        ].map((item, i) => (
          <button
            key={item.label}
            onClick={() => { setSettingsOpen(false); item.onClick(); }}
            className="transition-[background-color] duration-150 ease-out"
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              padding: '10px 12px', borderRadius: 8,
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              color: item.label === '로그아웃' ? STATUS_ERROR_TEXT : TEXT_PRIMARY,
              borderTop: i > 0 ? `1px solid ${BORDER_SUBTLE}` : 'none' }}
          >
            {item.label}
          </button>
        ))}
        {/* 버전 — 공지 제목이 "2.41.0 버전 업데이트 소식" 형식이라 학생이 자기 앱 버전과
            대조할 수 있어야 한다. 누를 것이 없으므로 버튼이 아닌 정적 표기로 둔다
            (업데이트는 SW가 자동 적용하므로 "업데이트 확인" 버튼은 할 일이 없다). */}
        <p style={{
          margin: 0, padding: '10px 12px',
          borderTop: `1px solid ${BORDER_SUBTLE}`,
          fontSize: 12, color: TEXT_TERTIARY, textAlign: 'center' }}>
          버전 v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: BG_APP }}>
      {showOnboarding && <OnboardingCarousel onDone={() => setShowOnboarding(false)} showHomework={homeworkEnabled} />}
      <PullIndicator pullY={pullY} refreshing={pullRefreshing} />

      {/* 상단 헤더 — 홈 탭은 고정 헤더 대신 아래 인사 섹션이 대신한다(강사앱 홈과 동일 구조).
          다른 탭은 강사앱 공용 PageHeader(스티키 글래스, 17/600)로 통일(2026-08-31).
          설정 버튼은 홈 인사 섹션에만 — 다른 탭 헤더에는 두지 않는다(2026-08-31 지적). */}
      {tab !== '홈' && (
        <PageHeader
          title={tab === '내 수업' ? '수업 일정' : tab === '보관함' ? '발음 보관함' : tab}
          // 공지는 하단탭이 아니라 홈 상단 벨로 진입(2026-08-31) — 뒤로가기로 홈 복귀
          back={tab === '공지'}
          onBack={() => setTab('홈')}
        />
      )}

      {/* 콘텐츠 */}
      {/* 하단 96 = 캡슐 점유 66 + 숨쉴 틈 (강사앱 .page-container pb-24와 동일 기준).
          헤더가 sticky(플로우 차지)라 상단 패딩 불필요. */}
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 96 }}>
        {tab === '홈' && (
          // 가장자리 여백은 강사앱 홈(px-4=16)과 동일하게 16 (2026-08-31 통일)
          <div style={{ padding: '32px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              {/* 여백·타이포는 강사앱 홈 인사와 동일 클래스 — 두 앱이 픽셀 단위로 같게(2026-08-31) */}
              <p className="text-[13px] mb-1.5 tabular-nums" style={{ color: TEXT_TERTIARY }}>
                {todayLabel}
              </p>
              <h1 className="text-2xl font-bold tracking-tight break-keep" style={{ color: TEXT_PRIMARY, margin: 0 }}>
                <span className="text-brand-600" style={{ fontFamily: HANZI_FONT }}>{cnGreeting}</span><br />
                {student.name}님
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {/* 공지 벨 — 하단탭에서 상단(설정 옆)으로 이동(2026-08-31). 새 공지 dot 유지 */}
              <button
                onClick={() => setTab('공지')}
                aria-label="공지"
                className="p-2 text-gray-400 active:text-gray-600 transition-[color] duration-150 ease-out"
                style={{
                  border: 'none', background: 'none', display: 'flex',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                  outline: 'none' }}
              >
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <BellIcon weight="fill" size={24} />
                  {noticeDot && (
                    <span style={{
                      position: 'absolute', top: -1, right: -3,
                      width: 7, height: 7, borderRadius: '50%',
                      background: STATUS_ERROR_TEXT,
                      border: '1px solid rgba(255,255,255,0.82)' }} />
                  )}
                </span>
              </button>
              {settingsControl}
            </div>
          </div>
        )}
        {tab === '홈' && (
          <HomeTab
            key={classRefreshKey}
            studentToken={studentToken}
            studentLoaded={student !== null}
            onUpcomingLoaded={handleUpcomingLoaded}
            hwAlerts={hwAlerts}
            homeworkEnabled={homeworkEnabled}
            onSwitchToClasses={() => setTab('내 수업')}
          />
        )}
        {tab === '내 수업' && (
          <div role="tabpanel" id="tab-panel-1" aria-labelledby="nav-내 수업">
            <MyClassesTab
              key={classRefreshKey}
              studentToken={studentToken}
              month={myClassesMonth}
              onMonthChange={setMyClassesMonth}
            />
          </div>
        )}
        {tab === '보관함' && homeworkEnabled && (
          <div role="tabpanel" id="tab-panel-2" aria-labelledby="nav-보관함">
            <ArchiveTab key={classRefreshKey} studentToken={studentToken} />
          </div>
        )}
        {tab === '공지' && (
          <div role="tabpanel" id="tab-panel-3" aria-labelledby="nav-공지">
            <NoticeTab studentToken={studentToken} />
          </div>
        )}
        {tab === '하늘하늘' && (
          <div role="tabpanel" id="tab-panel-4" aria-labelledby="nav-하늘하늘">
            <HanulTab />
          </div>
        )}
        {tab === 'MY' && (
          <div role="tabpanel" id="tab-panel-5" aria-labelledby="nav-MY">
            <MyTab
              student={student}
              studentToken={studentToken}
              foodSources={[
                { key: 'sessions', label: '완료 수업', count: Math.floor((student?.completedMinutes ?? 0) / 30) },
                { key: 'hw_submit', label: '숙제 제출', count: student?.sharedAt ? (student?.submittedHomeworkFood ?? 0) : 0 },
                { key: 'hw_feedback', label: '피드백 확인', count: student?.sharedAt ? (student?.feedbackSeenHomeworkFood ?? 0) : 0 },
              ]}
              onOpenPanda={() => navigate(`/personal/${studentToken}/panda`)}
            />
          </div>
        )}
      </div>

      {/* 코치마크 — 탭별 최초 방문 시 1회 표시 */}
      <CoachMarkOverlay
        visible={coachHome}
        onDone={tipHome.dismiss}
        steps={[
          { selector: '[data-coach="next-class"]', label: '다음 수업 날짜와 시간이 여기에 표시돼요. 수업 일정 탭에서 전체 일정을 확인할 수 있어요.' },
          ...(homeworkEnabled ? [{ selector: '[data-coach="homework-card"]', label: '숙제는 여기서 바로 확인하고 파일이나 음성으로 제출할 수 있어요' }] : []),
          // 팬더 카드는 MY 탭으로 이사(2026-08-31) — 홈 코치마크에서 제외
        ]}
      />
      <CoachMarkOverlay
        visible={coachClasses}
        onDone={tipClasses.dismiss}
        steps={[
          { selector: '[data-coach="month-nav"]', label: '← → 버튼으로 월을 이동하며 수업을 확인해요' },
        ]}
      />
      <CoachMarkOverlay
        visible={coachArchive}
        onDone={tipArchive.dismiss}
        steps={[
          { selector: null, label: '확인한 피드백 숙제를 언제든 다시 들춰볼 수 있어요' },
        ]}
      />
      {/* 공지 탭 코치마크는 제거했다 — 빈 상태 문구를 딤 위에 그대로 반복하기만 해서
          정보가 0이었다(2026-08-24 검수). 실기능이 생긴 지금은 더더욱 안내가 필요 없다. */}

      {/* 온보딩·코치마크가 떠 있는 동안에는 배너를 내보내지 않는다(겹침 방지).
          표시 상태는 useInstallPrompt 훅에 있어 잠시 언마운트해도 "닫음"이 풀리지 않는다. */}
      {!showOnboarding && !coachVisible && (
        <InstallBanner {...install} showIOSGuide={showIOSGuide} setShowIOSGuide={setShowIOSGuide} />
      )}

      {/* 캡슐 뒤 하단 스크림 — 강사앱 BottomNav와 같은 어법. rgba = BG_APP 토큰의 알파 변주 */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          height: 'calc(104px + env(safe-area-inset-bottom))',
          // 콘텐츠 위 · 플로팅 크롬(업데이트 알약·설치 배너·캡슐) 아래 — 강사앱 스크림과 동일 원칙
          zIndex: 20, pointerEvents: 'none',
          background: 'linear-gradient(to top, rgba(249,250,251,0.97) 0%, rgba(249,250,251,0.88) 38%, rgba(249,250,251,0.45) 68%, rgba(249,250,251,0) 100%)',
        }}
      />
      {/* 하단 네비게이션 — 플로팅 캡슐 (2026-08-31, 강사앱 BottomNav와 동일 어법).
          blur는 .bottom-nav-glass::before로 분리(iOS fixed+backdrop-filter 합성 버그 회피)
          + overflow:hidden으로 캡슐 곡률에 맞춰 자른다. */}
      <div className="bottom-nav-glass" style={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: 'calc(10px + env(safe-area-inset-bottom))',
        marginInline: 'auto',
        width: 'min(calc(100% - 24px), 440px)',
        borderRadius: 999,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-nav-float)',
        zIndex: 200,
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)' }}>
        <div style={{ display: 'flex' }}>
          {[
            { key: '홈', icon: <HouseIcon weight="fill" />, label: '홈', dot: false },
            // 라벨 '수업 일정'(2026-09-04, 자가예약 영구 폐기 후 '예약' 용어 정리). 내부 key는 팁 저장키·라우터 state 호환을 위해 '내 수업' 유지.
            { key: '내 수업', icon: <BookOpenIcon weight="fill" />, label: '수업 일정', dot: classDot },
            ...(homeworkEnabled ? [{ key: '보관함', icon: <ArchiveIcon weight="fill" />, label: '보관함', dot: archiveDot }] : []),
            // 브랜드 링크 허브 — 아이콘은 phosphor가 아니라 브랜드 심볼 이미지(symbol 플래그로 분기)
            { key: '하늘하늘', symbol: true, label: '하늘하늘', dot: false },
            // 공지는 홈 상단 벨로 이동(2026-08-31) — MY(내 현황·팬더)는 관례대로 맨 오른쪽
            { key: 'MY', icon: <UserIcon weight="fill" />, label: 'MY', dot: false },
          ].map(item => {
            const isActive = tab === item.key;
            return (
              <button
                key={item.key}
                id={`nav-${item.key}`}
                type="button"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setTab(item.key)}
                style={{
                  flex: 1,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 3, padding: '8px 0',
                  border: 'none', background: 'none', cursor: 'pointer',
                  minHeight: 56,
                  color: isActive ? PRIMARY : TEXT_INACTIVE,
                  fontSize: 24,
                  transitionProperty: 'color',
                  transitionDuration: '0.15s',
                  transitionTimingFunction: 'ease-out',
                  WebkitTapHighlightColor: 'transparent',
                  outline: 'none' }}
                className="press-static"
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {item.symbol ? (
                    // 심볼 PNG를 CSS 마스크로 씌워 currentColor로 칠한다 — grayscale 필터 근사로는
                    // phosphor 아이콘과 회색 톤이 미묘하게 달라 밸런스가 깨져 보였다(2026-08-31 지적).
                    // 이러면 색·전환이 버튼의 color(활성 PRIMARY/비활성 TEXT_INACTIVE)와 완전 동일.
                    <span
                      aria-hidden="true"
                      style={{
                        // phosphor 24px 박스는 내부 여백이 있어 실그림이 ~20px — 심볼도 20px로 맞추고
                        // 상하 2px 마진으로 24px 줄높이를 유지해 라벨 정렬이 어긋나지 않게 한다.
                        width: 20, height: 20, margin: 2, display: 'inline-block',
                        backgroundColor: 'currentColor',
                        WebkitMaskImage: 'url(/logo/symbol-red.png)',
                        maskImage: 'url(/logo/symbol-red.png)',
                        WebkitMaskSize: 'contain', maskSize: 'contain',
                        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                        WebkitMaskPosition: 'center', maskPosition: 'center' }}
                    />
                  ) : item.icon}
                  {item.dot && !isActive && (
                    <span style={{
                      position: 'absolute', top: -1, right: -3,
                      width: 7, height: 7, borderRadius: '50%',
                      background: STATUS_ERROR_TEXT,
                      border: '1px solid rgba(255,255,255,0.82)' }} />
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
