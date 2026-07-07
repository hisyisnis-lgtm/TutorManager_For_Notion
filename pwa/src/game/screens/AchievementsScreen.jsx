// 업적 전체 화면 — 하나의 리스트(섹션 없음). 업적마다 카테고리 색만 다르게(배지 둘레 진행 링에 색).
// 진행 링이 진행도를 겸해 별도 바·중복 표기 제거. 획득=색 채움, 미획득=회색+색 링(진행분).
// 톤 원칙: 미획득도 실제 아이콘을 회색으로 — '다음 목표'로 보이게(압박 아님). 참조: tone_game_redesign.md
import {
  CaretLeftIcon, CheckIcon, FootprintsIcon, TrophyIcon, FlameIcon, FireSimpleIcon, RocketIcon, CrownIcon,
  InfinityIcon, BookmarkSimpleIcon, BooksIcon, CalendarCheckIcon, CalendarHeartIcon, CalendarDotsIcon, FireIcon, WaveformIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { ACHIEVEMENTS, ACH_CATEGORIES } from '../achievements.js';
import { Reveal } from './shared.jsx';

// 업적 icon 문자열 → Phosphor 컴포넌트 (achievements.js의 icon 필드와 일치)
const ACH_ICONS = {
  Footprints: FootprintsIcon, Trophy: TrophyIcon, Flame: FlameIcon, FireSimple: FireSimpleIcon,
  Rocket: RocketIcon, Crown: CrownIcon, Infinity: InfinityIcon, BookmarkSimple: BookmarkSimpleIcon,
  Books: BooksIcon, CalendarCheck: CalendarCheckIcon, CalendarHeart: CalendarHeartIcon,
  CalendarDots: CalendarDotsIcon, Fire: FireIcon, Waveform: WaveformIcon, ArrowsClockwise: ArrowsClockwiseIcon,
};
// 카테고리 id → 색 (섹션은 없애고 색만 사용)
const CAT_COLOR = Object.fromEntries(ACH_CATEGORIES.map((c) => [c.id, c.color]));

const DEFAULT_EARNED = '#FFB02E'; // 기본 획득 금색(축하 오버레이 등 색 미지정 시)
const LOCKED_BG = '#f1ece5';      // 회색 틴트(미획득 배지 안쪽)
const LOCKED_FG = '#c9c2b8';      // 회색 아이콘
const RING_TRACK = '#ece7e0';     // 링 트랙(빈 부분)

const tint = (hex, a = 0.14) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// 공용 배지(원형 아이콘) — 축하 오버레이(CelebrationOverlay)에서 사용. size=원 지름. color=획득 강조색(미지정=금색).
export function AchBadge({ ach, earned, size = 48, color }) {
  const Icon = ACH_ICONS[ach.icon] || TrophyIcon;
  const fg = color || DEFAULT_EARNED;
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: earned ? tint(fg, 0.16) : LOCKED_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={Math.round(size * 0.46)} weight="fill" color={earned ? fg : LOCKED_FG} />
    </div>
  );
}

// 배지 둘레 진행 링 — 진행도를 아이콘에 통합(별도 바 제거). 획득=색 채움+체크, 미획득=색 링(진행분).
function RingBadge({ ach, got, color, pct, size = 54 }) {
  const Icon = ACH_ICONS[ach.icon] || TrophyIcon;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shownPct = got ? 100 : pct;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_TRACK} strokeWidth={stroke} />
        {shownPct > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - shownPct / 100)} />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: stroke + 2.5, borderRadius: '50%', background: got ? tint(color, 0.18) : LOCKED_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={Math.round(size * 0.4)} weight="fill" color={got ? color : LOCKED_FG} />
      </div>
      {got && (
        <div style={{ position: 'absolute', right: -2, bottom: -2, width: 19, height: 19, borderRadius: 10, background: color, border: '2.5px solid #FFFDF8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckIcon size={9} weight="bold" color="#fff" />
        </div>
      )}
    </div>
  );
}

// 업적 한 줄 — 카드 chrome 없이 얇은 구분선 리스트(대시보드 카드 느낌 제거). 진행은 링이 담당.
function AchRow({ ach, earned, snapshot, onToast, last }) {
  const color = CAT_COLOR[ach.cat] || DEFAULT_EARNED;
  const p = (ach.progress && snapshot) ? ach.progress(snapshot) : { cur: earned ? 1 : 0, target: 1 };
  const got = earned || p.cur >= p.target;
  const pct = Math.min(100, Math.round((p.cur / (p.target || 1)) * 100));
  return (
    <button className="tg-press" onClick={() => onToast && onToast(got ? '이미 달성한 업적이에요!' : ach.cond)}
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '13px 4px', background: 'none', border: 'none', borderBottom: last ? 'none' : '1px solid rgba(43,39,48,0.06)', cursor: 'pointer', ...TOUCH_OPT }}>
      <RingBadge ach={ach} got={got} color={color} pct={pct} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15.5, color: got ? '#2b2730' : '#8b8580' }}>{ach.label}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#a49da6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ach.desc}</span>
      </div>
      {/* 우측 — 획득은 링·체크가 말하므로 비움, 진행 중만 담백한 수치 */}
      {!got && (
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color, flexShrink: 0 }}>
          {p.cur.toLocaleString()}<span style={{ color: '#c9c2b8' }}> / {p.target.toLocaleString()}</span>
        </span>
      )}
    </button>
  );
}

export function AchievementsScreen({ earned, snapshot, onBack, onToast }) {
  const earnedSet = new Set(earned || []);
  const n = earnedSet.size;
  const total = ACHIEVEMENTS.length;
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>업적</span>
          {/* 달성 수 — 알약 칩(대시보드 느낌) 대신 헤더에 녹인 담백한 텍스트 */}
          <span style={{ marginLeft: 'auto', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14.5, color: '#b4ada6' }}>
            <b style={{ fontFamily: FONT_TITLE, fontWeight: 400, fontSize: 19, color: '#2b2730' }}>{n}</b> / {total}
          </span>
        </div>
      </Reveal>
      {/* 하나의 리스트 — 섹션 없이 흐르고, 카테고리 구분은 링/아이콘 색으로만 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 76, bottom: 'calc(20px + env(safe-area-inset-bottom))', overflowY: 'auto' }}>
        {ACHIEVEMENTS.map((a, i) => (
          <AchRow key={a.id} ach={a} earned={earnedSet.has(a.id)} snapshot={snapshot} onToast={onToast} last={i === ACHIEVEMENTS.length - 1} />
        ))}
      </Reveal>
    </>
  );
}
