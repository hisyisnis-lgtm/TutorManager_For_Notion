// 게임 화면 (Figma 좌표 절대배치) — 점수·일시정지·타이머·단어카드·코치·성조버튼 + 콤보/신기록 버스트 연출(P4b).
import { useState, useEffect, useRef } from 'react';
import { StarIcon, PauseIcon, TimerIcon, SpeakerHighIcon, EyeIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_NUM, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, WordCard, ToneButtons, CoachBubble } from './shared.jsx';

// 화면 중앙 버스트(P4b) — 콤보 마일스톤·신기록 순간 별 파티클 + 큰 텍스트가 팝하고 사라짐. 비차단.
function CenterBurst({ data }) {
  if (!data) return null;
  const stars = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div key={data.key} style={{ position: 'absolute', left: 0, right: 0, top: 252, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 20 }}>
      <style>{`
        @keyframes tgb-pop{0%{transform:scale(.4);opacity:0}22%{transform:scale(1.16);opacity:1}68%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:0}}
        @keyframes tgb-pop-hold{0%{transform:scale(.4);opacity:0}45%{transform:scale(1.16);opacity:1}100%{transform:scale(1);opacity:1}}
        @keyframes tgb-star{0%{transform:translate(0,0) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate(var(--tgx),var(--tgy)) scale(1);opacity:0}}
      `}</style>
      <div style={{ position: 'relative', animation: `${data.hold ? 'tgb-pop-hold' : 'tgb-pop'} 1.2s ease-out forwards` }}>
        {/* 화이트 헤일로 — 단어카드 위에서도 텍스트가 또렷이 떠 보이게 */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 250, height: 124, background: 'radial-gradient(closest-side, rgba(255,253,248,0.95), rgba(255,253,248,0.6) 55%, rgba(255,253,248,0))', pointerEvents: 'none' }} />
        {stars.map((i) => {
          const a = (i / stars.length) * Math.PI * 2; const r = 74;
          return (
            <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 11, height: 11, marginLeft: -5.5, marginTop: -5.5, '--tgx': `${Math.cos(a) * r}px`, '--tgy': `${Math.sin(a) * r}px`, animation: 'tgb-star 1s ease-out .04s forwards' }}>
              <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true"><path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" fill={data.particleColor} /></svg>
            </div>
          );
        })}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 40, color: data.color, textShadow: '0 0 8px #fffdf8, 0 0 8px #fffdf8, 0px 4px 12px rgba(43,39,48,0.18)', whiteSpace: 'nowrap' }}>{data.text}</span>
          {data.sub && <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: data.subColor, textShadow: '0 0 6px #fffdf8, 0 0 6px #fffdf8' }}>{data.sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function GameScreen({ word, entered, currentSyl, completed, timedOut, wordIndex, wordsLen, wordTimeLimit, paused, combo, comboFlash, floatScore, score, coachText, onTone, wrongBtn, onPause, playReveal = true, endless = false, runId = 0, recordToBeat = 0, practice = false, onSpeak, onReveal, demoFx = null }) {
  // ── 버스트 연출(P4b): 콤보 마일스톤(5·10·15…) + 라이브 신기록. 비차단·자동 소멸 ──
  const [burst, setBurst] = useState(null);
  const prevComboRef = useRef(0);
  const recordShownRef = useRef(false);
  const burstSeqRef = useRef(0);
  const burstTimerRef = useRef(null);
  const fireBurst = (d) => {
    burstSeqRef.current += 1;
    setBurst({ key: burstSeqRef.current, ...d });
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setBurst(null), 1250);
  };
  useEffect(() => { // 콤보 마일스톤(5의 배수, 증가 시점만)
    const prev = prevComboRef.current; prevComboRef.current = combo;
    if (combo > prev && combo >= 5 && combo % 5 === 0) fireBurst({ text: `콤보 ${combo}!`, color: TG.CORAL_DK, particleColor: TG.SUN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo]);
  useEffect(() => { // 라이브 신기록 — 진행 중 이전 최고기록 돌파(1회)
    if (recordToBeat > 0 && score > recordToBeat && !recordShownRef.current) {
      recordShownRef.current = true;
      playSfx('score');
      fireBurst({ text: '신기록!', sub: '최고 기록을 넘었어요', color: '#FF9500', subColor: '#c98300', particleColor: TG.SUN });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, recordToBeat]);
  useEffect(() => { prevComboRef.current = 0; recordShownRef.current = false; }, [runId]); // 새 런 리셋
  useEffect(() => () => { if (burstTimerRef.current) clearTimeout(burstTimerRef.current); }, []);
  useEffect(() => { // [DEV] 미리보기 버스트 데모(?screen=game&fx=combo|record) — hold로 유지(검수용). 머지 전 백도어 제거 대상
    if (!demoFx) return;
    burstSeqRef.current += 1;
    setBurst(demoFx === 'record'
      ? { key: burstSeqRef.current, hold: true, text: '신기록!', sub: '최고 기록을 넘었어요', color: '#FF9500', subColor: '#c98300', particleColor: TG.SUN }
      : { key: burstSeqRef.current, hold: true, text: '콤보 10!', color: TG.CORAL_DK, particleColor: TG.SUN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoFx]);
  return (
    <>
      {/* 점수 (상단 중앙) */}
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '9px 14px', borderRadius: 15, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 17, color: '#2b2730' }}>{score}</span>
      </div>
      </Reveal>
      {/* 일시정지 (우상단) */}
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', right: 20, top: 23 }}>
      <button onClick={onPause} aria-label="일시정지" className="tg-press" style={{ width: 40, height: 40, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
        <PauseIcon size={20} weight="fill" color={TG.SUB} />
      </button>
      </Reveal>
      {/* 타이머 top69 — 연습 모드는 게이지 대신 '연습 모드' 배지 */}
      {practice ? (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 14px', borderRadius: 16, background: 'rgba(54,201,141,0.14)' }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: TG.SUCCESS }}>연습 모드 · 시간 제한 없음</span>
          </div>
        </Reveal>
      ) : (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0px 3px 4.5px rgba(255,94,98,0.45)' }}>
            <TimerIcon size={20} weight="fill" color="#fff" />
          </div>
          <div style={{ flex: 1, height: 12, borderRadius: 6, background: '#f0ebe4', overflow: 'hidden' }}>
            <div key={`${runId}-${wordIndex}-${wordTimeLimit}`} style={{ height: '100%', width: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#ffc23c,#ff6b6b)', animation: `tg-timer ${wordTimeLimit}ms linear forwards`, animationPlayState: (paused || completed) ? 'paused' : 'running' }} />
          </div>
        </div>
        </Reveal>
      )}
      {/* 단어카드 top129 (폭 채움) */}
      <Reveal i={2} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 129 }}>
        <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut} progressText={endless ? `${wordIndex + 1}` : `${wordIndex + 1}/${wordsLen}`} combo={combo} comboFlash={comboFlash} floatScore={floatScore} />
      </Reveal>
      {/* 코치 top470 */}
      <Reveal i={3} play={playReveal} style={{ position: 'absolute', left: 24, right: 24, top: 470 }}>
        <CoachBubble text={coachText} />
      </Reveal>
      {/* 연습 모드 — 발음 듣기 / 정답 보기 (성조버튼 위) */}
      {practice && (
        <Reveal i={4} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(127px + env(safe-area-inset-bottom))' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onSpeak} className="tg-press" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerHighIcon size={20} weight="fill" color={TG.SUCCESS_GLOW} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>발음 듣기</span>
            </button>
            <button onClick={onReveal} disabled={completed} className="tg-press" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16, background: '#fff', border: '1.5px solid #ebe5de', cursor: completed ? 'default' : 'pointer', opacity: completed ? 0.5 : 1, ...TOUCH_OPT }}>
              <EyeIcon size={20} weight="fill" color="#767676" />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>정답 보기</span>
            </button>
          </div>
        </Reveal>
      )}
      {/* 성조버튼 하단 고정 */}
      <Reveal i={5} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <ToneButtons onTone={onTone} wrongBtn={wrongBtn} disabled={completed} />
      </Reveal>
      {/* 콤보 마일스톤 · 라이브 신기록 버스트(P4b) */}
      <CenterBurst data={burst} />
    </>
  );
}
