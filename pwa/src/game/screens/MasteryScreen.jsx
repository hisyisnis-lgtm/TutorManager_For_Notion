// 오답 노트 화면 (Figma "13. 오답 노트" / "13. 오답 노트_스크롤", 2026-08-05 리디자인)
//  구 "내 등급" 대시보드(등급 엠블럼·Lv 게이지·코치·성조 레이더·마스터 배지)는 시안에서 전부 빠졌다 —
//  등급은 프로필 모달, 레벨 게이지는 홈 HUD에 이미 있어 정보 손실 없음. 이 화면은 **틀린 단어 → 바로 복습**만 한다.
//  내부 수치는 전부 시안 절대값(라인하이트 고정) — flex 중앙정렬에 맡기면 라인박스가 여백을 먹는다.
import { useState } from 'react';
import { VolumeLoud, Play } from '@solar-icons/react';
import { TG, FONT_HANZI, FONT_PINYIN, FONT_NUM, TOUCH_OPT, TYPE, SPACE } from '../tgTokens.js';
import { NOTE_TARGET } from '../tgWordStats.js';
import { speakWord } from '../tgTts.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, TgTabBar, TAB_BAR_H } from './shared.jsx';

// 시안 13 실측 — 토큰에 없는 원오프 색만 상수로
const TITLE_INK = '#272622';    // 제목
const PCT_INK = '#452C1C';      // 정답률 %
const BAR_TRACK = '#E2D7C1';    // 정답률 트랙
const BAR_FILL = '#F96163';     // 정답률 채움 = CTA 레드
const CTA_EDGE = '#E64244';     // CTA 하단 인너 엣지
const SPEAKER_EDGE = '#E6E0D6'; // 발음듣기 버튼 하단 인너 엣지
const DIVIDER = '#E9E6DE';      // 스크롤 시 상단 고정 블록 구분선

