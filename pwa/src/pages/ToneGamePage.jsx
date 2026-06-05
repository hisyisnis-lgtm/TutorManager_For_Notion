// 성조 빨리 찾기 미니게임 — 리디자인(밝고 친근 캐주얼)
// 학생앱 공개 라우트(`/personal/:studentToken/game/tone`)에서 진입.
// 플로우: 시작 → 난이도 → 카운트다운 → 게임(정답/오답/시간초과) → 결과 (+ 일시정지 모달)
// 로직(콤보 타이밍·스코어·서버동기화)은 검증된 구현 유지, 비주얼은 Figma 시안 그대로.
// 이미지(판다·타이틀·배경)는 Figma에서 추출 (pwa/public/game/). 디자인 사양: 메모리 tone_game_redesign.md
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { App } from 'antd';
import {
  CaretLeftIcon, PauseIcon, StarIcon, PlayIcon, ArrowClockwiseIcon, SignOutIcon,
  LeafIcon, RocketIcon, CrownIcon, CheckCircleIcon, TimerIcon, LightningIcon, TrophyIcon,
  InstagramLogoIcon, YoutubeLogoIcon, ArticleIcon, HandWavingIcon, CaretRightIcon, ChartBarIcon,
  StairsIcon, LockSimpleIcon, SpeakerHighIcon, SpeakerSlashIcon,
} from '@phosphor-icons/react';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { fetchToneWords, requestGameOtp, verifyGameOtp } from '../api/gameApi.js';
import { resolveIdentity, fetchBests, submitResult, mergeGuestIntoStudent, pullMemberData, pushMemberData, mergeStudentIntoMember, loginMember, logoutMember, mergeGuestIntoMember, isMember } from '../game/gameStore.js';
import { TONES, ROUND_LENGTH, DIFFICULTIES } from '../constants/toneGameWords.js';
import {
  TG, FONT_TITLE, FONT_NUM, FONT_BODY, FONT_HANZI, RADIUS, SHADOW, DUR, TOUCH_OPT,
  TONE_TINTS, TONE_BORDERS, DIFF_COLORS, ASSETS, ensureGameFonts, pickCelebratePanda,
  haptic, shuffle, getTimeLimitForCombo, loadBest, saveBest,
} from '../game/tgTokens.js';
import { ToneMark, useCountUp, ComboChip, FlameIcon } from '../game/tgWidgets.jsx';
import {
  loadWordStats, saveWordStats, recordWordResult, subsetForPool, mergeStats,
  buildReviewList, masteredCount,
} from '../game/tgWordStats.js';
import { initTts, speakWord } from '../game/tgTts.js';
import { initSfx, play as playSfx, isSfxMuted, setSfxMuted } from '../game/tgSfx.js';

const DIFF_META = {
  easy:   { Icon: LeafIcon,   stars: 1 },
  normal: { Icon: RocketIcon, stars: 2 },
  hard:   { Icon: CrownIcon,  stars: 3 },
};

// 미리보기 모드(?screen=game)에서 게임 화면 렌더용 샘플 단어
const PREVIEW_WORDS = [
  { hanzi: '老师', pinyin: ['lǎo', 'shī'], tones: [3, 1], meaning: '선생님' },
  { hanzi: '咖啡', pinyin: ['kā', 'fēi'], tones: [1, 1], meaning: '커피' },
];

// ── keyframes / 글로벌 게임 스타일 ─────────────────────
function ToneGameStyles() {
  return (
    <style>{`
      @keyframes tg-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      @keyframes tg-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
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

// ── 단어 카드 (반응형 + 고정 슬롯, 메모리 §5) ──────────
function WordCard({ word, entered, currentSyl, completed, timedOut, progressText, combo, comboFlash, floatScore, hideProgress }) {
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
          color: isCurrent ? TG.CORAL_DK : TG.INK, transition: `color ${DUR.state} ease`,
        }}>{word.hanzi[i] ?? ''}</div>
        <div style={{ height: hz > 50 ? 26 : 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {completed && (
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: hz > 50 ? 17 : 14, color: TG.SUB }}>{word.pinyin[i] ?? ''}</span>
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
          <span style={{ color: '#9a93a0', fontSize: 14 }}>/ {progressText.split('/')[1]}</span>
        </div>
      )}
      <div style={{ position: 'absolute', right: 16, top: 14 }}><ComboChip combo={combo} flash={comboFlash} /></div>
      {floatScore && (
        <div style={{
          position: 'absolute', right: 20, top: 44, zIndex: 2, fontFamily: FONT_NUM, fontWeight: 800, fontSize: 22,
          color: TG.SUCCESS, animation: 'tg-float 1.3s ease-out forwards', pointerEvents: 'none',
        }}>{floatScore}</div>
      )}
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
    </div>
  );
}

// ── 성조 버튼 5개 (성조색 소프트 틴트 배경) ────────────
function ToneButtons({ onTone, wrongBtn, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 9, height: 81, alignItems: 'stretch' }}>
      {TONES.map((t) => {
        const isWrong = wrongBtn === t.num;
        return (
          <button
            key={t.num} onClick={() => onTone(t.num)} disabled={disabled} aria-label={t.name}
            className={`tg-press ${isWrong ? 'tg-shake' : ''}`}
            style={{
              flex: 1, minWidth: 0, height: '100%', cursor: disabled ? 'default' : 'pointer', borderRadius: 20,
              background: isWrong ? '#FFD9D9' : TONE_TINTS[t.num],
              border: `1.5px solid ${isWrong ? TG.DANGER : TONE_BORDERS[t.num]}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              paddingTop: 16, paddingBottom: 12, color: t.color, ...TOUCH_OPT,
            }}
          >
            <ToneMark tone={t.num} size={34} />
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: t.color }}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 일시정지 모달 ──────────────────────────────────────
function PauseModal({ score, combo, onResume, onRestart, onQuit }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(43,39,48,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)',
    }}>
      <div className="tg-enter" style={{
        width: '100%', maxWidth: 342, background: TG.CARD, borderRadius: 24, padding: '28px 22px 22px',
        boxShadow: '0 20px 60px rgba(43,39,48,0.3)', textAlign: 'center',
      }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: TG.CORAL_BG, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PauseIcon size={26} weight="fill" color={TG.CORAL_DK} />
        </div>
        <div style={{ fontFamily: FONT_TITLE, fontSize: 24, color: TG.INK, marginBottom: 4 }}>잠깐 멈췄어요</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: TG.SUB, marginBottom: 18 }}>이어서 도전할까요?</div>
        <div style={{ display: 'flex', background: '#FFF7E9', borderRadius: 14, padding: '14px 0', marginBottom: 18 }}>
          {[['점수', score], ['콤보', combo]].map(([label, val], i) => (
            <div key={label} style={{ flex: 1, borderLeft: i ? '1px solid rgba(43,39,48,0.08)' : 'none' }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: TG.SUB, marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 20, color: TG.INK }}>{val}</div>
            </div>
          ))}
        </div>
        <button className="tg-press" onClick={onResume} style={{
          width: '100%', height: 52, border: 'none', borderRadius: RADIUS.btn, cursor: 'pointer', background: TG.CORAL_GRAD,
          color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8, boxShadow: SHADOW.btn, marginBottom: 10, ...TOUCH_OPT,
        }}><PlayIcon size={18} weight="fill" /> 계속하기</button>
        <button className="tg-press" onClick={onRestart} style={{
          width: '100%', height: 50, borderRadius: RADIUS.btn, cursor: 'pointer', background: TG.CARD,
          border: '1.5px solid rgba(43,39,48,0.1)', color: TG.INK, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, ...TOUCH_OPT,
        }}><ArrowClockwiseIcon size={17} weight="bold" /> 처음부터</button>
        <button className="tg-press" onClick={onQuit} style={{
          width: '100%', height: 40, background: 'none', border: 'none', cursor: 'pointer', color: TG.SUB,
          fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...TOUCH_OPT,
        }}><SignOutIcon size={16} weight="bold" /> 그만두기</button>
      </div>
    </div>
  );
}

