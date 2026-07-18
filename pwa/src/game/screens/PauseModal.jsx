// 일시정지 모달 — 계속하기 / 처음부터 / 그만두기 (+ 우상단 설정).
import { useState } from 'react';
import { PauseIcon, PlayIcon, ArrowClockwiseIcon, SignOutIcon, GearSixIcon } from '@phosphor-icons/react';
import { TG, TYPE, RADIUS, SHADOW, TOUCH_OPT, SPACE } from '../tgTokens.js';
import { SettingsModal } from './shared.jsx';

export function PauseModal({ score, combo, onResume, onRestart, onQuit }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(43,39,48,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, backdropFilter: 'blur(2px)',
    }}>
      <div className="tg-enter" style={{
        position: 'relative', width: '100%', maxWidth: 342, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '28px 22px 22px',
        boxShadow: '0 20px 60px rgba(43,39,48,0.3)', textAlign: 'center',
      }}>
        {/* 설정 ⚙️ — 카드 우상단 */}
        <button onClick={() => setSettingsOpen(true)} aria-label="설정" className="tg-press"
          style={{ position: 'absolute', right: 16, top: 16, width: 34, height: 34, borderRadius: RADIUS.lg, border: 'none', background: TG.SURFACE, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
          <GearSixIcon size={18} weight="fill" color={TG.SUB} />
        </button>
        <div style={{ width: 56, height: 56, borderRadius: RADIUS.pill, background: TG.CORAL_BG, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PauseIcon size={26} weight="fill" color={TG.CORAL_DK} />
        </div>
        <div style={{ ...TYPE.titleLg, color: TG.INK, marginBottom: SPACE.xs }}>잠깐 멈췄어요</div>
        <div style={{ ...TYPE.sub, color: TG.SUB, marginBottom: SPACE.x3 }}>이어서 도전할까요?</div>
        <div style={{ display: 'flex', background: '#FFF7E9', borderRadius: RADIUS.lg, padding: '14px 0', marginBottom: SPACE.x3 }}>
          {[['점수', score], ['콤보', combo]].map(([label, val], i) => (
            <div key={label} style={{ flex: 1, borderLeft: i ? '1px solid rgba(43,39,48,0.08)' : 'none' }}>
              <div style={{ ...TYPE.meta, color: TG.SUB, marginBottom: SPACE.xs }}>{label}</div>
              <div style={{ ...TYPE.numMd, color: TG.INK }}>{val}</div>
            </div>
          ))}
        </div>
        <button className="tg-press" onClick={onResume} style={{
          width: '100%', height: 52, border: 'none', borderRadius: RADIUS.btn, cursor: 'pointer', background: TG.CORAL_GRAD,
          color: '#fff', ...TYPE.btn, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: SPACE.md, boxShadow: SHADOW.btn, marginBottom: SPACE.lg, ...TOUCH_OPT,
        }}><PlayIcon size={18} weight="fill" /> 계속하기</button>
        <button className="tg-press" onClick={onRestart} style={{
          width: '100%', height: 50, borderRadius: RADIUS.btn, cursor: 'pointer', background: TG.CARD,
          border: '1.5px solid rgba(43,39,48,0.1)', color: TG.INK, ...TYPE.btnSm,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, marginBottom: SPACE.md, ...TOUCH_OPT,
        }}><ArrowClockwiseIcon size={17} weight="bold" /> 처음부터</button>
        <button className="tg-press" onClick={onQuit} style={{
          width: '100%', height: 40, background: 'none', border: 'none', cursor: 'pointer', color: TG.SUB,
          ...TYPE.sub, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, ...TOUCH_OPT,
        }}><SignOutIcon size={16} weight="bold" /> 그만두기</button>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
