// 닉네임 변경 모달 — 홈 메뉴 '닉네임 변경'에서 회원이 언제든 닉네임을 바꾼다.
// 입력 + '다시 뽑기'(랜덤) + 저장. 저장 시 세션·서버(game_users.nickname)에 반영(호출부에서 처리).
// 시각 패턴은 SettingsModal과 통일(다크 오버레이 + 카드). 입력 규칙은 NicknameScreen과 동일(≤12자·비어있지 않음).
import { useState } from 'react';
import { ArrowsClockwiseIcon, XIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { randomNickname, NICKNAME_MAX } from '../nickname.js';

export function NicknameEditModal({ current = '', onSave, onClose }) {
  const [value, setValue] = useState(() => (current || '').slice(0, NICKNAME_MAX));
  const trimmed = value.trim();
  const canSave = trimmed.length >= 1;
  const reroll = () => { playSfx('button'); setValue(randomNickname()); };
  const save = () => {
    if (!canSave) return;
    playSfx('button');
    onSave(trimmed);
    onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: 24, padding: '20px 22px 22px',
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 18, color: TG.INK }}>닉네임 변경</span>
          <button onClick={onClose} aria-label="닫기" className="tg-press"
            style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: '#f3efe9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <XIcon size={14} weight="bold" color={TG.SUB} />
            </span>
          </button>
        </div>
        <div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, NICKNAME_MAX))}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            maxLength={NICKNAME_MAX}
            placeholder="닉네임"
            aria-label="닉네임"
            enterKeyHint="done"
            style={{
              width: '100%', height: 52, borderRadius: 14, border: `1.5px solid ${TG.CORAL_BG}`,
              background: '#fff', padding: '0 16px', fontFamily: FONT_BODY, fontSize: 16, fontWeight: 600,
              color: TG.INK, outline: 'none', textAlign: 'center', ...TOUCH_OPT,
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={reroll} className="tg-press" aria-label="닉네임 다시 뽑기" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 11,
              background: '#fff', border: `1.5px solid ${TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT,
            }}>
              <ArrowsClockwiseIcon size={14} weight="bold" color={TG.CORAL_DK} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: TG.INK }}>다시 뽑기</span>
            </button>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: TG.SUB, paddingRight: 4 }}>{trimmed.length}/{NICKNAME_MAX}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="tg-press" style={{
            flex: 1, height: 48, borderRadius: 14, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer',
            fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: TG.SUB, ...TOUCH_OPT,
          }}>취소</button>
          <button onClick={save} disabled={!canSave} className="tg-press" style={{
            flex: 1.4, height: 48, borderRadius: 14, border: 'none',
            background: canSave ? TG.CORAL_DK : '#e7e0d8', cursor: canSave ? 'pointer' : 'default',
            fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: canSave ? '#fff' : '#b8b0a8', ...TOUCH_OPT,
          }}>저장</button>
        </div>
      </div>
    </div>
  );
}