// ── 시작 화면 (화면 터치해서 시작) ─────────────────────
// SNS 링크 (PersonalPage와 동일 URL). 인스타그램이 메인, 유튜브·블로그는 보조.
const PLAY_LINKS = {
  instagram: { href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==', handle: '@tiantian_laoshi' },
  youtube: { href: 'https://www.youtube.com/@tiantian_chinese', label: '유튜브', color: '#FF0000', Icon: YoutubeLogoIcon },
  blog: { href: 'https://blog.naver.com/tiantian_chinese/224100509217', label: '블로그', color: '#03C75A', Icon: ArticleIcon },
};

// 통합 최고점수 — 3난이도 기록 중 최고(+ 그 난이도 라벨). 타이틀 카드는 '내 최고 실력'을 보여줌.
function bestLabelForKey(gameKey) { const d = DIFFICULTIES.find((x) => x.gameKey === gameKey); return d ? d.label : '초급'; }
function overallBestFromLocal(token) {
  let top = null;
  for (const d of DIFFICULTIES) {
    const b = loadBest(token, d.gameKey);
    if (b && (b.bestScore || 0) > 0 && (!top || b.bestScore > top.bestScore)) top = { ...b, label: d.label };
  }
  return top;
}
function overallBestFromServer(bests) {
  let top = null;
  for (const b of (bests || [])) {
    const sc = b.bestScore || 0;
    if (sc > 0 && (!top || sc > top.bestScore)) top = { bestScore: sc, bestMaxCombo: b.bestMaxCombo || 0, bestAvgMs: (b.bestAvgSec || 0) * 1000, playCount: b.playCount || 0, label: bestLabelForKey(b.gameKey) };
  }
  return top;
}

// ── 잠금 사다리 / 무한모드 ──────────────────────────────
// 초급(항상) → 중급(초급≥1000) → 고급(중급≥1000) → 무한(고급≥1000). 점수는 난이도별 캐시(localStorage).
export const UNLOCK_THRESHOLD = 1000;
const GAMEKEY = { easy: 'tone-easy', normal: 'tone-normal', hard: 'tone-hard' };
const ENDLESS_BEST_KEY = 'tone-endless'; // localStorage 캐시 키(헤드라인 최고). 서버 동기화는 meta.eb.
function diffBestScore(token, diffId) { const b = loadBest(token, GAMEKEY[diffId]); return b ? (b.bestScore || 0) : 0; }
function isDifficultyUnlocked(token, diffId) {
  if (diffId === 'easy') return true;
  if (diffId === 'normal') return diffBestScore(token, 'easy') >= UNLOCK_THRESHOLD;
  if (diffId === 'hard') return diffBestScore(token, 'normal') >= UNLOCK_THRESHOLD;
  return false;
}
function isEndlessUnlocked(token) { return diffBestScore(token, 'hard') >= UNLOCK_THRESHOLD; }
function unlockReqText(diffId) {
  if (diffId === 'normal') return '초급 1,000점 달성 시 해제';
  if (diffId === 'hard') return '중급 1,000점 달성 시 해제';
  return '';
}
function unlockToastText(diffId) {
  if (diffId === 'normal') return '초급 1,000점을 달성하면 열려요';
  if (diffId === 'hard') return '중급 1,000점을 달성하면 열려요';
  return '';
}
// 무한모드 제한시간 — 누적 클리어 수에 따라 점점 짧아지고 하한 고정.
function getEndlessTimeLimit(cleared) { return Math.max(2500, 6500 - cleared * 180); }
// 무한모드 베스트 캐시(localStorage)
function loadEndlessBest(token) { return loadBest(token, ENDLESS_BEST_KEY); }
function saveEndlessBest(token, data) { saveBest(token, ENDLESS_BEST_KEY, data); }
// 타이틀 헤드라인 최고점수 = 무한 기록 우선, 없으면 난이도 통합 최고.
function headlineBest(token) {
  const eb = loadEndlessBest(token);
  if (eb && (eb.bestScore || 0) > 0) return { ...eb, label: '무한' };
  return overallBestFromLocal(token);
}

// '놀러가기' 모달 — 인스타그램(메인 그라데이션) + 유튜브·블로그(보조). Figma "14. 놀러가기" 기준.
function PlayModal({ onClose }) {
  const openLink = (href) => { try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ } };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 322, background: TG.CARD, borderRadius: 28, padding: '28px 24px 24px',
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
      }}>
        <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(255,107,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <HandWavingIcon size={30} weight="fill" color={TG.CORAL_DK} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', width: '100%' }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 24, color: '#2b2730' }}>놀러 오세요</span>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, color: '#9a93a0' }}>하늘쌤 채널에서 더 많은 중국어 이야기를</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 인스타그램 메인 (그라데이션) */}
          <button className="tg-press" onClick={() => openLink(PLAY_LINKS.instagram.href)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)', boxShadow: '0 8px 16px rgba(221,42,123,0.3)', ...TOUCH_OPT,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 24, background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <InstagramLogoIcon size={26} weight="fill" color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: '#fff' }}>인스타그램</span>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{PLAY_LINKS.instagram.handle}</span>
            </div>
            <CaretRightIcon size={20} weight="bold" color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
          </button>
          {/* 유튜브·블로그 보조 (간소화) */}
          <div style={{ display: 'flex', gap: 10 }}>
            {[PLAY_LINKS.youtube, PLAY_LINKS.blog].map((s) => (
              <button key={s.label} className="tg-press" onClick={() => openLink(s.href)} style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 0', borderRadius: 14,
                background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT,
              }}>
                <s.Icon size={20} weight="fill" color={s.color} />
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 15, color: '#9a93a0' }}>닫기</span>
        </button>
      </div>
    </div>
  );
}
// [디버그] 점수 기록 설정 모달 — 잠금 사다리/무한 해제/헤드라인 테스트용(프로덕션 전 제거)
function DebugScoreModal({ studentToken, onClose, onApplied }) {
  const [v, setV] = useState(() => ({
    easy: loadBest(studentToken, GAMEKEY.easy)?.bestScore || 0,
    normal: loadBest(studentToken, GAMEKEY.normal)?.bestScore || 0,
    hard: loadBest(studentToken, GAMEKEY.hard)?.bestScore || 0,
    endless: loadEndlessBest(studentToken)?.bestScore || 0,
  }));
  const rows = [['easy', '초급'], ['normal', '중급'], ['hard', '고급'], ['endless', '무한']];
  const apply = () => {
    for (const id of ['easy', 'normal', 'hard']) {
      const prev = loadBest(studentToken, GAMEKEY[id]) || {};
      saveBest(studentToken, GAMEKEY[id], { ...prev, bestScore: Number(v[id]) || 0, updatedAt: Date.now() });
    }
    const prevE = loadEndlessBest(studentToken) || {};
    saveEndlessBest(studentToken, { ...prevE, bestScore: Number(v.endless) || 0, updatedAt: Date.now() });
    onApplied(); onClose();
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: 24, padding: '22px 20px 18px', boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 19, color: '#2b2730', textAlign: 'center' }}>🛠 점수 디버그</span>
        {rows.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>{label}</span>
            <input type="number" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
              style={{ width: 120, height: 38, borderRadius: 10, border: '1.5px solid #ebe5de', padding: '0 12px', textAlign: 'right', fontFamily: FONT_NUM, fontWeight: 700, fontSize: 15, color: '#2b2730', background: '#fff' }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button onClick={() => setV((s) => ({ ...s, easy: 1000, normal: 1000, hard: 1000 }))} className="tg-press" style={{ flex: 1, height: 40, borderRadius: 12, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#2b2730', ...TOUCH_OPT }}>난이도 모두 1000</button>
          <button onClick={() => setV({ easy: 0, normal: 0, hard: 0, endless: 0 })} className="tg-press" style={{ flex: 1, height: 40, borderRadius: 12, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#9a93a0', ...TOUCH_OPT }}>초기화</button>
        </div>
        <button onClick={apply} className="tg-press" style={{ width: '100%', height: 50, borderRadius: 16, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: SHADOW.btn, color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, marginTop: 4, ...TOUCH_OPT }}>적용</button>
        <button onClick={onClose} className="tg-press" style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT_BODY, fontWeight: 500, fontSize: 14, color: '#9a93a0', ...TOUCH_OPT }}>닫기</button>
      </div>
    </div>
  );
}

// ── 로그인(회원) — 휴대폰 + 카카오 알림톡 OTP. Figma "로그인"(182:2). 단일 통합화면(단계 상태) ──
function LoginScreen({ onBack, onSuccess }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const { message } = App.useApp();

  useEffect(() => {
    if (timer <= 0) return undefined;
    const t = setTimeout(() => setTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneValid = /^01[016789]\d{7,8}$/.test(phoneDigits);
  const codeValid = /^\d{6}$/.test(code);
  const fmtTimer = `${String(Math.floor(timer / 60)).padStart(2, '0')}:${String(timer % 60).padStart(2, '0')}`;

  const reqOtp = async () => {
    if (!phoneValid || loading) { if (!phoneValid) message.error('휴대폰 번호를 확인해주세요.'); return; }
    setLoading(true);
    try {
      const r = await requestGameOtp(phoneDigits);
      setOtpSent(true); setTimer(180); playSfx('button');
      message.success('인증번호를 보냈어요. 카카오톡을 확인해주세요.');
      if (r?.devCode) message.info(`개발 코드: ${r.devCode}`);
    } catch (e) { message.error(e?.message || '발송에 실패했어요.'); }
    finally { setLoading(false); }
  };

  const doLogin = async () => {
    if (!otpSent || !codeValid || loading) return;
    setLoading(true);
    try {
      const { token, user } = await verifyGameOtp(phoneDigits, code);
      const nick = name.trim() || user?.nickname || null;
      loginMember(token, { ...user, nickname: nick });
      const idn = resolveIdentity(undefined); // 회원 세션 반영
      mergeGuestIntoMember(idn);              // 게스트 로컬 → 회원 로컬 병합
      await pushMemberData(idn, nick).catch(() => {}); // 회원 로컬+이름 → 서버 업로드
      playSfx('win');
      onSuccess();
    } catch (e) { message.error(e?.message || '로그인에 실패했어요.'); }
    finally { setLoading(false); }
  };

  const ctaReady = otpSent && codeValid;
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>로그인</span>
        </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="휴대폰 번호로 기록을 저장해드려요" />
      </Reveal>
      {/* 이름 입력 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 217 }}>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 12))} type="text" placeholder="이름"
          style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: '#fff', padding: '0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box' }} />
      </Reveal>
      {/* 휴대폰 입력 + 인라인 '인증번호 받기' */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 291 }}>
        <div style={{ position: 'relative', height: 62 }}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="numeric" placeholder="휴대폰 번호"
            style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: '#fff', padding: '0 124px 0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={reqOtp} disabled={!phoneValid || loading} className="tg-press" style={{ position: 'absolute', right: 10, top: 10, height: 42, padding: '0 14px', borderRadius: 12, border: 'none', cursor: phoneValid ? 'pointer' : 'default', background: phoneValid ? '#FFE8E8' : '#f3efe9', display: 'flex', alignItems: 'center', ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: phoneValid ? TG.CORAL_DK : '#b8b0a8' }}>{otpSent && timer > 0 ? fmtTimer : '인증번호 받기'}</span>
          </button>
        </div>
      </Reveal>
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 361 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>카카오 알림톡으로 인증번호를 보내드려요</span>
      </Reveal>
      {/* 인증번호 입력 (받기 전 비활성) */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, top: 385 }}>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} type="tel" inputMode="numeric" maxLength={6} placeholder="인증번호 6자리" disabled={!otpSent}
          style={{ width: '100%', height: 62, borderRadius: 16, border: '1.5px solid #efeae4', background: otpSent ? '#fff' : '#f7f3ee', padding: '0 18px', fontSize: 16, fontFamily: FONT_BODY, color: '#2b2730', outline: 'none', boxSizing: 'border-box', letterSpacing: 3 }} />
      </Reveal>
      {otpSent && (
        <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, top: 455 }}>
          <button onClick={reqOtp} disabled={timer > 0 || loading} style={{ background: 'none', border: 'none', cursor: timer > 0 ? 'default' : 'pointer', padding: 0, ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: timer > 0 ? '#c4bdb4' : TG.CORAL_DK }}>인증번호 다시 받기</span>
          </button>
        </Reveal>
      )}
      <Reveal i={7} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <button onClick={doLogin} disabled={!ctaReady || loading} className="tg-press" style={{
          width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: ctaReady ? 'pointer' : 'default',
          background: ctaReady ? TG.CORAL_GRAD : '#e8e2da', boxShadow: ctaReady ? '0px 10px 20px rgba(242,72,76,0.32)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{loading ? '잠시만요…' : '로그인'}</span>
        </button>
      </Reveal>
    </>
  );
}

// 타이틀 반짝임 파티클 — 4점 별. s=위치, size=px, delay=초
function Sparkle({ s, size = 14, delay = 0 }) {
  return (
    <div style={{ position: 'absolute', width: size, height: size, zIndex: 3, pointerEvents: 'none', animation: `tg-sparkle 2.8s ease-in-out ${delay}s infinite`, ...s }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" fill="#FFC23C" />
      </svg>
    </div>
  );
}

function StartScreen({ best, bestLabel, onStart, onClose, onDebugIntro, onMastery, studentToken, onRefreshBest, onLogin, isMemberUser, memberName, onLogout }) {
  const animBest = useCountUp(best?.bestScore || 0, 1100); // 최고점수 0→실값 카운트업
  const [playOpen, setPlayOpen] = useState(false);
  const [debugScoreOpen, setDebugScoreOpen] = useState(false);
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  return (
    <FigmaScreen bgImage={ASSETS.startBg}>
      <div style={{ position: 'absolute', inset: 0, ...TOUCH_OPT }}>
        {/* 타이틀 아트 (가로 중앙) — 로고 비율 2047×1039 ≈ 1.97:1 유지 + 프리미엄 효과(글로우·팝·빛스윕·반짝임) */}
        <Reveal i={0} style={{ position: 'absolute', top: 120, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 322 }}>
          <div style={{ position: 'relative' }}>
            {/* 로고 — 진입 시 통통 팝 */}
            <img src={ASSETS.startTitle} alt="성조 빨리찾기" style={{ position: 'relative', zIndex: 1, display: 'block', width: '100%', height: 'auto', objectFit: 'contain', animation: 'tg-logo-pop .7s cubic-bezier(.34,1.56,.64,1) both' }} />
            {/* 빛 스윕 — 로고 모양(PNG 알파)으로 마스크해 로고 안에서만 하이라이트가 스윽 지나감 */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
              WebkitMaskImage: `url(${ASSETS.startTitle})`, maskImage: `url(${ASSETS.startTitle})`,
              WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center',
              background: 'linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.42) 50%, transparent 60%)', backgroundSize: '300% 100%',
              animation: 'tg-shine 7s ease-in-out 1.2s infinite' }} />
            {/* 반짝임 파티클 — 로고 주변에 작은 별이 톡톡 */}
            <Sparkle s={{ top: '-9%', left: '5%' }} size={16} delay={0.4} />
            <Sparkle s={{ top: '12%', right: '1%' }} size={12} delay={1.8} />
            <Sparkle s={{ bottom: '-2%', left: '22%' }} size={13} delay={3.0} />
          </div>
        </Reveal>
        {/* 닫기 top20 left24 */}
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="닫기" className="tg-press"
          style={{ position: 'absolute', left: 24, top: 20, width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
          <CaretLeftIcon weight="bold" size={20} color={TG.INK} />
        </button>
        {/* 로그인/로그아웃 — 우상단 소리토글 옆 (게스트=로그인 진입, 회원=로그아웃). 학생은 둘 다 null이라 미표시 */}
        {onLogin && (
          <button onClick={(e) => { e.stopPropagation(); onLogin(); }} className="tg-press"
            style={{ position: 'absolute', right: 72, top: 20, height: 40, padding: '0 14px', borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: TG.CORAL_DK }}>로그인</span>
          </button>
        )}
        {isMemberUser && (
          <button onClick={(e) => { e.stopPropagation(); onLogout && onLogout(); }} className="tg-press"
            style={{ position: 'absolute', right: 72, top: 20, height: 40, padding: '0 14px', borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, ...TOUCH_OPT }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: TG.SUB }}>{memberName ? `${memberName} · ` : ''}로그아웃</span>
          </button>
        )}
        {/* 소리 on/off 토글 (SFX 음소거) — 우상단 */}
        <button onClick={(e) => { e.stopPropagation(); const next = !sfxOn; setSfxOn(next); setSfxMuted(!next); if (next) playSfx('button'); }} aria-label="소리" className="tg-press"
          style={{ position: 'absolute', right: 24, top: 20, width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
          {sfxOn ? <SpeakerHighIcon size={20} weight="fill" color={TG.INK} /> : <SpeakerSlashIcon size={20} weight="fill" color="#b8b0a8" />}
        </button>
        {/* [디버그] 가운데 상단 — 소개부터 / 점수. import.meta.env.DEV 게이트로 프로덕션 빌드선 dead-code 제거(번들서도 빠짐), dev에선 유지 */}
        {import.meta.env.DEV && onDebugIntro && (
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20, display: 'flex', gap: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); onDebugIntro(); }} className="tg-press"
              style={{ height: 32, padding: '0 12px', borderRadius: 16, background: 'rgba(43,39,48,0.55)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, ...TOUCH_OPT }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: '#fff' }}>🛠 소개부터</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); setDebugScoreOpen(true); }} className="tg-press"
              style={{ height: 32, padding: '0 12px', borderRadius: 16, background: 'rgba(43,39,48,0.55)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, ...TOUCH_OPT }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: '#fff' }}>🛠 점수</span>
            </button>
          </div>
        )}
        {/* 최고 점수 카드 top323 — 항상 표시(기록 없으면 0 + '도전!' 칩) */}
          <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 300 }}>
          <div style={{ height: 90, background: '#fff', borderRadius: 22, boxShadow: '0px 6px 16px rgba(43,39,48,0.06)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 23, background: '#fff6e8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <StarIcon size={21} weight="fill" color={TG.SUN} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0' }}>최고 점수</span>
              <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 26, color: '#2b2730' }}>{animBest.toLocaleString()}</span>
            </div>
            <div style={{ background: '#fff1f1', padding: '7px 12px', borderRadius: 14 }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#f2484c' }}>{best?.bestScore > 0 ? (bestLabel || '초급') : '도전!'}</span>
            </div>
          </div>
          </Reveal>
        {/* 성조 미리보기 칩 top431 */}
        <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 408 }}>
        <div style={{ height: 62, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
          {TONES.map((t, idx) => (
            // 칩마다 위상차(-idx*0.2s)를 줘 좌→우로 물결치듯 둥둥
            <div key={t.num} style={{ flex: 1, minWidth: 0, height: '100%', background: TONE_TINTS[t.num], borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', justifyContent: 'center', color: t.color, animation: 'tg-bob 3s ease-in-out infinite', animationDelay: `${-idx * 0.2}s` }}>
              <ToneMark tone={t.num} size={26} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: t.color }}>{t.name}</span>
            </div>
          ))}
        </div>
        </Reveal>
        {/* 판다 코치 말풍선 — 칩 하단(493)과 시작하기 CTA(상단 150) 사이 가용공간에 가두고 세로 중앙 정렬.
            top 고정이면 짧은 화면서 CTA에 가리고, bottom 고정이면 짧은 화면서 위쪽 칩과 겹침 → top·bottom 동시 지정 + flex center로 양쪽 모두 회피. */}
        <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 470, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
          <CoachBubble text="오늘도 성조 찾으러 가볼까요?" />
        </Reveal>
        {/* 시작하기 메인 CTA (하단 고정·풀폭) — 최하단 보조쌍 위 */}
        <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
        <button className="tg-press" onClick={() => { playSfx('button'); onStart(); }} style={{
          width: '100%', height: 60, borderRadius: 20, border: 'none', cursor: 'pointer',
          background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
        }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>시작하기</span>
          <PlayIcon size={14} weight="fill" color="#fff" />
        </button>
        </Reveal>
        {/* 보조 버튼 한 쌍 (하단) — 놀러가기 | 단어 숙련도 */}
        <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="tg-press" onClick={() => setPlayOpen(true)} style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16,
            background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT,
          }}>
            <HandWavingIcon size={18} weight="fill" color={TG.CORAL_DK} />
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>놀러가기</span>
          </button>
          <button className="tg-press" onClick={onMastery} style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16,
            background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT,
          }}>
            <ChartBarIcon size={18} weight="fill" color={TG.CORAL_DK} />
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>단어 숙련도</span>
          </button>
        </div>
        </Reveal>
      </div>
      {playOpen && <PlayModal onClose={() => setPlayOpen(false)} />}
      {import.meta.env.DEV && debugScoreOpen && <DebugScoreModal studentToken={studentToken} onClose={() => setDebugScoreOpen(false)} onApplied={() => onRefreshBest && onRefreshBest()} />}
    </FigmaScreen>
  );
}

// ── 반응형 화면 컨테이너 ────────────────────────────────
// 전체 높이 컬럼(최대폭 600, 가운데). 요소는 absolute로 상단=top / 하단=bottom 앵커 + left/right로 폭 채움.
// → 화면 폭이 넓어지면 요소가 넓어지고, 세로가 길어지면 상단·하단이 벌어지며 채워짐(잘림 없음).
// 상단 safe-area: 컬럼을 노치 아래에서 시작(top=safe-top)시켜 상단 요소(top:20 등)가 상태바에 안 가리게.
//   배경(bgImage)은 root(inset:0)라 노치까지 덮음. 하단은 각 CTA가 env(safe-area-inset-bottom)로 개별 처리.
function FigmaScreen({ children, bg = TG.BG, bgImage }) {
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
function Reveal({ i = 0, base = 80, step = 70, play = true, style, children }) {
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
function useTypewriter(text, speed = 35) {
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

function CoachBubble({ text }) {
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

// ── 난이도 선택 화면 (Figma 좌표 절대배치) ──────────────
function DifficultyScreen({ selected, studentToken, onSelect, onStart, onBack, onLocked }) {
  return (
    <>
      {/* 헤더 top20 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
      <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
        </button>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>난이도 선택</span>
      </div>
      </Reveal>
      {/* 판다 다이얼로그 top120 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="실력에 맞는 단계를 골라보세요" />
      </Reveal>
      {/* 카드 top217 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: 217, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {DIFFICULTIES.map((d, idx) => {
          const meta = DIFF_META[d.id];
          const c = DIFF_COLORS[d.id];
          const Icon = meta.Icon;
          const unlocked = isDifficultyUnlocked(studentToken, d.id);
          const best = diffBestScore(studentToken, d.id);
          const on = unlocked && selected.id === d.id;
          return (
            <Reveal key={d.id} i={2 + idx}>
            <ShakeButton shakeOnClick={!unlocked} onClick={() => { if (unlocked) onSelect(d); else onLocked && onLocked(unlockToastText(d.id)); }} className={unlocked ? 'tg-press' : ''} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
              padding: '16px 18px 16px 16px', borderRadius: 24, cursor: 'pointer',
              background: unlocked ? '#fff' : '#f7f3ee',
              border: on ? `2.5px solid ${c.accent}` : '1.5px solid #efeae4',
              boxShadow: on ? `0px 8px 20px ${c.glow}` : (unlocked ? '0px 4px 12px rgba(43,39,48,0.05)' : 'none'),
              transition: `transform .26s cubic-bezier(0.34,1.56,0.64,1), box-shadow ${DUR.state} ease, border-color ${DUR.state} ease`, ...TOUCH_OPT,
            }}>
              <div style={{ width: 54, height: 54, borderRadius: 18, flexShrink: 0, background: unlocked ? c.tint : '#efeae4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={26} weight="fill" color={unlocked ? c.accent : '#b8b0a8'} />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: unlocked ? '#2b2730' : '#9a93a0' }}>{d.label}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[1, 2, 3].map((s) => <StarIcon key={s} size={14} weight="fill" color={s <= meta.stars ? (unlocked ? TG.SUN : '#d8d2ca') : '#E5DED5'} />)}
                  </div>
                </div>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0' }}>{unlocked ? d.desc : unlockReqText(d.id)}</span>
                {unlocked && (
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11.5, color: '#9a93a0' }}>
                    {best > 0 ? <>최고 <b style={{ color: '#2b2730', fontWeight: 800 }}>{best.toLocaleString()}</b>점</> : '아직 기록 없음'}
                  </span>
                )}
              </div>
              {unlocked
                ? (on
                  ? <CheckCircleIcon size={34} weight="fill" color={c.accent} />
                  : <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><div style={{ width: 28, height: 28, borderRadius: 999, border: '2px solid #DDD5CB' }} /></div>)
                : <LockSimpleIcon size={26} weight="fill" color="#b8b0a8" style={{ flexShrink: 0 }} />}
            </ShakeButton>
            </Reveal>
          );
        })}
      </div>
      {/* CTA 하단 고정 (Figma top712 → bottom 70) */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { playSfx('button'); onStart(selected); }} className="tg-press" style={{
        width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
      }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{selected.label}으로 시작</span>
        <PlayIcon size={13} weight="fill" color="#fff" />
      </button>
      </Reveal>
    </>
  );
}

// ── 카운트다운 ─────────────────────────────────────────
const DIFF_HANZI = { easy: '初', normal: '中', hard: '高' };
function CountdownVisual({ n, difficulty }) {
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
const CD_WAVE_W = 12; // 진폭 폭(px)
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
function CdWaveEdge({ side, color = '#f96c6e' }) {
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

// ── 게임 화면 (Figma 좌표 절대배치) ──────────────────────
function GameScreen({ word, entered, currentSyl, completed, timedOut, wordIndex, wordsLen, wordTimeLimit, paused, combo, comboFlash, floatScore, score, coachText, onTone, wrongBtn, onPause, playReveal = true, endless = false, runId = 0 }) {
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
      {/* 타이머 top69 */}
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
      {/* 단어카드 top129 (폭 채움) */}
      <Reveal i={2} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 129 }}>
        <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut} progressText={endless ? `${wordIndex + 1}` : `${wordIndex + 1}/${wordsLen}`} combo={combo} comboFlash={comboFlash} floatScore={floatScore} />
      </Reveal>
      {/* 코치 top470 */}
      <Reveal i={3} play={playReveal} style={{ position: 'absolute', left: 24, right: 24, top: 470 }}>
        <CoachBubble text={coachText} />
      </Reveal>
      {/* 성조버튼 하단 고정 */}
      <Reveal i={4} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
        <ToneButtons onTone={onTone} wrongBtn={wrongBtn} disabled={completed} />
      </Reveal>
    </>
  );
}

// ── 결과 화면 ──────────────────────────────────────────
function ResultScreen({ score, maxCombo, avgMs, isNewBest, previousBest, onRetry, onChangeDiff, retryLabel = '다시 도전', changeLabel = '난이도 바꾸기' }) {
  const animScore = useCountUp(score, 1100);
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '-';
  const pandaSrc = pickCelebratePanda(isNewBest, maxCombo);
  const delta = score - previousBest;
  return (
    <>
      {/* 신기록 배지 (중앙) */}
      {isNewBest && (
        <Reveal i={0} style={{ position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 16, background: 'linear-gradient(90deg, #ffd24d, #ff9f40)', boxShadow: '0px 6px 14px rgba(255,159,64,0.28)' }}>
          <TrophyIcon size={13} weight="fill" color="#fff" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#fff', whiteSpace: 'nowrap' }}>신기록 달성!</span>
        </div>
        </Reveal>
      )}
      {/* 축하 판다 150×150 (가로 중앙) */}
      <Reveal i={1} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 64 }}>
        <img src={pandaSrc} alt="" width={150} height={150} style={{ display: 'block', objectFit: 'contain' }} />
      </Reveal>
      {/* 점수 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 196 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 60, color: '#f2484c', lineHeight: 'normal', whiteSpace: 'nowrap' }}>{animScore.toLocaleString()}</span>
        {previousBest > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0', whiteSpace: 'nowrap' }}>이전 최고 {previousBest.toLocaleString()}</span>
            {isNewBest && delta > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', borderRadius: 10, background: 'rgba(54,201,141,0.16)' }}>
                <span style={{ fontFamily: FONT_NUM, fontWeight: 700, fontSize: 12, color: '#1fa86a', whiteSpace: 'nowrap' }}>▲ {delta.toLocaleString()}</span>
              </span>
            )}
          </div>
        )}
      </div>
      </Reveal>
      {/* 통계 2카드 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 312 }}>
      <div style={{ height: 128, display: 'flex', gap: 12, alignItems: 'stretch' }}>
        {[
          { icon: <FlameIcon size={17} color={TG.CORAL_DK} />, ibg: 'rgba(255,107,107,0.14)', val: maxCombo, unit: '콤보', label: '최고 콤보' },
          { icon: <LightningIcon size={17} weight="fill" color="#4D8DFF" />, ibg: 'rgba(77,141,255,0.14)', val: avgSec, unit: avgSec === '-' ? '' : '초', label: '평균 반응속도' },
        ].map((s) => (
          <div key={s.label} style={{ flex: 1, minWidth: 0, background: '#fff', borderRadius: 22, boxShadow: '0px 5px 14px rgba(43,39,48,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: s.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.icon}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
              <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 26, color: '#2b2730' }}>{s.val}</span>
              {s.unit && <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#9a93a0' }}>{s.unit}</span>}
            </div>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0' }}>{s.label}</span>
          </div>
        ))}
      </div>
      </Reveal>
      {/* 코치 — 통계카드 하단(440)과 다시 도전 CTA 사이 가용공간에 가두고 세로 중앙(짧은 화면·사파리 툴바서도 통계·CTA 양쪽과 겹침 방지) */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, top: 452, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
        <CoachBubble text="다시 도전해서 신기록을 깨볼까요?" />
      </Reveal>
      {/* 다시 도전 (하단 고정) — 최하단 '난이도 바꾸기' 위 */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { playSfx('button'); onRetry(); }} className="tg-press" style={{
        width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
      }}>
        <ArrowClockwiseIcon size={19} weight="bold" color="#fff" />
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{retryLabel}</span>
      </button>
      </Reveal>
      {/* 난이도 바꾸기 (하단 고정) */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(18px + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { playSfx('button'); onChangeDiff(); }} className="tg-press" style={{
        width: '100%', height: 54, borderRadius: 18, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
      }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: '#9a93a0' }}>{changeLabel}</span>
      </button>
      </Reveal>
    </>
  );
}

// ── 소개 화면 (3페이지 캐러셀, Figma 좌표 절대배치) ──────
const INTRO_PAGES = [
  {
    kind: 'note',
    title: '하늘쌤의 공부법에서 시작했어요',
    body: ['유학 시절, 병음 없는 중국어에 성조를 직접', '적어가며 회화를 익혔던 하늘쌤.', '그 연습법을 그대로 게임에 담았어요.'],
    cta: '다음', tcolTop: '41.9%',
  },
  {
    kind: 'icon', Icon: LightningIcon, iconColor: '#F2484C', circleBg: 'rgba(255,107,107,0.14)',
    tag: '성조를 빠르게 캐치!', tagColor: '#f2484c', tagBg: 'rgba(255,107,107,0.16)',
    title: '눈이 아니라 반응으로',
    body: ['성조를 빠르게 알아채는 게 회화의 진짜', '실력이에요. 반복해서 찾다 보면 머리가', '아니라 입이 먼저 기억해요.'],
    cta: '다음', tcolTop: '43.1%',
  },
  {
    kind: 'icon', Icon: TrophyIcon, iconColor: '#F0A91E', circleBg: 'rgba(255,194,60,0.16)',
    tag: '최고 기록에 도전!', tagColor: '#b07d12', tagBg: 'rgba(255,194,60,0.18)',
    title: '기록 깨는 재미로, 매일',
    body: ['지난 최고 기록을 넘볼 때의 짜릿함.', '어제의 나와 겨루다 보면,', '하루 1분이 어느새 습관이 돼요.'],
    cta: '직접 해볼까요?', tcolTop: '43.1%',
  },
];

// 소개 한 페이지 내용(일러스트+제목+본문) — 슬라이딩 트랙의 각 패널
function IntroPanel({ p }) {
  return (
    <>
      {p.kind === 'note' ? (
        <Reveal i={0} style={{ position: 'absolute', left: 0, right: 0, top: '16.5%' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 26, boxShadow: '0px 10px 28px rgba(43,39,48,0.08)', padding: '26px 30px 22px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {[['我', 3], ['爱', 4], ['你', 3]].map(([ch, tn]) => (
                <div key={ch} style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', color: TONES.find((t) => t.num === tn)?.color }}>
                  <ToneMark tone={tn} size={26} />
                  <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 52, color: '#2b2730', lineHeight: 1 }}>{ch}</span>
                </div>
              ))}
            </div>
            <div style={{ background: '#fff6e8', padding: '7px 14px', borderRadius: 14 }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#b07d12', whiteSpace: 'nowrap' }}>병음 없이 · 성조만 직접 표기</span>
            </div>
          </div>
        </div>
        </Reveal>
      ) : (
        <Reveal i={0} style={{ position: 'absolute', left: 0, right: 0, top: '19.8%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 112, height: 112, borderRadius: 56, background: p.circleBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p.Icon size={52} weight="fill" color={p.iconColor} />
          </div>
          <div style={{ background: p.tagBg, padding: '7px 14px', borderRadius: 14 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: p.tagColor, whiteSpace: 'nowrap' }}>{p.tag}</span>
          </div>
        </div>
        </Reveal>
      )}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: p.tcolTop }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 28, color: '#2b2730', letterSpacing: -0.3, width: '100%' }}>{p.title}</span>
        <div style={{ width: '100%', fontFamily: FONT_BODY, fontWeight: 500, fontSize: 15, color: '#9a93a0', lineHeight: 1.65 }}>
          {p.body.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>
      </Reveal>
    </>
  );
}

function IntroScreen({ page, onNext, onSkip }) {
  const cur = INTRO_PAGES[page];
  return (
    <>
      {/* 건너뛰기 (고정) */}
      <button onClick={() => { playSfx('button'); onSkip(); }} className="tg-press" style={{ position: 'absolute', right: 24, top: 18, zIndex: 3, padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: '#9a93a0' }}>건너뛰기</span>
      </button>

      {/* 슬라이딩 트랙 — 일러스트+제목+본문이 좌우로 슬라이드 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', width: '300%', height: '100%', transform: `translateX(-${page * (100 / 3)}%)`, transition: 'transform .38s cubic-bezier(.4,0,.2,1)' }}>
          {INTRO_PAGES.map((p, idx) => (
            <div key={idx} style={{ position: 'relative', width: `${100 / 3}%`, height: '100%', flexShrink: 0 }}>
              <IntroPanel p={p} />
            </div>
          ))}
        </div>
      </div>

      {/* 점 인디케이터 (고정) — CTA(89.35%) 위 gap 유지 */}
      <div style={{ position: 'absolute', left: 24, right: 24, top: '84.85%', zIndex: 3, height: 28, display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 8, width: i === page ? 22 : 8, borderRadius: 4, background: i === page ? '#ff6b6b' : '#e2dbd3', transition: 'width .25s ease, background .25s ease' }} />
        ))}
      </div>

      {/* CTA (고정) — 하단 여백 30px 상당(=89.35%) */}
      <button onClick={() => { playSfx('button'); onNext(); }} className="tg-press" style={{ position: 'absolute', left: 24, right: 24, top: '89.35%', zIndex: 3, height: 60, borderRadius: 20, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 18, color: '#fff' }}>{cur.cta}</span>
      </button>
    </>
  );
}

