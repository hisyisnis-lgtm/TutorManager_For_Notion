// 테마 선택 화면 — 난이도와 별개 축. 테마별 포스터 카드를 가로 스냅스크롤로 보여줌(항상 중앙 스냅, 양옆 카드 살짝 걸침).
// Figma "23. 테마 선택" 기준. 잠긴 테마는 흔들림+토스트(ShakeButton/onLocked), 해제조건은 자물쇠 아래 표기.
// 참조 메모리: tone_game_redesign.md (테마 모드)
import { useState } from 'react';
import { CaretLeftIcon, LockSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, DUR } from '../tgTokens.js';
import { isThemeUnlocked, themeBestScore, themeUnlockReqText, themeUnlockToastText } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble, ShakeButton } from './shared.jsx';

const CARD_W = 280, CARD_H = 392, GAP = 16;
// 스크롤 컨테이너 세로 패딩 — overflowY:hidden(가로 스크롤 강제)이 카드 그림자를 자르지 않게 여유 확보.
const PAD_TOP = 12, PAD_BOTTOM = 22;

// 포스터형 테마 카드 — (클립 레이어: 이미지/틴트 + 스크림 + 잠금딤) + 자물쇠·제목·시작버튼
function ThemeCard({ theme, unlocked, best, count }) {
  return (
    <>
      {/* 클립 레이어 — 이미지·그라디언트를 카드 둥근모서리 '안'에 가둠 */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden' }}>
        {theme.image
          ? <img src={theme.image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : (unlocked && ( // 오픈만 플레이스홀더 라벨(잠금은 자물쇠와 겹쳐 숨김)
            <span style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, lineHeight: 1.5, color: 'rgba(43,39,48,0.3)' }}>
              {theme.placeholder || '이미지'}<br />(준비 중)
            </span>
          ))}
        {!unlocked && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 160, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 100%)', pointerEvents: 'none' }} />
      </div>

      {/* 잠금 — 자물쇠 + 그 아래 해제조건(중앙) */}
      {!unlocked && (
        <div style={{ position: 'absolute', left: 18, right: 18, top: 138, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 54, height: 54, borderRadius: 27, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LockSimpleIcon size={27} weight="fill" color="#fff" />
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, lineHeight: 1.45, color: '#fff', textAlign: 'center', maxWidth: 210 }}>{themeUnlockReqText(theme)}</span>
        </div>
      )}

      {/* 제목 + 메타(오픈만) — 시작버튼 영역 피해 right 74 */}
      <div style={{ position: 'absolute', left: 18, right: unlocked ? 74 : 18, bottom: 22, textAlign: 'left' }}>
        <div style={{ fontFamily: FONT_TITLE, fontSize: 26, color: '#fff', opacity: unlocked ? 1 : 0.92, lineHeight: 1.1 }}>{theme.label}</div>
        {unlocked && (
          <div style={{ marginTop: 6, fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#fff', opacity: 0.9 }}>
            {best > 0 ? `최고 ${best.toLocaleString()}점 · ${count}단어` : `${count}단어`}
          </div>
        )}
      </div>

      {/* 시작 버튼(오픈만) */}
      {unlocked && (
        <div style={{ position: 'absolute', right: 18, bottom: 26, width: 46, height: 46, borderRadius: 23, background: TG.CORAL_DK, boxShadow: '0 5px 12px rgba(242,72,76,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PlayIcon size={18} weight="fill" color="#fff" />
        </div>
      )}
    </>
  );
}

export function ThemeScreen({ themes, studentToken, counts = {}, onStart, onBack, onLocked }) {
  const [active, setActive] = useState(0);
  const onScroll = (e) => {
    const i = Math.round(e.currentTarget.scrollLeft / (CARD_W + GAP));
    setActive(Math.max(0, Math.min(themes.length - 1, i)));
  };
  // 항상 중앙 스냅 — 좌우 패딩을 (컨테이너폭-카드폭)/2 로 줘서 첫·끝 카드도 가운데에 오게.
  const sidePad = `max(24px, calc((100% - ${CARD_W}px) / 2))`;
  return (
    <>
      {/* 헤더 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>테마 선택</span>
        </div>
      </Reveal>
      {/* 코치+카드+닷/힌트 = 헤더 아래 공간에 세로 중앙정렬. 단 중앙정렬 영역을 모바일 높이(≤680)로 캡 —
          모바일은 화면이 꽉 차 중앙정렬로 균형, 웹처럼 긴 화면은 상단 영역에 안정적으로 앉고 아래만 여백(가운데 붕 뜨는 것 방지). */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 72, height: 'min(calc(100% - 72px), 680px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
        {/* 코치 말풍선 */}
        <Reveal i={1} style={{ paddingLeft: 24, paddingRight: 24 }}>
          <CoachBubble text="어떤 테마로 즐겨볼까요?" />
        </Reveal>
        {/* 카드 가로 스냅스크롤 (항상 중앙 스냅 · 양옆 peek) */}
        <div onScroll={onScroll} className="tg-noscroll" style={{
          display: 'flex', gap: GAP, flexShrink: 0,
          paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, paddingLeft: sidePad, paddingRight: sidePad,
          overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {themes.map((t) => {
            const unlocked = isThemeUnlocked(studentToken, t);
            return (
              <ShakeButton key={t.id} shakeOnClick={!unlocked}
                onClick={() => { if (unlocked) { playSfx('button'); onStart(t); } else if (onLocked) onLocked(themeUnlockToastText(t)); }}
                className={unlocked ? 'tg-press' : ''}
                style={{
                  flex: `0 0 ${CARD_W}px`, width: CARD_W, height: CARD_H, scrollSnapAlign: 'center',
                  position: 'relative', borderRadius: 24, overflow: 'hidden', padding: 0, border: 'none',
                  cursor: 'pointer', background: t.tint || '#eee', boxShadow: '0 5px 14px rgba(43,39,48,0.10)', ...TOUCH_OPT,
                }}>
                <ThemeCard theme={t} unlocked={unlocked} best={themeBestScore(studentToken, t.gameKey)} count={counts[t.id] || 0} />
              </ShakeButton>
            );
          })}
        </div>
        {/* 페이지 닷 + 스크롤 힌트 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {themes.map((t, i) => (
              <div key={t.id} style={{ width: i === active ? 20 : 6, height: 6, borderRadius: 3, background: i === active ? TG.CORAL_DK : '#d8d2ca', transition: `all ${DUR.state} ease` }} />
            ))}
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: TG.SUB }}>옆으로 넘겨 테마를 골라보세요</span>
        </div>
      </div>
    </>
  );
}
