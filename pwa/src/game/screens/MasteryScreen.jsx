// 오답 노트 화면 (Figma "13. 오답 노트" / "13. 오답 노트_스크롤", 2026-08-05 리디자인)
//  구 "내 등급" 대시보드(등급 엠블럼·Lv 게이지·코치·성조 레이더·마스터 배지)는 시안에서 전부 빠졌다 —
//  등급은 프로필 모달, 레벨 게이지는 홈 HUD에 이미 있어 정보 손실 없음. 이 화면은 **틀린 단어 → 바로 복습**만 한다.
//  카드 정보열은 가용 폭을 쓰고, 긴 단어는 높이를 늘려 발음 버튼과 겹치지 않게 한다.
import { VolumeLoud, Play } from '@solar-icons/react';
import { TG, HOME, FONT_HANZI, FONT_PINYIN, FONT_NUM, TOUCH_OPT, TYPE, SPACE, SHADOW, keycap } from '../tgTokens.js';
import { NOTE_TARGET } from '../tgWordStats.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, TgTabBar, TAB_BAR_H, useStickyHeader, KeycapCta } from './shared.jsx';

// 시안 13 실측 — 토큰에 있는 색은 참조, 원오프만 리터럴 (2026-08-31 토큰 통합)
const TITLE_INK = TG.INK;    // 제목 (원오프)
const PCT_INK = HOME.INK;       // 정답률 %
const BAR_TRACK = HOME.GAUGE_TRACK; // 정답률 트랙
const BAR_FILL = TG.CTA;        // 정답률 채움 = CTA 레드
const SPEAKER_EDGE = TG.BORDER; // 발음듣기 버튼 하단 인너 엣지 (원오프)
const DIVIDER = TG.BORDER; // 스크롤 시 상단 고정 블록 구분선

