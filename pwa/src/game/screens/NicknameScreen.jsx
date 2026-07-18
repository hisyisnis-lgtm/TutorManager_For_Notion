// 닉네임 설정 — 소셜 로그인 직후 '항상' 표시. 랜덤 닉네임을 자동으로 채우고('다시 뽑기'로 재생성),
// 사용자가 그대로 시작하거나 직접 고쳐 쓸 수 있다. 카카오 닉네임 동의를 안 눌러도 '게스트'로 안 남는다.
// 레이아웃/톤은 LoginScreen과 통일(판다 히어로·헤드라인·CTA). 입력+버튼은 화면 중앙에 모아
// 모바일 키보드가 하단에서 올라와도 CTA를 가리지 않게 한다(하단 고정 안 함).
import { useState } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, ASSETS, RADIUS, SPACE } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { randomNickname, NICKNAME_MAX } from '../nickname.js';
import { Reveal } from './shared.jsx';

export { NICKNAME_MAX };

// defaultName: 제공자(카카오·구글)가 준 닉네임. 있으면 그걸 기본값으로, 없으면 랜덤 자동생성.
export function NicknameScreen({ defaultName = '', onSubmit, saving = false }) {
  const [value, setValue] = useState(() => {
    const provided = (defaultName || '').trim();
    return provided ? provided.slice(0, NICKNAME_MAX) : randomNickname();
  });
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 1 && !saving;
  const reroll = () => { playSfx('button'); setValue(randomNickname()); };
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
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>어떻게 불러드릴까요?</span>
      </Reveal>
      {/* 보조문구 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 302, textAlign: 'center' }}>
        <span style={{ ...TYPE.sub, color: TG.SUB }}>마음에 들면 그대로, 아니면 바꿔도 돼요</span>
      </Reveal>

      {/* 닉네임 입력 + (다시 뽑기 · 글자수) 한 줄 */}
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
            width: '100%', height: 56, borderRadius: RADIUS.lg, border: `1.5px solid ${TG.CORAL_BG}`,
            background: '#fff', padding: '0 18px', ...TYPE.body,
            color: TG.INK, outline: 'none', textAlign: 'center', ...TOUCH_OPT,
          }}
        />
        {/* 좌: 다시 뽑기 / 우: 글자수 — 정해진 높이 한 줄이라 아래 CTA와 겹치지 않음 */}
        <div style={{ marginTop: SPACE.lg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={reroll} className="tg-press" aria-label="닉네임 다시 뽑기" style={{
            display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 14px', borderRadius: RADIUS.md,
            background: '#fff', border: `1.5px solid ${TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT,
          }}>
            <ArrowsClockwiseIcon size={15} weight="bold" color={TG.CORAL_DK} />
            <span style={{ ...TYPE.labelSm, color: TG.INK }}>다시 뽑기</span>
          </button>
          <span style={{ ...TYPE.meta, color: TG.SUB, paddingRight: SPACE.xs }}>{trimmed.length}/{NICKNAME_MAX}</span>
        </div>
      </Reveal>

      {/* 시작하기 — 입력+한줄(입력56+여백10+버튼34≈100) 아래로 띄워 겹침 방지. 키보드에 안 가리게 하단 고정 안 함. */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 462 }}>
        <button onClick={submit} disabled={!canSubmit} className="tg-press" style={{
          width: '100%', height: 56, borderRadius: RADIUS.lg, border: 'none',
          background: canSubmit ? TG.CORAL_DK : TG.BORDER, cursor: canSubmit ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <span style={{ ...TYPE.btn, color: canSubmit ? '#fff' : TG.MUTED }}>
            {saving ? '저장 중…' : '시작하기'}
          </span>
        </button>
      </Reveal>
    </>
  );
}
