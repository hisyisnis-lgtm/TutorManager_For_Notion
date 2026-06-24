// 성조게임 화면 공통 빌딩블록 — 모든 화면 컴포넌트가 공유.
// 스타일 주입(ToneGameStyles)·반응형 컨테이너(FigmaScreen)·등장 래퍼(Reveal)·코치 말풍선·
// 단어 카드/성조 버튼·카운트다운 비주얼·토스트·흔들림 버튼.
// 참조 메모리: tone_game_redesign.md §5(단어카드)·§10-B(FigmaScreen)·§10-C(연출)
import { useState, useEffect, useRef } from 'react';
import { LockSimpleIcon, SpeakerHighIcon, SpeakerSlashIcon, VibrateIcon, XIcon } from '@phosphor-icons/react';
import {
  TG, FONT_NUM, FONT_BODY, FONT_HANZI, FONT_PINYIN, SHADOW, DUR, TOUCH_OPT, TONE_TINTS, TONE_BORDERS, ASSETS,
  haptic, isHapticMuted, setHapticMuted,
} from '../tgTokens.js';
import { ToneMark, ComboChip } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { play as playSfx, isSfxMuted, setSfxMuted } from '../tgSfx.js';

// 카운트다운 슬라이드 가장자리 진폭 폭(px) — keyframes(tg-cd-out)와 CdWaveEdge가 공유.
export const CD_WAVE_W = 12;

// ── keyframes / 글로벌 게임 스타일 ─────────────────────
export function ToneGameStyles() {
  return (
    <style>{`
      @keyframes tg-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      @keyframes tg-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
      @keyframes tg-heartbeat { 0%,100%{transform:scale(1)} 28%{transform:scale(1.2)} 42%{transform:scale(1)} 58%{transform:scale(1.12)} 72%{transform:scale(1)} }
      @keyframes tg-screenshake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-7px,2px)} 30%{transform:translate(6px,-2px)} 45%{transform:translate(-5px,1px)} 60%{transform:translate(4px,-1px)} 80%{transform:translate(-2px,0)} }
      @keyframes tg-punch { 0%{transform:scale(1)} 35%{transform:scale(1.06)} 100%{transform:scale(1)} }
      @keyframes tg-flash { 0%{opacity:0} 18%{opacity:.7} 100%{opacity:0} }
      @keyframes tg-fade-out { to { opacity:0 } }
      @keyframes tg-vignette { 0%,100%{opacity:.45} 50%{opacity:1} }
      @keyframes tg-card-in { 0%{opacity:0;transform:translateY(16px) scale(.965)} 100%{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes tg-pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
      @keyframes tg-float { 0%{transform:translateY(0) scale(.9);opacity:0} 20%{opacity:1} 100%{transform:translateY(-28px) scale(1.05);opacity:0} }
      @keyframes tg-enter { 0%{transform:translateY(10px);opacity:0} 100%{transform:translateY(0);opacity:1} }
      @keyframes tg-count { 0%{transform:scale(.4);opacity:0} 45%{transform:scale(1.06);opacity:1} 100%{transform:scale(1);opacity:1} }
      @keyframes tg-touch { 0%,100%{opacity:.5} 50%{opacity:1} }
      @keyframes tg-ripple { 0%{transform:translate(-50%,-50%) scale(.5);opacity:.4} 70%{opacity:.1} 100%{transform:translate(-50%,-50%) scale(2);opacity:0} }
      @keyframes tg-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      @keyframes tg-dot { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-6px);opacity:1} }
      @keyframes tg-cd-in { from{transform:translateX(100%)} to{transform:translateX(0)} }
      @keyframes tg-cd-out { from{transform:translateX(0)} to{transform:translateX(calc(-100% - ${CD_WAVE_W + 8}px))} }
      .tg-caret::after { content:'|'; margin-left:1px; opacity:.8; animation: tg-blink .8s step-end infinite }
      @keyframes tg-blink { 50%{opacity:0} }
      @keyframes tg-timer { from{width:100%} to{width:0%} }
      @keyframes tg-rise { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
      @keyframes tg-toast { 0%{opacity:0; transform:translateY(8px)} 12%{opacity:1; transform:translateY(0)} 86%{opacity:1; transform:translateY(0)} 100%{opacity:0; transform:translateY(-4px)} }
      /* 타이틀 로고 효과 */
      @keyframes tg-logo-pop { 0%{opacity:0; transform:scale(.7)} 60%{opacity:1; transform:scale(1.05)} 100%{opacity:1; transform:scale(1)} }
      @keyframes tg-shine { 0%{background-position:160% 0} 22%{background-position:-60% 0} 100%{background-position:-60% 0} }
      @keyframes tg-sparkle { 0%,100%{opacity:0; transform:scale(0) rotate(0deg)} 50%{opacity:1; transform:scale(1) rotate(45deg)} }
      .tg-reveal{ animation: tg-rise .4s cubic-bezier(.22,1,.36,1) both }
      .tg-toast{ animation: tg-toast 1.7s ease both }
      @media (prefers-reduced-motion: reduce){ .tg-reveal{ animation: none !important } }
      .tg-shake{ animation: tg-shake .42s ease }
      .tg-enter{ animation: tg-enter .36s cubic-bezier(.22,1,.36,1) both }
      /* 누를 땐 빠르게 쏙 들어가고(.09s), 뗄 땐 살짝 튕기며 부드럽게 복귀(back-out 스프링) */
      .tg-press{ transition: transform .28s cubic-bezier(0.34,1.56,0.64,1) }
      .tg-press:active{ transform: scale(.95); transition: transform .09s ease-out }
      .tg-root, .tg-root *, .tg-root *::before, .tg-root *::after { box-sizing: border-box; }
    `}</style>
  );
}

