// 시작 화면 — 타이틀 로고(프리미엄 효과)·최고점수 카드·성조 칩·판다 코치·시작하기 CTA·
// 보조쌍(놀러가기/단어 숙련도)·로그인(게스트)/로그아웃(회원)·소리 토글·[DEV]디버그.
// 놀러가기 모달(PlayModal)·디버그 점수 모달(DebugScoreModal)도 이 파일에.
import { useState } from 'react';
import {
  CaretLeftIcon, StarIcon, FlameIcon, PlayIcon, HandWavingIcon, ChartBarIcon, TrophyIcon, QuestionIcon,
  GearSixIcon, InstagramLogoIcon, YoutubeLogoIcon, ArticleIcon, CaretRightIcon, InfinityIcon, MedalIcon,
} from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, FONT_NUM, SHADOW, TOUCH_OPT, ASSETS, TONE_TINTS, loadBest, saveBest } from '../tgTokens.js';
import { ToneMark, useCountUp } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { play as playSfx } from '../tgSfx.js';
import { GAMEKEY, loadEndlessBest, saveEndlessBest } from '../gameLogic.js';
import { FigmaScreen, Reveal, CoachBubble, SettingsModal } from './shared.jsx';

// SNS 링크 (PersonalPage와 동일 URL). 인스타그램이 메인, 유튜브·블로그는 보조.
const PLAY_LINKS = {
  instagram: { href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==', handle: '@tiantian_laoshi' },
  youtube: { href: 'https://www.youtube.com/@tiantian_chinese', label: '유튜브', color: '#FF0000', Icon: YoutubeLogoIcon },
  blog: { href: 'https://blog.naver.com/tiantian_chinese/224100509217', label: '블로그', color: '#03C75A', Icon: ArticleIcon },
};

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

// [디버그] 점수 기록 설정 모달 — 잠금 사다리/무한 해제/헤드라인 테스트용(import.meta.env.DEV에서만 렌더).
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

// 스탯 타일 — 스트릭/최고점수 2분할(P3). 아이콘 배지가 카드 상단 가장자리에 반쯤 걸친 플로팅 디자인.
// onHelp 있으면 우상단 '?' 버튼(최고 점수 기준 안내).
function StatTile({ icon, badgeBg, value, label, onHelp }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, height: 100, background: '#fff', borderRadius: 22, boxShadow: '0px 6px 16px rgba(43,39,48,0.06)', overflow: 'visible' }}>
      {onHelp && (
        <button onClick={(e) => { e.stopPropagation(); onHelp(); }} aria-label="최고 점수 기준" className="tg-press" style={{ position: 'absolute', top: 7, right: 7, zIndex: 2, width: 22, height: 22, borderRadius: 11, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, ...TOUCH_OPT }}>
          <QuestionIcon size={20} weight="bold" color="#c2bab1" />
        </button>
      )}
      {/* 배지 — 카드 상단 중앙에 반쯤 걸침(중심이 상단 모서리). 살짝 떠 보이게 소프트 섀도 */}
      <div style={{ position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)', width: 44, height: 44, borderRadius: 22, background: badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>{icon}</div>
      {/* 숫자 + 라벨 — 카드 하단부 중앙(배지 자리 비우려 paddingTop) */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 22, gap: 6 }}>
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 24, color: '#2b2730', lineHeight: 1 }}>{value}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0' }}>{label}</span>
      </div>
    </div>
  );
}

// 최고 점수 기준 안내 모달 — headlineBest 로직(무한 우선, 없으면 통합) 설명. '?' 버튼으로 호출.
function BestInfoRow({ Icon, color, bg, title, desc }) {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={18} weight="fill" color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#2b2730' }}>{title}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#9a93a0', lineHeight: 1.4 }}>{desc}</span>
      </div>
    </div>
  );
}

function BestInfoModal({ best, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: 24, padding: '24px 22px 20px', boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, background: '#ffe7bb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StarIcon size={24} weight="fill" color="#FF9500" />
          </div>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 20, color: '#2b2730' }}>최고 점수 기준</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <BestInfoRow Icon={InfinityIcon} color="#4D8DFF" bg="rgba(77,141,255,0.13)" title="무한 모드 기록이 있으면" desc="무한 모드 최고 점수를 보여줘요" />
          <BestInfoRow Icon={StarIcon} color="#FF9500" bg="rgba(255,149,0,0.13)" title="무한 기록이 없으면" desc="초급·중급·고급 중 가장 높은 점수예요" />
        </div>
        <div style={{ background: '#f7f3ee', borderRadius: 14, padding: '11px 14px' }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: '#767676', lineHeight: 1.5 }}>
            연습·복습 모드는 점수에 반영되지 않아요.{best?.label && best?.bestScore > 0 ? ` 지금은 ‘${best.label}’ 기준이에요.` : ''}
          </span>
        </div>
        <button onClick={onClose} className="tg-press" style={{ width: '100%', height: 50, borderRadius: 16, border: 'none', cursor: 'pointer', background: TG.CORAL_GRAD, boxShadow: SHADOW.btn, color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, ...TOUCH_OPT }}>알겠어요</button>
      </div>
    </div>
  );
}

