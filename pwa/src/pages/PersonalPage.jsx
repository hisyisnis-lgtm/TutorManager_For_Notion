import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import {
  fetchStudentByToken,
  fetchMyClasses,
} from '../api/bookingApi.js';
import { fetchMyHomework, parseHomework, submitHomework, uploadStudentFile, homeworkStatusColor } from '../api/homework.js';
import { Card, Button, Spin } from 'antd';
import { DAY_KR, timeToMin, formatDuration, formatYearMonth, addMonths } from '../utils/dateUtils.js';
import HomeworkFilterBar from '../components/homework/HomeworkFilterBar.jsx';
import HomeworkSection from '../components/homework/HomeworkSection.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { HouseIcon, BookOpenIcon, FileTextIcon, BellIcon, GearSixIcon, ClipboardTextIcon, HourglassIcon, ChatTeardropTextIcon, ArchiveIcon, NoteBlankIcon, SpeakerHighIcon, CalendarBlankIcon, MegaphoneIcon, CaretRightIcon, InstagramLogoIcon, YoutubeLogoIcon, ArticleIcon, MusicNotesIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { STAGES, getStageInfo, PANDA_FEED_KEY, getPandaStorageKey } from '../components/ui/PandaWidget.jsx';
import InstallBanner from '../components/ui/InstallBanner.jsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import OnboardingCarousel, { ONBOARDING_KEY } from '../components/ui/OnboardingCarousel.jsx';
import CoachMarkOverlay from '../components/ui/CoachMarkOverlay.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import { useTabTip, resetAllTabTips } from '../hooks/useTabTip.js';
import {
  PRIMARY, PRIMARY_LIGHT, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_INACTIVE, TEXT_DISABLED,
  BG_APP, BG_ICON_NEUTRAL, BG_SUCCESS,
  BORDER_SUBTLE,
  STATUS_SUCCESS_DARK, STATUS_SUCCESS_BG,
  STATUS_ERROR_TEXT, STATUS_ERROR_BG, STATUS_ERROR_BORDER,
  STATUS_INFO_DARK,
} from '../constants/theme.js';
import { BADGE_SMALL, BADGE_MEDIUM, FOOTNOTE } from '../constants/styles.js';

const SAVED_TOKEN_KEY = 'personal_student_token';

function formatHours(h) {
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0 && mins > 0) return `${hours}시간 ${mins}분`;
  if (hours > 0) return `${hours}시간`;
  return `${mins}분`;
}

const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

// ===== 수업 카드 공통 컴포넌트 =====
function ClassCard({ cls, todayStr, nowMin }) {
  const d = new Date(cls.date + 'T00:00:00+09:00');
  const clsStartMin = timeToMin(cls.startTime);
  const clsEndMin = clsStartMin + cls.durationMin;
  const isToday = cls.date === todayStr;
  const isPast = cls.date < todayStr;
  const isOngoing = !cls.isCancelled && isToday && nowMin >= clsStartMin && nowMin < clsEndMin;
  const isDimmed = isPast || cls.isCancelled;

  // 끝 시간 계산
  const endH = Math.floor(clsEndMin / 60).toString().padStart(2, '0');
  const endM = (clsEndMin % 60).toString().padStart(2, '0');
  const endTimeStr = `${endH}:${endM}`;

  return (
    <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', opacity: isDimmed ? 0.6 : 1, transition: 'opacity 0.2s' }} styles={{ body: { padding: '14px 16px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 날짜 박스 */}
        <div style={{ minWidth: 50, textAlign: 'center', backgroundColor: isDimmed ? BG_APP : PRIMARY_BG, borderRadius: 10, padding: '8px 6px', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: isDimmed ? TEXT_INACTIVE : PRIMARY, lineHeight: 1.15 }} className="tabular-nums">
            {d.getDate()}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: isDimmed ? TEXT_DISABLED : PRIMARY_LIGHT, marginTop: 1 }}>
            {DAY_KR[d.getDay()]}요일
          </div>
        </div>

        {/* 수업 정보 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 상태 배지 행 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexWrap: 'wrap' }}>
            {isOngoing && <span style={{ ...BADGE_SMALL, backgroundColor: '#e6f4ff', color: STATUS_INFO_DARK }}>수업중</span>}
            {isToday && !isOngoing && !cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK }}>오늘</span>}
            {isPast && !cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: '#f5f5f5', color: TEXT_INACTIVE }}>완료</span>}
            {cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: '#f5f5f5', color: TEXT_INACTIVE }}>취소</span>}
            {cls.classType === '2:1' && <span style={{ ...BADGE_SMALL, backgroundColor: '#fff7e6', color: '#d46b08' }}>2:1</span>}
            {cls.specialNote === '🟠 보강' && <span style={{ ...BADGE_SMALL, backgroundColor: '#e6fffb', color: '#08979c' }}>보강</span>}
            {cls.specialNote === '🔴 결석' && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_ERROR_BG, color: STATUS_ERROR_TEXT }}>결석</span>}
          </div>
          {/* 시간 + 장소 행 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: isDimmed ? TEXT_INACTIVE : TEXT_PRIMARY }} className="tabular-nums">
              {cls.startTime}–{endTimeStr}
            </span>
            {cls.location && (
              <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                {LOCATION_LABEL[cls.location] ?? cls.location}
              </span>
            )}
          </div>
        </div>

        {/* 수업 시간 */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDimmed ? TEXT_DISABLED : PRIMARY }} className="tabular-nums">
            {formatDuration(cls.durationMin)}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ===== 발음 보관함 — localStorage 유틸 =====