// ── 반응형 화면 컨테이너 ────────────────────────────────
// 전체 높이 컬럼(최대폭 600, 가운데). 요소는 absolute로 상단=top / 하단=bottom 앵커 + left/right로 폭 채움.
// → 화면 폭이 넓어지면 요소가 넓어지고, 세로가 길어지면 상단·하단이 벌어지며 채워짐(잘림 없음).
// 상단 safe-area: 컬럼을 노치 아래에서 시작(top=safe-top)시켜 상단 요소(top:20 등)가 상태바에 안 가리게.
//   배경(bgImage)은 root(inset:0)라 노치까지 덮음. 하단은 각 CTA가 env(safe-area-inset-bottom)로 개별 처리.
export function FigmaScreen({ children, bg = TG.BG, bgImage }) {
  return (
    <div className="tg-root" style={{ position: 'fixed', inset: 0, background: bg, overflow: 'hidden' }}>
      <ToneGameStyles />
      {/* 배경을 화면 전체에 깔아 여백까지 채움 */}
      {bgImage && <img src={bgImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
      <div style={{ position: 'absolute', top: 'env(safe-area-inset-top)', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 600 }}>
        {children}
      </div>
    </div>
  );
}

// ── 순차 등장 래퍼 ─────────────────────────────────────
// 바깥 div = 기존 위치/정렬(absolute·translateX 등) 그대로, 안쪽 div = 아래서 페이드업(tg-rise).
// → 정렬 transform과 등장 transform이 다른 노드라 충돌 없음. i 순서대로 시차(base+i*step ms).
// play=false면 숨김 유지(opacity0) — 게임화면처럼 '특정 시점부터' 등장시킬 때 사용.
export function Reveal({ i = 0, base = 80, step = 70, play = true, style, children }) {
  return (
    <div style={style}>
      <div className={play ? 'tg-reveal' : undefined}
        style={play ? { animationDelay: `${base + i * step}ms` } : { opacity: 0 }}>
        {children}
      </div>
    </div>
  );
}

// 코치 말풍선 (Figma 다이얼로그 구조)
// 타이핑 연출 — 글자 하나씩 노출, 탭하면 즉시 완성
export function useTypewriter(text, speed = 35) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!text) return undefined;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  const done = count >= (text ? text.length : 0);
  return [text ? text.slice(0, count) : '', done, () => setCount(text ? text.length : 0)];
}