export function StartScreen({ best, streak = 0, onStart, onClose, onHelp, onDebugIntro, onMastery, onAchievements, studentToken, onRefreshBest, onLogin, isMemberUser, memberName, onLogout }) {
  const animBest = useCountUp(best?.bestScore || 0, 1100); // 최고점수 0→실값 카운트업
  const [playOpen, setPlayOpen] = useState(false);
  const [debugScoreOpen, setDebugScoreOpen] = useState(false);
  const [bestInfoOpen, setBestInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <FigmaScreen bgImage={ASSETS.startBg}>
      <div style={{ position: 'absolute', inset: 0, ...TOUCH_OPT }}>
        {/* 타이틀 아트 (가로 중앙) — 로고 비율 2047×1039 ≈ 1.97:1 유지 + 프리미엄 효과(글로우·팝·빛스윕·반짝임) */}
        <Reveal i={0} style={{ position: 'absolute', top: 90, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 322 }}>
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
        {/* 도움말 top20 left72 — 소개·튜토리얼 재시청(온보딩 후 규칙 복구 경로). 닫기 옆 */}
        {onHelp && (
          <button onClick={(e) => { e.stopPropagation(); onHelp(); }} aria-label="도움말" className="tg-press"
            style={{ position: 'absolute', left: 72, top: 20, width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <QuestionIcon weight="fill" size={20} color={TG.INK} />
          </button>
        )}
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
        {/* 설정 ⚙️ (소리·햅틱 토글) — 우상단. 기존 단독 소리 토글을 흡수 */}
        <button onClick={(e) => { e.stopPropagation(); setSettingsOpen(true); }} aria-label="설정" className="tg-press"
          style={{ position: 'absolute', right: 24, top: 20, width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
          <GearSixIcon size={20} weight="fill" color={TG.INK} />
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
        {/* 스탯 2분할 top288 — 🔥스트릭 | ⭐최고점수 (P3) */}
        <Reveal i={1} style={{ position: 'absolute', left: 24, right: 24, top: 288 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatTile
              icon={<FlameIcon size={22} weight="fill" color={streak > 0 ? TG.CORAL_DK : '#b9a89f'} />}
              badgeBg={streak > 0 ? '#ffded3' : '#e9e2d8'}
              value={streak} label="일 연속" />
            <StatTile
              icon={<StarIcon size={21} weight="fill" color="#FF9500" />}
              badgeBg="#ffe7bb" value={animBest.toLocaleString()} label="최고 점수"
              onHelp={() => setBestInfoOpen(true)} />
          </div>
        </Reveal>
        {/* 성조 미리보기 칩 top416 */}
        <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 416 }}>
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
        <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 492, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
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
        {/* 보조 버튼 (하단) — 놀러가기 | 숙련도 | 업적 */}
        <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { key: 'play', Icon: HandWavingIcon, label: '놀러가기', onClick: () => setPlayOpen(true) },
            { key: 'mastery', Icon: MedalIcon, label: '내 등급', onClick: onMastery },
            { key: 'ach', Icon: TrophyIcon, label: '업적', onClick: () => onAchievements && onAchievements() },
          ].map(({ key, Icon, label, onClick }) => (
            <button key={key} className="tg-press" onClick={onClick} style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px 0', borderRadius: 16,
              background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT,
            }}>
              <Icon size={18} weight="fill" color={TG.CORAL_DK} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: '#2b2730' }}>{label}</span>
            </button>
          ))}
        </div>
        </Reveal>
      </div>
      {playOpen && <PlayModal onClose={() => setPlayOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {bestInfoOpen && <BestInfoModal best={best} onClose={() => setBestInfoOpen(false)} />}
      {import.meta.env.DEV && debugScoreOpen && <DebugScoreModal studentToken={studentToken} onClose={() => setDebugScoreOpen(false)} onApplied={() => onRefreshBest && onRefreshBest()} />}
    </FigmaScreen>
  );
}