const HW_VIEWED_KEY = (token) => `hw_viewed_${token}`;

function getViewedMap(token) {
  try { return JSON.parse(localStorage.getItem(HW_VIEWED_KEY(token)) || '{}'); }
  catch { return {}; }
}

function markViewed(token, hwId) {
  const map = getViewedMap(token);
  if (!map[hwId]) {
    map[hwId] = Date.now();
    localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map));
  }
}

function isArchived(token, hwId) {
  const viewedAt = getViewedMap(token)[hwId];
  return !!viewedAt && Date.now() - viewedAt > 24 * 60 * 60 * 1000;
}

function forceArchive(token, hwId) {
  const map = getViewedMap(token);
  // 24시간+1초 전으로 설정해 즉시 보관함 조건 충족
  map[hwId] = Date.now() - (24 * 60 * 60 * 1000 + 1000);
  localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map));
}

// ===== 숙제 탭 =====
function MyHomeworkTab({ studentToken }) {
  const [homeworkList, setHomeworkList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('title');
  const [filterMonth, setFilterMonth] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pages = await fetchMyHomework(studentToken);
      setHomeworkList(pages.map(parseHomework));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { load(); }, [load]);

  // 사용 가능한 월 목록 (내림차순)
  const availableMonths = [...new Set(
    homeworkList.map((h) => h.createdTime?.slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  // 필터 적용
  const filteredList = homeworkList.filter((h) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (searchType === 'content') {
        if (!h.content?.toLowerCase().includes(q)) return false;
      } else {
        if (!h.title.toLowerCase().includes(q)) return false;
      }
    }
    if (filterMonth && h.createdTime?.slice(0, 7) !== filterMonth) return false;
    return true;
  });

  const pending = filteredList.filter((h) => h.status === '미제출');
  const submitted = filteredList.filter((h) => h.status === '제출완료');
  const feedbacked = filteredList.filter((h) => h.status === '피드백완료' && !isArchived(studentToken, h.id));

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;

  if (homeworkList.length === 0) {
    return <EmptyState icon={<NoteBlankIcon size={44} weight="thin" style={{ color: '#d9d9d9' }} />} title="숙제가 없어요" description="선생님이 숙제를 등록하면 여기에 표시돼요" />;
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      {/* 검색 + 필터 바 */}
      <div style={{ marginBottom: 16 }}>
        <HomeworkFilterBar
          searchText={searchText}
          onSearchChange={setSearchText}
          searchType={searchType}
          onSearchTypeChange={setSearchType}
          showSearchType
          filterMonth={filterMonth}
          onMonthChange={setFilterMonth}
          availableMonths={availableMonths}
          pillMode
        />
      </div>

      {feedbacked.length > 0 && (
        <HomeworkSection icon={<ChatTeardropTextIcon size={18} weight="fill" />} label="피드백 왔어요" count={feedbacked.length} color={STATUS_SUCCESS_DARK}>
          {feedbacked.map((hw, i) => (
            <div key={hw.id} {...(i === 0 ? { 'data-coach': 'homework-card' } : {})}>
              <HwCard
                hw={hw}
                studentToken={studentToken}
                onMarkViewed={() => markViewed(studentToken, hw.id)}
              />
            </div>
          ))}
        </HomeworkSection>
      )}

      {pending.length > 0 && (
        <HomeworkSection icon={<ClipboardTextIcon size={18} weight="fill" />} label="해야 할 숙제" count={pending.length} color={STATUS_ERROR_TEXT}>
          {pending.map((hw, i) => (
            <div key={hw.id} {...(i === 0 ? { 'data-coach': 'homework-card' } : {})}>
              <HwCard
                hw={hw}
                studentToken={studentToken}
              />
            </div>
          ))}
        </HomeworkSection>
      )}

      {submitted.length > 0 && (
        <HomeworkSection icon={<HourglassIcon size={18} weight="fill" />} label="검토 중" count={submitted.length} color={STATUS_INFO_DARK}>
          {submitted.map((hw) => (
            <HwCard
              key={hw.id}
              hw={hw}
              studentToken={studentToken}
            />
          ))}
        </HomeworkSection>
      )}

      {filteredList.length === 0 && homeworkList.length > 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: TEXT_DISABLED, fontSize: 13 }}>
          검색 결과가 없어요
        </div>
      )}

      <p style={FOOTNOTE}>
        숙제 관련 문의는 선생님께 해주세요
      </p>
    </div>
  );
}


