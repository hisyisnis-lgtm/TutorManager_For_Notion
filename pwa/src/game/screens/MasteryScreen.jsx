// 단어 숙련도 화면 (Figma "15. 단어 숙련도") — 성조 레이더 + 복습필요 리스트 + 마스터 수 + 복습 CTA.
import { SpeakerHighIcon, PlayIcon, MedalIcon } from '@phosphor-icons/react';
import { TG, FONT_HANZI, FONT_BODY, FONT_PINYIN, TOUCH_OPT, TYPE, RADIUS, SPACE } from '../tgTokens.js';
import { ROUND_LENGTH } from '../../constants/toneGameWords.js';
import { TONE_NUMS, toneAccuracy, toneAttempts } from '../toneStats.js';
import { TIER_SPARK_POS as PARTICLE_POS } from '../earProfile.js';
import { displayTier } from '../gameXp.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, CoachBubble } from './shared.jsx';

function masteryColor(acc) { return acc >= 0.8 ? TG.SUCCESS_GLOW : acc >= 0.5 ? TG.SUN : TG.CORAL; }

// 엠블럼 주변 반짝임 위치 = earProfile.TIER_SPARK_POS(RankUpReveal과 공용 — 좌표는 거기 한 곳에서)

// ── 성조 레이더(P2) — 성조별 정답률 5각형. toneStats(1·2·3·4·경성)로 데이터 폴리곤을 그림 ──
const RADAR = { cx: 100, cy: 80, R: 52 };
const TONE_LABEL = { 1: '1성', 2: '2성', 3: '3성', 4: '4성', 0: '경성' };
const TONE_COLOR = { 1: '#FF4D6D', 2: '#FF9F40', 3: TG.SUCCESS_GLOW, 4: '#4D8DFF', 0: '#AAB2BD' };
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
    <div style={{ background: '#fff', border: '1.5px solid #efeae4', borderRadius: RADIUS.btn, padding: '16px 18px 10px' }}>
      <span style={{ ...TYPE.labelSm, color: TG.INK }}>내 귀 지도 · 성조별 정답률</span>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginTop: SPACE.xxs }}>
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
          <span style={{ position: 'absolute', top: '54%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', ...TYPE.meta, color: TG.SUB, padding: '0 28px' }}>
            더 플레이하면 성조별 실력이 보여요
          </span>
        )}
      </div>
    </div>
  );
}

