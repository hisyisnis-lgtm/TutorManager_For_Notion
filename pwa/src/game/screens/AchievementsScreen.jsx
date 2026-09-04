// 업적 화면 (Figma "14. 업적" / "14. 업적 — 스크롤", 2026-08-05 리디자인)
//  구 구성(헤더바 + 진행 링 배지 + 얇은 구분선 리스트)에서 오답 노트와 같은 문법으로 통일:
//  제목 → 업적 진행도(라벨+바) → 카드 리스트. 스크롤하면 진행도만 상단에 고정된다.
//  내부 수치는 전부 시안 절대값(라인하이트 고정) — flex 중앙정렬에 맡기면 라인박스가 여백을 먹는다.
import {
  Cup, Flame, Fire, Rocket, Crown, Infinity as InfinityIcon, Refresh,
  Flag, Bookmark, Book, CalendarMark, CalendarDate, Calendar, Soundwave,
  CheckCircle, Star, Stars, CrownStar, MedalStar, Bolt,
} from '@solar-icons/react';
import { TG, HOME, TYPE, FONT_NUM, TOUCH_OPT, SPACE, SHADOW, keycap } from '../tgTokens.js';
import { ACHIEVEMENTS } from '../achievements.js';
import { Reveal, TgTabBar, TAB_BAR_H, useStickyHeader, Gauge } from './shared.jsx';

// 업적 icon 문자열 → Solar 컴포넌트 (achievements.js의 icon 필드와 일치)
const ACH_ICONS = {
  Flag: Flag, Trophy: Cup, Flame: Flame, FireSimple: Fire,
  Rocket: Rocket, Crown: Crown, Infinity: InfinityIcon, BookmarkSimple: Bookmark,
  Books: Book, CalendarCheck: CalendarMark, CalendarHeart: CalendarDate,
  CalendarDots: Calendar, Fire: Fire, Waveform: Soundwave, ArrowsClockwise: Refresh,
  CheckCircle, Star, Stars, CrownStar, MedalStar, Bolt,
};
// 업적 강조색 — 리스트 타일·축하 오버레이가 **같은 색 하나**를 쓴다.
//  예전엔 오버레이만 카테고리별 색(achColor)이라 팝업마다 아이콘 색이 달랐다(2026-08-09 사용자 지적).
export const ACH_ACCENT = TG.CTA;

const DEFAULT_EARNED = TG.SUN;     // 기본 획득 금색(축하 오버레이 등 색 미지정 시)
const LOCKED_BG = TG.SURFACE;       // 회색 틴트(축하 오버레이 배지 안쪽)
const LOCKED_FG = TG.MUTED;       // 회색 아이콘

// 시안 14 실측 — 토큰에 있는 색은 참조, 원오프만 리터럴 (2026-08-31 토큰 통합)
const TITLE_INK = TG.INK;           // 제목·업적명·진행 수치 (원오프)
const ICON_LOCKED = TG.ICON_LOCKED;   // 미획득 아이콘 (원오프)
const BAR_TRACK = HOME.GAUGE_TRACK;
const BAR_FILL = TG.CTA;
const PCT_INK = HOME.INK;
const DIVIDER = TG.BORDER;

const tint = (hex, a = 0.14) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// 공용 배지(원형 아이콘) — 축하 오버레이(CelebrationOverlay)에서 사용. size=원 지름. color=획득 강조색(미지정=금색).
//  bg/iconSize = 시안별 오버라이드(축하 모달 512:2 = 흰 원 92 + 업적 아이콘 50).
export function AchBadge({ ach, earned, size = 48, color, bg, iconSize }) {
  const Icon = ACH_ICONS[ach.icon] || Cup;
  const fg = color || DEFAULT_EARNED;
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: bg || (earned ? tint(fg, 0.16) : LOCKED_BG), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={iconSize || Math.round(size * 0.46)} weight="Bold" color={earned ? fg : LOCKED_FG} />
    </div>
  );
}

