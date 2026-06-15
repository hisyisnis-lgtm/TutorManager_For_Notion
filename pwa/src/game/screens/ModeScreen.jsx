// 모드 선택 (난이도 모드 / 무한 모드) — Figma "17. 모드 선택". 잠긴 카드는 흔들림+토스트.
import { CaretLeftIcon, StairsIcon, LightningIcon, LockSimpleIcon, CaretRightIcon, GraduationCapIcon, ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { ShakeButton, Reveal, CoachBubble } from './shared.jsx';

function ModeCard({ Icon, iconColor, tintBg, title, desc, locked, lockText, onClick, onLocked }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', padding: '20px 18px', borderRadius: 22,
      background: locked ? '#f7f3ee' : '#fff', border: '1.5px solid #efeae4', cursor: 'pointer',
      boxShadow: locked ? 'none' : '0px 4px 12px rgba(43,39,48,0.05)', ...TOUCH_OPT,
    }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, flexShrink: 0, background: locked ? '#efeae4' : tintBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={28} weight="fill" color={locked ? '#b8b0a8' : iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0' }}>{desc}</span>
      </div>
      {locked ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <LockSimpleIcon size={22} weight="fill" color="#b8b0a8" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11, color: '#9a93a0', whiteSpace: 'nowrap' }}>{lockText}</span>
        </div>
      ) : <CaretRightIcon size={24} weight="bold" color="#c9c2bb" style={{ flexShrink: 0 }} />}
    </ShakeButton>
  );
}

export function ModeScreen({ endlessUnlocked, reviewCount = 0, onDifficulty, onEndless, onPractice, onReview, onBack, onLocked }) {
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
        <CoachBubble text="오늘은 어떻게 즐겨볼까요?" />
      </Reveal>
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 224 }}>
      {/* 순서: 난이도 → 연습 → 복습 → 무한(잠김 맨 아래). 학습성(연습·복습) 인접, 비활성은 끝 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ModeCard Icon={StairsIcon} iconColor={TG.CORAL_DK} tintBg="rgba(255,107,107,0.14)" title="난이도 모드" desc="초급부터 단계별로 차근차근" onClick={onDifficulty} />
        <ModeCard Icon={GraduationCapIcon} iconColor={TG.SUCCESS_GLOW} tintBg="rgba(54,201,141,0.14)" title="연습 모드" desc="시간 제한 없이 단어 공부" onClick={onPractice} />
        <ModeCard Icon={ArrowsClockwiseIcon} iconColor="#4D8DFF" tintBg="rgba(77,141,255,0.14)" title="복습 모드"
          desc={reviewCount > 0 ? `약한 단어 ${reviewCount}개 복습` : '게임을 하면 약한 단어가 모여요'} onClick={onReview} />
        <ModeCard Icon={LightningIcon} iconColor="#F0A91E" tintBg="rgba(255,194,60,0.16)" title="무한 모드" desc="모든 단어 랜덤 · 점점 빨라지는 도전" locked={!endlessUnlocked} lockText="고급 1,000점" onClick={onEndless} onLocked={() => onLocked && onLocked('고급 1,000점을 달성하면 열려요')} />
      </div>
      </Reveal>
    </>
  );
}
