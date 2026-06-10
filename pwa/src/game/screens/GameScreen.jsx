// 게임 화면 (Figma 좌표 절대배치) — 점수·일시정지·타이머·단어카드·코치·성조버튼.
import { StarIcon, PauseIcon, TimerIcon, SpeakerHighIcon, EyeIcon } from '@phosphor-icons/react';
import { TG, FONT_NUM, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { Reveal, WordCard, ToneButtons, CoachBubble } from './shared.jsx';

export function GameScreen({ word, entered, currentSyl, completed, timedOut, wordIndex, wordsLen, wordTimeLimit, paused, combo, comboFlash, floatScore, score, coachText, onTone, wrongBtn, onPause, playReveal = true, endless = false, runId = 0, practice = false, onSpeak, onReveal }) {
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
    </>
  );
}