// 달성 체크 — 시안 chk0(40 박스에 stroke 5 라운드 체크)
function AchCheck() {
  return (
    <svg width={40} height={40} viewBox="0 0 40 40" fill="none" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M9.16667 20.8333L16.6667 28.3333L30.8333 12.5" stroke={TG.SUB} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 업적 한 줄 — 시안: 342×70 · r20 · 흰 카드 · padding 10/20/10/10.
//  왼쪽 = 타일 40(r10) + 아이콘 32 + gap8 + [이름 16 / 설명 12], 오른쪽 = 체크 또는 진행 수치(Roboto Black 16)
function AchRow({ ach, earned, snapshot, onToast }) {
  const Icon = ACH_ICONS[ach.icon] || Cup;
  const p = (ach.progress && snapshot) ? ach.progress(snapshot) : { cur: earned ? 1 : 0, target: 1 };
  const got = earned || p.cur >= p.target;
  const showProgress = !got && p.target > 1;
  return (
    <button className="tg-press" onClick={() => onToast && onToast(got ? '이미 달성한 업적이에요!' : ach.cond, got ? 'done' : 'lock')}
      style={{
        // ★width 100% 필수 — button은 기본이 내용 크기라, 등장 래퍼(Reveal) 안에 들어가면 행마다 폭이 들쭉날쭉해진다(2026-08-06)
        width: '100%', height: 70, borderRadius: 20, background: '#fff', boxShadow: SHADOW.level1, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px 10px 10px', textAlign: 'left', flexShrink: 0, ...TOUCH_OPT,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, minWidth: 0 }}>
        {/* 아이콘 뒤 틴트/솔리드 박스 제거(design_system §18-2, 2026-09-03) — 획득/미획득은 아이콘 색만으로 구분. 40 슬롯은 정렬 유지용 */}
        <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={34} weight="Bold" color={got ? ACH_ACCENT : ICON_LOCKED} />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ ...TYPE.h2, lineHeight: '19px', color: TITLE_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ach.label}</span>
          <span style={{ ...TYPE.meta, fontWeight: 700, lineHeight: '14px', color: TG.SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ach.desc}</span>
        </div>
      </div>
      {got ? <AchCheck /> : showProgress ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, fontFamily: FONT_NUM, fontWeight: 900, fontSize: 16, lineHeight: '19px' }}>
          <span style={{ color: TITLE_INK }}>{p.cur.toLocaleString()}</span>
          <span style={{ color: TG.SUB }}>/{p.target.toLocaleString()}</span>
        </div>
      ) : null}
    </button>
  );
}

export function AchievementsScreen({ earned, snapshot, onToast, tabNav, achDot = false }) {
  // 스크롤 상태(시안 14 — 스크롤): 제목이 밀려 올라가고 '업적 진행도'만 상단에 고정 — 흰 블록 110 + 하단 2px 구분선.
  //  sticky top:0 + paddingTop 50 → 고정 시 라벨 y50 · 바 y78 · 블록 110(시안과 동일).
  //  ★고정 전환 판정은 오답 노트와 같은 공용 훅(useStickyHeader) — 블록이 실제로 상단에 붙는 순간에만 바뀐다.
  const { scrollRef, sentinelRef, stuck } = useStickyHeader();
  const earnedSet = new Set(earned || []);
  const total = ACHIEVEMENTS.length;
  const gotN = ACHIEVEMENTS.filter((a) => {
    if (earnedSet.has(a.id)) return true;
    const p = (a.progress && snapshot) ? a.progress(snapshot) : null;
    return !!(p && p.cur >= p.target);
  }).length;
  const pct = Math.round((gotN / (total || 1)) * 100);
  return (
    <>
      <div className="tg-noscroll" ref={scrollRef} style={{
        scrollbarWidth: 'none', // 데스크톱 스크롤바가 폭을 먹어 342 컬럼이 좁아지지 않게(모바일은 원래 없음)
        position: 'absolute', left: 0, right: 0, top: 0, bottom: `calc(${TAB_BAR_H}px + env(safe-area-inset-bottom))`,
        overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 24px', zIndex: 2,
      }}>
        {/* 제목 — 시안 y40 · 26px 2줄(라인 31) */}
        <Reveal i={0} style={{ display: 'block', marginTop: 40 }}>
          <span style={{ display: 'block', ...TYPE.head, fontSize: 26, lineHeight: '31px', color: TITLE_INK }}>
            업적을 확인하고<br />달성해봐요!
          </span>
        </Reveal>
        {/* ★고정 경계 센티넬 — 블록이 갖고 있던 -30 top 마진을 여기로 옮겼다(레이아웃 총합 동일).
            이 지점이 컨테이너 상단을 넘는 순간 = 블록이 붙는 순간. IntersectionObserver가 정확히 그때 발화한다. */}
        <div ref={sentinelRef} aria-hidden="true" style={{ height: 0, marginTop: -30 }} />
        {/* 업적 진행도 — 평소 y122, 스크롤하면 상단 고정. ★sticky는 Reveal(transform) 안에서 죽는다 → 페이드만(tg-fade) */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 3, margin: '0 -24px 0', padding: '50px 24px 18px',
          // ★배경엔 transition을 걸지 않는다 — 페이드 도중 반투명 구간에서 뒤 행이 비쳐 '틈'으로 보인다.
          background: stuck ? '#fff' : 'transparent', boxShadow: stuck ? keycap(DIVIDER, { depth: 2, lift: null }) : 'none',
        }}>
          {/* 시안: 평소 16 Medium → 고정되면 24 Bold(제목 역할을 물려받음). 라인박스는 18로 고정이라 바 위치·블록 높이는 그대로 */}
          <span style={{
            display: 'block', ...TYPE.body, fontSize: stuck ? 24 : 16, fontWeight: stuck ? 700 : 500,
            lineHeight: '18px', color: TITLE_INK, transition: 'font-size .15s ease',
          }}>업적 진행도</span>
          <div style={{ marginTop: SPACE.lg, height: 14, display: 'flex', alignItems: 'center', gap: SPACE.lg }}>
            <Gauge pct={pct} fill={BAR_FILL} track={BAR_TRACK} transition="width .4s ease" ariaLabel="업적 진행도"
              style={{ flex: 1, minWidth: 0, width: 'auto' }} />
            <span style={{ width: 30, textAlign: 'center', fontFamily: FONT_NUM, fontWeight: 900, fontSize: 12, lineHeight: '14px', color: PCT_INK, flexShrink: 0 }}>{pct}%</span>
          </div>
        </div>
        {/* 리스트 — 시안 y208(고정 블록 아래 26) · 행 간격 10 */}
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: SPACE.lg, paddingBottom: 40 }}>
          {ACHIEVEMENTS.map((a, ai) => (
            <Reveal key={a.id} i={ai + 2}>
              <AchRow ach={a} earned={earnedSet.has(a.id)} snapshot={snapshot} onToast={onToast} />
            </Reveal>
          ))}
        </div>
      </div>
      <TgTabBar active="ach" onNav={tabNav} dot={achDot ? "ach" : null} />
    </>
  );
}