// ── 튜토리얼 화면 (게임 레이아웃 + 가이드, Figma 좌표) ──
function TutorialScreen({ onDone }) {
  const word = { hanzi: '妈妈', pinyin: ['mā', 'ma'], tones: [1, 0], meaning: '엄마' };
  const [entered, setEntered] = useState([]);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [wrong, setWrong] = useState(null);
  const doneRef = useRef(false);
  const answer = word.tones[currentSyl];

  const tap = (n) => {
    if (completed) return;
    if (n === answer) {
      const ne = [...entered, n];
      setEntered(ne);
      haptic([10, 20, 30]);
      if (ne.length === word.tones.length) {
        setCompleted(true);
        playSfx('correct'); speakWord(word); // 완성 — 정답음 + 올바른 발음 재생(인게임과 동일)
        if (!doneRef.current) { doneRef.current = true; setTimeout(onDone, 1500); }
      } else { playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      setWrong(n); haptic(20); playSfx('wrong');
      setTimeout(() => setWrong(null), 450);
    }
  };

  return (
    <>
      {/* 점수(정적) 상단 중앙 */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20, display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '9px 14px', borderRadius: 15, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 17, color: '#2b2730' }}>0</span>
      </div>
      {/* 일시정지(정적) 우상단 */}
      <div style={{ position: 'absolute', right: 20, top: 23, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
        <PauseIcon size={20} weight="fill" color={TG.SUB} />
      </div>
      {/* 타이머(정적) top69 */}
      <div style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, background: '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0px 3px 4.5px rgba(255,94,98,0.45)' }}>
          <TimerIcon size={20} weight="fill" color="#fff" />
        </div>
        <div style={{ flex: 1, height: 12, borderRadius: 6, background: '#f0ebe4' }} />
      </div>
      {/* 연습 태그 top70 (중앙) */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 70, background: '#fff1f1', padding: '8px 14px', borderRadius: 14 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12.5, color: '#f2484c', whiteSpace: 'nowrap' }}>연습 모드 · 한 번 해볼까요?</span>
      </div>
      {/* 딤 오버레이 — 강조(카드·정답버튼·코치) 외 어둡게. 완료 시 사라짐 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(43,39,48,0.5)', opacity: completed ? 0 : 1, transition: 'opacity .35s ease', pointerEvents: 'none' }} />
      {/* 카드 top129 (폭 채움) — 스포트라이트 */}
      <Reveal i={0} style={{ position: 'absolute', left: 20, right: 20, top: 129, zIndex: 6 }}>
        <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={false} progressText="1/1" combo={0} comboFlash={false} floatScore={null} hideProgress />
      </Reveal>
      {/* 코치 top470 — 스포트라이트 */}
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 470, zIndex: 6 }}>
        <CoachBubble text={completed ? '잘했어요! 이제 시작해요' : '성조를 찾아볼까요?'} />
      </Reveal>
      {/* 성조버튼 하단 고정 (정답 강조 + 나머지 흐림) — 스포트라이트 */}
      <Reveal i={2} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 6 }}>
      <div style={{ height: 81, display: 'flex', gap: 9 }}>
        {TONES.map((t) => {
          const isAnswer = t.num === answer && !completed;
          const isWrong = wrong === t.num;
          return (
            <button key={t.num} onClick={() => tap(t.num)} className={`tg-press ${isWrong ? 'tg-shake' : ''}`} style={{
              position: 'relative', flex: 1, minWidth: 0, height: '100%', borderRadius: 20, cursor: 'pointer',
              // 딤 위 스포트라이트 — 틴트가 투명하면 어두운 딤이 비쳐 칙칙해지므로 페이지색 위에 합성해 불투명 처리
              background: `linear-gradient(${TONE_TINTS[t.num]}, ${TONE_TINTS[t.num]}), ${TG.BG}`,
              border: isAnswer ? `3px solid ${t.color}` : `1.5px solid ${TONE_BORDERS[t.num]}`,
              color: t.color,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 16, paddingBottom: 12,
              boxShadow: isAnswer ? `0 0 0 4px ${t.color}22` : 'none',
              transition: 'box-shadow .2s ease', ...TOUCH_OPT,
            }}>
              {/* 탭 물결(리플) — 정답 버튼에서 톡톡 두드리듯 원형 파동 반복. 2겹으로 끊김 없이. 마크 뒤(zIndex 0) */}
              {isAnswer && [0, 750].map((delay) => (
                <span key={delay} style={{
                  position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, borderRadius: '50%',
                  background: t.color, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0,
                  animation: `tg-ripple 1500ms ease-out ${delay}ms infinite`,
                }} />
              ))}
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <ToneMark tone={t.num} size={34} />
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, color: t.color }}>{t.name}</span>
              </div>
            </button>
          );
        })}
      </div>
      </Reveal>
    </>
  );
}

