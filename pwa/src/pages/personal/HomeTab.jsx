import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Spin, App } from 'antd';
import { ClipboardTextIcon, HourglassIcon, ChatTeardropTextIcon, CaretRightIcon, MusicNotesIcon, ArticleIcon, InstagramLogoIcon, YoutubeLogoIcon } from '@phosphor-icons/react';
import { peekCache, writeCacheValue, trackRevalidation } from '../../hooks/useCachedResource.js';
import { fetchMyClasses } from '../../api/bookingApi.js';
import { homeworkStatusColor } from '../../api/homework.js';
import { getViewedMap, HW_VIEWED_KEY } from '../../utils/homeworkViewed.js';
import { DAY_KR, timeToMin, formatDuration, addMonths } from '../../utils/dateUtils.js';
import ClassCard from './ClassCard.jsx';
import HomeworkSection from '../../components/homework/HomeworkSection.jsx';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import { getStageInfo, getPandaStorageKey } from '../../components/ui/PandaWidget.jsx';
import { BADGE_SMALL, BADGE_MEDIUM } from '../../constants/styles.js';
import {
  PRIMARY,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_INACTIVE, TEXT_DISABLED,
  GRAY_100, BORDER_SUBTLE, BORDER_NEUTRAL,
  STATUS_INFO_BG, STATUS_INFO_DARK,
  STATUS_SUCCESS_BG, STATUS_SUCCESS_DARK,
  STATUS_WARNING_BG, STATUS_WARNING_TEXT,
  STATUS_ERROR_TEXT,
  GRADIENTS, BRAND_EXTERNAL,
} from '../../constants/theme.js';