// 오답 단어 한 줄 — 단어(한자·병음·뜻)와 복습 진행을 묶고, 발음듣기는 54px을 유지한다.
//  진행 = 졸업까지 필요한 정답 3번 중 몇 번을 채웠는가(구 '누적 정답률'을 규칙 개편으로 교체).
function WrongWordRow({ word, left }) {
  const done = Math.max(0, NOTE_TARGET - left); // 채운 정답 횟수
  const pct = Math.round((done / NOTE_TARGET) * 100);
  return (
    <div style={{
      minHeight: 80, borderRadius: 20, background: '#fff', boxShadow: SHADOW.level1,
      display: 'flex', alignItems: 'center', gap: SPACE.lg, padding: SPACE.lg, flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
        {/* 긴 한자나 병음은 같은 단어 묶음 안에서 줄바꿈한다. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${SPACE.xs}px ${SPACE.md}px` }}>
          <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 30, lineHeight: '36px', color: TG.INK, maxWidth: '100%', overflowWrap: 'anywhere' }}>{word.hanzi}</span>
          <div style={{ flex: '1 1 95px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
            <span style={{ fontFamily: FONT_PINYIN, fontWeight: 700, fontSize: 14, lineHeight: '18px', color: TG.SUB, overflowWrap: 'anywhere' }}>{(word.pinyin || []).join(' ')}</span>
            <span style={{ ...TYPE.label, lineHeight: '18px', color: TG.SUB, overflowWrap: 'anywhere' }}>{word.meaning}</span>
          </div>
        </div>
        {/* 진행 바는 정보열의 남은 폭을 사용하고 횟수는 항상 보인다. */}
        <div style={{ height: 16, display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <div style={{ flex: 1, minWidth: 0, height: 10, borderRadius: 19, background: BAR_TRACK, overflow: 'hidden' }}
            role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={NOTE_TARGET} aria-label={`${word.hanzi} 정답 ${done}번 / ${NOTE_TARGET}번`}>
            <div style={{ width: `${pct}%`, height: '100%', background: BAR_FILL, transition: 'width .3s ease' }} />
          </div>
          <span style={{ fontFamily: FONT_NUM, fontWeight: 500, fontSize: 14, lineHeight: '16px', fontVariantNumeric: 'tabular-nums', color: PCT_INK, whiteSpace: 'nowrap', flexShrink: 0 }}>{done}/{NOTE_TARGET}</span>
        </div>
      </div>
      {/* 발음 듣기 54 r12 — 아이콘 28 정중앙(시안), 하단 인너 엣지 */}
      <button onClick={() => speakWord(word)} aria-label={`${word.hanzi} 발음 듣기`} className="tg-press" style={{
        width: 54, height: 54, borderRadius: 12, background: TG.SURFACE, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        boxShadow: keycap(SPEAKER_EDGE, { lift: null }), ...TOUCH_OPT,
      }}>
        <VolumeLoud size={28} weight="Bold" color={TG.SUB} />
      </button>
    </div>
  );
}

// 주 CTA — 시안 13: 342×50 r20 레드 키캡(라벨 21 + 플레이 18). 오답이 없을 땐 같은 자리에 '문제 풀기'로 바뀐다.
function PrimaryCta({ label, onClick }) {
  return (
    <KeycapCta height={50} label={label} labelStyle={{ whiteSpace: 'nowrap' }} Icon={Play}
      onClick={() => { playSfx('button'); onClick(); }}
      style={{ boxShadow: keycap(TG.CTA_EDGE, { lift: SHADOW.ctaGlow }) }} />
  );
}

export function MasteryScreen({ rows, onReview, onPlay, tabNav, achDot = false }) {
  // 제목 아래의 복습 버튼을 스크롤 중에도 유지한다. 제목·CTA·목록은 같은 세로 흐름을 쓴다.
  const { scrollRef, sentinelRef, stuck } = useStickyHeader();
  const need = rows.length;
  return (
    <>
      <div className="tg-noscroll" ref={scrollRef} style={{
        scrollbarWidth: 'none', // 데스크톱 스크롤바가 폭을 먹어 342 컬럼이 좁아지지 않게(모바일은 원래 없음)
        position: 'absolute', left: 0, right: 0, top: 0, bottom: `calc(${TAB_BAR_H}px + env(safe-area-inset-bottom))`,
        overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 24px', zIndex: 2,
      }}>
        {/* 제목의 두 번째 줄에 복습 규칙을 함께 안내한다. */}
        <Reveal i={0} style={{ display: 'block', marginTop: 40 }}>
          <span style={{ display: 'block', ...TYPE.head, fontSize: 26, lineHeight: '31px', color: TITLE_INK }}>
            {need > 0 ? <>틀린 단어 {need}개,<br />3번 맞히면 사라져요</> : <>아직 복습할<br />단어가 없어요</>}
          </span>
          {need === 0 && (
            // 복습할 게 없으면 같은 자리에서 곧장 게임으로 이어진다.
            <div style={{ marginTop: 20 }}><PrimaryCta label="문제 풀기" onClick={onPlay} /></div>
          )}
        </Reveal>
        {need > 0 && (
          <>
          {/* 센티넬을 고정 블록 시작에 두어 실제 고정 시점과 배경 전환을 맞춘다. */}
          <div ref={sentinelRef} aria-hidden="true" style={{ height: 0 }} />
          {/* ★Reveal(transform) 안에 넣으면 sticky가 죽는다 — 고정 블록은 페이드만(tg-fade) */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 3, margin: '0 -24px 0', padding: '20px 24px 12px',
            // 배경엔 transition 금지 — 페이드 도중 반투명 구간에서 뒤 행이 비쳐 '틈'으로 보인다.
            background: stuck ? '#fff' : 'transparent', boxShadow: stuck ? `0 2px 0 ${DIVIDER}` : 'none',
          }}>
            <PrimaryCta label="복습 하기" onClick={onReview} />
          </div>
          </>
        )}
        {need > 0 && (
          // CTA 아래 총 24px, 카드 사이는 12px로 복습 대상들을 한 목록으로 묶는다.
          <div style={{ marginTop: SPACE.lg, display: 'flex', flexDirection: 'column', gap: SPACE.lg, paddingBottom: 40 }}>
            {rows.map((r, ri) => (
              <Reveal key={r.word.hanzi} i={ri + 2}>
                <WrongWordRow word={r.word} left={r.left} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
      <TgTabBar active="mastery" onNav={tabNav} dot={achDot ? "ach" : null} />
    </>
  );
}
