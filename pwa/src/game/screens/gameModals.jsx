// 게임 공용 모달 — 놀러가기(SNS)·복습 시작·게임방법·무한 안내·로그인 유도·[DEV]점수 디버그. 시작/홈 등 여러 화면에서 재사용.
// (기존 StartScreen.jsx 내부 함수에서 추출)
import { useState } from 'react';
import { HandStars, Notebook, AltArrowRight, Play, Infinity as InfinityIcon, Devices, SquareAcademicCap, MedalStar } from '@solar-icons/react';
import { InstagramLogoIcon, YoutubeLogoIcon, QuestionMarkIcon } from '@phosphor-icons/react';
import { TG, TYPE, SHADOW, TOUCH_OPT, loadBest, saveBest, RADIUS, SPACE } from '../tgTokens.js';
import { GAMEKEY, loadEndlessBest, saveEndlessBest } from '../gameLogic.js';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';
import { track } from '../gameAnalytics.js';
import { ModalCard, ModalHead, ModalBody, KeycapCta, ModalTextButton } from './shared.jsx';

// 모달 배지·CTA 색(시안 실측)
const CTA_RED = TG.CTA;              // 기본 CTA·배지 코랄
const ENDLESS_ORANGE = TG.ENDLESS;    // 무한 모드 배지
const EXAM_GOLD = TG.SUN;            // 승급시험 배지
const TRAIN_GREEN = TG.TRAIN, TRAIN_GREEN_EDGE = TG.TRAIN_EDGE; // 트레이닝 아이덴티티(시안 461:339)
// 물음표 기호 아이콘 — Solar엔 순수 물음표가 없어 Phosphor를 쓴다(ModalHead의 Icon 인터페이스에 맞춘 래퍼)
const QuestionMarkBadge = ({ size, color }) => <QuestionMarkIcon size={size} weight="bold" color={color} />;