function WordStatRow({ word, acc }) {
  const pct = Math.round(acc * 100);
  const c = masteryColor(acc);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, padding: '14px 16px', borderRadius: RADIUS.btn, background: '#fff', border: '1.5px solid #efeae4', flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md }}>
          <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 24, color: TG.INK }}>{word.hanzi}</span>
          <span style={{ ...TYPE.sub, color: TG.SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{word.meaning}</span>
        </div>
        <div style={{ fontFamily: FONT_PINYIN, fontWeight: 500, fontSize: 12, color: TG.SUB, marginTop: SPACE.xs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(word.pinyin || []).join(' ')}</div>
      </div>
      {/* 정답률만(% + 바) — 평균시간은 부차적이라 제외해 왼쪽 2행과 균형 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: SPACE.sm, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span style={{ ...TYPE.numMd, color: c }}>{pct}</span>
          <span style={{ ...TYPE.numMd, fontSize: 12, color: c }}>%</span>
        </div>
        <div style={{ width: 64, height: 6, borderRadius: RADIUS.xs, background: TG.TRACK, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: RADIUS.xs }} />
        </div>
      </div>
      {/* 발음 듣기(TTS) */}
      <button onClick={() => speakWord(word)} aria-label="발음 듣기" className="tg-press" style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: TG.SURFACE, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
        <SpeakerHighIcon size={18} weight="fill" color="#767676" />
      </button>
    </div>
  );
}

export function MasteryScreen({ rows, masteredN, xp = 0, rank = 0, onExam, toneStats, onBack, onReview }) {
  const need = rows.length;
  const reviewN = Math.min(ROUND_LENGTH, need);
  const tier = displayTier(rank, xp); // 등급 = 저장 rank(승급 시험 게이트). 게이지는 XP 진행. 마스터 수는 복습 학습 통계로 별도 표시.
  return (
    <>
      <GameHeader title="내 등급" onBack={onBack} />
      {/* 스크롤 영역 — 코치 + 레이더 + 소제목 + 리스트를 함께 스크롤(모바일서 리스트가 좁은 고정영역에 갇히지 않게) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 52, bottom: need > 0 ? 'calc(102px + env(safe-area-inset-bottom))' : 'calc(24px + env(safe-area-inset-bottom))',
        overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 24px 10px', zIndex: 2,
        // 헤더 바(52px) 바닥에 딱 붙는 위·아래 가장자리 페이드(난이도 선택 화면과 동일 방식). 위는 엠블럼 안 흐리게 얕게, 아래는 리스트가 부드럽게 사라지게
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 20px, #000 calc(100% - 48px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 20px, #000 calc(100% - 48px), transparent 100%)',
      }}>
        {/* 성장 엠블럼 히어로 — 중앙 대형 엠블럼 + 단계별 글로우/파티클 + 단계명 + 진행 */}
        <Reveal i={1}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md, padding: '6px 0 2px' }}>
            {/* 엠블럼 + 글로우 + 반짝임 파티클 */}
            <div style={{ position: 'relative', width: '100%', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div aria-hidden="true" style={{ position: 'absolute', width: 196, height: 196, borderRadius: '50%', pointerEvents: 'none', background: `radial-gradient(closest-side, ${tier.glow}66, ${tier.glow}1a 55%, ${tier.glow}00 72%)` }} />
              {PARTICLE_POS.slice(0, tier.particles).map(([dx, dy, sz], i) => (
                <div key={i} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(${dx}px, ${dy}px)`, pointerEvents: 'none' }}>
                  <div style={{ animation: `tg-sparkle ${2.4 + i * 0.35}s ease-in-out ${i * 0.45}s infinite` }}>
                    <svg viewBox="0 0 24 24" width={sz} height={sz} aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={tier.spark} /></svg>
                  </div>
                </div>
              ))}
              <img src={tier.emblem} alt="" width={132} height={132} style={{ position: 'relative', filter: `drop-shadow(0 8px 18px ${tier.glow}55)` }} />
            </div>
            {/* 단계명 */}
            <span style={{ ...TYPE.title, color: TG.INK }}>{tier.name}</span>
            {/* 진행 — 누적 XP 게이지 */}
            {tier.isMax ? (
              <span style={{ ...TYPE.labelSm, color: '#E0A21A' }}>최고 등급 달성! 🎉 · 누적 {xp.toLocaleString()} XP</span>
            ) : (
              <>
                <div style={{ width: 220, height: 8, borderRadius: RADIUS.xs, background: TG.TRACK, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(tier.progress * 100)}%`, height: '100%', borderRadius: RADIUS.xs, background: TG.CORAL_GRAD, transition: 'width .4s ease' }} />
                </div>
                <span style={{ ...TYPE.meta, color: TG.SUB }}>{tier.examReady ? '승급 시험 준비 완료!' : `다음 등급까지 ${tier.toNext.toLocaleString()} XP`} · 누적 {xp.toLocaleString()} XP</span>
              </>
            )}
            {/* 승급 시험 CTA — 게이지 만땅(examReady)일 때만. 합격하면 등급 상승. */}
            {tier.examReady && onExam && (
              <button onClick={() => { playSfx('button'); onExam(); }} className="tg-press" style={{
                marginTop: SPACE.xl, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: '12px 22px', borderRadius: RADIUS.lg,
                border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0 8px 18px rgba(242,72,76,0.3)', ...TOUCH_OPT,
              }}>
                <MedalIcon size={19} weight="fill" color="#fff" />
                <span style={{ ...TYPE.btn, color: '#fff' }}>승급 시험 보기</span>
              </button>
            )}
          </div>
        </Reveal>
        <Reveal i={2} style={{ display: 'block', marginTop: 30 }}><CoachBubble text={need ? '약한 단어부터 복습해 볼까요?' : '잘하고 있어요! 계속 도전해요'} /></Reveal>
        {/* 내 귀 지도(성조 레이더, P2) */}
        <Reveal i={3} style={{ display: 'block', marginTop: SPACE.x2 }}><ToneRadar toneStats={toneStats} /></Reveal>
        {need > 0 ? (
          <>
            {/* 소제목 */}
            <div style={{ marginTop: SPACE.x3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TYPE.labelSm, color: TG.INK }}>복습 필요 {need}개</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs, background: 'rgba(54,201,141,0.14)', padding: '5px 11px', borderRadius: RADIUS.md }}>
                <span style={{ ...TYPE.labelSm, color: TG.SUCCESS }}>✓ 마스터 {masteredN}개</span>
              </div>
            </div>
            {/* 리스트 */}
            <div style={{ marginTop: SPACE.xl, display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
              {rows.map((r) => <WordStatRow key={r.word.hanzi} word={r.word} acc={r.acc} />)}
            </div>
          </>
        ) : (
          <div style={{ marginTop: SPACE.x4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md, textAlign: 'center' }}>
            <span style={{ ...TYPE.head, fontSize: 18, color: TG.INK }}>아직 복습할 단어가 없어요</span>
            <span style={{ ...TYPE.sub, color: TG.SUB }}>게임을 플레이하면 약한 단어가 모여요</span>
          </div>
        )}
      </div>
      {/* 복습 CTA */}
      {need > 0 && (
        <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <button onClick={() => { playSfx('button'); onReview(); }} className="tg-press" style={{
          width: '100%', height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD,
          boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
        }}>
          <span style={{ ...TYPE.cta, color: '#fff' }}>약한 단어 {reviewN}개 복습하기</span>
          <PlayIcon size={14} weight="fill" color="#fff" />
        </button>
        </Reveal>
      )}
    </>
  );
}