// ── 단어 숙련도 행 (한자+병음+뜻 / 정답률 막대 + 평균속도) ──
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

// ── 단어 숙련도 화면 (Figma "15. 단어 숙련도") ──
function MasteryScreen({ rows, masteredN, onBack, onReview }) {
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

// 미리보기(?screen=mastery)용 샘플 — 복습필요 3 + 마스터 12
const PREVIEW_MASTERY = (() => {
  const review = [
    { hanzi: '复杂', pinyin: ['fù', 'zá'], tones: [4, 2], meaning: '복잡하다', a: 20, p: 9, t: 52000 },
    { hanzi: '影响', pinyin: ['yǐng', 'xiǎng'], tones: [3, 3], meaning: '영향', a: 21, p: 13, t: 44100 },
    { hanzi: '严格', pinyin: ['yán', 'gé'], tones: [2, 2], meaning: '엄격하다', a: 10, p: 7, t: 19000 },
  ];
  const mastered = ['妈妈', '你好', '谢谢', '老师', '朋友', '时间', '学生', '中国', '咖啡', '文化', '健康', '经济'];
  const stats = {}, map = {};
  for (const w of review) { stats[w.hanzi] = [w.a, w.p, w.t, w.a]; map[w.hanzi] = { hanzi: w.hanzi, pinyin: w.pinyin, tones: w.tones, meaning: w.meaning }; }
  for (const hz of mastered) { stats[hz] = [4, 4, 4800, 4]; map[hz] = { hanzi: hz, pinyin: [], tones: [], meaning: '' }; }
  return { stats, map };
})();

// 잠긴 버튼 흔들기 — shakeOnClick일 때 클릭 시 좌우 흔들림(tg-shake) + onClick(토스트)
function ShakeButton({ shakeOnClick, onClick, className = '', style, children, ...rest }) {
  const [shaking, setShaking] = useState(false);
  useEffect(() => { if (!shaking) return undefined; const t = setTimeout(() => setShaking(false), 450); return () => clearTimeout(t); }, [shaking]);
  const handle = () => {
    if (shakeOnClick) { setShaking(false); requestAnimationFrame(() => setShaking(true)); playSfx('locked'); }
    if (onClick) onClick();
  };
  return <button onClick={handle} className={`${className} ${shaking ? 'tg-shake' : ''}`.trim()} style={style} {...rest}>{children}</button>;
}

// 중앙 토스트 (잠금 안내 등) — Figma "Toast". 다크 알약 + 자물쇠 + 문구. tg-toast로 페이드 인·아웃.
function GameToast({ msg }) {
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

// ── 모드 선택 (난이도 모드 / 무한 모드) — Figma "17. 모드 선택" ──
function ModeCard({ Icon, iconColor, tintBg, title, desc, locked, lockText, onClick, onLocked }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', padding: '20px 18px', borderRadius: 22,
      background: locked ? '#f7f3ee' : '#fff', border: '1.5px solid #efeae4', cursor: 'pointer',
      boxShadow: locked ? 'none' : '0px 4px 12px rgba(43,39,48,0.05)', ...TOUCH_OPT,
    }}>
      <div style={{ width: 56, height: 56, borderRadius: 18, flexShrink: 0, background: locked ? '#efeae4' : tintBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={28} weight="fill" color={locked ? '#b8b0a8' : iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0' }}>{desc}</span>
      </div>
      {locked ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <LockSimpleIcon size={22} weight="fill" color="#b8b0a8" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11, color: '#9a93a0', whiteSpace: 'nowrap' }}>{lockText}</span>
        </div>
      ) : <CaretRightIcon size={24} weight="bold" color="#c9c2bb" style={{ flexShrink: 0 }} />}
    </ShakeButton>
  );
}
function ModeScreen({ endlessUnlocked, onDifficulty, onEndless, onBack, onLocked }) {
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
      <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
        </button>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>모드 선택</span>
      </div>
      </Reveal>
      <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 120 }}>
        <CoachBubble text="오늘은 어떻게 즐겨볼까요?" />
      </Reveal>
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 224 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ModeCard Icon={StairsIcon} iconColor={TG.CORAL_DK} tintBg="rgba(255,107,107,0.14)" title="난이도 모드" desc="초급부터 단계별로 차근차근" onClick={onDifficulty} />
        <ModeCard Icon={LightningIcon} iconColor="#F0A91E" tintBg="rgba(255,194,60,0.16)" title="무한 모드" desc="모든 단어 랜덤 · 점점 빨라지는 도전" locked={!endlessUnlocked} lockText="고급 1,000점" onClick={onEndless} onLocked={() => onLocked && onLocked('고급 1,000점을 달성하면 열려요')} />
      </div>
      </Reveal>
    </>
  );
}

