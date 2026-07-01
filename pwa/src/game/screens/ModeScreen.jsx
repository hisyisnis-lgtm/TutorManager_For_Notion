// 모드 선택 — 중요도 2단. 주력 큰 카드(난이도·테마) + 보조 칩(무한·연습·복습).
// Figma "26. 모드 선택 v2". 잠긴 카드(무한)는 흔들림+토스트.
import { CaretLeftIcon, CaretRightIcon, StairsIcon, LightningIcon, LockSimpleIcon, GraduationCapIcon, ArrowsClockwiseIcon, CardsThreeIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { ShakeButton, Reveal, CoachBubble } from './shared.jsx';

// 주력 큰 카드 — 아이콘 박스 + 제목 + 설명 (세로). locked면 회색+자물쇠 배지+해제조건.
function BigTile({ Icon, iconColor, tintBg, title, desc, locked, lockText, onClick, onLocked }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} style={{
      flex: 1, minWidth: 0, height: 150, background: locked ? '#f7f3ee' : '#fff', border: '1.5px solid #efeae4', borderRadius: 22, cursor: 'pointer',
      boxShadow: locked ? 'none' : '0px 4px 12px rgba(43,39,48,0.05)', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', ...TOUCH_OPT,
    }}>
      <div style={{ position: 'relative', width: 56, height: 56, borderRadius: 18, background: locked ? '#efeae4' : tintBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'auto' }}>
        <Icon size={28} weight="fill" color={locked ? '#b8b0a8' : iconColor} />
        {locked && (
          <div style={{ position: 'absolute', right: -5, bottom: -5, width: 22, height: 22, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.14)' }}>
            <LockSimpleIcon size={13} weight="fill" color="#9a93a0" />
          </div>
        )}
      </div>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0', marginTop: 4 }}>{locked ? lockText : desc}</span>
    </ShakeButton>
  );
}

// 피처 카드 — 메인 모드를 풀폭으로 강조(accent 색 범용). locked면 회색+자물쇠+조건.
function FeatureCard({ Icon, accent, tint, border, title, desc, locked, lockText, onClick, onLocked }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} style={{
      width: '100%', height: 80, display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '0 18px', borderRadius: 20, cursor: 'pointer',
      background: locked ? '#f3eee7' : tint, border: `1.5px solid ${locked ? '#efeae4' : border}`,
      boxShadow: locked ? 'none' : `0px 5px 14px ${accent}22`, ...TOUCH_OPT,
    }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, flexShrink: 0, background: locked ? '#e7e0d6' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: locked ? 'none' : `0 2px 6px ${accent}33` }}>
        <Icon size={28} weight="fill" color={locked ? '#b8b0a8' : accent} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0' }}>{desc}</span>
      </div>
      {locked ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <LockSimpleIcon size={20} weight="fill" color="#b8b0a8" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10.5, color: '#9a93a0', whiteSpace: 'nowrap' }}>{lockText}</span>
        </div>
      ) : <CaretRightIcon size={22} weight="bold" color={accent} style={{ flexShrink: 0, opacity: 0.55 }} />}
    </ShakeButton>
  );
}

// 보조 칩 — 가로 플랫 칩(아이콘+라벨). 주력보다 가볍게(위계). locked면 회색+자물쇠.
function ModeChip({ Icon, iconColor, label, locked, onClick, onLocked }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} style={{
      flex: 1, minWidth: 0, height: 56, background: locked ? '#f3eee7' : '#fff', border: '1.5px solid #efeae4', borderRadius: 16, cursor: 'pointer',
      boxShadow: locked ? 'none' : '0px 3px 9px rgba(43,39,48,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
    }}>
      <Icon size={22} weight="fill" color={locked ? '#b8b0a8' : iconColor} />
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14.5, color: locked ? '#9a93a0' : '#2b2730' }}>{label}</span>
      {locked && <LockSimpleIcon size={13} weight="fill" color="#b8b0a8" style={{ marginLeft: -2 }} />}
    </ShakeButton>
  );
}

export function ModeScreen({ endlessUnlocked, reviewCount = 0, onDifficulty, onTheme, onEndless, onPractice, onReview, onBack, onLocked }) {
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>모드 선택</span>
        </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="무엇으로 플레이할까요?" />
      </Reveal>
      {/* 주력 큰 카드 2 — 난이도 · 무한 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 224 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <BigTile Icon={StairsIcon} iconColor={TG.CORAL_DK} tintBg="rgba(255,107,107,0.14)" title="난이도 모드" desc="초급부터 차근차근" onClick={onDifficulty} />
          <BigTile Icon={LightningIcon} iconColor="#F0A91E" tintBg="rgba(255,194,60,0.16)" title="무한 모드" desc="점점 빨라지는 도전"
            locked={!endlessUnlocked} lockText="고급 1,000점 달성 시" onClick={onEndless} onLocked={() => onLocked && onLocked('고급 1,000점을 달성하면 열려요')} />
        </div>
      </Reveal>
      {/* 메인 콘텐츠 — 테마(피처 카드, 풀폭·보라 강조) */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 390 }}>
        <FeatureCard Icon={CardsThreeIcon} accent="#7c5cff" tint="rgba(124,92,255,0.10)" border="rgba(124,92,255,0.28)"
          title="테마 모드" desc="드라마·여행 · 취향대로 골라 플레이" onClick={onTheme} />
      </Reveal>
      {/* 학습 보조 칩 2 — 연습·복습 */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 488 }}>
        <div style={{ display: 'flex', gap: 9 }}>
          <ModeChip Icon={GraduationCapIcon} iconColor={TG.SUCCESS_GLOW} label="연습" onClick={onPractice} />
          <ModeChip Icon={ArrowsClockwiseIcon} iconColor="#4D8DFF" label="복습" onClick={onReview} />
        </div>
      </Reveal>
    </>
  );
}
