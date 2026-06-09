// 튜토리얼 화면 (게임 레이아웃 + 가이드, Figma 좌표) — 妈妈 1단어 연습 + 딤 스포트라이트.
import { useState, useRef } from 'react';
import { StarIcon, PauseIcon, TimerIcon } from '@phosphor-icons/react';
import { TG, FONT_NUM, FONT_BODY, TOUCH_OPT, TONE_TINTS, TONE_BORDERS, haptic } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { WordCard, CoachBubble, Reveal } from './shared.jsx';

export function TutorialScreen({ onDone }) {
  const word = { hanzi: '妈妈', pinyin: ['mā', 'ma'], tones: [1, 0], meaning: '엄마' };
  const [entered, setEntered] = useState([]);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [wrong, setWrong] = useState(null);
  const doneRef = useRef(false);
  const answer = word.tones[currentSyl];

  const tap = (n) => {
    if (completed) return;
    if (n === answer) {
      const ne = [...entered, n];
      setEntered(ne);
      haptic([10, 20, 30]);
      if (ne.length === word.tones.length) {
        setCompleted(true);
        playSfx('correct'); speakWord(word); // 완성 — 정답음 + 올바른 발음 재생(인게임과 동일)
        if (!doneRef.current) { doneRef.current = true; setTimeout(onDone, 1500); }
      } else { playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      setWrong(n); haptic(20); playSfx('wrong');
      setTimeout(() => setWrong(null), 450);
    }
  };

  return (
    <>
      {/* 점수(정적) 상단 중앙 */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20, display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '9px 14px', borderRadius: 15, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 17, color: '#2b2730' }}>0</span>
      </div>
      {/* 일시정지(정적) 우상단 */}
      <div style={{ position: 'absolute', right: 20, top: 23, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
        <PauseIcon size={20} weight="fill" color={TG.SUB} />
      </div>
      {/* 타이머(정적) top69 */}
      <div style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, background: '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0px 3px 4.5px rgba(255,94,98,0.45)' }}>
          <TimerIcon size={20} weight="fill" color="#fff" />
        </div>
        <div style={{ flex: 1, height: 12, borderRadius: 6, background: '#f0ebe4' }} />
      </div>
      {/* 연습 태그 top70 (중앙) */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 70, background: '#fff1f1', padding: '8px 14px', borderRadius: 14 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#f2484c', whiteSpace: 'nowrap' }}>연습 모드 · 한 번 해볼까요?</span>
      </div>
      {/* 딤 오버레이 — 강조(카드·정답버튼·코치) 외 어둡게. 완료 시 사라짐 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(43,39,48,0.5)', opacity: completed ? 0 : 1, transition: 'opacity .35s ease', pointerEvents: 'none' }} />
      {/* 카드 top129 (폭 채움) — 스포트라이트 */}
      <Reveal i={0} style={{ position: 'absolute', left: 20, right: 20, top: 129, zIndex: 6 }}>
        <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={false} progressText="1/1" combo={0} comboFlash={false} floatScore={null} hideProgress />
      </Reveal>
      {/* 코치 top470 — 스포트라이트 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 470, zIndex: 6 }}>
        <CoachBubble text={completed ? '잘했어요! 이제 시작해요' : '성조를 찾아볼까요?'} />
      </Reveal>
      {/* 성조버튼 하단 고정 (정답 강조 + 나머지 흐림) — 스포트라이트 */}
      <Reveal i={2} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 6 }}>
      <div style={{ height: 81, display: 'flex', gap: 9 }}>
        {TONES.map((t) => {
          const isAnswer = t.num === answer && !completed;
          const isWrong = wrong === t.num;
          return (
            <button key={t.num} onClick={() => tap(t.num)} className={`tg-press ${isWrong ? 'tg-shake' : ''}`} style={{
              position: 'relative', flex: 1, minWidth: 0, height: '100%', borderRadius: 20, cursor: 'pointer',
              // 딤 위 스포트라이트 — 틴트가 투명하면 어두운 딤이 비쳐 칙칙해지므로 페이지색 위에 합성해 불투명 처리
              background: `linear-gradient(${TONE_TINTS[t.num]}, ${TONE_TINTS[t.num]}), ${TG.BG}`,
              border: isAnswer ? `3px solid ${t.color}` : `1.5px solid ${TONE_BORDERS[t.num]}`,
              color: t.color,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 16, paddingBottom: 12,
              boxShadow: isAnswer ? `0 0 0 4px ${t.color}22` : 'none',
              transition: 'box-shadow .2s ease', ...TOUCH_OPT,
            }}>
              {/* 탭 물결(리플) — 정답 버튼에서 톡톡 두드리듯 원형 파동 반복. 2겹으로 끊김 없이. 마크 뒤(zIndex 0) */}
              {isAnswer && [0, 750].map((delay) => (
                <span key={delay} style={{
                  position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, borderRadius: '50%',
                  background: t.color, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0,
                  animation: `tg-ripple 1500ms ease-out ${delay}ms infinite`,
                }} />
              ))}
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <ToneMark tone={t.num} size={34} />
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: t.color }}>{t.name}</span>
              </div>
            </button>
          );
        })}
      </div>
      </Reveal>
    </>
  );
}
