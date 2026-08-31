// 닉네임 설정 — 소셜 로그인 직후 '항상' 표시. 랜덤 닉네임을 자동으로 채우고('닉네임 뽑기'로 재생성),
// 사용자가 그대로 시작하거나 직접 고쳐 쓸 수 있다. 카카오 닉네임 동의를 안 눌러도 '게스트'로 안 남는다.
// 시안(755:11): 글래스 헤더 + 좌측정렬 2줄 헤드라인 + 입력(342×56)·안내문·'닉네임 뽑기' 칩 + 하단 고정 CTA.
// 입력 묶음은 상단(y182)에 고정 — 모바일 키보드가 올라와도 가려지지 않는다.
import { useState } from 'react';
import { Refresh, CloseCircle } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, FONT_BODY, RADIUS } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { randomNickname, NICKNAME_MAX, NICKNAME_MIN } from '../nickname.js';
import { useKeyboardInset } from '../tgWidgets.jsx';
import { Reveal, GameHeader, KeycapCta } from './shared.jsx';

export { NICKNAME_MAX };

// 시안 색 — 입력·칩의 쿨그레이 라인/라벨(인게임 카드 액션 버튼과 동일 계열)
const FIELD_BORDER = '#E2E7EB', CHIP_ICON = '#637481', CHIP_TEXT = TG.STEEL;

// 입력 한 줄에서 제어문자만 털어내고 상한까지 자른다(설정·변경 화면 공통 규칙).
export const cleanNickname = (raw) => raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, NICKNAME_MAX);

// 닉네임 입력 묶음(입력칸 + 안내문 + 뽑기 칩) — 설정 화면과 변경 모달이 그대로 공유한다.
// chipGap: 안내문↔칩 간격(시안 — 설정 화면 20 · 변경 모달 10).
export function NicknameField({ value, onChange, onSubmit, chipGap = 20 }) {
  const reroll = () => { playSfx('button'); onChange(randomNickname()); };
  // 한 덩어리(block)로 감싼다 — 모달처럼 flex column 안에 놓여도 부모 gap이 내부 간격(6·chipGap)에 끼어들지 않게.
  return (
    <div>
      {/* 입력칸 — 시안 342×56 r12, 좌 17 / 우 10(지우기 28) */}
      <div style={{
        height: 56, background: '#fff', border: `1px solid ${FIELD_BORDER}`, borderRadius: RADIUS.md,
        display: 'flex', alignItems: 'center', padding: '0 10px 0 17px',
      }}>
        <input
          value={value}
          onChange={(e) => onChange(cleanNickname(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit && onSubmit(); }}
          maxLength={NICKNAME_MAX}
          placeholder="닉네임"
          aria-label="닉네임"
          enterKeyHint="done"
          style={{
            flex: 1, minWidth: 0, height: '100%', border: 'none', background: 'none', outline: 'none', padding: 0,
            fontFamily: FONT_BODY, fontWeight: 700, fontSize: 20, color: TG.INK, ...TOUCH_OPT,
          }}
        />
        {/* 지우기 — 아이콘 28은 시안 그대로, 히트영역은 44로 넓힌다(우측 여백 10 유지 위해 -8 보정) */}
        {value.length > 0 && (
          <button onClick={() => onChange('')} aria-label="닉네임 지우기" className="tg-press" style={{
            width: 44, height: 44, marginRight: -8, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT,
          }}>
            <CloseCircle size={28} weight="Bold" color={TG.INK} />
          </button>
        )}
      </div>
      {/* 안내문 — 길이 규칙은 상수에서 그대로 읽어 문구와 검증이 어긋나지 않게 */}
      <span style={{ display: 'block', marginTop: 6, fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, lineHeight: '19px', color: TG.SUB }}>
        {NICKNAME_MIN}자 이상 {NICKNAME_MAX}자 이하로 가능합니다.
      </span>
      <button onClick={reroll} className="tg-press" aria-label="닉네임 다시 뽑기" style={{
        marginTop: chipGap, display: 'flex', width: 'fit-content', alignItems: 'center', gap: 6, padding: '7px 13px',
        borderRadius: RADIUS.md, background: '#fff', border: `1px solid ${FIELD_BORDER}`, cursor: 'pointer', ...TOUCH_OPT,
      }}>
        <Refresh size={17} weight="Bold" color={CHIP_ICON} />
        <span style={{ ...TYPE.label, lineHeight: '19px', color: CHIP_TEXT }}>닉네임 뽑기</span>
      </button>
    </div>
  );
}

// defaultName: 제공자(카카오·구글)가 준 닉네임. 있으면 그걸 기본값으로, 없으면 랜덤 자동생성.
export function NicknameScreen({ defaultName = '', onSubmit, saving = false }) {
  const [value, setValue] = useState(() => {
    const provided = (defaultName || '').trim();
    return provided ? provided.slice(0, NICKNAME_MAX) : randomNickname();
  });
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= NICKNAME_MIN && !saving;
  const kbInset = useKeyboardInset(); // 키보드가 뜨면 그 높이만큼 CTA를 올려 키보드 바로 위에 붙인다
  const submit = () => {
    if (!canSubmit) return;
    playSfx('button');
    onSubmit(trimmed);
  };
  return (
    <>
      <GameHeader title="닉네임 설정" center glass />

      {/* 헤드라인 — 시안 좌측정렬 26/36 2줄(블록 중심 y126) */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, right: 24, top: 90 }}>
        <span style={{ display: 'block', ...TYPE.head, fontSize: 26, lineHeight: '36px', color: TG.INK }}>
          어떻게<br />불러드릴까요?
        </span>
      </Reveal>

      {/* 입력 묶음 — 시안 y182 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 182 }}>
        <NicknameField value={value} onChange={setValue} onSubmit={submit} />
      </Reveal>

      {/* 시작하기 — 하단 고정 키캡 CTA(시안 342×60, 하단 26). 키보드가 뜨면 그 위(간격 12)로 따라 붙는다 */}
      <KeycapCta bg={canSubmit ? TG.CTA : TG.BORDER} color={canSubmit ? '#fff' : TG.MUTED}
        label={saving ? '저장 중…' : '시작하기'} onClick={submit} disabled={!canSubmit}
        style={{
          position: 'absolute', left: 24, right: 24, zIndex: 3, width: 'auto',
          bottom: kbInset > 0 ? kbInset + 12 : 'calc(26px + env(safe-area-inset-bottom))',
          transition: 'bottom .18s ease-out',
          ...(canSubmit ? null : { boxShadow: 'none' }),
        }} />
    </>
  );
}
