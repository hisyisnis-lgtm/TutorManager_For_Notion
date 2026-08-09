// 일시정지 모달 — 시안 461:46(2026-08-06 편집본): 딤 검정 80% + 카드 330 r24, 4묶음(간격 16)
//  ① 아이콘 50 + 제목 ② 점수/콤보 통계 박스 ③ 설정 토글 5개 ④ 키캡 버튼(계속하기 + [홈으로|다시하기]).
//  ⚙ 별도 설정 모달을 없애고(시안), 소리·음악·햅틱·단어 뜻·병음을 이 모달 안에서 바로 조절한다.
import { useState } from 'react';
import { Pause, Play, VolumeLoud, VolumeCross, MusicNotes, MusicNote, SmartphoneVibration, Notebook, TextField } from '@solar-icons/react';
import { TG, TYPE, RADIUS, TOUCH_OPT, SPACE, haptic, isHapticMuted, setHapticMuted, isMeaningHidden, setMeaningHidden, isPinyinHidden, setPinyinHidden } from '../tgTokens.js';
import { play as playSfx, isSfxMuted, setSfxMuted } from '../tgSfx.js';
import { isBgmMuted, setBgmMuted } from '../tgBgm.js';
import { MenuToggle } from './shared.jsx';

const CTA_RED = '#F96163', CTA_RED_EDGE = '#E64244';
const SUB_BTN_TEXT = '#7E8A94', SUB_BTN_EDGE = '#E4EDF5';
const STAT_BG = '#F7F6F5';
const KEYCAP = {
  height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', paddingBottom: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
};

export function PauseModal({ score, combo, crutchCtx, onResume, onRestart, onQuit }) {
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  const [bgmOn, setBgmOn] = useState(() => !isBgmMuted());
  const [hapticOn, setHapticOn] = useState(() => !isHapticMuted());
  // 뜻·병음은 **현재 모드 컨텍스트**(스테이지·보스·무한·트레이닝·테마)에 저장 — 인게임 단어카드가 읽는 값과 같아야 즉시 반영된다.
  const [meaningOn, setMeaningOn] = useState(() => !isMeaningHidden(crutchCtx));
  const [pinyinOn, setPinyinOn] = useState(() => !isPinyinHidden(crutchCtx));
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4,
    }}>
      <div className="tg-enter" style={{
        width: '100%', maxWidth: 330, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '28px 22px 22px',
        boxShadow: '0px 4px 18px rgba(43,39,48,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2,
      }}>
        {/* 아이콘 + 제목 (간격 10) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.lg }}>
          <Pause size={50} weight="Bold" color={TG.CORAL_DK} />
          {/* 라인하이트는 시안 텍스트 박스 그대로(29) — 기본 라인박스를 쓰면 카드가 8px 늘어난다 */}
          <span style={{ ...TYPE.head, fontSize: 24, lineHeight: '29px', color: TG.INK }}>잠깐 멈췄어요</span>
        </div>
        {/* 통계 — 점수 | 콤보 */}
        <div style={{ width: '100%', display: 'flex', background: STAT_BG, borderRadius: RADIUS.lg, padding: '14px 0' }}>
          {[['점수', score], ['콤보', combo]].map(([label, val], i) => (
            <div key={label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs, borderLeft: i ? '1px solid rgba(43,39,48,0.08)' : 'none' }}>
              <span style={{ ...TYPE.body, fontWeight: 400, fontSize: 14, lineHeight: '17px', color: TG.INK }}>{label}</span>
              <span style={{ ...TYPE.numLg, fontWeight: 900, fontSize: 26, lineHeight: '30px', color: TG.INK }}>{val}</span>
            </div>
          ))}
        </div>
        {/* 설정 토글 — 홈 메뉴와 같은 행 규격(공용 MenuToggle), 행 간격 6 */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <MenuToggle Icon={sfxOn ? VolumeLoud : VolumeCross} label="소리" on={sfxOn}
            onToggle={() => { const n = !sfxOn; setSfxOn(n); setSfxMuted(!n); if (n) playSfx('button'); }} />
          {/* 음악은 게임 중 정지 상태 — 여기선 설정만 저장하고 재생하지 않는다(홈으로 나가면 그때 재생) */}
          <MenuToggle Icon={bgmOn ? MusicNotes : MusicNote} label="음악" on={bgmOn}
            onToggle={() => { const n = !bgmOn; setBgmOn(n); setBgmMuted(!n); }} />
          <MenuToggle Icon={SmartphoneVibration} label="햅틱" on={hapticOn}
            onToggle={() => { const n = !hapticOn; setHapticOn(n); setHapticMuted(!n); if (n) haptic(20); }} />
          <MenuToggle Icon={Notebook} label="단어 뜻" on={meaningOn}
            onToggle={() => { const n = !meaningOn; setMeaningOn(n); setMeaningHidden(crutchCtx, !n); }} />
          <MenuToggle Icon={TextField} label="병음" on={pinyinOn}
            onToggle={() => { const n = !pinyinOn; setPinyinOn(n); setPinyinHidden(crutchCtx, !n); }} />
        </div>
        {/* 버튼 — 계속하기(주) + [홈으로 | 다시하기] */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
          <button className="tg-press" onClick={onResume} style={{
            ...KEYCAP, width: '100%', background: CTA_RED,
            boxShadow: `0px 4px 18px rgba(43,39,48,0.07), inset 0 -4px 0 ${CTA_RED_EDGE}`,
          }}>
            <span style={{ ...TYPE.head, color: '#fff' }}>계속하기</span>
            <Play size={18} weight="Bold" color="#fff" />
          </button>
          <div style={{ display: 'flex', gap: SPACE.lg }}>
            {[['홈으로', onQuit], ['다시하기', onRestart]].map(([label, fn]) => (
              <button key={label} className="tg-press" onClick={fn} style={{
                ...KEYCAP, flex: 1, minWidth: 0, background: '#fff',
                boxShadow: `0px 4px 18px rgba(43,39,48,0.07), inset 0 -4px 0 ${SUB_BTN_EDGE}`,
              }}>
                <span style={{ ...TYPE.head, color: SUB_BTN_TEXT }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
