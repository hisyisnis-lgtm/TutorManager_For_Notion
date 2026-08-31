import { Card, CardContent } from '@/components/shadcn/card';
import { DAY_KR, timeToMin, formatDuration } from '../../utils/dateUtils.js';
import { BADGE_SMALL } from '../../constants/styles.js';
import {
  PRIMARY, PRIMARY_LIGHT, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_TERTIARY, TEXT_INACTIVE, TEXT_DISABLED,
  BG_APP, GRAY_100,
  STATUS_INFO_BG, STATUS_INFO_DARK,
  STATUS_SUCCESS_BG, STATUS_SUCCESS_DARK,
  STATUS_WARNING_BG, STATUS_WARNING_TEXT,
  STATUS_TEAL_BG, STATUS_TEAL_TEXT,
  STATUS_ERROR_BG, STATUS_ERROR_TEXT,
} from '../../constants/theme.js';

export const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

/**
 * 수업 한 건 카드 — 학생앱 홈(예약된 수업)과 예약 현황 탭이 함께 쓴다.
 * 지난 수업·취소 수업은 흐리게(isDimmed), 진행 중이면 '수업중' 배지.
 */
export default function ClassCard({ cls, todayStr, nowMin }) {
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
    // 목록 카드 규범 = radius 16 + padding 16 (강사앱 ClassCard와 동일)
    <Card className="rounded-2xl" style={{ opacity: isDimmed ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      <CardContent className="p-4">
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

        {/* 수업 정보 — 배지가 시간 **위에** 뜨고 소요시간이 오른쪽에 따로 떠서
            가운데 블록이 래그드했다(2026-08-31 지적). 시간을 주인공으로 승격하고
            배지는 시간 옆 인라인, 장소·소요시간은 아래 메타 한 줄로 합친다. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: isDimmed ? TEXT_INACTIVE : TEXT_PRIMARY }} className="tabular-nums">
              {cls.startTime}–{endTimeStr}
            </span>
            {isOngoing && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_INFO_BG, color: STATUS_INFO_DARK }}>수업중</span>}
            {isToday && !isOngoing && !cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK }}>오늘</span>}
            {isPast && !cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: GRAY_100, color: TEXT_INACTIVE }}>완료</span>}
            {cls.isCancelled && <span style={{ ...BADGE_SMALL, backgroundColor: GRAY_100, color: TEXT_INACTIVE }}>취소</span>}
            {cls.classType === '2:1' && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_WARNING_BG, color: STATUS_WARNING_TEXT }}>2:1</span>}
            {cls.specialNote === '🟠 보강' && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_TEAL_BG, color: STATUS_TEAL_TEXT }}>보강</span>}
            {cls.specialNote === '🔴 결석' && <span style={{ ...BADGE_SMALL, backgroundColor: STATUS_ERROR_BG, color: STATUS_ERROR_TEXT }}>결석</span>}
          </div>
          <div style={{ marginTop: 3, fontSize: 13, color: isDimmed ? TEXT_DISABLED : TEXT_TERTIARY }} className="tabular-nums">
            {cls.location && <>{LOCATION_LABEL[cls.location] ?? cls.location} · </>}
            {formatDuration(cls.durationMin)}
          </div>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}
