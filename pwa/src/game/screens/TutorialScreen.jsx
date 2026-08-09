// 첫 진입 인게임 튜토리얼 — 실제 라운드를 압축한 5비트 미니 플로우(짧게).
//  비트0 성조 익히기: 같은 'ma' 5성(妈麻马骂吗) 탭해서 소리 듣기 → 성조=오르내림 각인.
//  비트1 보고 찾기(妈妈): 한자 보고 성조 선택(정답 강조) → 완료 시 발음 재생(추측→확인 루프).
//  비트2 듣고 찾기(好): 소리만 듣고 성조 선택 → 한자 공개. 실제 라운드에 섞여 나오는 유형 대비.
//  비트3 그려서 찾기(好): 한자 보고 성조를 손가락으로 그려서 맞히기(DrawPad). 그리기 문제 유형 대비.
//  비트4 연음 규칙(美国): 3성+2성 답한 뒤 완성 순간 연음 마크 등장 → 하늘쌤 반3성 연음 규칙 각인.
// 게임 레이아웃 + 딤 스포트라이트. 완료 후 onDone → 모드선택.
import { useState, useEffect, useRef } from 'react';
import { Stopwatch, Play } from '@solar-icons/react';
import { TG, TYPE, FONT_HANZI, TOUCH_OPT, haptic, RADIUS, SPACE } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { WordCard, CoachBubble, Reveal, DrawPad, GameHeader, ToneButtons } from './shared.jsx';
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
      {/* 인게임 크롬(정적) — 시안 19: 타이머 (24,72). 딤 아래라 어둡게 깔린다 — 점수 숫자는 튜토리얼에선 뺀다(2026-08-06 사용자 요청) */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 72, display: 'flex', alignItems: 'center', gap: SPACE.md }}>
        <div style={{ width: 32, height: 32, borderRadius: RADIUS.lg, background: '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0px 3px 4.5px rgba(255,94,98,0.45)' }}>
          <Stopwatch size={20} weight="Bold" color="#fff" />
        </div>
        <div style={{ flex: 1, height: 12, borderRadius: 8, background: '#EBE5D5', overflow: 'hidden' }}>
          <div style={{ width: '83%', height: '100%', background: '#FF5E62' }} />
        </div>
      </div>

      {/* 딤 오버레이 — 헤더(60) 아래만. 강조(진행필·카드·성조버튼) 외 어둡게. 마지막 정답 시 사라짐 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 60, bottom: 0, zIndex: 5, background: 'rgba(43,39,48,0.5)', opacity: dimOff ? 0 : 1, transition: 'opacity .35s ease', pointerEvents: 'none' }} />

      {/* 헤더 — 글래스 60 + '튜토리얼' + 우측 건너뛰기. 딤(z5) 위.
          ★뒤로가기 없음(2026-08-07 사용자) — 우측 '건너뛰기'와 동작이 같아(둘 다 skip) 나가는 문이 두 개였다. */}
      <GameHeader title="튜토리얼" glass center z={7} right={
        <button onClick={skip} className="tg-press" style={{ marginLeft: 'auto', padding: '12px 0 12px 12px', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
          <span style={{ ...TYPE.sub, fontWeight: 700, color: TG.INK }}>건너뛰기</span>
        </button>
      } />

      {/* 진행 표시(5점) + 단계 라벨 — 시안 (116,73) 158×30 r16 흰색 */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 73, height: 30, display: 'flex', alignItems: 'center', gap: SPACE.md, background: '#fff', padding: '0 14px', borderRadius: RADIUS.lg, zIndex: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ width: i === phase ? 16 : 6, height: 6, borderRadius: RADIUS.xs, background: i === phase ? TG.CORAL_DK : '#f4c4c4', transition: 'width .25s ease' }} />
          ))}
        </div>
        <span style={{ ...TYPE.labelSm, color: TG.CORAL_DK, whiteSpace: 'nowrap' }}>{PHASE_LABEL[phase]}</span>
      </div>

      {/* 카드 top129 — 스포트라이트. 비트0=성조 소개, 비트1/2=단어카드 */}
      <Reveal i={0} style={{ position: 'absolute', left: 20, right: 20, top: 129, zIndex: 6 }}>
        {phase === 0 ? (
          <div style={{ background: TG.CARD, borderRadius: RADIUS.card, minHeight: 200, padding: '28px 22px', boxShadow: '0 10px 28px rgba(43,39,48,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.x3 }}>
            <div style={{ display: 'flex', gap: SPACE.x2 }}>
              {SAMPLE_ORDER.map((n) => (
                <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md, color: TONES.find((t) => t.num === n)?.color }}>
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

      {/* 비트1/2/3 코치 — 스포트라이트. 비트3(그리기)은 패드 자리 확보 위해 카드 바로 아래로.
          ★비트3 세로 배치 실측(390×844): 단어카드 바닥 401 → 말풍선(높이 75, 판다는 위로 5 튀어나옴) → 패드.
            구 430은 말풍선 바닥이 505라 패드(490)를 15px 파고들어 판다와 그리기 영역이 겹쳤다(2026-08-07 사용자). */}
      {phase !== 0 && (
        <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: phase === 3 ? 415 : 470, zIndex: 6 }}>
          <CoachBubble text={coachText} />
        </Reveal>
      )}

      {/* 비트0 '다음' 버튼 — 시안 19: (24,677) 342×50 r20 단색 코랄 + 아래 인너 엣지 + 플레이 18 */}
      {phase === 0 && (
        <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(117px + env(safe-area-inset-bottom))', zIndex: 6 }}>
          <button onClick={() => goPhase(1)} className="tg-press" style={{
            width: '100%', height: 50, borderRadius: 20, border: 'none', cursor: 'pointer', background: '#F96163',
            boxShadow: '0px 10px 20px rgba(242,72,76,0.1), inset 0 -4px 0 #E64244', paddingBottom: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
          }}>
            <span style={{ ...TYPE.head, color: '#fff' }}>다음</span>
            <Play size={18} weight="Bold" color="#fff" />
          </button>
        </Reveal>
      )}

      {/* 비트3 그리기 패드 — 성조버튼 대신. 스포트라이트(딤 위 zIndex6). 그려서 성조 맞히기.
          ★Reveal(이중 div, 안쪽 height 없음)로 감싸면 height:100% 패드가 접힘 → 단일 positioned div(top/bottom로 높이 확보) */}
      {phase === 3 && (
        <div className="tg-reveal" style={{ position: 'absolute', left: 20, right: 20, top: 502, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 6, animationDelay: '220ms' }}>
          {/* demoTone = 예시 획 재생(튜토리얼 전용). 인게임 DrawPad는 빈 캔버스 그대로 — 정답 힌트가 되면 안 되므로. */}
          <DrawPad expectedTone={answer} demoTone={answer} onDraw={tap} disabled={completed} resetKey={phase} />
        </div>
      )}

      {/* 성조버튼 하단 고정 — 시안 19는 인게임과 **같은 흰 키캡**(63.6×81 r20). 정답 안내는 highlight(테두리+리플)로.
          비트0=탭해서 듣기(정답 없음), 비트3(그리기)은 미표시 */}
      {phase !== 3 && (
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(26px + env(safe-area-inset-bottom))', zIndex: 6 }}>
        <ToneButtons onTone={tap} wrongBtn={wrong} disabled={completed}
          highlight={phase !== 0 && !completed ? answer : null} />
      </Reveal>
      )}
    </>
  );
}
