// 난이도 선택 화면 (Figma 좌표 절대배치) — 카드 3개 + 잠금 사다리(점수/자물쇠).
import { CaretLeftIcon, StarIcon, CheckCircleIcon, LockSimpleIcon, PlayIcon, LeafIcon, RocketIcon, CrownIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, DUR, DIFF_COLORS } from '../tgTokens.js';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';
import { isDifficultyUnlocked, diffBestScore, unlockReqText, unlockToastText } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble, ShakeButton } from './shared.jsx';

const DIFF_META = {
  easy:   { Icon: LeafIcon,   stars: 1 },
  normal: { Icon: RocketIcon, stars: 2 },
  hard:   { Icon: CrownIcon,  stars: 3 },
};

export function DifficultyScreen({ selected, studentToken, onSelect, onStart, onBack, onLocked }) {
  return (
    <>
      {/* 헤더 top20 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
      <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
        </button>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>난이도 선택</span>
      </div>
      </Reveal>
      {/* 판다 다이얼로그 top120 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="실력에 맞는 단계를 골라보세요" />
      </Reveal>
      {/* 카드 top217 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 217, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {DIFFICULTIES.map((d, idx) => {
          const meta = DIFF_META[d.id];
          const c = DIFF_COLORS[d.id];
          const Icon = meta.Icon;
          const unlocked = isDifficultyUnlocked(studentToken, d.id);
          const best = diffBestScore(studentToken, d.id);
          const on = unlocked && selected.id === d.id;
          return (
            <Reveal key={d.id} i={2 + idx}>
            <ShakeButton shakeOnClick={!unlocked} onClick={() => { if (unlocked) onSelect(d); else onLocked && onLocked(unlockToastText(d.id)); }} className={unlocked ? 'tg-press' : ''} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
              padding: '16px 18px 16px 16px', borderRadius: 24, cursor: 'pointer',
              background: unlocked ? '#fff' : '#f7f3ee',
              border: on ? `2.5px solid ${c.accent}` : '1.5px solid #efeae4',
              boxShadow: on ? `0px 8px 20px ${c.glow}` : (unlocked ? '0px 4px 12px rgba(43,39,48,0.05)' : 'none'),
              transition: `transform .26s cubic-bezier(0.34,1.56,0.64,1), box-shadow ${DUR.state} ease, border-color ${DUR.state} ease`, ...TOUCH_OPT,
            }}>
              <div style={{ width: 54, height: 54, borderRadius: 18, flexShrink: 0, background: unlocked ? c.tint : '#efeae4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={26} weight="fill" color={unlocked ? c.accent : '#b8b0a8'} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: unlocked ? '#2b2730' : '#9a93a0' }}>{d.label}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1, 2, 3].map((s) => <StarIcon key={s} size={14} weight="fill" color={s <= meta.stars ? (unlocked ? TG.SUN : '#d8d2ca') : '#E5DED5'} />)}
                  </div>
                </div>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0' }}>{unlocked ? d.desc : unlockReqText(d.id)}</span>
                {unlocked && (
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: '#9a93a0' }}>
                    {best > 0 ? <>최고 <b style={{ color: '#2b2730', fontWeight: 800 }}>{best.toLocaleString()}</b>점</> : '아직 기록 없음'}
                  </span>
                )}
              </div>
              {unlocked
                ? (on
                  ? <CheckCircleIcon size={34} weight="fill" color={c.accent} />
                  : <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><div style={{ width: 28, height: 28, borderRadius: 999, border: '2px solid #DDD5CB' }} /></div>)
                : <LockSimpleIcon size={26} weight="fill" color="#b8b0a8" style={{ flexShrink: 0 }} />}
            </ShakeButton>
            </Reveal>
          );
        })}
      </div>
      {/* CTA 하단 고정 (Figma top712 → bottom 70) */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { playSfx('button'); onStart(selected); }} className="tg-press" style={{
        width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
      }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{selected.label}으로 시작</span>
        <PlayIcon size={13} weight="fill" color="#fff" />
      </button>
      </Reveal>
    </>
  );
}