function HwCard({ hw, studentToken, onMarkViewed }) {
  const navigate = useNavigate();
  const { bg, text } = homeworkStatusColor(hw.status);
  const isFeedback = hw.status === '피드백완료';
  const fileCount = hw.submitFiles?.length ?? 0;

  return (
    <Card
      variant="borderless"
      style={{
        borderRadius: 12,
        boxShadow: isFeedback
          ? '0 0 0 2px rgba(82, 196, 26, 0.35), var(--shadow-border)'
          : 'var(--shadow-border)',
        overflow: 'hidden',
      }}
      styles={{ body: { padding: 0 } }}
    >
      <button
        type="button"
        onClick={() => {
          onMarkViewed?.();
          navigate(`/personal/${studentToken}/homework/${hw.id}`);
        }}
        className="active:scale-[0.96]"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', border: 'none', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent', textAlign: 'left',
          background: isFeedback ? 'rgba(82, 196, 26, 0.04)' : 'none',
          transitionProperty: 'scale, background',
          transitionDuration: '150ms',
          transitionTimingFunction: 'ease-out',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hw.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {hw.content && (
              <span style={{ fontSize: 12, color: TEXT_TERTIARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                {hw.content}
              </span>
            )}
            {fileCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: TEXT_TERTIARY, flexShrink: 0 }}>
                <MusicNotesIcon size={12} weight="fill" />
                {fileCount}개
              </span>
            )}
            {isFeedback && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: STATUS_SUCCESS_DARK, flexShrink: 0 }}>
                <ChatTeardropTextIcon size={12} weight="fill" />
                피드백
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
          <span style={{ ...BADGE_SMALL, background: bg, color: text }}>
            {hw.status}
          </span>
          <CaretRightIcon size={14} color={TEXT_DISABLED} />
        </div>
      </button>
    </Card>
  );
}

// ===== 발음 보관함 카드 (읽기 전용) =====
function ArchiveHwCard({ hw, studentToken }) {
  const navigate = useNavigate();
  const viewedAt = getViewedMap(studentToken)[hw.id];
  const viewedDateStr = viewedAt
    ? new Date(viewedAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
    : "";

  return (
    <Card
      variant="borderless"
      style={{ borderRadius: 12, boxShadow: "var(--shadow-border)", overflow: "hidden" }}
      styles={{ body: { padding: 0 } }}
    >
      <button
        type="button"
        onClick={() => navigate(`/personal/${studentToken}/homework/${hw.id}`)}
        className="active:scale-[0.96]"
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", border: "none", cursor: "pointer",
          WebkitTapHighlightColor: "transparent", textAlign: "left", background: "none",
          transitionProperty: "scale", transitionDuration: "150ms", transitionTimingFunction: "ease-out",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hw.title}
          </p>
          {viewedDateStr && (
            <p style={{ fontSize: 11, color: TEXT_DISABLED, margin: 0 }}>{viewedDateStr} 확인</p>
          )}
        </div>
        <CaretRightIcon size={14} color={TEXT_DISABLED} />
      </button>
    </Card>
  );
}