// 오답 단어 한 줄 — 시안 13 실측(2026-08-10 갱신): 342×77 · r20 · 흰 카드 · shadow 0/4 b18 4%.
//  내부 = [한자행 37] gap4 [진행행 16], padding 10/10/10/14, 컬럼 223 + 발음듣기 54.
//  진행 = 졸업까지 필요한 정답 3번 중 몇 번을 채웠는가(구 '누적 정답률'을 규칙 개편으로 교체).
function WrongWordRow({ word, left }) {
  const done = Math.max(0, NOTE_TARGET - left); // 채운 정답 횟수
  const pct = Math.round((done / NOTE_TARGET) * 100);
  return (
    <div style={{
      height: 77, borderRadius: 20, background: '#fff', boxShadow: '0px 4px 18px rgba(43,39,48,0.04)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 10px 10px 14px', flexShrink: 0,
    }}>
      <div style={{ width: 223, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
        {/* 한자 30 + [병음 14 / 뜻 14] — 시안 gap 8, 병음·뜻 사이 3, 행 높이 37 */}
        <div style={{ height: 37, display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 30, lineHeight: '36px', color: TG.INK, flexShrink: 0 }}>{word.hanzi}</span>
          {/* 시안의 병음/뜻 블록은 95 고정이지만 뜻('잘못되다, 틀리다')이 그 폭을 넘어 그려진다(Figma는 클리핑 안 함).
              코드에서 95로 자르면 '…'이 되므로 넘침을 허용하되, 발음듣기 버튼과 겹치지 않게 210에서만 자른다(2026-08-10). */}
          <div style={{ width: 95, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
            <span style={{ fontFamily: FONT_PINYIN, fontWeight: 700, fontSize: 14, lineHeight: '17px', color: TG.SUB, whiteSpace: 'nowrap', maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }}>{(word.pinyin || []).join(' ')}</span>
            <span style={{ ...TYPE.label, lineHeight: '17px', color: TG.SUB, whiteSpace: 'nowrap', maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }}>{word.meaning}</span>
          </div>
        </div>
        {/* 졸업 진행 바 193×10 + 'n/3' (Roboto Medium 14) — 다 채우면 노트에서 사라진다. 시안 행 높이 16 */}
        <div style={{ height: 16, display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 193, height: 10, borderRadius: 19, background: BAR_TRACK, overflow: 'hidden', flexShrink: 0 }} /* 시안 13 실측 193×10 — 뜻 칸만 넓히고 바 길이는 시안 그대로 */
            role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={NOTE_TARGET} aria-label={`${word.hanzi} 정답 ${done}번 / ${NOTE_TARGET}번`}>
            <div style={{ width: `${pct}%`, height: '100%', background: BAR_FILL, transition: 'width .3s ease' }} />
          </div>
          <span style={{ fontFamily: FONT_NUM, fontWeight: 500, fontSize: 14, lineHeight: '16px', color: PCT_INK, whiteSpace: 'nowrap' }}>{done}/{NOTE_TARGET}</span>
        </div>
      </div>
      {/* 발음 듣기 54 r12 — 아이콘 28 정중앙(시안), 하단 인너 엣지 */}
      <button onClick={() => speakWord(word)} aria-label={`${word.hanzi} 발음 듣기`} className="tg-press" style={{
        width: 54, height: 54, borderRadius: 12, background: TG.SURFACE, border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        boxShadow: `inset 0 -4px 0 ${SPEAKER_EDGE}`, ...TOUCH_OPT,
      }}>
        <VolumeLoud size={28} weight="Bold" color={TG.ICON} />
      </button>
    </div>
  );
}

// 주 CTA — 시안 13: 342×50 r20 레드 키캡(라벨 21 + 플레이 18). 오답이 없을 땐 같은 자리에 '문제 풀기'로 바뀐다.
function PrimaryCta({ label, onClick }) {
  return (
    <button onClick={() => { playSfx('button'); onClick(); }} className="tg-press" style={{
      width: '100%', height: 50, borderRadius: 20, border: 'none', cursor: 'pointer', background: BAR_FILL,
      boxShadow: `0px 10px 20px rgba(242,72,76,0.1), inset 0 -4px 0 ${CTA_EDGE}`, paddingBottom: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
    }}>
      <span style={{ ...TYPE.head, color: '#fff', whiteSpace: 'nowrap' }}>{label}</span>
      <Play size={18} weight="Bold" color="#fff" />
    </button>
  );
}

export function MasteryScreen({ rows, onReview, onPlay, tabNav }) {
  // 스크롤 상태(시안 13_스크롤): 제목이 밀려 올라가고 CTA가 상단에 고정 — 흰 블록 110 + 하단 2px 구분선.
  //  sticky top:0 + paddingTop 40 → 고정 시 CTA가 y40에 서고 블록 높이가 정확히 110(40+50+20)이 된다.
  const [stuck, setStuck] = useState(false);
  const need = rows.length;
  return (
    <>
      <div className="tg-noscroll" onScroll={(e) => { const s = e.currentTarget.scrollTop > 4; setStuck((prev) => (prev === s ? prev : s)); }} style={{
        scrollbarWidth: 'none', // 데스크톱 스크롤바가 폭을 먹어 342 컬럼이 좁아지지 않게(모바일은 원래 없음)
        position: 'absolute', left: 0, right: 0, top: 0, bottom: `calc(${TAB_BAR_H}px + env(safe-area-inset-bottom))`,
        overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 24px', zIndex: 2,
      }}>
        {/* 제목 — 시안 y40 · 26px 2줄(라인 31). 오답이 없으면 이 자리에 빈 상태 문구를 대신 놓는다(화면 위쪽 리듬 유지).
            ★2줄째가 졸업 규칙을 겸한다 — 별도 안내문을 끼우면 아래 sticky CTA 위치가 밀린다(레이아웃 유지) */}
        <Reveal i={0} style={{ display: 'block', marginTop: 40 }}>
          <span style={{ display: 'block', ...TYPE.head, fontSize: 26, lineHeight: '31px', color: TITLE_INK }}>
            {need > 0 ? <>틀린 단어 {need}개,<br />3번 맞히면 사라져요</> : <>아직 복습할<br />단어가 없어요</>}
          </span>
          {need === 0 && (
            // 복습할 게 없으면 같은 자리에서 곧장 게임으로 — 빈 화면에 갇히지 않게. 위치는 '복습 하기'와 동일(y122)
            <div style={{ marginTop: 20 }}><PrimaryCta label="문제 풀기" onClick={onPlay} /></div>
          )}
        </Reveal>
        {need > 0 && (
          // ★Reveal(transform) 안에 넣으면 sticky가 죽는다 — 고정 블록은 페이드만(tg-fade)
          <div className="tg-fade" style={{
            position: 'sticky', top: 0, zIndex: 3, margin: '-20px -24px 0', padding: '40px 24px 20px', animationDelay: '85ms',
            background: stuck ? '#fff' : 'transparent', boxShadow: stuck ? `0 2px 0 ${DIVIDER}` : 'none', transition: 'background .15s ease',
          }}>
            <PrimaryCta label="복습 하기" onClick={onReview} />
          </div>
        )}
        {need > 0 && (
          // 리스트 — 시안 y222(고정 블록 아래 30) · 행 간격 10. 행마다 스태거(최대 5단계까지만 늘어남)
          <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: SPACE.lg, paddingBottom: 40 }}>
            {rows.map((r, ri) => (
              <Reveal key={r.word.hanzi} i={ri + 2}>
                <WrongWordRow word={r.word} left={r.left} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
      <TgTabBar active="mastery" onNav={tabNav} />
    </>
  );
}