export function CoachBubble({ text }) {
  const [shown, done, skip] = useTypewriter(text);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* 판다·말풍선 분리 — 같은 주기(3s)에 고정 위상차(-1s)만. 항상 일정 간격으로 따라다녀 깔끔 */}
      <img src={ASSETS.pandaCoach} width={73} height={63} alt="" style={{ flexShrink: 0, filter: 'drop-shadow(0px 4px 10px rgba(43,39,48,0.08))', animation: 'tg-bob 3s ease-in-out infinite', animationDelay: '-1s' }} />
      <div style={{ position: 'relative', marginLeft: 8.8, animation: 'tg-bob 3s ease-in-out infinite' }}>
        <div onClick={(e) => { if (!done) { e.stopPropagation(); skip(); } }} style={{ background: '#3c3c3c', padding: '10px 14px', borderRadius: 10, cursor: done ? 'default' : 'pointer' }}>
          <span className={done ? '' : 'tg-caret'} style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, color: '#fff', whiteSpace: 'nowrap' }}>{shown}</span>
        </div>
        {/* 꼬리 — Figma 벡터(41:39) 그대로, 회전 없음(이미 왼쪽 향함). 말풍선 좌측 -8.8px·top 9.27 (Figma 절대좌표) */}
        <span style={{ position: 'absolute', left: -8.8, top: 9.27, lineHeight: 0 }}>
          <svg width="12" height="16" viewBox="0 0 12 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.19488 1.59069C-0.28873 0.93007 0.18306 0 1.00178 0L10.076 0C10.6282 0 11.076 0.447715 11.076 1L11.076 13.3955C11.076 14.3624 9.84019 14.7664 9.26906 13.9862L0.19488 1.59069Z" fill="#3C3C3C" />
          </svg>
        </span>
      </div>
    </div>
  );
}

