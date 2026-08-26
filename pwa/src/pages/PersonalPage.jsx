import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { App, Card, Button } from 'antd';
import { HouseIcon, BookOpenIcon, BellIcon, GearSixIcon, ArchiveIcon, WarningCircleIcon } from '@phosphor-icons/react';
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
import CoachMarkOverlay from '../components/ui/CoachMarkOverlay.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import { useTabTip, resetAllTabTips } from '../hooks/useTabTip.js';
import HomeTab from './personal/HomeTab.jsx';
import MyClassesTab from './personal/MyClassesTab.jsx';
import ArchiveTab from './personal/ArchiveTab.jsx';
import NoticeTab from './personal/NoticeTab.jsx';
import {
  PRIMARY,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_INACTIVE, TEXT_TERTIARY,
  BG_APP, BORDER_SUBTLE,
  STATUS_ERROR_TEXT,
} from '../constants/theme.js';

const SAVED_TOKEN_KEY = 'personal_student_token';

// ===== 메인 페이지 =====
export default function PersonalPage() {
  const navigate = useNavigate();
  // 정적 message는 테마 컨텍스트를 못 받아 콘솔 경고 + 스타일 불일치 — App.useApp() 사용
  const { message } = App.useApp();
  const { studentToken } = useParams();
  const routerLocation = useLocation();

  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState(() => {
    const t = routerLocation.state?.tab;
    return ['홈', '내 수업', '보관함', '공지'].includes(t) ? t : '홈';
  });
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(ONBOARDING_KEY));

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
  const coachArchive = tab === '보관함'  && tipArchive.visible;
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
      message.success('이미 홈 화면에 추가되어 있어요!');
      return;
    }
    if (install.canPrompt) {
      const accepted = await install.promptInstall();
      if (accepted) message.success('홈 화면에 추가되었어요!');
      return;
    }
    setShowIOSGuide(true);
  };

  const loadStudent = useCallback(async () => {
    try {
      const data = await fetchStudentByToken(studentToken);
      localStorage.setItem(SAVED_TOKEN_KEY, studentToken);
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
        <Card variant="borderless" style={{ borderRadius: 12, maxWidth: 360, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <WarningCircleIcon size={44} weight="fill" color={STATUS_ERROR_TEXT} />
          </div>
          <p style={{ fontSize: 14, color: STATUS_ERROR_TEXT, margin: 0 }}>{studentError}</p>
          <Button
            type="primary"
            block
            onClick={() => navigate('/personal')}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 16 }}
          >
            다시 입력
          </Button>
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

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: BG_APP }}>
      {showOnboarding && <OnboardingCarousel onDone={() => setShowOnboarding(false)} />}
      <PullIndicator pullY={pullY} refreshing={pullRefreshing} />

      {/* 상단 헤더 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px' }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.3 }}>
          {tab === '홈' ? student.name : tab === '내 수업' ? '예약 현황' : tab === '보관함' ? '발음 보관함' : tab}
        </h1>

        <div ref={settingsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            aria-label="설정"
            aria-expanded={settingsOpen}
            className="transition-[color] duration-150 ease-out"
            style={{
              width: 36, height: 36, padding: 0,
              border: 'none', background: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: TEXT_SECONDARY, fontSize: 24,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none' }}
          >
            <GearSixIcon weight="fill" />
          </button>

          {/* 플로팅 패널 */}
          <div style={{
            position: 'absolute', top: 44, right: 0,
            background: '#fff', borderRadius: 12,
            boxShadow: 'var(--shadow-card)',
            padding: '6px',
            minWidth: 140,
            transformOrigin: 'top right',
            transform: settingsOpen ? 'scale(1)' : 'scale(0.85)',
            opacity: settingsOpen ? 1 : 0,
            pointerEvents: settingsOpen ? 'auto' : 'none',
            transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease' }}>
            {[
              ...(install.isInstalled ? [] : [{ label: '홈 화면에 추가', onClick: handleInstallAction }]),
              { label: '가이드 보기', onClick: () => { resetAllTabTips(); setTipResetKey(k => k + 1); } },
              { label: '문제 신고하기', onClick: () => window.open('https://forms.gle/dCwXvZAdfG12AxoJ9', '_blank', 'noopener,noreferrer') },
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
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: 56, paddingBottom: 80 }}>
        {tab === '홈' && (
          <HomeTab
            key={classRefreshKey}
            studentToken={studentToken}
            foodSources={[
              { key: 'sessions', label: '완료 수업', count: Math.floor((student?.completedMinutes ?? 0) / 30) },
              { key: 'hw_submit', label: '숙제 제출', count: student?.sharedAt ? (student?.submittedHomeworkFood ?? 0) : 0 },
              { key: 'hw_feedback', label: '피드백 확인', count: student?.sharedAt ? (student?.feedbackSeenHomeworkFood ?? 0) : 0 },
            ]}
            studentLoaded={student !== null}
            remainingHours={student?.remainingHours ?? 0}
            onUpcomingLoaded={handleUpcomingLoaded}
            hwAlerts={hwAlerts}
            onOpenPanda={() => navigate(`/personal/${studentToken}/panda`)}
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
        {tab === '보관함' && (
          <div role="tabpanel" id="tab-panel-2" aria-labelledby="nav-보관함">
            <ArchiveTab key={classRefreshKey} studentToken={studentToken} />
          </div>
        )}
        {tab === '공지' && (
          <div role="tabpanel" id="tab-panel-3" aria-labelledby="nav-공지">
            <NoticeTab studentToken={studentToken} />
          </div>
        )}
      </div>

      {/* 코치마크 — 탭별 최초 방문 시 1회 표시 */}
      <CoachMarkOverlay
        visible={coachHome}
        onDone={tipHome.dismiss}
        steps={[
          { selector: '[data-coach="next-class"]', label: '다음 수업 날짜와 시간이 여기에 표시돼요. 예약 현황 탭에서 전체 일정을 확인할 수 있어요.' },
          { selector: '[data-coach="homework-card"]', label: '숙제는 여기서 바로 확인하고 파일이나 음성으로 제출할 수 있어요' },
          { selector: '[data-coach="panda"]', label: '수업을 완료하면 팬더에게 먹이를 줄 수 있어요 🐼 탭해서 팬더를 키워보세요!' },
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

      {/* 하단 네비게이션 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: 'var(--shadow-nav)',
        paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
          {[
            { key: '홈', icon: <HouseIcon weight="fill" />, label: '홈', dot: false },
            { key: '내 수업', icon: <BookOpenIcon weight="fill" />, label: '예약 현황', dot: classDot },
            { key: '보관함', icon: <ArchiveIcon weight="fill" />, label: '보관함', dot: archiveDot },
            { key: '공지', icon: <BellIcon weight="fill" />, label: '공지', dot: noticeDot },
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
                  gap: 3, padding: '8px 0 10px',
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
                  {item.icon}
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
