// 닉네임 설정 — 소셜 로그인 직후 '항상' 표시. 제공자(카카오·구글)가 준 이름이 있으면 프리필.
// 게임에서 보일 이름을 직접 정하게 해, 카카오 닉네임 동의를 안 눌러도 '게스트'로 남지 않게 한다.
// 레이아웃/톤은 LoginScreen과 통일(판다 히어로·헤드라인·CTA). 입력+버튼은 화면 중앙에 모아
// 모바일 키보드가 하단에서 올라와도 CTA를 가리지 않게 한다(하단 고정 안 함).
import { useState } from 'react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, ASSETS } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal } from './shared.jsx';

export const NICKNAME_MAX = 12; // 서버 검증(worker GameNicknameSchema)과 반드시 동일하게 유지

export function NicknameScreen({ defaultName = '', onSubmit, saving = false }) {
  const [value, setValue] = useState(() => (defaultName || '').slice(0, NICKNAME_MAX));
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 1 && !saving;
  const submit = () => {
    if (!canSubmit) return;
    playSfx('button');
    onSubmit(trimmed);
  };
  return (
    <>
      {/* 판다 히어로 */}
      <Reveal i={0} style={{ position: 'absolute', left: 0, right: 0, top: 104, display: 'flex', justifyContent: 'center' }}>
        <img src={ASSETS.pandaCoach} alt="" width={128} style={{ height: 'auto', filter: 'drop-shadow(0px 6px 14px rgba(43,39,48,0.12))', animation: 'tg-bob 3s ease-in-out infinite' }} />
      </Reveal>

      {/* 헤드라인 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 258, textAlign: 'center' }}>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 24, color: TG.INK }}>어떻게 불러드릴까요?</span>
      </Reveal>
      {/* 보조문구 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 302, textAlign: 'center' }}>
        <span style={{ fontFamily: FONT_BODY, fontSize: 14, color: TG.SUB }}>게임에서 이 이름으로 표시돼요</span>
      </Reveal>

      {/* 닉네임 입력 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 348 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, NICKNAME_MAX))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          maxLength={NICKNAME_MAX}
          placeholder="닉네임"
          aria-label="닉네임"
          enterKeyHint="done"
          style={{
            width: '100%', height: 56, borderRadius: 16, border: `1.5px solid ${TG.CORAL_BG}`,
            background: '#fff', padding: '0 18px', fontFamily: FONT_BODY, fontSize: 16, fontWeight: 600,
            color: TG.INK, outline: 'none', textAlign: 'center', ...TOUCH_OPT,
          }}
        />
        <div style={{ marginTop: 6, paddingRight: 4, textAlign: 'right' }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: TG.SUB }}>{trimmed.length}/{NICKNAME_MAX}</span>
        </div>
      </Reveal>

      {/* 시작하기 — 입력 바로 아래(키보드에 안 가리게 하단 고정 안 함) */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 424 }}>
        <button onClick={submit} disabled={!canSubmit} className="tg-press" style={{
          width: '100%', height: 56, borderRadius: 16, border: 'none',
          background: canSubmit ? TG.CORAL_DK : '#e7e0d8', cursor: canSubmit ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: canSubmit ? '#fff' : '#b8b0a8' }}>
            {saving ? '저장 중…' : '시작하기'}
          </span>
        </button>
      </Reveal>
    </>
  );
}