// ── 단어 카드 (반응형 + 고정 슬롯, 메모리 §5) ──────────
export function WordCard({ word, entered, currentSyl, completed, timedOut, progressText, combo, comboFlash, floatScore, hideProgress, listen = false, audioOff = false, onReplay, onCantHear }) {
  const listening = listen && !audioOff && !completed && !timedOut; // 듣기 모드: 답하기 전엔 한자 가리고 소리 패널
  const n = word.tones.length;
  let hz, colW, gap, twoRow = false, perRow = n;
  if (n <= 4) { hz = 66; colW = 72; gap = 14; }
  else if (n === 5) { hz = 44; colW = 52; gap = 8; }
  else { hz = 36; colW = 44; gap = 8; twoRow = true; perRow = Math.ceil(n / 2); }

  const glow = completed && !timedOut ? SHADOW.correctGlow : timedOut ? SHADOW.timeoutGlow : SHADOW.card;
  const guide = completed && !timedOut ? { text: '정답', color: TG.SUCCESS }
    : timedOut ? { text: '시간초과', color: TG.DANGER }
    : { text: `${currentSyl + 1}번째 글자의 성조를 누르세요`, color: TG.GUIDE };

  const Syllable = (i) => {
    const revealed = i < entered.length;
    const tone = revealed ? entered[i] : null;
    const toneColor = tone != null ? (TONES.find((t) => t.num === tone)?.color ?? TG.INK) : TG.INK;
    const isCurrent = i === currentSyl && !completed;
    return (
      <div key={i} style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ height: hz > 50 ? 34 : 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {revealed ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 999,
              background: toneColor, color: '#fff', animation: 'tg-pop .3s cubic-bezier(.34,1.56,.64,1) both',
            }}>
              <ToneMark tone={tone} size={hz > 50 ? 16 : 13} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: hz > 50 ? 12 : 10 }}>{tone === 0 ? '경' : `${tone}성`}</span>
            </span>
          ) : (
            <div style={{
              width: hz > 50 ? 28 : 22, height: 5, borderRadius: 999,
              background: isCurrent ? TG.CORAL : '#E5DED5',
              animation: isCurrent ? 'tg-pulse 1.1s ease-in-out infinite' : 'none',
            }} />
          )}
        </div>
        <div style={{
          fontFamily: FONT_HANZI, fontWeight: 700, fontSize: hz, lineHeight: 1.05,
          // 정답 입력 시 글자가 성조색으로 채워짐(전환) + 팝 — 타격감 + 성조-색 각인
          color: isCurrent ? TG.CORAL_DK : (revealed ? toneColor : TG.INK), transition: `color ${DUR.state} ease`,
          animation: revealed ? 'tg-pop .32s cubic-bezier(.34,1.56,.64,1) both' : 'none',
        }}>{word.hanzi[i] ?? ''}</div>
        <div style={{ height: hz > 50 ? 26 : 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {completed && (
            <span style={{ fontFamily: FONT_PINYIN, fontWeight: 600, fontSize: hz > 50 ? 17 : 14, color: TG.SUB }}>{word.pinyin[i] ?? ''}</span>
          )}
        </div>
      </div>
    );
  };

  const cols = Array.from({ length: n }, (_, i) => i);
  const rows = twoRow ? [cols.slice(0, perRow), cols.slice(perRow)] : [cols];

  return (
    <div style={{
      position: 'relative', background: TG.CARD, borderRadius: 28, width: '100%', height: 292, padding: 20, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: glow, transition: `box-shadow ${DUR.state} ease`,
    }}>
      {!hideProgress && (
        <div style={{ position: 'absolute', left: 16, top: 16, fontFamily: FONT_NUM, fontWeight: 700, fontSize: 16, display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ color: '#f2484c' }}>{progressText.split('/')[0]}</span>
          {/* 분모(총 문제수)는 있을 때만 — 무한모드는 숫자만이라 '/ ' 안 보이게 */}
          {progressText.split('/')[1] && <span style={{ color: '#9a93a0', fontSize: 14 }}>/ {progressText.split('/')[1]}</span>}
        </div>
      )}
      <div style={{ position: 'absolute', right: 16, top: 14 }}><ComboChip combo={combo} flash={comboFlash} /></div>
      {floatScore && (
        <div style={{
          position: 'absolute', right: 20, top: 44, zIndex: 2, fontFamily: FONT_NUM, fontWeight: 800, fontSize: 22,
          color: TG.SUCCESS, animation: 'tg-float 1.3s ease-out forwards', pointerEvents: 'none',
        }}>{floatScore}</div>
      )}
      {listening ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {/* 한자·뜻 가림 → 소리만. 스피커 + 다시 듣기 / 지금은 못 들어요 */}
          <div style={{ width: 104, height: 104, borderRadius: 52, background: 'rgba(242,72,76,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SpeakerHighIcon size={48} weight="fill" color={TG.CORAL_DK} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onReplay} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 17px', borderRadius: 16, background: '#fff', border: `1.5px solid ${TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerHighIcon size={18} weight="fill" color={TG.CORAL_DK} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: TG.INK }}>다시 듣기</span>
            </button>
            <button onClick={onCantHear} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 17px', borderRadius: 16, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerSlashIcon size={18} weight="fill" color="#767676" />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: TG.INK }}>지금은 못 들어요</span>
            </button>
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: TG.GUIDE }}>소리를 듣고 성조를 찾으세요</span>
        </div>
      ) : (
        <>
          <div style={{ height: 22, marginTop: 8, textAlign: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: TG.SUB }}>{word.meaning}</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
            {rows.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap }}>{row.map((i) => Syllable(i))}</div>
            ))}
          </div>
          <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: guide.color, transition: `color ${DUR.state} ease` }}>{guide.text}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── 성조 버튼 5개 (성조색 소프트 틴트 배경) ────────────
export function ToneButtons({ onTone, wrongBtn, disabled }) {
  const [ripple, setRipple] = useState(null); // { num, key } — 탭 순간 성조색 리플
  const seqRef = useRef(0);
  const handle = (num) => { seqRef.current += 1; setRipple({ num, key: seqRef.current }); onTone(num); };
  return (
    <div style={{ display: 'flex', gap: 9, height: 81, alignItems: 'stretch' }}>
      {TONES.map((t) => {
        const isWrong = wrongBtn === t.num;
        return (
          <button
            key={t.num} onClick={() => handle(t.num)} disabled={disabled} aria-label={t.name}
            className={`tg-press ${isWrong ? 'tg-shake' : ''}`}
            style={{
              position: 'relative', overflow: 'hidden',
              flex: 1, minWidth: 0, height: '100%', cursor: disabled ? 'default' : 'pointer', borderRadius: 20,
              background: isWrong ? '#FFD9D9' : TONE_TINTS[t.num],
              border: `1.5px solid ${isWrong ? TG.DANGER : TONE_BORDERS[t.num]}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              paddingTop: 16, paddingBottom: 12, color: t.color, ...TOUCH_OPT,
            }}
          >
            {/* 탭 순간 성조색 리플 — 타격감 + 성조-색 각인 */}
            {ripple && ripple.num === t.num && (
              <span key={ripple.key} aria-hidden="true" style={{
                position: 'absolute', left: '50%', top: '50%', width: 90, height: 90, borderRadius: '50%',
                background: t.color, animation: 'tg-ripple .5s ease-out forwards', pointerEvents: 'none', zIndex: 0,
              }} />
            )}
            <ToneMark tone={t.num} size={34} />
            <span style={{ position: 'relative', zIndex: 1, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: t.color }}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 카운트다운 비주얼 (난이도 핀 포함) ──────────────────
const DIFF_HANZI = { easy: '初', normal: '中', hard: '高' };
export function CountdownVisual({ n, difficulty }) {
  return (
    <>
      {/* 숫자 + 안내 (Figma top290.5 = 34.4%) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: '34.4%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div key={n} style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0px 14px 15px rgba(242,72,76,0.3))', animation: 'tg-count .85s ease forwards' }}>
          <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 120, color: '#fff', lineHeight: 'normal' }}>{n > 0 ? n : ''}</span>
        </div>
        <Reveal i={1} base={140}>
          <span style={{ display: 'block', fontFamily: FONT_BODY, fontWeight: 500, fontSize: 15, color: '#fff', textAlign: 'center' }}>성조를 빠르게 찾아 탭하세요!</span>
        </Reveal>
      </div>
      {/* 난이도 핀 (Figma top575.5 = 68.2%) */}
      <Reveal i={2} base={140} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '68.2%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff3d6', padding: '10px 16px', borderRadius: 16 }}>
        <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 15, color: '#e0a21a' }}>{DIFF_HANZI[difficulty?.id] || '中'}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#b07d12' }}>{difficulty?.label || '중급'}</span>
      </div>
      </Reveal>
    </>
  );
}

