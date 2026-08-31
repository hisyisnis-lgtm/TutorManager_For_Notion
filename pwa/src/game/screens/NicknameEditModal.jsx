// 닉네임 변경 모달 — 홈 메뉴 '닉네임 변경'에서 회원이 언제든 닉네임을 바꾼다.
// 입력 + '닉네임 뽑기'(랜덤) + 저장. 저장 시 세션·서버(game_users.nickname)에 반영(호출부에서 처리).
// 시안(755:24): 흰 카드 320 r24·패딩 28/22/22(내용 276) — 제목 / 입력 묶음 / [취소][저장] 키캡 2버튼.
// 입력 규칙·모양은 NicknameScreen과 완전히 공유(NicknameField).
import { useState } from 'react';
import { TG, TYPE, TOUCH_OPT, RADIUS } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { NICKNAME_MIN } from '../nickname.js';
import { useKeyboardInset } from '../tgWidgets.jsx';
import { NicknameField, cleanNickname } from './NicknameScreen.jsx';
import { KeycapCta } from './shared.jsx';

export function NicknameEditModal({ current = '', onSave, onClose }) {
  const [value, setValue] = useState(() => cleanNickname(current || ''));
  const trimmed = value.trim();
  const canSave = trimmed.length >= NICKNAME_MIN;
  const kbInset = useKeyboardInset(); // 키보드가 뜨면 딤 영역을 그 위로 줄여 카드가 '보이는 영역' 안에서 가운데 오게
  const save = () => {
    if (!canSave) return;
    playSfx('button');
    onSave(trimmed);
    onClose();
  };
  // 딤은 화면 전체를 덮은 채, 키보드 높이만큼 아래 패딩을 줘서 카드가 '키보드 위 영역'의 가운데로 온다.
  //  (딤 자체를 줄이면 키보드 슬라이드 중 아래쪽이 잠깐 안 덮인다.) 남은 높이보다 카드가 크면 스크롤.
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', transition: 'padding-bottom .18s ease-out',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto',
      padding: 24, paddingBottom: kbInset + 24, ...TOUCH_OPT,
    }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '28px 22px 22px',
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: 30,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ ...TYPE.head, fontSize: 18, lineHeight: '28px', color: TG.INK }}>닉네임 변경</span>
          {/* 안내문↔칩 간격은 시안대로 10(설정 화면은 20) */}
          <NicknameField value={value} onChange={setValue} onSubmit={save} chipGap={10} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <KeycapCta bg="#fff" edge={TG.KEY_EDGE} color={TG.STEEL} label="취소" onClick={onClose} style={{ flex: 1, minWidth: 0 }} />
          <KeycapCta bg={canSave ? TG.CTA : TG.BORDER} color={canSave ? '#fff' : TG.MUTED} label="저장"
            onClick={save} disabled={!canSave} style={{ flex: 1, minWidth: 0, ...(canSave ? null : { boxShadow: 'none' }) }} />
        </div>
      </div>
    </div>
  );
}