// 한글 받침 유무 — 조사(으로/로) 선택용. 마지막 글자가 한글이 아니면 받침 없음으로 본다.
function hasFinalConsonant(word = '') {
  const ch = (word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (!ch || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

// ── 안내 모달 5종 — 시안(2026-08-06) 공통 규격으로 통일 ────────────────
//  카드 330 r24 · 배지 72 r24 + 아이콘 38 · 제목 24/29 · 본문 14/22 · 키캡 CTA 60 · 텍스트 '닫기'.
//  구 비주얼(그라데이션 배지·글로우 CTA)은 전부 폐기 — 일시정지/메뉴 모달과 같은 언어로 맞춤.
export function HelpStartModal({ onStart, onClose }) {
  // 시안 769:28 — 배지 코랄 + 물음표 기호(Phosphor QuestionMark). CTA엔 아이콘 없음.
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={QuestionMarkBadge} badgeBg={CTA_RED} title="게임 방법" />
      <ModalBody lines={['성조 게임 조작법을 처음부터', '다시 볼까요?']} />
      <KeycapCta label="게임 방법 보기" onClick={() => { onStart && onStart(); }} />
      <ModalTextButton onClick={onClose} />
    </ModalCard>
  );
}

// 무한 시작 모달 — 모드선택 '무한' 카드 시. 서든데스·건너뛰기 규칙 안내 + [게임 시작].
//  시안 771:2에서 최고점 칩·단어카드설정(뜻/병음) 토글은 빠졌다 — 뜻/병음은 일시정지 모달에서 조절.
export function EndlessStartModal({ onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={InfinityIcon} badgeBg={ENDLESS_ORANGE} title="무한 모드" />
      <ModalBody lines={['점점 빨라지는 문제를 계속 풀어요.', '한 번이라도 틀리면 끝!', '모르는 단어는 건너뛰기 패스로 넘기세요.']} />
      <KeycapCta label="게임 시작" Icon={Play} onClick={() => { onStart && onStart(); }} />
      <ModalTextButton onClick={onClose} />
    </ModalCard>
  );
}

// 트레이닝 시작 모달 — 모드선택 '트레이닝' 카드 시. 무엇을 하는 모드인지 안내 + [트레이닝 시작].
//   트레이닝 = 열린 스테이지 범위의 약점가중 단어를 시간제한 없이 무한 반복(기록 미반영).
export function TrainingStartModal({ onStart, onClose }) {
  // 시안 461:43 — 다른 안내 모달과 같은 규격(r24 · 28/22/22)으로 통일됨(2026-08-07). 본문만 색 강조가 있어 커스텀.
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={SquareAcademicCap} badgeBg={TRAIN_GREEN} title="트레이닝" />
      <span style={{ width: '100%', ...TYPE.body, fontWeight: 400, fontSize: 14, lineHeight: '22px', color: TG.SUB, textAlign: 'center' }}>
        지금 열린 범위에서 <span style={{ color: TG.INK }}>약한 단어 위주</span>로 골라줘요.<br />
        <span style={{ color: TRAIN_GREEN }}>시간 제한 없이</span> 계속 이어서 연습해요.<br />
        기록에는 반영되지 않으니 부담 없이!
      </span>
      <KeycapCta bg={TRAIN_GREEN} edge={TRAIN_GREEN_EDGE} label="시작 하기" Icon={Play} onClick={() => { onStart && onStart(); }} />
      {/* 이 모달만 닫기 색이 SUB(시안 461:43) */}
      <ModalTextButton color={TG.SUB} onClick={onClose} />
    </ModalCard>
  );
}

// 트레이닝 유도 모달 — 입문을 연속으로 어려워한 유저가 '홈으로 가기'로 나오면 홈에서 부드럽게 제안(비강제).
export function TrainingNudgeModal({ onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={SquareAcademicCap} badgeBg={TRAIN_GREEN} title="천천히 익혀볼까요?" />
      <ModalBody lines={['입문이 조금 어렵게 느껴지셨나요?', '트레이닝은 시간 제한 없이', '약한 단어 위주로 편하게 연습할 수 있어요.']} />
      <KeycapCta bg={TRAIN_GREEN} edge={TRAIN_GREEN_EDGE} label="트레이닝 시작" Icon={Play} onClick={() => { onStart && onStart(); }} />
      <ModalTextButton onClick={onClose} />
    </ModalCard>
  );
}

// 승급시험 유도 모달 — 고득점으로 실력 증명 시, 5단계 다 안 깨도 승급시험 도전 제안(비강제·급별 1회).
export function ExamPromptModal({ nextLabel = '', onStart, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={MedalStar} badgeBg={EXAM_GOLD} title="실력이 좋으시네요!" />
      {/* 조사 — 받침 있으면 '으로'(실전→실전으로), 없으면 '로'(고수→고수로) */}
      <ModalBody lines={['모든 단계를 깨지 않아도', `${nextLabel} 승급시험에 바로 도전할 수 있어요.`, `통과하면 ${nextLabel}${hasFinalConsonant(nextLabel) ? '으로' : '로'} 승급!`]} />
      <KeycapCta label="승급시험 도전" Icon={Play} onClick={() => { onStart && onStart(); }} />
      <ModalTextButton onClick={onClose} />
    </ModalCard>
  );
}

// 로그인 유도 모달 — 게스트가 이전 기록을 넘긴 순간(결과 화면). 기기 저장(정직) 안내 + 로그인.
export function LoginNudgeModal({ onLogin, onClose }) {
  return (
    <ModalCard onClose={onClose}>
      <ModalHead Icon={Devices} badgeBg={CTA_RED} title="어디서든 이어가기" />
      <ModalBody lines={['기록은 지금 이 기기에 저장돼 있어요.', '로그인하면 다른 기기에서도 이어서 할 수 있어요.']} />
      {/* 시안 771:41(2026-08-07 수정) — 라벨 '로그인', CTA 아이콘 없음 */}
      <KeycapCta label="로그인" Icon={Play} onClick={() => { onLogin && onLogin(); }} />
      <ModalTextButton onClick={onClose} />
    </ModalCard>
  );
}

// SNS 링크 (PersonalPage와 동일 URL). 인스타그램이 메인, 유튜브·블로그는 보조.
export const PLAY_LINKS = {
  instagram: { href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==', handle: '@tiantian_laoshi' },
  youtube: { id: 'youtube', href: 'https://www.youtube.com/@tiantian_chinese', label: '유튜브', color: '#FF0000', Icon: YoutubeLogoIcon, w: 'fill' }, // 브랜드로고=phosphor라 fill // BRAND
  blog: { id: 'blog', href: 'https://blog.naver.com/tiantian_chinese/224100509217', label: '블로그', color: '#03C75A', Icon: Notebook, w: 'Bold' }, // Solar // BRAND
};

// '놀러가기' 모달 — 인스타그램(메인 그라데이션) + 유튜브·블로그(보조). Figma "14. 놀러가기" 기준.
export function PlayModal({ onClose }) {
  // 측정: 게임→채널 전환 클릭(유입 깔때기의 출구) — 채널 라벨만(PII 없음)
  const openLink = (href, channel) => { track('cta_play_link', { m: channel }); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ } };
  return (
    <ModalCard onClose={onClose} padding="28px 24px 24px" gap={18}>
      {/* 틴트 원 배경 제거(§18-2, 2026-09-03) — 아이콘을 키워 무게 유지 */}
      <HandStars size={48} weight="Bold" color={TG.CORAL_DK} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm, textAlign: 'center', width: '100%' }}>
          <span style={{ ...TYPE.titleLg, color: TG.INK }}>놀러 오세요</span>
          <span style={{ ...TYPE.sub, color: TG.SUB }}>하늘쌤 채널에서 더 많은 중국어 이야기를</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
          <button className="tg-press" onClick={() => openLink(PLAY_LINKS.instagram.href, 'instagram')} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: SPACE.xl, padding: '14px 16px', borderRadius: RADIUS.btn, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)', boxShadow: '0 8px 16px rgba(221,42,123,0.3)', ...TOUCH_OPT,
          }}>
            <div style={{ width: 48, height: 48, borderRadius: RADIUS.xxl, background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <InstagramLogoIcon size={26} weight="fill" color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.xs, alignItems: 'flex-start' }}>
              <span style={{ ...TYPE.btn, color: '#fff' }}>인스타그램</span>
              <span style={{ ...TYPE.meta, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{PLAY_LINKS.instagram.handle}</span>
            </div>
            <AltArrowRight size={20} weight="Bold" color="#fff" style={{ opacity: 0.9, flexShrink: 0 }} />
          </button>
          <div style={{ display: 'flex', gap: SPACE.lg }}>
            {[PLAY_LINKS.youtube, PLAY_LINKS.blog].map((s) => (
              <button key={s.label} className="tg-press" onClick={() => openLink(s.href, s.id)} style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: '12px 0', borderRadius: RADIUS.lg,
                background: '#fff', border: `1.5px solid ${TG.BORDER}`, cursor: 'pointer', ...TOUCH_OPT,
              }}>
                <s.Icon size={20} weight={s.w} color={s.color} />
                <span style={{ ...TYPE.label, color: TG.INK }}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="tg-press" onClick={onClose} style={{ width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
          <span style={{ ...TYPE.body, color: TG.SUB }}>닫기</span>
        </button>
    </ModalCard>
  );
}

// [디버그] 점수 기록 설정 모달 — 잠금 사다리/무한 해제/헤드라인 테스트용(import.meta.env.DEV에서만 렌더).
export function DebugScoreModal({ studentToken, onClose, onApplied }) {
  const [v, setV] = useState(() => ({
    easy: loadBest(studentToken, GAMEKEY.easy)?.bestScore || 0,
    normal: loadBest(studentToken, GAMEKEY.normal)?.bestScore || 0,
    hard: loadBest(studentToken, GAMEKEY.hard)?.bestScore || 0,
    endless: loadEndlessBest(studentToken)?.bestScore || 0,
  }));
  const rows = [...DIFFICULTIES.map((d) => [d.id, d.label]), ['endless', '무한']];
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
    <ModalCard onClose={onClose} maxWidth={320} radius={24} padding="22px 20px 18px" gap={12} align="stretch">
        <span style={{ ...TYPE.head, fontSize: 19, color: TG.INK, textAlign: 'center' }}>🛠 점수 디버그</span>
        {rows.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.xl }}>
            <span style={{ ...TYPE.label, color: TG.INK }}>{label}</span>
            <input type="number" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
              style={{ width: 120, height: 38, borderRadius: RADIUS.md, border: `1.5px solid ${TG.BORDER}`, padding: '0 12px', textAlign: 'right', ...TYPE.num, fontSize: 15, color: TG.INK, background: '#fff' }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: SPACE.md, marginTop: SPACE.xxs }}>
          <button onClick={() => setV((s) => ({ ...s, easy: 1000, normal: 1000, hard: 1000 }))} className="tg-press" style={{ flex: 1, height: 40, borderRadius: RADIUS.md, border: `1.5px solid ${TG.BORDER}`, background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.INK, ...TOUCH_OPT }}>난이도 모두 1000</button>
          <button onClick={() => setV({ easy: 0, normal: 0, hard: 0, endless: 0 })} className="tg-press" style={{ flex: 1, height: 40, borderRadius: RADIUS.md, border: `1.5px solid ${TG.BORDER}`, background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.SUB, ...TOUCH_OPT }}>초기화</button>
        </div>
        <button onClick={apply} className="tg-press" style={{ width: '100%', height: 50, borderRadius: RADIUS.lg, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: SHADOW.btn, color: '#fff', ...TYPE.btn, marginTop: SPACE.xs, ...TOUCH_OPT }}>적용</button>
        <button onClick={onClose} className="tg-press" style={{ width: '100%', padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', ...TYPE.sub, color: TG.SUB, ...TOUCH_OPT }}>닫기</button>
    </ModalCard>
  );
}