// 카운트다운 슬라이드 가장자리 — 세로 사인파 실루엣.
// 슬라이드 컨테이너 좌/우 '바깥쪽'에 코랄 띠를 붙여, 가운데 정렬(전체 덮음)일 땐 화면 밖이라 안 보이고
// 슬라이드 중에만 게임 위로 물결 경계가 드러나게 한다.
const CD_WAVE_PATH = (() => {
  const N = 13, H = 1000, steps = 80, amp = CD_WAVE_W / 2;
  // 오른쪽 직선변(x=W) → 아래로 → 왼쪽 사인 실루엣을 따라 위로 → 닫기
  let d = `M ${CD_WAVE_W} 0 L ${CD_WAVE_W} ${H}`;
  for (let i = steps; i >= 0; i--) {
    const y = (H / steps) * i;
    const x = amp + amp * Math.sin((i / steps) * N * Math.PI * 2);
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} Z`;
})();
export function CdWaveEdge({ side, color = '#f96c6e' }) {
  const isLeft = side === 'left';
  return (
    <svg width={CD_WAVE_W} height="100%" viewBox={`0 0 ${CD_WAVE_W} 1000`} preserveAspectRatio="none" aria-hidden="true"
      style={{
        position: 'absolute', top: 0, height: '100%', [isLeft ? 'left' : 'right']: 0,
        transform: isLeft ? 'translateX(-100%)' : 'translateX(100%) scaleX(-1)', display: 'block',
      }}>
      <path d={CD_WAVE_PATH} fill={color} />
    </svg>
  );
}

// 잠긴 버튼 흔들기 — shakeOnClick일 때 클릭 시 좌우 흔들림(tg-shake) + onClick(토스트)
export function ShakeButton({ shakeOnClick, onClick, className = '', style, children, ...rest }) {
  const [shaking, setShaking] = useState(false);
  useEffect(() => { if (!shaking) return undefined; const t = setTimeout(() => setShaking(false), 450); return () => clearTimeout(t); }, [shaking]);
  const handle = () => {
    if (shakeOnClick) { setShaking(false); requestAnimationFrame(() => setShaking(true)); playSfx('locked'); }
    if (onClick) onClick();
  };
  return <button onClick={handle} className={`${className} ${shaking ? 'tg-shake' : ''}`.trim()} style={style} {...rest}>{children}</button>;
}

// 중앙 토스트 (잠금 안내 등) — Figma "Toast". 다크 알약 + 자물쇠 + 문구. tg-toast로 페이드 인·아웃.
export function GameToast({ msg }) {
  // 광학 중앙 보정: 정중앙(50%)이면 눈에는 아래로 쏠려 보임(하단 CTA로 무게중심도 아래) → 하단 패딩을 키워 살짝 위로.
  // 애니메이션(tg-toast)이 transform:translateY를 쓰므로 토스트 박스가 아닌 바깥 컨테이너 패딩으로 올림. safe-area-top도 함께 정합.
  return (
    <div style={{ position: 'fixed', top: 'env(safe-area-inset-top)', bottom: 0, left: 0, right: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: '24px 24px calc(24px + 12vh)' }}>
      <div className="tg-toast" style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(43,39,48,0.94)', boxShadow: '0 8px 22px rgba(26,16,20,0.28)', borderRadius: 14, padding: '12px 18px 12px 16px', maxWidth: '90%' }}>
        <LockSimpleIcon size={16} weight="fill" color="#fff" style={{ flexShrink: 0 }} />
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
      </div>
    </div>
  );
}

// ── 설정 모달 ─────────────────────────────────────────
// ⚙️ 설정 — 소리(SFX)·햅틱(진동) on/off. 시작화면·일시정지 모달에서 공용. Figma "18. 설정 모달" 기준.
function SettingRow({ Icon, label, on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: on ? 'rgba(242,72,76,0.12)' : '#f0ebe4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} weight="fill" color={on ? TG.CORAL_DK : '#b8b0a8'} />
        </div>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: TG.INK }}>{label}</span>
      </div>
      <button onClick={onToggle} role="switch" aria-checked={on} aria-label={label} className="tg-press"
        style={{ width: 48, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', padding: 0, background: on ? TG.CORAL_DK : '#d8d0c7', position: 'relative', transition: 'background .2s ease', ...TOUCH_OPT }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: 11, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .18s ease' }} />
      </button>
    </div>
  );
}

export function SettingsModal({ onClose }) {
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  const [hapticOn, setHapticOn] = useState(() => !isHapticMuted());
  const toggleSfx = () => { const next = !sfxOn; setSfxOn(next); setSfxMuted(!next); if (next) playSfx('button'); };
  const toggleHaptic = () => { const next = !hapticOn; setHapticOn(next); setHapticMuted(!next); if (next) haptic(20); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 300, background: TG.CARD, borderRadius: 24, padding: '20px 22px 22px',
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 18, color: TG.INK }}>설정</span>
          <button onClick={onClose} aria-label="닫기" className="tg-press"
            style={{ width: 30, height: 30, borderRadius: 15, border: 'none', background: '#f3efe9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <XIcon size={14} weight="bold" color={TG.SUB} />
          </button>
        </div>
        <SettingRow Icon={sfxOn ? SpeakerHighIcon : SpeakerSlashIcon} label="소리" on={sfxOn} onToggle={toggleSfx} />
        <SettingRow Icon={VibrateIcon} label="햅틱" on={hapticOn} onToggle={toggleHaptic} />
      </div>
    </div>
  );
}
