// 첫 진입 인게임 튜토리얼 — 실제 라운드를 압축한 5비트 미니 플로우(짧게).
//  비트0 성조 익히기: 같은 'ma' 5성(妈麻马骂吗) 탭해서 소리 듣기 → 성조=오르내림 각인.
//  비트1 보고 찾기(妈妈): 한자 보고 성조 선택(정답 강조) → 완료 시 발음 재생(추측→확인 루프).
//  비트2 듣고 찾기(好): 소리만 듣고 성조 선택 → 한자 공개. 실제 라운드에 섞여 나오는 유형 대비.
//  비트3 그려서 찾기(好): 한자 보고 성조를 손가락으로 그려서 맞히기(DrawPad). 그리기 문제 유형 대비.
//  비트4 연음 규칙(美国): 3성+2성 답한 뒤 완성 순간 연음 마크 등장 → 하늘쌤 반3성 연음 규칙 각인.
// 게임 레이아웃 + 딤 스포트라이트. 완료 후 onDone → 모드선택.
import { useState, useEffect, useRef } from 'react';
import { StarIcon, TimerIcon, CaretRightIcon } from '@phosphor-icons/react';
import { TG, TYPE, FONT_HANZI, TOUCH_OPT, TONE_TINTS, TONE_BORDERS, haptic } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { WordCard, CoachBubble, Reveal, DrawPad } from './shared.jsx';
import { P1_WORD, P2_WORD, LY_WORD, TONE_SAMPLES, SAMPLE_ORDER } from '../tutorialWords.js';
import { findLianyin } from '../lianyin.js';

const PHASE_LABEL = ['성조 익히기', '보고 찾기', '듣고 찾기', '그려서 찾기', '연음 규칙'];

