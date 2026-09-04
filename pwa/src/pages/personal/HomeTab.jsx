import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { CircleNotchIcon } from '@phosphor-icons/react';
import { Button } from '../../components/shadcn/button';
import { Card, CardContent } from '../../components/shadcn/card';
import { ChatTeardropTextIcon, CaretRightIcon, MusicNotesIcon } from '@phosphor-icons/react';
import { peekCache, writeCacheValue, trackRevalidation } from '../../hooks/useCachedResource.js';
import { fetchMyClasses } from '../../api/bookingApi.js';
import { homeworkStatusColor } from '../../api/homework.js';
import { getViewedMap, HW_VIEWED_KEY } from '../../utils/homeworkViewed.js';
import { DAY_KR, timeToMin, formatDuration, addMonths, formatDateDot } from '../../utils/dateUtils.js';
import ClassCard from './ClassCard.jsx';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import { BADGE_SMALL } from '../../constants/styles.js';
import {
  PRIMARY,
  TEXT_PRIMARY, TEXT_TERTIARY, TEXT_INACTIVE, TEXT_DISABLED,
  BORDER_SUBTLE, BORDER_NEUTRAL,
  STATUS_INFO_DARK,
  STATUS_SUCCESS_DARK,
  STATUS_WARNING_TEXT,
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
      className="overflow-hidden"
      // 피드백 도착 카드만 초록 링을 덧댄다 — 기본 그림자는 Card가 이미 갖고 있지만
      // 링과 함께 쓰려면 한 선언에 넣어야 해서 여기서 통째로 지정한다.
      style={isFeedback
        ? { boxShadow: '0 0 0 2px rgba(82, 196, 26, 0.35), var(--shadow-border)' }
        : undefined}
    >
      <CardContent className="p-0">
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
            {hw.createdTime && (
              <span style={{ fontSize: 11, color: TEXT_DISABLED, flexShrink: 0 }}>
                등록 {formatDateDot(hw.createdTime)}
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
      </CardContent>
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

  const timeColor = isOngoing ? STATUS_INFO_DARK : PRIMARY;

  // 상태 단어(오늘/내일/수업 중)는 배지 칩 대신 날짜 줄의 첫 단어로 —
  // 큰 날짜 숫자·배지·카운트다운이 겹치니 "복잡하고 정리 안 된 느낌"(2026-08-31 지적).
  // 주인공은 시간 하나, 나머지는 조용한 한 줄씩.
  const statusWord = isOngoing
    ? { label: '수업 중', color: STATUS_INFO_DARK }
    : isToday
      ? { label: '오늘', color: STATUS_SUCCESS_DARK }
      : daysUntil === 1
        ? { label: '내일', color: STATUS_WARNING_TEXT }
        : null;

  // 날짜/상태는 메타 줄의 첫 항목 — 별도 줄로 두면 '오늘' 한 단어가 붕 뜬다(2026-08-31).
  // 오늘/내일/수업 중은 단어로, 그 외에는 수업 날짜로 말한다.
  const whenLabel = statusWord
    ? statusWord
    : { label: `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_KR[d.getDay()]}요일`, color: TEXT_INACTIVE };

  return (
    <div>
      {/* 시간 — 이 블록의 유일한 주인공. 한 덩어리(단일 크기·단일 색)를 유지하되
          투명도만으로 깊이를 준다: 시작이 앵커, 끝은 받쳐준다.
          구분자는 앱 전체 시간 표기와 같은 물결(~) — 작은 대시는 붕 떠 보였다(2026-08-31). */}
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 34, fontWeight: 700, color: timeColor, margin: '0 0 8px', lineHeight: 1, letterSpacing: '-0.5px' }} className="tabular-nums">
        <span>{cls.startTime}</span>
        <span style={{ opacity: 0.35 }} aria-hidden="true">~</span>
        <span style={{ opacity: 0.55 }}>{endTimeStr}</span>
      </p>

      {/* 부가 정보 — 언제 · 얼마나 · 어디서 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} className="tabular-nums">
        <span style={{ fontSize: 13, fontWeight: 600, color: whenLabel.color }}>
          {whenLabel.label}
        </span>
        <span style={{ color: BORDER_NEUTRAL, fontSize: 13 }}>·</span>
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

// 숙제가 하나도 없을 때 자리 문구 — 섹션은 항상 떠 있고 비어 있음도 정보다
function HwEmptyLine() {
  return (
    <p style={{ fontSize: 13, color: TEXT_INACTIVE, margin: 0, padding: '2px 2px 0' }}>
      아직 받은 숙제가 없어요
    </p>
  );
}

// ===== 홈 탭 =====
export default function HomeTab({ studentToken, studentLoaded, onUpcomingLoaded, hwAlerts, homeworkEnabled = true, onSwitchToClasses }) {
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
      const [curr, next, after] = await trackRevalidation(Promise.all([
        fetchMyClasses(studentToken, thisMonth),
        fetchMyClasses(studentToken, addMonths(thisMonth, 1)),
        fetchMyClasses(studentToken, addMonths(thisMonth, 2)),
      ]));
      // 잘라내지 않고 전부 담는다 — '예약된 수업' 개수가 실제 예약 건수여야 하기 때문.
      // (이전 slice(0,5) 때문에 10건 잡혀 있어도 5개로 보였다. 2026-08-26 실측: 활성 학생
      //  대부분이 8~11건이라 사실상 전원이 이 상한에 걸려 있었다.)
      // 화면에 카드로 펼치는 건 아래 렌더에서 따로 제한한다(다음 수업 1건 + 목록 3건).
      // 조회창은 이번 달 + 2개월(2026-09-04, 2개월→3개월). 일시중단 뒤 두 달 뒤로 잡힌 복귀 수업이
      //  "예정 수업 없음"으로 보이던 구멍을 막는다. 더 넓히면 홈 로딩마다 월별 요청이 그만큼 는다.
      // 오늘 수업은 **끝나기 전까지만** '다음 수업'이다 — date만 비교하면 끝난 수업이
      // 자정까지 홈에 남는다(2026-08-30 검수 지적). 진행 중(시작~종료 사이)은 계속 보여준다.
      const nowMinFresh = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      const all = [...curr, ...next, ...after]
        .filter(c => !c.isCancelled && (
          c.date > todayStr
          || (c.date === todayStr && timeToMin(c.startTime) + c.durationMin > nowMinFresh)
        ))
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
      <div data-coach="next-class" style={{ padding: '0 16px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both' }}>
        <SectionHeading>다음 수업</SectionHeading>
        {upcomingLoading ? (
          <div style={{
            height: 86, borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircleNotchIcon size={16} weight="bold" className="animate-spin" aria-hidden />
          </div>
        ) : upcomingError ? (
          <div style={{
            borderRadius: 12, background: '#fff',
            boxShadow: 'var(--shadow-border)', padding: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: TEXT_TERTIARY, margin: '0 0 10px' }}>수업 정보를 불러오지 못했어요</p>
            <Button variant="outline" size="sm" onClick={loadInitialData}>다시 시도</Button>
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
      <div style={{ margin: '0 16px 24px', borderBottom: `1px solid ${BORDER_SUBTLE}` }} />

      {/* 숙제 — 상태별 섹션 대신 부여된 숙제 카드 하나의 플랫 리스트(2026-08-31 사용자 제안).
          상태는 카드 배지(미제출/제출완료/피드백완료)가 이미 말해주므로 섹션 헤더는 중복이었다.
          정렬 = 지금 해야 하는 일 순: 제출 전 → 피드백 확인 → 제출 완료(대기). 피드백이
          쌓여도 제출할 숙제가 항상 맨 위라 묻히지 않는다. 비어 있으면 문구 한 줄.
          비VIP(homeworkEnabled=false)는 섹션 자체를 내지 않는다 — 영구 빈 상태로 "나만 숙제를 안 주나" 오해를 만들던 것(2026-09-04). */}
      {studentLoaded && homeworkEnabled && (
        <div style={{ padding: '0 16px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '60ms' }}>
          <SectionHeading>숙제</SectionHeading>
          {(() => {
            const all = [
              ...(hwAlerts?.pending ?? []),
              ...(hwAlerts?.feedback ?? []),
              ...(hwAlerts?.submitted ?? []),
            ];
            if (all.length === 0) return <HwEmptyLine />;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {all.map((hw, i) => (
                  <div key={hw.id} {...(i === 0 ? { 'data-coach': 'homework-card' } : {})}>
                    <HwCard
                      hw={hw}
                      studentToken={studentToken}
                      // 피드백 카드만 열람 시 보관함으로 이동
                      onMarkViewed={hw.status === '피드백완료' ? () => {
                        forceArchive(studentToken, hw.id);
                        toast.success('보관함으로 이동됐어요');
                      } : undefined}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* '내 현황'(지표 + 팬더)은 MY 탭으로 이사(2026-08-31) — MyTab.jsx */}

      {/* 예약된 수업 목록 (2번째~) */}
      {!upcomingLoading && visibleUpcoming.length > 1 && (
        <div style={{ padding: '0 16px', marginBottom: 24, animation: 'fade-in-up 400ms cubic-bezier(0.2,0,0,1) both', animationDelay: '160ms' }}>
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

      {/* 블로그·인스타·유튜브 링크는 '하늘하늘' 탭으로 이동(2026-08-31) — HanulTab.jsx */}
    </div>
  );
}

