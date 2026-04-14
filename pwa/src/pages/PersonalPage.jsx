import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import {
  fetchStudentByToken,
  fetchMyClasses,
} from '../api/bookingApi.js';
import { Card, Button, Spin } from 'antd';
import { HomeOutlined, BookOutlined, FileTextOutlined, BellOutlined, SettingOutlined } from '@ant-design/icons';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import PandaWidget from '../components/ui/PandaWidget.jsx';
import InstallBanner from '../components/ui/InstallBanner.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

const SAVED_TOKEN_KEY = 'personal_student_token';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
function formatMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${y}년 ${m}월`;
}
function shiftMonth(monthStr, delta) {
  const date = new Date(monthStr + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ===== 수업 카드 공통 컴포넌트 =====
const BADGE = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20 };

function ClassCard({ cls, todayStr, nowMin }) {
  const d = new Date(cls.date + 'T00:00:00+09:00');
  const clsStartMin = timeToMin(cls.startTime);
  const clsEndMin = clsStartMin + cls.durationMin;
  const isToday = cls.date === todayStr;
  const isPast = cls.date < todayStr;
  const isOngoing = !cls.isCancelled && isToday && nowMin >= clsStartMin && nowMin < clsEndMin;
  const isDimmed = isPast || cls.isCancelled;

  return (
    <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', opacity: isDimmed ? 0.65 : 1, transition: 'opacity 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 날짜 박스 */}
        <div style={{ minWidth: 52, textAlign: 'center', backgroundColor: isDimmed ? '#fafafa' : '#fff0f1', borderRadius: 12, padding: '8px 6px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: isDimmed ? '#8c8c8c' : '#7f0005', lineHeight: 1.2 }} className="tabular-nums">
            {d.getDate()}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: isDimmed ? '#bfbfbf' : '#a00008' }}>
            {DAY_KR[d.getDay()]}요일
          </div>
        </div>

        {/* 수업 정보 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            {isOngoing && <span style={{ ...BADGE, backgroundColor: '#e6f4ff', color: '#0958d9' }}>수업중</span>}
            {isToday && !isOngoing && !cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f6ffed', color: '#389e0d' }}>오늘</span>}
            {isPast && !cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f5f5f5', color: '#595959' }}>완료</span>}
            {cls.isCancelled && <span style={{ ...BADGE, backgroundColor: '#f5f5f5', color: '#8c8c8c' }}>취소</span>}
            {cls.classType === '2:1' && <span style={{ ...BADGE, backgroundColor: '#fff7e6', color: '#d46b08' }}>2:1</span>}
            {cls.specialNote === '🟠 보강' && <span style={{ ...BADGE, backgroundColor: '#e6fffb', color: '#08979c' }}>보강</span>}
            {cls.specialNote === '🔴 결석' && <span style={{ ...BADGE, backgroundColor: '#fff2f0', color: '#cf1322' }}>결석</span>}
            <span style={{ fontSize: 14, fontWeight: 600, color: '#262626' }} className="tabular-nums">{cls.startTime}</span>
          </div>
          {cls.location && (
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>{LOCATION_LABEL[cls.location] ?? cls.location}</div>
          )}
        </div>

        {/* 수업 시간 강조 */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isDimmed ? '#bfbfbf' : '#7f0005' }} className="tabular-nums">
            {formatDuration(cls.durationMin)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ===== 내 수업 탭 =====
function MyClassesTab({ studentToken, month, onMonthChange }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyClasses(studentToken, month);
      setClasses(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken, month]);

  useEffect(() => { load(); }, [load]);

  const _nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = _nowKST.toISOString().slice(0, 10);
  const nowMin = _nowKST.getUTCHours() * 60 + _nowKST.getUTCMinutes();

  const upcomingClasses = classes
    .filter(c => !c.isCancelled && c.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const pastClasses = classes
    .filter(c => c.isCancelled || c.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <div>
      {/* 월 네비게이션 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #f5f5f5',
        backgroundColor: '#fff',
      }}>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          aria-label="이전 달"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: '1px solid #f0f0f0', background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#595959',
          }}
        >‹</button>
        <span
          style={{ fontSize: 16, fontWeight: 700, color: '#1d1d1f' }}
          aria-live="polite"
          aria-atomic="true"
        >
          {formatMonth(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label="다음 달"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: '1px solid #f0f0f0', background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: '#595959',
          }}
        >›</button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '56px 0' }}>
          <Spin />
        </div>
      )}
      {error && (
        <div style={{ margin: '16px', padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
          {error}
        </div>
      )}
      {!loading && !error && classes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0 48px' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#595959', marginBottom: 4 }}>이 달에 수업이 없어요</div>
          <div style={{ fontSize: 13, color: '#bfbfbf' }}>다른 달을 선택해 보세요</div>
        </div>
      )}

      {!loading && !error && classes.length > 0 && (
        <>
          {upcomingClasses.length > 0 && (
            <div style={{ padding: '12px 16px 0' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#767676', margin: '0 0 8px' }}>예정된 수업</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          {pastClasses.length > 0 && (
            <div style={{ padding: '12px 16px 0' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#767676', margin: '0 0 8px' }}>지난 수업</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, textAlign: 'center', color: '#8c8c8c', margin: '12px 16px 24px' }}>
            수업 변경·취소는 강사님께 문의해주세요
          </p>
        </>
      )}
    </div>
  );
}

// ===== 홈 탭 =====
function HomeTab({ studentToken, totalSessions, studentLoaded }) {
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${nowKST.getUTCFullYear()}-${pad(nowKST.getUTCMonth() + 1)}-${pad(nowKST.getUTCDate())}`;
  const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();

  const initMonth = () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}`;
  };
  const [calMonth, setCalMonth] = useState(initMonth);
  const [calClasses, setCalClasses] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  // 초기 로드: curr + next 2개 요청으로 캘린더와 다가오는 수업 모두 처리 (중복 제거)
  const loadInitialData = useCallback(async () => {
    setUpcomingLoading(true);
    setCalLoading(true);
    try {
      const thisMonth = initMonth();
      const [curr, next] = await Promise.all([
        fetchMyClasses(studentToken, thisMonth),
        fetchMyClasses(studentToken, shiftMonth(thisMonth, 1)),
      ]);
      setCalClasses(curr.filter(c => !c.isCancelled));
      const all = [...curr, ...next]
        .filter(c => !c.isCancelled && c.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      setUpcoming(all.slice(0, 5));
    } catch {
      setUpcoming([]);
      setCalClasses([]);
    } finally {
      setUpcomingLoading(false);
      setCalLoading(false);
    }
  }, [studentToken]);

  const loadCalendarMonth = useCallback(async (month) => {
    setCalLoading(true);
    setSelectedDay(null);
    try {
      const data = await fetchMyClasses(studentToken, month);
      setCalClasses(data.filter(c => !c.isCancelled));
    } catch {
      setCalClasses([]);
    } finally {
      setCalLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  const [calYear, calMonthNum] = calMonth.split('-').map(Number);

  const classCountMap = {};
  calClasses.forEach(c => {
    const day = parseInt(c.date.slice(8), 10);
    classCountMap[day] = (classCountMap[day] || 0) + 1;
  });

  const selectedDayClasses = selectedDay
    ? calClasses.filter(c => parseInt(c.date.slice(8), 10) === selectedDay)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  const handleDayClick = (day) => {
    if (!classCountMap[day]) return;
    setSelectedDay(prev => prev === day ? null : day);
  };

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* 팬더 위젯 — student 로드 완료 후에만 표시 (로딩 중 알(0회) 깜빡임 방지) */}
      {studentLoaded && (
        <div style={{ padding: '16px 20px 8px' }}>
          <PandaWidget totalSessions={totalSessions} />
        </div>
      )}

      {/* 수업 캘린더 */}
      <div style={{ padding: '16px 20px 0' }}>
        <MonthCalendar
          year={calYear}
          month={calMonthNum}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={handleDayClick}
          onPrevMonth={() => { const m = shiftMonth(calMonth, -1); setCalMonth(m); loadCalendarMonth(m); }}
          onNextMonth={() => { const m = shiftMonth(calMonth, 1); setCalMonth(m); loadCalendarMonth(m); }}
          loading={calLoading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {calMonthNum}월 {selectedDay}일 수업
              </p>
              <ul className="space-y-1.5">
                {selectedDayClasses.map(cls => (
                  <li key={cls.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50">
                    <span className="text-xs font-semibold text-brand-600 shrink-0 tabular-nums">
                      {cls.startTime}
                    </span>
                    <span className="text-sm text-gray-700">
                      {formatDuration(cls.durationMin)}
                      {cls.location && ` · ${LOCATION_LABEL[cls.location] ?? cls.location}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        />
      </div>

      {/* 다가오는 수업 */}
      <div style={{ padding: '16px 20px 0' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#595959', margin: '0 0 10px' }}>다가오는 수업</p>
        {upcomingLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin size="small" /></div>
        ) : upcoming.length === 0 ? (
          <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#767676', fontSize: 14 }}>
              다가오는 수업이 없어요
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map(cls => (
              <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 메인 페이지 =====
export default function PersonalPage() {
  const navigate = useNavigate();
  const { studentToken } = useParams();
  const routerLocation = useLocation();

  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState(routerLocation.state?.tab ?? '홈');

  const [classRefreshKey, setClassRefreshKey] = useState(0);
  const [myClassesMonth, setMyClassesMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const install = useInstallPrompt();
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

  const handleInstallAction = () => {
    if (install.isIOS) setShowIOSGuide(true);
    else install.promptInstall();
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
    await loadStudent();
  }, [loadStudent]);

  const { pullY, refreshing: pullRefreshing } = usePullToRefresh(handlePullRefresh);

  if (studentError) {
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center px-4">
        <Card variant="borderless" style={{ borderRadius: 16, maxWidth: 360, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <p className="text-red-500 text-sm">{studentError}</p>
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
    return <div className="min-h-dvh bg-gray-50 flex items-center justify-center text-gray-500 text-sm">불러오는 중...</div>;
  }

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f9fafb' }}>
      <PullIndicator pullY={pullY} refreshing={pullRefreshing} />

      {/* 상단 헤더 */}
      <div style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, zIndex: 100,
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1d1d1f', margin: 0 }}>
          {tab === '홈' ? `😊 ${student.name}` : tab === '내 수업' ? '예약 현황' : tab}
        </h1>

        <div ref={settingsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            aria-label="설정"
            aria-expanded={settingsOpen}
            style={{
              width: 36, height: 36, padding: 0,
              border: 'none', background: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#595959', fontSize: 20,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
          >
            <SettingOutlined />
          </button>

          {/* 플로팅 패널 */}
          <div style={{
            position: 'absolute', top: 44, right: 0,
            background: '#fff', borderRadius: 12,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            padding: '6px',
            minWidth: 140,
            transformOrigin: 'top right',
            transform: settingsOpen ? 'scale(1)' : 'scale(0.85)',
            opacity: settingsOpen ? 1 : 0,
            pointerEvents: settingsOpen ? 'auto' : 'none',
            transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease',
          }}>
            {[
              ...(install.isInstallable ? [{ label: '홈 화면에 추가', onClick: handleInstallAction }] : []),
              { label: '문제 신고하기', onClick: () => window.open('https://forms.gle/dCwXvZAdfG12AxoJ9', '_blank', 'noopener,noreferrer') },
              { label: '로그아웃', onClick: () => { localStorage.removeItem('personal_student_token'); navigate('/personal'); } },
            ].map((item, i) => (
              <button
                key={item.label}
                onClick={() => { setSettingsOpen(false); item.onClick(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8,
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 500,
                  color: item.label === '로그아웃' ? '#cf1322' : '#262626',
                  borderTop: i > 0 ? '1px solid #f5f5f5' : 'none',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{ maxWidth: 480, margin: '0 auto', paddingTop: 56, paddingBottom: 80 }}>
        {tab === '홈' && (
          <HomeTab key={classRefreshKey} studentToken={studentToken} totalSessions={student?.totalSessions ?? 0} studentLoaded={student !== null} />
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
        {tab === '숙제' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bfbfbf' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
            <div style={{ fontSize: 14, color: '#8c8c8c' }}>준비 중입니다</div>
          </div>
        )}
        {tab === '공지' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bfbfbf' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
            <div style={{ fontSize: 14, color: '#8c8c8c' }}>준비 중입니다</div>
          </div>
        )}
      </div>

      <InstallBanner {...install} showIOSGuide={showIOSGuide} setShowIOSGuide={setShowIOSGuide} />

      {/* 하단 네비게이션 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: '0px -1px 0px 0px rgba(0,0,0,0.06), 0px -2px 8px 0px rgba(0,0,0,0.04)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
          {[
            { key: '홈', icon: <HomeOutlined />, label: '홈' },
            { key: '내 수업', icon: <BookOutlined />, label: '예약 현황' },
            { key: '숙제', icon: <FileTextOutlined />, label: '숙제' },
            { key: '공지', icon: <BellOutlined />, label: '공지' },
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
                  color: isActive ? '#7f0005' : '#8c8c8c',
                  fontSize: 20,
                  transitionProperty: 'color, transform',
                  transitionDuration: '0.15s',
                  transitionTimingFunction: 'ease-out',
                  WebkitTapHighlightColor: 'transparent',
                  outline: 'none',
                }}
              >
                {item.icon}
                <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
