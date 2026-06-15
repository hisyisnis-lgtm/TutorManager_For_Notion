// 단어 숙련도 화면 (Figma "15. 단어 숙련도") — 성조 레이더 + 복습필요 리스트 + 마스터 수 + 복습 CTA.
import { CaretLeftIcon, SpeakerHighIcon, PlayIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_HANZI, FONT_BODY, FONT_NUM, TOUCH_OPT } from '../tgTokens.js';
import { ROUND_LENGTH } from '../../constants/toneGameWords.js';
import { TONE_NUMS, toneAccuracy, toneAttempts } from '../toneStats.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble } from './shared.jsx';

function masteryColor(acc) { return acc >= 0.8 ? TG.SUCCESS_GLOW : acc >= 0.5 ? TG.SUN : TG.CORAL; }

// ── 성조 레이더(P2) — 성조별 정답률 5각형. toneStats(1·2·3·4·경성)로 데이터 폴리곤을 그림 ──
const RADAR = { cx: 100, cy: 80, R: 52 };
const TONE_LABEL = { 1: '1성', 2: '2성', 3: '3성', 4: '4성', 0: '경성' };
const TONE_COLOR = { 1: '#FF4D6D', 2: '#FF9F40', 3: '#36C98D', 4: '#4D8DFF', 0: '#AAB2BD' };
function vtx(i, scale = 1) {
  const ang = ((-90 + i * 72) * Math.PI) / 180; // 위(1성)에서 시계방향
  return [RADAR.cx + RADAR.R * scale * Math.cos(ang), RADAR.cy + RADAR.R * scale * Math.sin(ang)];
}
function ToneRadar({ toneStats }) {
  const accs = TONE_NUMS.map((t) => ({ tone: t, acc: toneAccuracy(toneStats?.[t]), att: toneAttempts(toneStats?.[t]) }));
  const totalAtt = accs.reduce((s, a) => s + a.att, 0);
  const hasData = totalAtt >= 10; // 의미 있는 형태가 나올 만큼 탭이 쌓였을 때만 데이터 폴리곤
  const grid = (s) => TONE_NUMS.map((_, i) => vtx(i, s).map((n) => n.toFixed(1)).join(',')).join(' ');
  const dataPts = accs.map((a, i) => vtx(i, hasData ? Math.max(0.06, a.acc) : 0).map((n) => n.toFixed(1)).join(',')).join(' ');
  return (
    <div style={{ background: '#fff', border: '1.5px solid #efeae4', borderRadius: 18, padding: '16px 18px 10px' }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#2b2730' }}>성조별 정답률</span>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginTop: 2 }}>
        <svg width={200} height={150} viewBox="0 0 200 150" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
          {/* 그리드(외곽+50%) */}
          <polygon points={grid(1)} fill="none" stroke="#E5DED5" strokeWidth={1.2} />
          <polygon points={grid(0.5)} fill="none" stroke="#EFEAE4" strokeWidth={1} />
          {/* 축 */}
          {TONE_NUMS.map((t, i) => { const [x, y] = vtx(i, 1); return <line key={`ax${t}`} x1={RADAR.cx} y1={RADAR.cy} x2={x} y2={y} stroke="#EFEAE4" strokeWidth={1} />; })}
          {/* 데이터 폴리곤 + 꼭짓점 점 */}
          {hasData && <polygon points={dataPts} fill="rgba(255,107,107,0.18)" stroke="#FF6B6B" strokeWidth={2} strokeLinejoin="round" />}
          {hasData && accs.map((a, i) => { const [x, y] = vtx(i, Math.max(0.06, a.acc)); return <circle key={`dot${a.tone}`} cx={x} cy={y} r={3.5} fill={TONE_COLOR[a.tone]} />; })}
          {/* 성조 라벨(꼭짓점 바깥, 성조색) */}
          {TONE_NUMS.map((t, i) => { const [x, y] = vtx(i, 1.22); return <text key={`lb${t}`} x={x} y={y} fontFamily={FONT_BODY} fontSize={11} fontWeight={500} fill={TONE_COLOR[t]} textAnchor="middle" dominantBaseline="middle">{TONE_LABEL[t]}</text>; })}
        </svg>
        {!hasData && (
          <span style={{ position: 'absolute', top: '54%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0', padding: '0 28px' }}>
            더 플레이하면 성조별 실력이 보여요
          </span>
        )}
      </div>
    </div>
  );
}

function WordStatRow({ word, acc, avg }) {
  const pct = Math.round(acc * 100);
  const c = masteryColor(acc);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, background: '#fff', border: '1.5px solid #efeae4', flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 24, color: '#2b2730' }}>{word.hanzi}</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{word.meaning}</span>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(word.pinyin || []).join(' ')}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 20, color: c }}>{pct}</span>
          <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 12, color: c }}>%</span>
        </div>
        <div style={{ width: 64, height: 6, borderRadius: 3, background: '#f0ebe4', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 3 }} />
        </div>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: '#9a93a0' }}>{avg > 0 ? `평균 ${(avg / 1000).toFixed(1)}초` : '—'}</span>
      </div>
      {/* 발음 듣기(TTS) */}
      <button onClick={() => speakWord(word)} aria-label="발음 듣기" className="tg-press" style={{ width: 34, height: 34, borderRadius: 12, background: '#f3efe9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
        <SpeakerHighIcon size={18} weight="fill" color="#767676" />
      </button>
    </div>
  );
}

export function MasteryScreen({ rows, masteredN, toneStats, onBack, onReview }) {
  const need = rows.length;
  const reviewN = Math.min(ROUND_LENGTH, need);
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
      <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
        </button>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>단어 숙련도</span>
      </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 88 }}>
        <CoachBubble text={need ? '약한 단어부터 복습해 볼까요?' : '잘하고 있어요! 계속 도전해요'} />
      </Reveal>
      {/* 성조 레이더(P2) — 코치 아래, 항상 표시 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 158 }}>
        <ToneRadar toneStats={toneStats} />
      </Reveal>
      {/* 소제목 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 372, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#2b2730' }}>복습 필요 {need}개</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(54,201,141,0.14)', padding: '5px 11px', borderRadius: 12 }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: TG.SUCCESS }}>✓ 마스터 {masteredN}개</span>
        </div>
      </div>
      {/* 복습 필요 → 리스트(스크롤) / 없음 → 빈 상태 */}
      {need > 0 ? (
        <div style={{ position: 'absolute', left: 24, right: 24, top: 404, bottom: 'calc(110px + env(safe-area-inset-bottom))', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
          {rows.map((r) => <WordStatRow key={r.word.hanzi} word={r.word} acc={r.acc} avg={r.avg} />)}
        </div>
      ) : (
        <div style={{ position: 'absolute', left: 24, right: 24, top: 448, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 18, color: '#2b2730' }}>아직 복습할 단어가 없어요</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>게임을 플레이하면 약한 단어가 모여요</span>
        </div>
      )}
      {/* 복습 CTA */}
      {need > 0 && (
        <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <button onClick={() => { playSfx('button'); onReview(); }} className="tg-press" style={{
          width: '100%', height: 60, borderRadius: 20, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD,
          boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 18, color: '#fff' }}>약한 단어 {reviewN}개 복습하기</span>
          <PlayIcon size={14} weight="fill" color="#fff" />
        </button>
        </Reveal>
      )}
    </>
  );
}