// ── 스플래시 (게임 진입 시 짧게 — 로고+판다+로딩점) ──
function SplashScreen() {
  return (
    <FigmaScreen>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <img src={ASSETS.startTitle} alt="성조 빨리찾기" style={{ width: 300, height: 'auto', objectFit: 'contain', animation: 'tg-enter .5s cubic-bezier(.22,1,.36,1) both' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 9, height: 9, borderRadius: 999, background: TG.CORAL, animation: `tg-dot .9s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
        </div>
      </div>
    </FigmaScreen>
  );
}

// ════════════════════════════════════════════════════════
export default function ToneGamePage() {
  const { studentToken: routeToken } = useParams();
  // 정체성 추상화: 학생(토큰)/게스트(로컬UUID·독립진입)/프리뷰를 동일 처리. 로컬 저장키=identity.id, 서버호출은 identity로 게이팅.
  const identity = useMemo(() => resolveIdentity(routeToken), [routeToken]);
  const studentToken = identity.id; // 로컬 저장 키(학생토큰/게스트ID/'preview'). 서버 호출은 fetchBests/submitResult(identity)로.
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState(false);

  // 로컬 시안 검수용 미리보기 모드 (token='preview', ?screen=로 초기화면 지정)
  // ⚠️ import.meta.env.DEV 게이트 — dev(작업 브랜치·localhost)에서만 동작, 프로덕션 빌드에선 항상 false로 비활성(백도어 자동 제거).
  const isPreview = import.meta.env.DEV && identity.kind === 'preview';
  const previewScreen = isPreview ? (new URLSearchParams(window.location.search).get('screen') || 'start') : 'start';
  const cdPreview = previewScreen === 'countdown'; // 카운트다운 미리보기는 난이도 위 오버레이로
  const initialScreen = cdPreview ? 'difficulty' : previewScreen;

  const [screen, setScreen] = useState(initialScreen); // start | difficulty | game | end | intro | tutorial
  const [paused, setPaused] = useState(false);
  const [words, setWords] = useState(() => (isPreview && previewScreen === 'game' ? PREVIEW_WORDS : []));
  const [cdPhase, setCdPhase] = useState(cdPreview ? 'run' : null); // 카운트다운 오버레이 단계: null|'in'|'run'|'out'
  const [cdNum, setCdNum] = useState(3);
  const [wordIndex, setWordIndex] = useState(0);
  const [currentSyl, setCurrentSyl] = useState(0);
  const [entered, setEntered] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [startTs, setStartTs] = useState(0);
  const [hasMistake, setHasMistake] = useState(false);
  const [floatScore, setFloatScore] = useState(null);
  const [comboFlash, setComboFlash] = useState(false);
  const [wrongBtn, setWrongBtn] = useState(null); // 오답 버튼 흔들림(450ms 단발)
  const [showWrong, setShowWrong] = useState(false); // 코치 오답 메시지 지속(다음 시도/단어까지) — wrongBtn과 분리
  const [wordTimeLimit, setWordTimeLimit] = useState(7000);
  const [timedOut, setTimedOut] = useState(false);

  const wordTimeLimitRef = useRef(7000);
  const wordElapsedRef = useRef(0); // 현재 단어의 누적 '진행' 시간(일시정지·카운트다운 제외)
  const segStartRef = useRef(0);    // 현재 진행 구간 시작 시각
  const [totalAnswerTime, setTotalAnswerTime] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTIES[0]);
  const [wordPoolByDiff, setWordPoolByDiff] = useState({});
  const wordStatsRef = useRef({});  // 단어별 숙련도 글로벌(localStorage 동기화)
  const endHandledRef = useRef(false); // 결과화면 1회 처리 가드(다시하기로 score 리셋 시 재실행·중복 사운드 방지)
  const [reviewMode, setReviewMode] = useState(false); // 복습 모드(약한 단어 10개)
  const [endlessMode, setEndlessMode] = useState(false); // 무한 모드(랜덤·가속·첫초과종료)
  const [runId, setRunId] = useState(0); // 게임 시작 시마다 증가 — 같은 단어1로 재시작해도 타이머·게이지 리셋용
  const [splash, setSplash] = useState(isPreview ? previewScreen === 'splash' : true); // 진입 스플래시(실제 진입만, 미리보기는 ?screen=splash)
  const [toast, setToast] = useState(null); // 중앙 토스트(잠금 안내 등)
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    if (!msg) return;
    setToast({ msg, key: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1700);
  }, []);
  const [best, setBest] = useState(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [previousBest, setPreviousBest] = useState(0);
  const [introPage, setIntroPage] = useState(() => (isPreview ? Number(new URLSearchParams(window.location.search).get('introPage') || 0) : 0)); // 소개 캐러셀 페이지 (0~2)

  const timersRef = useRef([]);
  const addTimer = (id) => { timersRef.current.push(id); };

  useEffect(() => { ensureGameFonts(); initTts(); initSfx(); }, []);

  // 스플래시 자동 해제(실제 진입만 1.6초; 미리보기 splash는 검수용으로 유지)
  useEffect(() => {
    if (!splash || isPreview) return undefined;
    const t = setTimeout(() => setSplash(false), 1600);
    return () => clearTimeout(t);
  }, [splash, isPreview]);

  useEffect(() => {
    if (isPreview) { setStudent({ name: '미리보기' }); return; }
    if (identity.kind === 'member') { setStudent({ name: identity.memberUser?.nickname || '회원' }); return; } // 회원: token이 게임유저 JWT라 학생 조회 X(데이터는 pullMemberData)
    if (identity.kind === 'guest') { setStudent({ name: '플레이어' }); return; } // 게스트 독립 진입 — 학생 조회 없음
    fetchStudentByToken(identity.token).then(setStudent).catch(() => setError(true));
  }, [identity, isPreview]);

  useEffect(() => {
    DIFFICULTIES.forEach((d) => {
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
    });
  }, []);

  // 게스트→학생 1회 병합(같은 기기) → 통합 최고점수·숙련도 로컬 로드 → 서버(학생만) 동기화. 게스트는 로컬만.
  useEffect(() => {
    if (isPreview) return undefined;
    let cancelled = false;
    (async () => {
      await mergeGuestIntoStudent(identity).catch(() => {}); // 학생 진입 시 게스트 로컬 기록을 학생 쪽에 병합(학생일 때만 동작)
      if (cancelled) return;
      if (identity.kind === 'member') {
        await pullMemberData(identity).catch(() => {}); // 회원: 서버(/game/me) → 로컬 머지
        if (cancelled) return;
        // 연결된 학생(예약코드)의 GAME_BEST 기록을 회원 로컬에 max 흡수 → 학생→회원 이관(점수 높은 쪽 보존). 흡수 시 서버 gameData에도 반영.
        const absorbed = await mergeStudentIntoMember(identity).catch(() => false);
        if (cancelled) return;
        if (absorbed) pushMemberData(identity).catch(() => {});
      }
      wordStatsRef.current = loadWordStats(studentToken);
      setBest(headlineBest(studentToken)); // 즉시 캐시 기반 헤드라인(무한 우선)
      const bests = await fetchBests(identity).catch(() => null); // 서버 베스트(학생만, 게스트=null)
      if (cancelled || !bests) return;
      // 서버 meta.eb(무한 최고) 복구 → 캐시에 반영
      let eb = 0;
      for (const b of bests) { if (b?.meta?.eb) eb = Math.max(eb, Number(b.meta.eb) || 0); }
      if (eb > (loadEndlessBest(studentToken)?.bestScore || 0)) saveEndlessBest(studentToken, { ...(loadEndlessBest(studentToken) || {}), bestScore: eb, updatedAt: Date.now() });
      setBest(headlineBest(studentToken));
      // 단어 통계 병합
      let merged = wordStatsRef.current;
      for (const b of bests) { if (b?.meta?.w) merged = mergeStats(merged, b.meta.w); }
      wordStatsRef.current = merged;
      saveWordStats(studentToken, merged);
    })();
    return () => { cancelled = true; };
  }, [identity, isPreview]);

  useEffect(() => {
    if (screen !== 'end') { endHandledRef.current = false; return; } // 결과화면 벗어나면 가드 해제
    if (!studentToken) return;
    if (endHandledRef.current) return; // 이미 이 결과 처리함 — 다시하기로 score=0 리셋돼도 재실행·중복 사운드 방지
    endHandledRef.current = true;
    const avgMsVal = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
    // 영향받은 난이도 단어통계 동기화(복습·무한 공용)
    const syncWordStats = () => {
      const affected = new Set();
      for (const w of words) { for (const d of DIFFICULTIES) { if ((wordPoolByDiff[d.id] || []).some((x) => x.hanzi === w.hanzi)) affected.add(d.id); } }
      for (const id of affected) {
        const d = DIFFICULTIES.find((x) => x.id === id);
        const sub = subsetForPool(wordStatsRef.current, wordPoolByDiff[id] || []);
        submitResult(identity, d.gameKey, { score: 0, maxCombo: 0, avgMs: 0, meta: { w: sub } }).catch(() => {});
      }
    };

    // 무한 모드 — 헤드라인 최고기록(별도). meta.eb로 영구화(고급 행에 얹음, best 비교엔 0 submit).
    if (endlessMode) {
      const prev = loadEndlessBest(studentToken) || { bestScore: 0, bestMaxCombo: 0, bestAvgMs: 0, playCount: 0 };
      const newBestFlag = score > (prev.bestScore || 0);
      setIsNewBest(newBestFlag); setPreviousBest(prev.bestScore || 0);
      const updated = {
        bestScore: newBestFlag ? score : prev.bestScore, bestMaxCombo: newBestFlag ? maxCombo : (prev.bestMaxCombo || 0),
        bestAvgMs: newBestFlag ? avgMsVal : (prev.bestAvgMs || 0), playCount: (prev.playCount || 0) + 1, updatedAt: Date.now(),
      };
      if (!isPreview) {
        saveEndlessBest(studentToken, updated);
        setBest(headlineBest(studentToken));
        syncWordStats();
        submitResult(identity, GAMEKEY.hard, { score: 0, maxCombo: 0, avgMs: 0, meta: { eb: updated.bestScore } }).catch(() => {});
        if (identity.kind === 'member') pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me) 통째 동기화
      }
      playSfx(newBestFlag ? 'win' : 'gameover');
      return;
    }

    // 복습 모드 — 최고기록 미반영, 단어 통계만 영구화(영향받은 난이도 meta.w 동기화)
    if (reviewMode) {
      setIsNewBest(false); setPreviousBest(0);
      if (!isPreview) { syncWordStats(); if (identity.kind === 'member') pushMemberData(identity).catch(() => {}); }
      playSfx('gameover'); // 복습은 신기록 개념 없음 → 신기록 아님 규칙대로 게임오버
      return;
    }

    // 일반(난이도) 모드 — 난이도별 최고기록 갱신 + 단어 통계(meta.w) 동기화
    const gameKey = selectedDifficulty.gameKey;
    const prev = loadBest(studentToken, gameKey) || { bestScore: 0, bestMaxCombo: 0, bestAvgMs: 0, playCount: 0 };
    const newBestFlag = score > (prev.bestScore || 0);
    setIsNewBest(newBestFlag);
    setPreviousBest(prev.bestScore || 0);
    const updated = {
      bestScore: newBestFlag ? score : prev.bestScore,
      bestMaxCombo: newBestFlag ? maxCombo : (prev.bestMaxCombo || 0),
      bestAvgMs: newBestFlag ? avgMsVal : (prev.bestAvgMs || 0),
      playCount: (prev.playCount || 0) + 1, updatedAt: Date.now(),
    };
    saveBest(studentToken, gameKey, updated);
    setBest(headlineBest(studentToken)); // 헤드라인(무한 우선, 없으면 통합) 갱신
    // 효과음: 다음 단계가 새로 열렸으면 '잠금해제', 신기록이면 '승리', 아니면 '게임오버'
    const justUnlocked = (prev.bestScore || 0) < UNLOCK_THRESHOLD && updated.bestScore >= UNLOCK_THRESHOLD;
    playSfx(justUnlocked ? 'unlock' : (newBestFlag ? 'win' : 'gameover'));
    const wSub = isPreview ? null : subsetForPool(wordStatsRef.current, wordPoolByDiff[selectedDifficulty.id] || []);
    submitResult(identity, gameKey, { score, maxCombo, avgMs: avgMsVal, ...(wSub && Object.keys(wSub).length ? { meta: { w: wSub } } : {}) }).catch(() => {});
    if (identity.kind === 'member' && !isPreview) pushMemberData(identity).catch(() => {}); // 회원: 로컬 → 서버(/game/me) 통째 동기화
  }, [screen, identity, studentToken, selectedDifficulty, score, maxCombo, answeredCount, totalAnswerTime, reviewMode, endlessMode, words, wordPoolByDiff, isPreview]);

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }, []);

  // 카운트다운 오버레이 단계 진행: in(슬라이드 인)→run(3·2·1)→out(슬라이드 아웃)
  useEffect(() => {
    if (cdPhase !== 'in') return undefined;
    const t = setTimeout(() => { setScreen('game'); setCdPhase('run'); }, 420);
    return () => clearTimeout(t);
  }, [cdPhase]);
  useEffect(() => {
    if (cdPhase !== 'run' || isPreview) return undefined;
    if (cdNum <= 0) { playSfx('go'); setCdPhase('out'); return undefined; }
    playSfx('count');
    const t = setTimeout(() => setCdNum((v) => v - 1), 850);
    return () => clearTimeout(t);
  }, [cdPhase, cdNum, isPreview]);
  useEffect(() => {
    if (cdPhase !== 'out') return undefined;
    const t = setTimeout(() => setCdPhase(null), 420);
    return () => clearTimeout(t);
  }, [cdPhase]);

  useEffect(() => {
    if (screen !== 'game' || cdPhase) return; // 카운트다운 끝나야 타이머 시작
    const limit = endlessMode
      ? getEndlessTimeLimit(answeredCount)                              // 무한: 누적 클리어 수로 점점 가속(하한)
      : getTimeLimitForCombo(combo, reviewMode ? 0.85 : selectedDifficulty.timeMultiplier);
    wordElapsedRef.current = 0; // 새 단어 — 누적 진행시간 리셋
    wordTimeLimitRef.current = limit;
    setWordTimeLimit(limit);
    setTimedOut(false);
    setShowWrong(false); // 새 단어 — 코치 오답 메시지 초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordIndex, screen, selectedDifficulty, cdPhase, runId]);

  useEffect(() => {
    if (screen !== 'game' || completed || paused || cdPhase) return undefined;
    // 남은 시간만큼만 카운트(일시정지 후 계속하기 시 처음부터 다시 세지 않음)
    segStartRef.current = Date.now();
    const remaining = Math.max(0, wordTimeLimitRef.current - wordElapsedRef.current);
    const timer = setTimeout(() => {
      const word = words[wordIndex];
      if (!word) return;
      setTimedOut(true); setCompleted(true); setCombo(0); setEntered(word.tones);
      haptic([60, 30, 60]); playSfx('timeout');
      speakWord(word); // 시간초과 공개 → 올바른 발음 들려주기
      // 단어 숙련도 기록(시간초과 = 실패)
      if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: false, timedOut: true, ms: 0 }); saveWordStats(studentToken, wordStatsRef.current); }
      addTimer(setTimeout(() => {
        if (endlessMode || wordIndex + 1 >= words.length) setScreen('end'); // 무한: 첫 시간초과 = 종료
        else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); }
      }, 1700));
    }, remaining);
    return () => {
      clearTimeout(timer);
      wordElapsedRef.current += Date.now() - segStartRef.current; // 이번 진행 구간을 누적
    };
  }, [screen, completed, paused, cdPhase, wordTimeLimit, wordIndex, words, endlessMode, isPreview, studentToken]);

  const startGame = (difficulty) => {
    const d = difficulty || selectedDifficulty;
    if (difficulty && difficulty.id !== selectedDifficulty.id) setSelectedDifficulty(d);
    const pool = wordPoolByDiff[d.id];
    if (!pool || pool.length === 0) {
      message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
      setScreen('difficulty');
      fetchToneWords(d.id).then((w) => { if (Array.isArray(w) && w.length > 0) setWordPoolByDiff((prev) => ({ ...prev, [d.id]: w })); }).catch(() => {});
      return;
    }
    setReviewMode(false); setEndlessMode(false);
    setWords(shuffle(pool).slice(0, ROUND_LENGTH));
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false); setStartTs(Date.now());
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    wordElapsedRef.current = 0; setRunId((n) => n + 1); // 단어1로 재시작해도 타이머·게이지 리셋
    // 카운트다운 오버레이 시작 (현재 화면 위로 슬라이드 인 → run 중 게임으로 전환 → 슬라이드 아웃)
    setCdNum(3); setCdPhase('in');
  };

  // 복습 모드 — 약한 단어 N개로 게임. 최고기록 미반영, 단어 통계만 갱신.
  const startReview = (reviewWords) => {
    if (!reviewWords || reviewWords.length === 0) return;
    setReviewMode(true); setEndlessMode(false);
    setWords(reviewWords);
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false); setStartTs(Date.now());
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    wordElapsedRef.current = 0; setRunId((n) => n + 1); // 단어1로 재시작해도 타이머·게이지 리셋
    setCdNum(3); setCdPhase('in'); // 카운트다운이 현재(숙련도) 화면 위로 슬라이드 → 게임
  };

  // 무한 모드 — 전 난이도 랜덤 스트림. 점점 가속, 첫 시간초과 종료, 헤드라인 최고점.
  const startEndless = () => {
    const all = DIFFICULTIES.flatMap((d) => wordPoolByDiff[d.id] || []);
    if (all.length === 0) { message.error('단어를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
    let stream = [];
    for (let i = 0; i < 8; i++) stream = stream.concat(shuffle(all)); // 첫 초과로 끝나므로 충분히 길게
    setEndlessMode(true); setReviewMode(false);
    setWords(stream);
    setWordIndex(0); setCurrentSyl(0); setEntered([]); setCompleted(false);
    setCombo(0); setMaxCombo(0); setScore(0); setHasMistake(false); setStartTs(Date.now());
    setTotalAnswerTime(0); setAnsweredCount(0); setIsNewBest(false); setPreviousBest(0); setTimedOut(false); setPaused(false);
    wordElapsedRef.current = 0; setRunId((n) => n + 1); // 단어1로 재시작해도 타이머·게이지 리셋
    setCdNum(3); setCdPhase('in');
  };

  const handleTone = useCallback((toneNum) => {
    if (completed || paused || cdPhase) return;
    const word = words[wordIndex];
    if (!word) return;
    const expected = word.tones[currentSyl];
    if (toneNum === expected) {
      setShowWrong(false); // 정답 — 오답 메시지 해제
      const ne = [...entered, toneNum];
      setEntered(ne);
      if (ne.length === word.tones.length) {
        setCompleted(true);
        speakWord(word); // 정답 완성 → 올바른 발음 자동 재생(성조 강화)
        const answerTime = wordElapsedRef.current + (Date.now() - segStartRef.current);
        const remaining = Math.max(0, wordTimeLimitRef.current - answerTime);
        const timeBonus = Math.floor(remaining / 100);
        let earned = 50;
        if (!hasMistake) {
          const newCombo = combo + 1;
          earned = 100 + newCombo * 20 + timeBonus;
          setCombo(newCombo); setMaxCombo((m) => Math.max(m, newCombo));
          if (newCombo >= 2) { setComboFlash(true); addTimer(setTimeout(() => setComboFlash(false), 700)); }
          haptic([10, 20, 30]); playSfx(newCombo >= 2 ? 'combo' : 'correct');
        } else { earned = 50 + Math.floor(timeBonus / 2); setCombo(0); haptic(15); playSfx('correct', 0.4); }
        setScore((s) => s + earned);
        setFloatScore(`+${earned}`);
        setTotalAnswerTime((t) => t + answerTime);
        setAnsweredCount((c) => c + 1);
        // 단어 숙련도 기록(무실수 클리어 여부 + 소요시간)
        if (!isPreview) { recordWordResult(wordStatsRef.current, word.hanzi, { perfect: !hasMistake, timedOut: false, ms: answerTime }); saveWordStats(studentToken, wordStatsRef.current); }
        addTimer(setTimeout(() => setFloatScore(null), 1300));
        addTimer(setTimeout(() => {
          if (wordIndex + 1 >= words.length) setScreen('end');
          else { setWordIndex((i) => i + 1); setCurrentSyl(0); setEntered([]); setCompleted(false); setHasMistake(false); }
        }, 1500));
      } else { haptic(8); playSfx('tap'); setCurrentSyl((s) => s + 1); }
    } else {
      setHasMistake(true); setCombo(0); setWrongBtn(toneNum); setShowWrong(true); haptic([40, 30, 40]); playSfx('wrong');
      addTimer(setTimeout(() => setWrongBtn(null), 450)); // 버튼 흔들림만 해제, 코치 메시지는 유지
    }
  }, [completed, paused, cdPhase, words, wordIndex, currentSyl, entered, hasMistake, combo, isPreview, studentToken]);

  useEffect(() => {
    if (screen !== 'game') return;
    const handler = (e) => {
      if (e.repeat) return;
      const map = { '1': 1, '2': 2, '3': 3, '4': 4, '0': 0, '5': 0 };
      const tone = map[e.key];
      if (tone === undefined) return;
      e.preventDefault(); handleTone(tone);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, handleTone]);

  const coach = (() => {
    if (timedOut) return { text: '시간 끝! 다시 도전해요', tone: 'danger' };
    if (completed) return combo >= 2 ? { text: `콤보 ${combo}! 멋져요`, tone: 'success' } : { text: '정확해요! 잘했어요', tone: 'success' };
    if (showWrong) return { text: '앗! 다시 찾아봐', tone: 'danger' };
    return { text: '이건 무슨 성조일까?', tone: 'neutral' };
  })();

  const word = words[wordIndex];
  const avgMsForResult = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;

  if (error) return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TG.DANGER, fontSize: 14, background: TG.BG }}>정보를 불러오지 못했어요</div>;
  if (splash || !student) return <SplashScreen />; // 스플래시가 로딩 상태도 겸함

  // 온보딩(소개·튜토리얼) 1회만 — localStorage 플래그
  const finishOnboard = () => { try { localStorage.setItem('tg_onboarded', '1'); } catch { /* noop */ } setScreen('modeselect'); };
  const goFromStart = () => {
    let seen = false;
    try { seen = !!localStorage.getItem('tg_onboarded'); } catch { /* noop */ }
    if (seen) { setScreen('modeselect'); } else { setIntroPage(0); setScreen('intro'); }
  };

  // 단어 숙련도 뷰 데이터 (글로벌 stats + 풀 → 복습필요 리스트/마스터 수/복습단어)
  const masteryStats = (isPreview && previewScreen === 'mastery')
    ? (new URLSearchParams(window.location.search).get('empty') ? {} : PREVIEW_MASTERY.stats)
    : wordStatsRef.current;
  const masteryMap = (isPreview && previewScreen === 'mastery')
    ? PREVIEW_MASTERY.map
    : DIFFICULTIES.reduce((m, d) => { for (const w of (wordPoolByDiff[d.id] || [])) m[w.hanzi] = { ...w, diff: d.label }; return m; }, {});
  const reviewRows = buildReviewList(masteryStats, masteryMap);
  const masteredN = masteredCount(masteryStats, masteryMap);
  const reviewWords = reviewRows.slice(0, ROUND_LENGTH).map((r) => r.word);

  // 화면별 본문 (카운트다운 오버레이/일시정지 모달은 아래에서 위에 덧댐)
  let content;
  if (screen === 'start') {
    content = <StartScreen best={best} bestLabel={best?.label || selectedDifficulty.label} onStart={goFromStart} onClose={() => { if (identity.kind === 'student') navigate(`/personal/${identity.token}`); else window.location.href = '/'; }} onDebugIntro={import.meta.env.DEV ? (() => { setIntroPage(0); setScreen('intro'); }) : undefined} onMastery={() => setScreen('mastery')} studentToken={studentToken} onRefreshBest={() => setBest(headlineBest(studentToken))}
      onLogin={identity.kind === 'guest' ? () => setScreen('login') : null}
      isMemberUser={identity.kind === 'member'} memberName={identity.memberUser?.nickname || null}
      onLogout={() => { logoutMember(); window.location.reload(); }} />;
  } else if (screen === 'login') {
    content = <FigmaScreen><LoginScreen onBack={() => setScreen('start')} onSuccess={() => { setTimeout(() => window.location.reload(), 500); }} /></FigmaScreen>;
  } else if (screen === 'mastery') {
    content = (
      <FigmaScreen>
        <MasteryScreen rows={reviewRows} masteredN={masteredN} onBack={() => setScreen('start')} onReview={() => startReview(reviewWords)} />
      </FigmaScreen>
    );
  } else if (screen === 'intro') {
    content = (
      <FigmaScreen>
        <IntroScreen page={introPage}
          onNext={() => { if (introPage < 2) setIntroPage(introPage + 1); else setScreen('tutorial'); }}
          onSkip={finishOnboard} />
      </FigmaScreen>
    );
  } else if (screen === 'tutorial') {
    content = <FigmaScreen><TutorialScreen onDone={finishOnboard} /></FigmaScreen>;
  } else if (screen === 'modeselect') {
    content = (
      <FigmaScreen>
        <ModeScreen endlessUnlocked={isEndlessUnlocked(studentToken)}
          onDifficulty={() => { playSfx('button'); setScreen('difficulty'); }} onEndless={() => { playSfx('button'); startEndless(); }} onBack={() => setScreen('start')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'difficulty') {
    content = (
      <FigmaScreen>
        <DifficultyScreen selected={selectedDifficulty} studentToken={studentToken} onSelect={setSelectedDifficulty} onStart={startGame} onBack={() => setScreen('modeselect')} onLocked={showToast} />
      </FigmaScreen>
    );
  } else if (screen === 'end') {
    content = (
      <FigmaScreen>
        <ResultScreen score={score} maxCombo={maxCombo} avgMs={avgMsForResult} isNewBest={reviewMode ? false : isNewBest} previousBest={reviewMode ? 0 : previousBest}
          endless={endlessMode}
          onRetry={endlessMode ? () => startEndless() : reviewMode ? () => startReview(reviewWords) : () => startGame(selectedDifficulty)}
          onChangeDiff={endlessMode ? () => setScreen('modeselect') : reviewMode ? () => setScreen('mastery') : () => setScreen('difficulty')}
          retryLabel={reviewMode ? '한 번 더 복습' : undefined}
          changeLabel={endlessMode ? '모드 선택으로' : reviewMode ? '숙련도로 돌아가기' : undefined} />
      </FigmaScreen>
    );
  } else { // game
    content = (
      <FigmaScreen>
        {word && (
          <GameScreen word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut}
            wordIndex={wordIndex} wordsLen={words.length} wordTimeLimit={wordTimeLimit} paused={paused || !!cdPhase} endless={endlessMode} runId={runId}
            combo={combo} comboFlash={comboFlash} floatScore={floatScore} score={score} coachText={coach.text}
            onTone={handleTone} wrongBtn={wrongBtn} onPause={() => setPaused(true)} playReveal={!cdPhase} />
        )}
      </FigmaScreen>
    );
  }

  // 카운트다운 오버레이 — 직전 화면 위로 슬라이드 인 → 게임 위로 슬라이드 아웃 (레이어드 커버/리빌)
  const cdStyle = cdPhase === 'in' ? { animation: 'tg-cd-in .42s cubic-bezier(.4,0,.2,1) forwards' }
    : cdPhase === 'out' ? { animation: 'tg-cd-out .42s cubic-bezier(.4,0,.2,1) forwards' }
    : { transform: 'translateX(0)' };

  return (
    <>
      {content}
      {cdPhase && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ...cdStyle }}>
          {/* 좌우 물결 가장자리 — 컨테이너 바깥쪽이라 가운데 정렬 시엔 화면 밖(비표시), 슬라이드 중에만 보임 */}
          <CdWaveEdge side="left" />
          <CdWaveEdge side="right" />
          <FigmaScreen bg="#f96c6e"><CountdownVisual n={cdNum} difficulty={selectedDifficulty} /></FigmaScreen>
        </div>
      )}
      {paused && (
        <PauseModal score={score} combo={combo} onResume={() => setPaused(false)}
          onRestart={() => { setPaused(false); if (endlessMode) startEndless(); else if (reviewMode) startReview(reviewWords); else startGame(selectedDifficulty); }}
          onQuit={() => { setPaused(false); setReviewMode(false); setEndlessMode(false); setScreen('start'); }} />
      )}
      {toast && <GameToast key={toast.key} msg={toast.msg} />}
    </>
  );
}