function forceArchive(token, hwId) {
  const map = getViewedMap(token);
  // viewedAt = 현재 시점. 학생이 같은 카드를 다시 볼 때마다 갱신 → 강사 피드백일과의 시점 비교가 정확.
  map[hwId] = Date.now();
  localStorage.setItem(HW_VIEWED_KEY(token), JSON.stringify(map));
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
        overflow: 'hidden' }}
      styles={{ body: { padding: 0 } }}
    >
      <button
        type="button"
        onClick={() => {
          onMarkViewed?.();
          navigate(`/personal/${studentToken}/homework/${hw.id}`);
        }}
        className=""
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', border: 'none', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent', textAlign: 'left',
          background: isFeedback ? 'rgba(82, 196, 26, 0.04)' : 'none',
          transitionProperty: 'background',
          transitionDuration: '150ms',
          transitionTimingFunction: 'ease-out' }}
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
          <CaretRightIcon size={16} color={TEXT_DISABLED} />
        </div>
      </button>
    </Card>
  );
}


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
  if (isOngoing)        badge = { label: '수업 중', bg: STATUS_INFO_BG, color: STATUS_INFO_DARK };
  else if (isToday)     badge = { label: '오늘',   bg: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK };
  else if (daysUntil === 1) badge = { label: '내일', bg: STATUS_WARNING_BG, color: STATUS_WARNING_TEXT };
  else if (daysUntil <= 7)  badge = { label: `D-${daysUntil}`, bg: GRAY_100, color: TEXT_SECONDARY };

  const timeColor = isOngoing ? STATUS_INFO_DARK : PRIMARY;

  return (
    <div style={{ position: 'relative' }}>
      {/* 배지 — 우측 상단 */}
      {badge && (
        <span style={{
          position: 'absolute', top: 0, right: 0,
          ...BADGE_MEDIUM,
          background: badge.bg, color: badge.color }}>
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
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_INACTIVE }}>
          {formatDuration(cls.durationMin)}
        </span>
        {cls.location && (
          <>
            <span style={{ color: BORDER_NEUTRAL, fontSize: 13 }}>·</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_INACTIVE }}>
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
        { label: '남은 수업 시간', value: formatDuration(remainingHours * 60), unit: null },
        { label: '예약된 수업', value: upcomingCount, unit: '개' },
      ].map(({ label, value, unit }) => (
        <div key={label} style={{
          flex: 1, background: '#fff', borderRadius: 12, padding: '12px 14px',
          boxShadow: 'var(--shadow-border)' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: TEXT_TERTIARY, margin: '0 0 4px' }}>{label}</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.15 }} className="tabular-nums">
            {value}
            {unit && <span style={{ fontSize: 13, fontWeight: 400, color: TEXT_TERTIARY, marginLeft: 3 }}>{unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

// ===== 홈 탭 =====
export default function HomeTab({ studentToken, foodSources, studentLoaded, remainingHours, onUpcomingLoaded, hwAlerts, onOpenPanda, onSwitchToClasses }) {
  // 정적 message는 테마 컨텍스트를 못 받아 콘솔 경고 + 스타일 불일치 — App.useApp() 사용
  const { message } = App.useApp();
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${nowKST.getUTCFullYear()}-${pad(nowKST.getUTCMonth() + 1)}-${pad(nowKST.getUTCDate())}`;
  const nowMin = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes();

  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  // 캐시 없는 첫 방문에서 네트워크 실패를 "수업 없음" 빈 상태로 위장하지 않기
  const [upcomingError, setUpcomingError] = useState(false);

  const loadInitialData = useCallback(async () => {
    // 캐시 있으면 즉시 표시(홈 첫 화면 빠르게), 뒤에서 갱신. dot 판정(onUpcomingLoaded)은
    // 최신 데이터로만 — 옛 목록으로 새 수업 점을 잘못 띄우지 않게.
    const CK = `student:upcoming:${studentToken}`;
    const cached = peekCache(CK);
    if (cached) {
      setUpcoming(cached);
      setUpcomingLoading(false);
    } else {
      setUpcomingLoading(true);
    }
    try {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const thisMonth = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}`;
      const [curr, next] = await trackRevalidation(Promise.all([
        fetchMyClasses(studentToken, thisMonth),
        fetchMyClasses(studentToken, addMonths(thisMonth, 1)),
      ]));
      // 잘라내지 않고 전부 담는다 — '예약된 수업' 개수가 실제 예약 건수여야 하기 때문.
      // (이전 slice(0,5) 때문에 10건 잡혀 있어도 5개로 보였다. 2026-08-26 실측: 활성 학생
      //  대부분이 8~11건이라 사실상 전원이 이 상한에 걸려 있었다.)
      // 화면에 카드로 펼치는 건 아래 렌더에서 따로 제한한다(다음 수업 1건 + 목록 3건).
      // 조회창은 이번 달+다음 달이라 그 너머 예약은 집계에서 빠진다 — 지금 운영 패턴(1~2개월치
      //  선등록)에선 충분하고, 더 넓히면 홈 로딩마다 월별 요청이 그만큼 늘어난다.
      const all = [...curr, ...next]
        .filter(c => !c.isCancelled && c.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      setUpcoming(all);
      setUpcomingError(false);
      writeCacheValue(CK, all);
      onUpcomingLoaded?.(all);
    } catch {
      if (!cached) { setUpcoming([]); setUpcomingError(true); }
    } finally {
      setUpcomingLoading(false);
    }
  }, [studentToken]);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  // 잡혀 있는 수업은 결제 잔여와 무관하게 전부 보여준다.
  //
  // 이전에는 학생 '잔여 시간 회차'로 목록을 잘라냈지만 두 겹으로 틀렸다.
  // ① 단위 혼동: 그 값의 단위는 개수가 아니라 시간이라 개수로 slice하면 90분 수업 학생은
  //    3시간 남았을 때 3개가 보였고, 딱 맞게 결제한 학생(0시간)은 목록이 통째로 비었다.
  // ② 기준 자체가 부적합: 그 값은 완료분뿐 아니라 '예정' 수업까지 이미 차감한 뒤의 잔액이다.
  //    월별 결제(수강권 없음)라 강사가 몇 달치를 미리 잡아두면 음수가 되는 게 정상이고
  //    (2026-08-26 실측: 강세희 −9시간, 예약 5건), 이걸 초과로 보고 감추면 학생 화면에서
  //    실제로 잡혀 있는 수업이 사라진다. 결제 안내는 강사앱 '결제 안내 필요'가 맡는다.
  const visibleUpcoming = upcoming;

  return (
    <div style={{ paddingTop: 20, paddingBottom: 24 }}>

      {/* 다음 수업 */}
      <div data-coach="next-class" style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both' }}>
        <SectionHeading>다음 수업</SectionHeading>
        {upcomingLoading ? (
          <div style={{
            height: 86, borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="small" />
          </div>
        ) : upcomingError ? (
          <div style={{
            borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-border)', padding: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: TEXT_TERTIARY, margin: '0 0 10px' }}>수업 정보를 불러오지 못했어요</p>
            <Button size="small" onClick={loadInitialData}>다시 시도</Button>
          </div>
        ) : visibleUpcoming.length === 0 ? (
          <div style={{
            borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-border)', padding: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: TEXT_TERTIARY, margin: 0 }}>선생님과 수업 일정을 잡아보세요</p>
          </div>
        ) : (
          <NextClassHeroCard cls={visibleUpcoming[0]} todayStr={todayStr} nowMin={nowMin} />
        )}
      </div>
      <div style={{ margin: '0 20px 24px', borderBottom: `1px solid ${BORDER_SUBTLE}` }} />

      {/* 숙제 — 제출 전 / 제출 완료 / 피드백 완료 (각 섹션은 카드 있을 때만 노출) */}
      {studentLoaded && (hwAlerts?.pending?.length > 0 || hwAlerts?.submitted?.length > 0 || hwAlerts?.feedback?.length > 0) && (
        <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '60ms' }}>
          <SectionHeading>숙제</SectionHeading>

          {hwAlerts.feedback.length > 0 && (
            <HomeworkSection icon={<ChatTeardropTextIcon size={20} weight="fill" />} label="피드백 완료" count={hwAlerts.feedback.length} color={STATUS_SUCCESS_DARK}>
              {hwAlerts.feedback.map((hw, i) => (
                <div key={hw.id} {...(i === 0 ? { 'data-coach': 'homework-card' } : {})}>
                  <HwCard
                    hw={hw}
                    studentToken={studentToken}
                    onMarkViewed={() => {
                      forceArchive(studentToken, hw.id);
                      message.success('보관함으로 이동됐어요');
                    }}
                  />
                </div>
              ))}
            </HomeworkSection>
          )}

          {hwAlerts.pending.length > 0 && (
            <HomeworkSection icon={<ClipboardTextIcon size={20} weight="fill" />} label="제출 전" count={hwAlerts.pending.length} color={STATUS_ERROR_TEXT}>
              {hwAlerts.pending.map((hw, i) => (
                <div key={hw.id} {...(i === 0 && hwAlerts.feedback.length === 0 ? { 'data-coach': 'homework-card' } : {})}>
                  <HwCard hw={hw} studentToken={studentToken} />
                </div>
              ))}
            </HomeworkSection>
          )}

          {hwAlerts.submitted.length > 0 && (
            <HomeworkSection icon={<HourglassIcon size={20} weight="fill" />} label="제출 완료" count={hwAlerts.submitted.length} color={STATUS_INFO_DARK}>
              {hwAlerts.submitted.map((hw) => (
                <HwCard key={hw.id} hw={hw} studentToken={studentToken} />
              ))}
            </HomeworkSection>
          )}
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
                overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
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
                className="no-press"
                style={{
                  position: 'relative', zIndex: 1,
                  width: '100%', height: 80,
                  display: 'flex', alignItems: 'center',
                  background: GRADIENTS.studentHero,
                  border: 'none', cursor: 'pointer',
                  borderRadius: 16, boxShadow: '0 4px 20px rgba(127,0,5,0.28)',
                  padding: '0 16px 0 20px', textAlign: 'left',
                  overflow: 'hidden',
                  WebkitTapHighlightColor: 'transparent' }}
              >
                {/* 팬더 이미지: 카드 내부에서 overflow:hidden으로 상·하단 클립 */}
                <img
                  src={stage.img} alt="" aria-hidden="true"
                  style={{
                    position: 'absolute', right: -20, bottom: -24,
                    width: 180, height: 180, objectFit: 'contain',
                    pointerEvents: 'none',
                    animation: 'panda-rock 2s ease-in-out infinite', transformOrigin: 'bottom center' }}
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
                { label: '블로그', icon: <ArticleIcon size={24} weight="fill" color={BRAND_EXTERNAL.naver} />, href: 'https://blog.naver.com/tiantian_chinese/224100509217' },
                { label: '인스타그램', icon: <InstagramLogoIcon size={24} weight="fill" color={BRAND_EXTERNAL.instagram} />, href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==' },
                { label: '유튜브', icon: <YoutubeLogoIcon size={24} weight="fill" color={BRAND_EXTERNAL.youtube} />, href: 'https://www.youtube.com/@tiantian_chinese' },
              ].map(({ label, icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press"
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '14px 8px',
                    background: '#fff', borderRadius: 12,
                    boxShadow: 'var(--shadow-border)',
                    textDecoration: 'none',
                    WebkitTapHighlightColor: 'transparent' }}
                >
                  {icon}
                  <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY }}>{label}</span>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 예약된 수업 목록 (2번째~) */}
      {!upcomingLoading && visibleUpcoming.length > 1 && (
        <div style={{ padding: '0 20px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '160ms' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <SectionHeading style={{ marginBottom: 0 }}>예약된 수업</SectionHeading>
            <button
              type="button"
              onClick={onSwitchToClasses}
              className="transition-[color] duration-150 ease-out"
              style={{
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, color: TEXT_TERTIARY, padding: '4px 0',
                WebkitTapHighlightColor: 'transparent' }}
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

