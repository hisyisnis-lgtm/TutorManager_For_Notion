// 단어 숙련도 화면 (Figma "15. 단어 숙련도") — 복습필요 리스트 + 마스터 수 + 복습 CTA.
import { CaretLeftIcon, SpeakerHighIcon, PlayIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_HANZI, FONT_BODY, FONT_NUM, TOUCH_OPT } from '../tgTokens.js';
import { ROUND_LENGTH } from '../../constants/toneGameWords.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble } from './shared.jsx';

function masteryColor(acc) { return acc >= 0.8 ? TG.SUCCESS_GLOW : acc >= 0.5 ? TG.SUN : TG.CORAL; }

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

export function MasteryScreen({ rows, masteredN, onBack, onReview }) {
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
      {/* 소제목 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 172, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#2b2730' }}>복습 필요 {need}개</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(54,201,141,0.14)', padding: '5px 11px', borderRadius: 12 }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: TG.SUCCESS }}>✓ 마스터 {masteredN}개</span>
        </div>
      </div>
      {/* 복습 필요 → 리스트(스크롤) / 없음 → 빈 상태(상단 1/3 고정) */}
      {need > 0 ? (
        <div style={{ position: 'absolute', left: 24, right: 24, top: 204, bottom: 'calc(110px + env(safe-area-inset-bottom))', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
          {rows.map((r) => <WordStatRow key={r.word.hanzi} word={r.word} acc={r.acc} avg={r.avg} />)}
        </div>
      ) : (
        <div style={{ position: 'absolute', left: 24, right: 24, top: '38%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 18, color: '#2b2730' }}>아직 복습할 단어가 없어요</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>게임을 플레이하면 약한 단어가 모여요</span>
        </div>
      )}
      {/* 복습 CTA */}
      {need > 0 && (
        <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
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