// ===== 발음 보관함 탭 =====
function ArchiveTab({ studentToken }) {
  const [homeworkList, setHomeworkList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('title');
  const [filterMonth, setFilterMonth] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pages = await fetchMyHomework(studentToken);
      setHomeworkList(pages.map(parseHomework));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { load(); }, [load]);

  const archivedList = homeworkList.filter(
    (h) => h.status === '피드백완료' && isArchived(studentToken, h.id)
  );

  const availableMonths = [...new Set(
    archivedList.map((h) => h.createdTime?.slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  const filteredList = archivedList.filter((h) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (searchType === 'content') {
        if (!h.content?.toLowerCase().includes(q)) return false;
      } else {
        if (!h.title.toLowerCase().includes(q)) return false;
      }
    }
    if (filterMonth && h.createdTime?.slice(0, 7) !== filterMonth) return false;
    return true;
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} onRetry={load} />;

  if (archivedList.length === 0) {
    return (
      <EmptyState
        icon={<SpeakerHighIcon size={44} weight="thin" style={{ color: '#d9d9d9' }} />}
        title="아직 보관된 발음이 없어요"
        description={"피드백을 확인한 숙제는\n하루 뒤 여기에 자동으로 쌓여요"}
      />
    );
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ marginBottom: 16 }}>
        <HomeworkFilterBar
          searchText={searchText}
          onSearchChange={setSearchText}
          searchType={searchType}
          onSearchTypeChange={setSearchType}
          showSearchType
          filterMonth={filterMonth}
          onMonthChange={setFilterMonth}
          availableMonths={availableMonths}
          pillMode
        />
      </div>

      {filteredList.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: TEXT_DISABLED, fontSize: 13 }}>
          검색 결과가 없어요
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredList.map((hw) => (
            <ArchiveHwCard
              key={hw.id}
              hw={hw}
              studentToken={studentToken}
            />
          ))}
        </div>
      )}

      <p style={FOOTNOTE}>
        숙제 관련 문의는 선생님께 해주세요
      </p>
    </div>
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
      <div data-coach="month-nav" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${BORDER_SUBTLE}`,
        backgroundColor: '#fff',
      }}>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="이전 달"
          className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: `1px solid ${BORDER_SUBTLE}`, background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: TEXT_SECONDARY,
          }}
        >‹</button>
        <span
          style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY }}
          aria-live="polite"
          aria-atomic="true"
        >
          {formatYearMonth(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="다음 달"
          className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: `1px solid ${BORDER_SUBTLE}`, background: '#fafafa', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: TEXT_SECONDARY,
          }}
        >›</button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={load} />}
      {!loading && !error && classes.length === 0 && (
        <EmptyState icon={<CalendarBlankIcon size={44} weight="thin" style={{ color: '#d9d9d9' }} />} title="이 달에 수업이 없어요" description="다른 달을 선택해 보세요" />
      )}

      {!loading && !error && classes.length > 0 && (
        <>
          {upcomingClasses.length > 0 && (
            <div style={{ padding: '16px 16px 0' }}>
              <SectionHeading>예정된 수업</SectionHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          {pastClasses.length > 0 && (
            <div style={{ padding: '16px 16px 0' }}>
              <SectionHeading>지난 수업</SectionHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          <p style={{ ...FOOTNOTE, margin: '12px 16px 24px' }}>
            수업 변경·취소는 강사님께 문의해주세요
          </p>
        </>
      )}
    </div>
  );
}

// ===== 다음 수업 히어로 카드 =====
function NextClassHeroCard({ cls, todayStr, nowMin }) {
  const clsStartMin = timeToMin(cls.startTime);
  const clsEndMin = clsStartMin + cls.durationMin;
  const endH = Math.floor(clsEndMin / 60).toString().padStart(2, '0');
  const endM = (clsEndMin % 60).toString().padStart(2, '0');
  const endTimeStr = `${endH}:${endM}`;
  const isToday = cls.date === todayStr;
  const isOngoing = isToday && nowMin >= clsStartMin && nowMin < clsEndMin;
  const daysUntil = Math.round(
    (new Date(cls.date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000
  );
  const d = new Date(cls.date + 'T00:00:00+09:00');

  let badge = null;
  if (isOngoing)        badge = { label: '수업 중', bg: '#e6f4ff', color: STATUS_INFO_DARK };
  else if (isToday)     badge = { label: '오늘',   bg: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK };
  else if (daysUntil === 1) badge = { label: '내일', bg: '#fff7e6', color: '#d46b08' };
  else if (daysUntil <= 7)  badge = { label: `D-${daysUntil}`, bg: '#f5f5f5', color: TEXT_SECONDARY };

  const timeColor = isOngoing ? STATUS_INFO_DARK : PRIMARY;

  return (
    <div style={{ position: 'relative' }}>
      {/* 배지 — 우측 상단 */}
      {badge && (
        <span style={{
          position: 'absolute', top: 0, right: 0,
          ...BADGE_MEDIUM,
          background: badge.bg, color: badge.color,
        }}>
          {badge.label}
        </span>
      )}

      {/* 날짜 + 요일 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }} className="tabular-nums">
        <span style={{ fontSize: 32, fontWeight: 700, color: TEXT_PRIMARY, lineHeight: 1, letterSpacing: '-0.5px' }}>
          {d.getMonth() + 1}.{d.getDate()}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_INACTIVE }}>
          {DAY_KR[d.getDay()]}요일
        </span>
      </div>

      {/* 시간 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }} className="tabular-nums">
        <span style={{ fontSize: 44, fontWeight: 700, color: timeColor, lineHeight: 1, letterSpacing: '-1px' }}>
          {cls.startTime}
        </span>
        <span style={{ fontSize: 26, fontWeight: 600, color: timeColor, opacity: 0.45, lineHeight: 1, letterSpacing: '-0.5px' }}>
          {endTimeStr}
        </span>
      </div>

      {/* 부가 정보 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: TEXT_INACTIVE }}>
          {formatDuration(cls.durationMin)}
        </span>
        {cls.location && (
          <>
            <span style={{ color: '#d9d9d9', fontSize: 13 }}>·</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: TEXT_INACTIVE }}>
              {cls.location}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ===== 지표 로우 =====
function MetricRow({ remainingHours, upcomingCount }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {[
        { label: '남은 수업 시간', value: formatHours(remainingHours), unit: null },
        { label: '다가오는 수업', value: upcomingCount, unit: '개' },
      ].map(({ label, value, unit }) => (
        <div key={label} style={{
          flex: 1, background: '#fff', borderRadius: 12, padding: '12px 14px',
          boxShadow: 'var(--shadow-border)',
        }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: TEXT_TERTIARY, margin: '0 0 4px' }}>{label}</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.15 }} className="tabular-nums">
            {value}
            {unit && <span style={{ fontSize: 13, fontWeight: 400, color: TEXT_TERTIARY, marginLeft: 3 }}>{unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

// ===== 홈 숙제 알림 카드 =====
function HomeworkAlertCard({ pending, feedback, studentToken, onNavigate }) {
  const navigate = useNavigate();
  if (pending.length === 0 && feedback.length === 0) return null;

  const items = [
    ...pending.map((h) => ({ hw: h, type: 'pending' })),
    ...feedback.map((h) => ({ hw: h, type: 'feedback' })),
  ];

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: 'var(--shadow-border)' }}>
      {items.map(({ hw, type }, i) => {
        const isPending = type === 'pending';
        return (
          <button
            key={hw.id}
            type="button"
            onClick={() => studentToken ? navigate(`/personal/${studentToken}/homework/${hw.id}`) : onNavigate?.()}
            className="active:scale-[0.97] transition-[scale,background-color] duration-150 ease-out"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              borderTop: i > 0 ? `1px solid ${BORDER_SUBTLE}` : 'none',
              WebkitTapHighlightColor: 'transparent', textAlign: 'left',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isPending ? PRIMARY_BG : STATUS_SUCCESS_BG,
            }}>
              {isPending
                ? <ClipboardTextIcon size={18} weight="fill" color={PRIMARY} />
                : <ChatTeardropTextIcon size={18} weight="fill" color={STATUS_SUCCESS_DARK} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', wordBreak: 'keep-all' }}>
                {hw.title}
              </p>
              <p style={{ fontSize: 12, color: isPending ? PRIMARY : STATUS_SUCCESS_DARK, margin: '2px 0 0' }}>
                {isPending ? '미제출' : '피드백 도착'}
              </p>
            </div>
            <CaretRightIcon size={16} weight="bold" color="#d9d9d9" style={{ flexShrink: 0 }} />
          </button>
        );
      })}
    </div>
  );
}

// ===== 홈 탭 =====
function HomeTab({ studentToken, foodSources, studentLoaded, remainingHours, remainingSessions, onUpcomingLoaded, hwAlerts, onSwitchToHomework, onOpenPanda, onSwitchToClasses }) {
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${nowKST.getUTCFullYear()}-${pad(nowKST.getUTCMonth() + 1)}-${pad(nowKST.getUTCDate())}`;
  const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();

  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);

  const loadInitialData = useCallback(async () => {
    setUpcomingLoading(true);
    try {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const thisMonth = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}`;
      const [curr, next] = await Promise.all([
        fetchMyClasses(studentToken, thisMonth),
        fetchMyClasses(studentToken, addMonths(thisMonth, 1)),
      ]);
      const all = [...curr, ...next]
        .filter(c => !c.isCancelled && c.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      const upcomingSlice = all.slice(0, 5);
      setUpcoming(upcomingSlice);
      onUpcomingLoaded?.(upcomingSlice);
    } catch {
      setUpcoming([]);
    } finally {
      setUpcomingLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  const visibleUpcoming = (remainingSessions !== null && remainingSessions >= 0)
    ? upcoming.slice(0, remainingSessions)
    : upcoming;

  return (
    <div style={{ paddingTop: 20, paddingBottom: 24 }}>

      {/* 다음 수업 */}
      <div data-coach="next-class" style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both' }}>
        <SectionHeading>다음 수업</SectionHeading>
        {upcomingLoading ? (
          <div style={{
            height: 86, borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Spin size="small" />
          </div>
        ) : visibleUpcoming.length === 0 ? (
          <div style={{
            borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-border)', padding: '20px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 14, color: TEXT_TERTIARY, margin: 0 }}>선생님과 수업 일정을 잡아보세요</p>
          </div>
        ) : (
          <NextClassHeroCard cls={visibleUpcoming[0]} todayStr={todayStr} nowMin={nowMin} />
        )}
      </div>
      <div style={{ margin: '0 20px 24px', borderBottom: `1px solid ${BORDER_SUBTLE}` }} />

      {/* 숙제 */}
      {studentLoaded && hwAlerts?.pending?.length > 0 && (
        <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '60ms' }}>
          <SectionHeading>숙제</SectionHeading>
          <HomeworkAlertCard
            pending={hwAlerts.pending}
            feedback={[]}
            studentToken={studentToken}
            onNavigate={onSwitchToHomework}
          />
        </div>
      )}

      {/* 피드백 */}
      {studentLoaded && hwAlerts?.feedback?.length > 0 && (
        <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '80ms' }}>
          <SectionHeading>피드백</SectionHeading>
          <HomeworkAlertCard
            pending={[]}
            feedback={hwAlerts.feedback}
            studentToken={studentToken}
            onNavigate={onSwitchToHomework}
          />
        </div>
      )}

      {/* 내 현황 + 팬더 키우기 */}
      {studentLoaded && (() => {
        const total = foodSources.reduce((s, x) => s + (x.count || 0), 0);
        // 학생별 키 사용 → 다른 학생의 EXP가 섞여 표시되던 문제 해결
        const fed = Math.min(parseInt(localStorage.getItem(getPandaStorageKey(studentToken)) || '0', 10), total);
        const { stage } = getStageInfo(fed);
        return (
          <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '120ms' }}>
            <SectionHeading>내 현황</SectionHeading>
            <MetricRow remainingHours={remainingHours} upcomingCount={visibleUpcoming.length} />
            {/*
              팬더 배너 — 두 레이어 기법
              paddingTop=76: 카드 위로 노출되는 팬더 높이
              카드 height=80 (fixed), 팬더 이미지 180px
              팬더 bottom=-24 in card → 하단 24px이 overflow:hidden으로 클립됨
              오버레이 div가 카드 위 76px 구간을 보여줌
            */}
            <div style={{ position: 'relative', marginTop: 8, paddingTop: 52 }}>
              {/* 오버레이: 카드 상단 위로 삐져나온 팬더 상체만 노출 */}
              <div style={{
                position: 'absolute', top: 0, right: -20,
                width: 180, height: 52,
                overflow: 'hidden', pointerEvents: 'none', zIndex: 2,
              }}>
                <img
                  src={stage.img} alt={stage.label}
                  style={{ position: 'absolute', right: 0, bottom: -104, width: 180, height: 180, objectFit: 'contain', animation: 'panda-rock 2s ease-in-out infinite', transformOrigin: 'bottom center' }}
                />
              </div>

              {/* 카드: overflow:hidden이 팬더 하단을 클립 */}
              <button
                data-coach="panda"
                type="button"
                onClick={onOpenPanda}
                className="active:scale-[0.97] transition-[scale] duration-150 ease-out"
                style={{
                  position: 'relative', zIndex: 1,
                  width: '100%', height: 80,
                  display: 'flex', alignItems: 'center',
                  background: 'linear-gradient(135deg, #7f0005 0%, #a80006 100%)',
                  border: 'none', cursor: 'pointer',
                  borderRadius: 16, boxShadow: '0 4px 20px rgba(127,0,5,0.28)',
                  padding: '0 16px 0 20px', textAlign: 'left',
                  overflow: 'hidden',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* 팬더 이미지: 카드 내부에서 overflow:hidden으로 상·하단 클립 */}
                <img
                  src={stage.img} alt="" aria-hidden="true"
                  style={{
                    position: 'absolute', right: -20, bottom: -24,
                    width: 180, height: 180, objectFit: 'contain',
                    pointerEvents: 'none',
                    animation: 'panda-rock 2s ease-in-out infinite', transformOrigin: 'bottom center',
                  }}
                />
                {/* 배경 장식 원 */}
                <div style={{ position: 'absolute', left: -12, bottom: -18, width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                {/* 텍스트 */}
                <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.3, letterSpacing: '-0.3px', textWrap: 'balance', marginBottom: 6 }}>
                    수업할수록 팬더가 자라요
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
                    탭해서 먹이 주기 →
                  </div>
                </div>
                {/* 팬더 공간 확보용 */}
                <div style={{ width: 148, flexShrink: 0 }} />
              </button>
            </div>

            {/* 블로그·인스타·유튜브 링크 카드 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {[
                { label: '블로그', icon: <ArticleIcon size={22} weight="fill" color="#03C75A" />, href: 'https://blog.naver.com/tiantian_chinese/224100509217' },
                { label: '인스타그램', icon: <InstagramLogoIcon size={22} weight="fill" color="#E1306C" />, href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==' },
                { label: '유튜브', icon: <YoutubeLogoIcon size={22} weight="fill" color="#FF0000" />, href: 'https://www.youtube.com/@tiantian_chinese' },
              ].map(({ label, icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="active:scale-[0.96] transition-[scale] duration-150 ease-out"
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '14px 8px',
                    background: '#fff', borderRadius: 12,
                    boxShadow: 'var(--shadow-border)',
                    textDecoration: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {icon}
                  <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY }}>{label}</span>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 다가오는 수업 목록 (2번째~) */}
      {!upcomingLoading && visibleUpcoming.length > 1 && (
        <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '160ms' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SectionHeading style={{ marginBottom: 0 }}>다가오는 수업</SectionHeading>
            <button
              type="button"
              onClick={onSwitchToClasses}
              className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
              style={{
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, color: TEXT_TERTIARY, padding: '4px 0',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              전체 보기 ›
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleUpcoming.slice(1, 4).map(cls => (
              <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
            ))}
          </div>
        </div>
      )}
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
  const [homeworkDot, setHomeworkDot] = useState(false);
  const [archiveDot, setArchiveDot] = useState(false);
  const [classDot, setClassDot] = useState(false);

  // 홈 탭 숙제 알림 카드
  const [hwAlerts, setHwAlerts] = useState({ pending: [], feedback: [] });
  const prevTabRef = useRef(tab);
  const lastUpcomingIdsRef = useRef(null);

  const ARCHIVE_SEEN_KEY = `archive_last_seen_${studentToken}`;
  const CLASS_SEEN_KEY = `classes_seen_ids_${studentToken}`;

  // 옛 공통 팬더 EXP 키(`panda_fed_total`) 정리 — 학생별 키 도입 전 누적된 잔존물.
  // 어느 학생 것인지 식별 불가능하므로 단순 삭제. 이미 없으면 무동작.
  useEffect(() => {
    try { localStorage.removeItem(PANDA_FEED_KEY); } catch {}
  }, []);

  const checkDots = useCallback(async () => {
    try {
      const pages = await fetchMyHomework(studentToken);
      const list = pages.map(parseHomework);
      const viewedMap = getViewedMap(studentToken);

      const pendingList = list.filter(h => h.status === '미제출');
      const feedbackList = list.filter(h => h.status === '피드백완료' && !viewedMap[h.id]);

      // 숙제 dot: 미제출 OR 안 읽은 피드백
      setHomeworkDot(pendingList.length > 0 || feedbackList.length > 0);

      // 홈 탭 알림 카드
      setHwAlerts({ pending: pendingList, feedback: feedbackList });

      // 보관함 dot: 마지막 보관함 방문 이후 새로 archived된 항목
      const lastSeenTime = parseInt(localStorage.getItem(ARCHIVE_SEEN_KEY) || '0', 10);
      setArchiveDot(
        list.some(h => {
          if (h.status !== '피드백완료') return false;
          const viewedAt = viewedMap[h.id];
          return viewedAt && isArchived(studentToken, h.id) && viewedAt > lastSeenTime;
        })
      );
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

    // 숙제 탭에서 나올 때 재확인
    if (prev === '숙제' && tab !== '숙제') checkDots();

    // 보관함 탭 방문 시 dot 해제 + 타임스탬프 저장
    if (tab === '보관함') {
      localStorage.setItem(ARCHIVE_SEEN_KEY, String(Date.now()));
      setArchiveDot(false);
    }

    // 내 수업 탭 방문 시 dot 해제 + 스냅샷 갱신
    if (tab === '내 수업' && lastUpcomingIdsRef.current !== null) {
      localStorage.setItem(CLASS_SEEN_KEY, lastUpcomingIdsRef.current);
      setClassDot(false);
    }
  }, [tab, checkDots]);

  // 탭별 튜토리얼 팁 (온보딩 완료 후 활성화)
  const [tipResetKey, setTipResetKey] = useState(0);
  const onboardingDone = !showOnboarding;
  const tipHome     = useTabTip('홈',     onboardingDone, tipResetKey);
  const tipClasses  = useTabTip('내 수업', onboardingDone, tipResetKey);
  const tipHomework = useTabTip('숙제',   onboardingDone, tipResetKey);
  const tipArchive  = useTabTip('보관함', onboardingDone, tipResetKey);
  const tipNotice   = useTabTip('공지',   onboardingDone, tipResetKey);
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
    if (install.canPrompt) install.promptInstall();
    else setShowIOSGuide(true);
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
            <WarningCircleIcon size={36} weight="fill" color={STATUS_ERROR_TEXT} />
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
        borderBottom: `1px solid ${BORDER_SUBTLE}`,
      }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
        }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.3 }}>
          {tab === '홈' ? student.name : tab === '내 수업' ? '예약 현황' : tab === '보관함' ? '발음 보관함' : tab}
        </h1>

        <div ref={settingsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            aria-label="설정"
            aria-expanded={settingsOpen}
            className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
            style={{
              width: 36, height: 36, padding: 0,
              border: 'none', background: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: TEXT_SECONDARY, fontSize: 24,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            }}
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
            transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s ease',
          }}>
            {[
              { label: '홈 화면에 추가', onClick: handleInstallAction },
              { label: '가이드 보기', onClick: () => { resetAllTabTips(); setTipResetKey(k => k + 1); } },
              { label: '문제 신고하기', onClick: () => window.open('https://forms.gle/dCwXvZAdfG12AxoJ9', '_blank', 'noopener,noreferrer') },
              { label: '로그아웃', onClick: () => { localStorage.removeItem('personal_student_token'); navigate('/personal'); } },
            ].map((item, i) => (
              <button
                key={item.label}
                onClick={() => { setSettingsOpen(false); item.onClick(); }}
                className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 8,
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 500,
                  color: item.label === '로그아웃' ? STATUS_ERROR_TEXT : TEXT_PRIMARY,
                  borderTop: i > 0 ? `1px solid ${BORDER_SUBTLE}` : 'none',
                }}
              >
                {item.label}
              </button>
            ))}
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
              { key: 'sessions', label: '완료 수업', count: student?.totalSessions ?? 0 },
              { key: 'referral', label: '친구 추천', count: student?.referralBonus ?? 0 },
            ]}
            studentLoaded={student !== null}
            remainingHours={student?.remainingHours ?? 0}
            remainingSessions={student?.remainingSessions ?? null}
            onUpcomingLoaded={handleUpcomingLoaded}
            hwAlerts={hwAlerts}
            onSwitchToHomework={() => setTab('숙제')}
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
        {tab === '숙제' && (
          <div role="tabpanel" id="tab-panel-2" aria-labelledby="nav-숙제">
            <MyHomeworkTab key={classRefreshKey} studentToken={studentToken} />
          </div>
        )}
        {tab === '보관함' && (
          <div role="tabpanel" id="tab-panel-3" aria-labelledby="nav-보관함">
            <ArchiveTab key={classRefreshKey} studentToken={studentToken} />
          </div>
        )}
        {tab === '공지' && (
          <EmptyState
            icon={<MegaphoneIcon size={44} weight="thin" style={{ color: '#d9d9d9' }} />}
            title="공지사항 준비 중이에요"
            description="선생님이 공지를 등록하면 여기에 표시돼요"
          />
        )}
      </div>

      {/* 코치마크 — 탭별 최초 방문 시 1회 표시 */}
      <CoachMarkOverlay
        visible={tab === '홈' && tipHome.visible}
        onDone={tipHome.dismiss}
        steps={[
          { selector: '[data-coach="next-class"]', label: '다음 수업 날짜와 시간이 여기에 표시돼요. 내 수업 탭에서 전체 일정을 확인할 수 있어요.' },
          { selector: '[data-coach="panda"]', label: '수업을 완료하면 팬더에게 먹이를 줄 수 있어요 🐼 탭해서 팬더를 키워보세요!' },
        ]}
      />
      <CoachMarkOverlay
        visible={tab === '내 수업' && tipClasses.visible}
        onDone={tipClasses.dismiss}
        steps={[
          { selector: '[data-coach="month-nav"]', label: '← → 버튼으로 월을 이동하며 수업을 확인해요' },
        ]}
      />
      <CoachMarkOverlay
        visible={tab === '숙제' && tipHomework.visible}
        onDone={tipHomework.dismiss}
        steps={[
          { selector: '[data-coach="homework-card"]', label: '탭하면 내용을 확인하고 파일이나 음성으로 제출할 수 있어요' },
        ]}
      />
      <CoachMarkOverlay
        visible={tab === '보관함' && tipArchive.visible}
        onDone={tipArchive.dismiss}
        steps={[
          { selector: null, label: '피드백 받은 숙제는 24시간 뒤 자동으로 여기에 보관돼요' },
        ]}
      />
      <CoachMarkOverlay
        visible={tab === '공지' && tipNotice.visible}
        onDone={tipNotice.dismiss}
        steps={[
          { selector: null, label: '선생님이 공지를 등록하면 여기에 표시돼요' },
        ]}
      />

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
            { key: '홈', icon: <HouseIcon weight="fill" />, label: '홈', dot: false },
            { key: '내 수업', icon: <BookOpenIcon weight="fill" />, label: '예약 현황', dot: classDot },
            { key: '숙제', icon: <FileTextIcon weight="fill" />, label: '숙제', dot: homeworkDot },
            { key: '보관함', icon: <ArchiveIcon weight="fill" />, label: '보관함', dot: archiveDot },
            { key: '공지', icon: <BellIcon weight="fill" />, label: '공지', dot: false },
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
                  transitionProperty: 'color, scale',
                  transitionDuration: '0.15s',
                  transitionTimingFunction: 'ease-out',
                  WebkitTapHighlightColor: 'transparent',
                  outline: 'none',
                }}
                className="active:scale-[0.96]"
              >
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {item.icon}
                  {item.dot && !isActive && (
                    <span style={{
                      position: 'absolute', top: -1, right: -3,
                      width: 7, height: 7, borderRadius: '50%',
                      background: STATUS_ERROR_TEXT,
                      border: '1.5px solid rgba(255,255,255,0.82)',
                    }} />
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
