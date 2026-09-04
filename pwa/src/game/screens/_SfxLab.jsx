// [임시·DEV 검수용] 효과음/배경음 랩 — 미리보기 URL `?screen=sfxlab` 로 진입.
// 버튼으로 각 SFX를 눌러 들어보고, 콤보 피치 래더·BGM 재생/정지도 확인한다.
// 이 랩에선 소리/음악 음소거를 자동 해제(꺼둔 상태여도 들리게). 검수 끝나면 이 파일 + ToneGamePage의 'sfxlab' 분기 삭제.
import { useEffect } from 'react';
import { FONT_TITLE, FONT_BODY, TG, TOUCH_OPT } from '../tgTokens.js';
import { AltArrowLeft, MusicNotes, Stop } from '@solar-icons/react';
import { ToneGameStyles } from './shared.jsx';
import { play as playSfx, setSfxMuted, isSfxMuted } from '../tgSfx.js';
import { startBgm, stopBgm, setBgmMuted, isBgmMuted } from '../tgBgm.js';

// [키, 라벨, 설명, 액센트색]
const GROUPS = [
  ['진행 / UI', TG.INK, [
    ['tap', '탭', '부분정답 진행'],
    ['button', '버튼', 'UI 클릭'],
    ['count', '카운트', '카운트다운 틱'],
    ['go', '시작', '상승 3음 + 악센트'],
  ]],
  ['정답 피드백', TG.SUCCESS, [
    ['correct', '정답', '2음 상승 벨'],
    ['combo', '콤보', '스냅 2음 (피치↑)'],
    ['score', '점수', '코인 딩딩'],
    ['wrong', '오답', '부드러운 하강 버즈'],
  ]],
  ['성조 목소리 (캐릭터 말하기)', '#8B5CF6', [
    ['tone1', '1성', '높고 평탄'],
    ['tone2', '2성', '상승'],
    ['tone3', '3성', '내렸다 올림'],
    ['tone4', '4성', '하강'],
    ['tone0', '경성', '짧고 가볍게'],
  ]],
  ['결과 / 이벤트', TG.CORAL_DK, [
    ['win', '신기록', '팡파르 아르페지오'],
    ['unlock', '잠금해제', '5음계 반짝'],
    ['gameover', '게임오버', '잔잔한 마무리 화음'],
    ['timeout', '시간초과', '아래로 슬라이드'],
    ['locked', '잠금거절', '"부-부"'],
    ['whoosh', '전환', '휘익 노이즈'],
  ]],
];

function SfxButton({ sfxKey, label, desc, accent, onPlay }) {
  return (
    <button onClick={() => onPlay(sfxKey)} className="tg-press" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
      padding: '12px 14px', minHeight: 60, borderRadius: 14, cursor: 'pointer',
      background: TG.CARD, border: `1.5px solid ${TG.LINE}`, textAlign: 'left',
      boxShadow: '0 2px 6px rgba(43,39,48,0.06)', ...TOUCH_OPT,
    }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15, color: accent }}>{label}</span>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: TG.SUB }}>{desc}</span>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 10, color: '#C9C2BB', marginTop: 1 }}>{sfxKey}</span>
    </button>
  );
}

export function SfxLab({ onBack }) {
  // 랩 진입 시 소리/음악 음소거 해제(꺼둔 상태여도 들리게). 나갈 때 BGM 정지 + 사용자 음소거 설정 원복.
  useEffect(() => {
    const wasSfxMuted = isSfxMuted(); const wasBgmMuted = isBgmMuted(); // 진입 전 설정 캡처
    setSfxMuted(false); setBgmMuted(false);
    return () => { stopBgm(); setSfxMuted(wasSfxMuted); setBgmMuted(wasBgmMuted); };
  }, []);

  const onPlay = (key) => playSfx(key);
  // 콤보 피치 래더 — 콤보 2~10을 순차 재생(게임과 동일하게 음정이 반음씩 상승).
  const playComboLadder = () => {
    for (let combo = 2; combo <= 10; combo++) {
      const rate = Math.pow(2, Math.min(combo - 1, 12) / 12);
      setTimeout(() => playSfx('combo', undefined, rate), (combo - 2) * 170);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: TG.BG, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <ToneGameStyles />
      {/* 헤더 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: TG.BG, padding: '18px 20px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${TG.LINE}` }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: TG.CARD, border: `1.5px solid ${TG.LINE}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <AltArrowLeft size={20} weight="Bold" color={TG.INK} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 19, color: TG.INK }}>효과음 검수 (임시)</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: TG.SUB }}>버튼을 눌러 들어보세요 · 소리/음악 자동 ON</span>
        </div>
      </div>

      <div style={{ padding: '16px 20px calc(40px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* SFX 그룹 */}
        {GROUPS.map(([title, accent, items]) => (
          <div key={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13, color: accent, letterSpacing: 0.2 }}>{title}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {items.map(([key, label, desc]) => (
                <SfxButton key={key} sfxKey={key} label={label} desc={desc} accent={accent} onPlay={onPlay} />
              ))}
            </div>
          </div>
        ))}

        {/* 콤보 래더 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13, color: TG.SUN }}>콤보 피치 래더</span>
          <button onClick={playComboLadder} className="tg-press" style={{
            padding: '14px', borderRadius: 14, cursor: 'pointer', border: 'none',
            background: TG.CORAL_GRAD, color: '#fff', fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15,
            boxShadow: '0 6px 16px rgba(242,72,76,0.3)', ...TOUCH_OPT,
          }}>▶ 콤보 2 → 10 연속 재생 (음정 상승)</button>
        </div>

        {/* BGM */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13, color: TG.INK }}>배경음 (BGM)</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => startBgm()} className="tg-press" style={{
              flex: 1, padding: '14px', borderRadius: 14, cursor: 'pointer', border: `1.5px solid ${TG.LINE}`,
              background: TG.CARD, color: TG.INK, fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
            }}><MusicNotes size={18} weight="Bold" color={TG.SUCCESS} />재생</button>
            <button onClick={() => stopBgm()} className="tg-press" style={{
              flex: 1, padding: '14px', borderRadius: 14, cursor: 'pointer', border: `1.5px solid ${TG.LINE}`,
              background: TG.CARD, color: TG.INK, fontFamily: FONT_BODY, fontWeight: 800, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
            }}><Stop size={18} weight="Bold" color={TG.CORAL_DK} />정지</button>
          </div>
        </div>
      </div>
    </div>
  );
}