export function TutorialScreen({ onDone }) {
  const [phase, setPhase] = useState(0);       // 0 성조소개 · 1 보고찾기 · 2 듣고찾기 · 3 그려서찾기
  const [entered, setEntered] = useState([]);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [audioOff, setAudioOff] = useState(false); // 비트2 '지금은 못 들어요' 폴백
  const doneRef = useRef(false);
  // 내부 setTimeout 모아두고 언마운트 시 전부 정리 — 스킵 후 뒤늦은 타이머 발화(onDone 중복 등) 방지
  const timersRef = useRef([]);
  const later = (fn, ms) => timersRef.current.push(setTimeout(fn, ms));
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const word = phase === 4 ? LY_WORD : phase >= 2 ? P2_WORD : P1_WORD; // 비트4 연음=美国, 비트2/3=好(단음절)
  const answer = phase >= 1 ? word.tones[currentSyl] : null;
  const lyAt = phase === 4 ? findLianyin(word.tones) : -1; // 비트4 완성 시 연음 마크 표시
  const dimOff = (phase === 2 || phase === 3 || phase === 4) && completed; // 정답 시 딤 해제(해방감·마크 강조)

  // 비트2 진입 시 발음 자동 재생(듣기 문제)
  useEffect(() => {
    if (phase !== 2) return undefined;
    const t = setTimeout(() => speakWord(P2_WORD), 450);
    return () => clearTimeout(t);
  }, [phase]);

  const goPhase = (next) => { setEntered([]); setCurrentSyl(0); setCompleted(false); setWrong(null); setAudioOff(false); setPhase(next); };

  const tap = (n) => {
    if (completed) return;
    if (phase === 0) { playSfx('tap'); haptic(10); speakWord(TONE_SAMPLES[n]); return; } // 소리만 들려주기(정답 없음)
    if (n === answer) {
      const ne = [...entered, n];
      setEntered(ne); haptic([10, 20, 30]);
      if (ne.length === word.tones.length) {
        setCompleted(true);
        playSfx('correct'); speakWord(word); // 완료 → 올바른 발음 재생(인게임과 동일)
        if (phase === 1) later(() => goPhase(2), 1500);
        else if (phase === 2) later(() => goPhase(3), 1500);
        else if (phase === 3) later(() => goPhase(4), 1500);
        else if (!doneRef.current) { doneRef.current = true; later(onDone, 2200); } // 비트4 연음 = 마지막(마크·규칙 볼 시간 여유)
      } else { playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      setWrong(n); haptic(20); playSfx('wrong');
      later(() => setWrong(null), 450);
    }
  };

  // 건너뛰기 — 복귀 유저(localStorage 초기화 등)가 튜토리얼을 강제 완주하지 않게. doneRef로 완료 타이머와 중복 방지.
  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    playSfx('button');
    onDone();
  };

  const coachText = phase === 1
    ? (completed ? '맞히면 올바른 발음이 들려요 👂' : `${currentSyl + 1}번째 글자의 성조를 눌러요`)
    : phase === 2
    ? (completed ? '잘했어요! 다음은 그리기예요 ✏️' : '이번엔 소리만 듣고 성조를 찾아요')
    : phase === 3
    ? (completed ? '좋아요! 마지막 규칙 하나 🔗' : '성조를 손가락으로 그려서 맞혀요 ✏️')
    : (completed ? '연음! 반3성으로 이어서 🔗' : '3성 뒤 2성! 성조를 눌러요');

  return (
    <>
      {/* 점수(정적) 상단 중앙 */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20, display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '9px 14px', borderRadius: 15, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ ...TYPE.numMd, fontSize: 17, color: TG.INK }}>0</span>
      </div>
      {/* 우상단은 건너뛰기 버튼이 차지(정적 일시정지 아이콘은 겹쳐서 제거) */}
      {/* 타이머(정적) top69 */}
      <div style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, background: '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0px 3px 4.5px rgba(255,94,98,0.45)' }}>
          <TimerIcon size={20} weight="fill" color="#fff" />
        </div>
        <div style={{ flex: 1, height: 12, borderRadius: 6, background: TG.TRACK }} />
      </div>
      {/* 진행 표시(3점) + 단계 라벨 — top70 중앙 */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 70, display: 'flex', alignItems: 'center', gap: 8, background: '#fff1f1', padding: '8px 14px', borderRadius: 14, zIndex: 7 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ width: i === phase ? 16 : 6, height: 6, borderRadius: 3, background: i === phase ? TG.CORAL_DK : '#f4c4c4', transition: 'width .25s ease' }} />
          ))}
        </div>
        <span style={{ ...TYPE.labelSm, color: TG.CORAL_DK, whiteSpace: 'nowrap' }}>{PHASE_LABEL[phase]}</span>
      </div>

      {/* 딤 오버레이 — 강조(카드·코치·성조버튼) 외 어둡게. 마지막 정답 시 사라짐 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(43,39,48,0.5)', opacity: dimOff ? 0 : 1, transition: 'opacity .35s ease', pointerEvents: 'none' }} />

      {/* 건너뛰기 — IntroScreen 우상단과 같은 스타일(텍스트만·히트영역 ≥44px). 딤 위(zIndex 7)라 색만 밝게(대비 확보) */}
      <button onClick={skip} className="tg-press" style={{ position: 'absolute', right: 22, top: 11, zIndex: 7, padding: '13px 12px', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ ...TYPE.sub, color: 'rgba(255,255,255,0.9)' }}>건너뛰기</span>
      </button>

      {/* 카드 top129 — 스포트라이트. 비트0=성조 소개, 비트1/2=단어카드 */}
      <Reveal i={0} style={{ position: 'absolute', left: 20, right: 20, top: 129, zIndex: 6 }}>
        {phase === 0 ? (
          <div style={{ background: TG.CARD, borderRadius: 28, minHeight: 200, padding: '28px 22px', boxShadow: '0 10px 28px rgba(43,39,48,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <div style={{ display: 'flex', gap: 14 }}>
              {SAMPLE_ORDER.map((n) => (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, color: TONES.find((t) => t.num === n)?.color }}>
                  <ToneMark tone={n} size={22} />
                  <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 34, color: TG.INK, lineHeight: 1 }}>{TONE_SAMPLES[n].hanzi}</span>
                </div>
              ))}
            </div>
            <span style={{ ...TYPE.sub, color: TG.SUB, textAlign: 'center', lineHeight: 1.55 }}>같은 소리도 <b style={{ color: TG.CORAL_DK, fontWeight: 800 }}>성조</b>에 따라 뜻이 달라져요<br />아래 버튼을 눌러 들어보세요 👂</span>
          </div>
        ) : (
          <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={false}
            progressText="1/1" combo={0} comboFlash={false} floatScore={null} hideProgress
            listen={phase === 2} draw={phase === 3} lianyinAt={lyAt} audioOff={audioOff} onReplay={() => speakWord(word)} onCantHear={() => setAudioOff(true)} />
        )}
      </Reveal>

      {/* 비트1/2/3 코치 — 스포트라이트. 비트3(그리기)은 패드 자리 확보 위해 카드 바로 아래로 */}
      {phase !== 0 && (
        <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: phase === 3 ? 430 : 470, zIndex: 6 }}>
          <CoachBubble text={coachText} />
        </Reveal>
      )}

      {/* 비트0 '다음' 버튼 — 성조버튼 위. 스포트라이트 */}
      {phase === 0 && (
        <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(130px + env(safe-area-inset-bottom))', zIndex: 6 }}>
          <button onClick={() => goPhase(1)} className="tg-press" style={{ width: '100%', height: 52, borderRadius: 16, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0px 8px 18px rgba(242,72,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...TOUCH_OPT }}>
            <span style={{ ...TYPE.btn, color: '#fff' }}>다음</span>
            <CaretRightIcon size={14} weight="bold" color="#fff" />
          </button>
        </Reveal>
      )}

      {/* 비트3 그리기 패드 — 성조버튼 대신. 스포트라이트(딤 위 zIndex6). 그려서 성조 맞히기.
          ★Reveal(이중 div, 안쪽 height 없음)로 감싸면 height:100% 패드가 접힘 → 단일 positioned div(top/bottom로 높이 확보) */}
      {phase === 3 && (
        <div className="tg-reveal" style={{ position: 'absolute', left: 20, right: 20, top: 490, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 6, animationDelay: '220ms' }}>
          <DrawPad expectedTone={answer} onDraw={tap} disabled={completed} resetKey={phase} />
        </div>
      )}

      {/* 성조버튼 하단 고정 — 비트0=탭해서 듣기(정답 강조 없음), 비트1/2=정답 강조 + 나머지 흐림. 비트3(그리기)은 미표시 */}
      {phase !== 3 && (
      <Reveal i={2} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 6 }}>
        <div style={{ height: 81, display: 'flex', gap: 9 }}>
          {TONES.map((t) => {
            const isAnswer = phase !== 0 && t.num === answer && !completed;
            const isWrong = wrong === t.num;
            return (
              <button key={t.num} onClick={() => tap(t.num)} className={`tg-press ${isWrong ? 'tg-shake' : ''}`} data-nosfx="true" style={{
                position: 'relative', flex: 1, minWidth: 0, height: '100%', borderRadius: 20, cursor: 'pointer',
                // 딤 위 스포트라이트 — 틴트가 투명하면 딤이 비쳐 칙칙 → 페이지색 위에 합성해 불투명
                background: `linear-gradient(${TONE_TINTS[t.num]}, ${TONE_TINTS[t.num]}), ${TG.BG}`,
                border: isAnswer ? `3px solid ${t.color}` : `1.5px solid ${TONE_BORDERS[t.num]}`,
                color: t.color,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 16, paddingBottom: 12,
                boxShadow: isAnswer ? `0 0 0 4px ${t.color}22` : 'none',
                transition: 'box-shadow .2s ease', ...TOUCH_OPT,
              }}>
                {/* 정답 버튼 탭 물결(리플) */}
                {isAnswer && [0, 750].map((delay) => (
                  <span key={delay} style={{
                    position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, borderRadius: '50%',
                    background: t.color, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0,
                    animation: `tg-ripple 1500ms ease-out ${delay}ms infinite`,
                  }} />
                ))}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <ToneMark tone={t.num} size={34} />
                  <span style={{ ...TYPE.labelSm, color: t.color }}>{t.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Reveal>
      )}
    </>
  );
}
