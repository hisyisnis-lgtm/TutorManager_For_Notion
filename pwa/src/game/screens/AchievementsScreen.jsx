// 업적 전체 화면 — 배지 그리드(획득=금색/미획득=회색). 시작화면 업적 선반(P3) 탭으로 진입.
// 톤 원칙: 미획득도 실제 아이콘을 회색으로 보여줘 '다음 목표'로 보이게(압박 아님·격려). 참조: tone_game_redesign.md
import {
  CaretLeftIcon, FootprintsIcon, TrophyIcon, FlameIcon, FireSimpleIcon, RocketIcon, CrownIcon,
  InfinityIcon, BookmarkSimpleIcon, BooksIcon, CalendarCheckIcon, CalendarHeartIcon, CalendarDotsIcon, FireIcon, WaveformIcon,
} from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { ACHIEVEMENTS } from '../achievements.js';
import { Reveal, CoachBubble } from './shared.jsx';

// 업적 icon 문자열 → Phosphor 컴포넌트 (achievements.js의 icon 필드와 일치)
const ACH_ICONS = {
  Footprints: FootprintsIcon, Trophy: TrophyIcon, Flame: FlameIcon, FireSimple: FireSimpleIcon,
  Rocket: RocketIcon, Crown: CrownIcon, Infinity: InfinityIcon, BookmarkSimple: BookmarkSimpleIcon,
  Books: BooksIcon, CalendarCheck: CalendarCheckIcon, CalendarHeart: CalendarHeartIcon,
  CalendarDots: CalendarDotsIcon, Fire: FireIcon, Waveform: WaveformIcon,
};

const EARNED_BG = '#fff6e8';   // 따뜻한 금색 틴트(획득)
const EARNED_FG = '#FFB02E';   // 금색 아이콘
const LOCKED_BG = '#f3efe9';   // 회색 틴트(미획득)
const LOCKED_FG = '#cfc8bf';   // 회색 아이콘

// 공용 배지 — 선반·그리드 양쪽에서 사용. size=원 지름.
export function AchBadge({ ach, earned, size = 48 }) {
  const Icon = ACH_ICONS[ach.icon] || TrophyIcon;
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: earned ? EARNED_BG : LOCKED_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={Math.round(size * 0.46)} weight="fill" color={earned ? EARNED_FG : LOCKED_FG} />
    </div>
  );
}

export function AchievementsScreen({ earned, onBack, onToast }) {
  const earnedSet = new Set(earned || []);
  const n = earnedSet.size;
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>업적</span>
        </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 88 }}>
        <CoachBubble text={n > 0 ? `벌써 ${n}개나 모았어요!` : '게임을 플레이하면 업적이 모여요'} />
      </Reveal>
      {/* 12개 그리드(3열·스크롤) — 코치 말풍선 아래 충분히 띄움 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 176, bottom: 'calc(24px + env(safe-area-inset-bottom))', overflowY: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {ACHIEVEMENTS.map((a) => {
            const got = earnedSet.has(a.id);
            return (
              <button key={a.id} className="tg-press"
                onClick={() => onToast && onToast(got ? '이미 달성한 업적이에요!' : a.cond)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 6px 12px', background: '#fff', borderRadius: 18, border: '1.5px solid #efeae4', opacity: got ? 1 : 0.78, cursor: 'pointer', ...TOUCH_OPT }}>
                <AchBadge ach={a} earned={got} size={52} />
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: got ? '#2b2730' : '#9a93a0', textAlign: 'center', lineHeight: 1.2 }}>{a.label}</span>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 10.5, color: '#9a93a0', textAlign: 'center', lineHeight: 1.3 }}>{a.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
