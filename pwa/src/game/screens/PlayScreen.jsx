// 놀러가기 탭 화면 — 구 PlayModal(모달)을 탭바 도입(2026-07-27 홈 리디자인)과 함께 풀스크린 화면으로 전환.
// 콘텐츠·측정은 모달과 동일(PLAY_LINKS 단일 출처): 인스타그램(메인 그라데이션) + 유튜브·블로그(보조).
import { InstagramLogoIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';

const TITLE_INK = TG.INK; // 시안 15 제목(오답 노트·업적과 동일)
import { track } from '../gameAnalytics.js';
import { PLAY_LINKS } from './gameModals.jsx';
import { TgTabBar, TAB_BAR_H, Reveal } from './shared.jsx';

export function PlayScreen({ tabNav, achDot = false }) {
  const openLink = (href, channel) => { track('cta_play_link', { m: channel }); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ } };
  return (
    <div style={{ position: 'absolute', inset: 0, background: TG.BG, ...TOUCH_OPT }}>
      {/* 스크롤 레이어 — 탭바(형제)는 고정. 진입 애니(tg-enter)는 콘텐츠에만(탭바 깜빡임 방지) */}
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      {/* 시안 15(2026-08-05): 아이콘 원·부제 삭제, 제목 좌측정렬 24px 2줄(y40) → 인스타 y120 → 보조행 y206(간격 10) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, padding: `calc(40px + env(safe-area-inset-top)) 24px calc(${TAB_BAR_H + 24}px + env(safe-area-inset-bottom))` }}>
        <Reveal i={0} style={{ marginBottom: 12 }}>
          <span style={{ display: 'block', ...TYPE.head, fontSize: 24, lineHeight: '29px', color: TITLE_INK }}>
            하늘쌤의 놀이터로<br />놀러오세요!
          </span>
        </Reveal>
        {/* 인스타그램 — 내부는 시안 절대좌표(원 16,14/48 · 라벨 78,17 · 핸들 78,42) */}
        <Reveal i={1}>
        <button className="tg-press" onClick={() => openLink(PLAY_LINKS.instagram.href, 'instagram')} style={{
          position: 'relative', width: '100%', height: 76, padding: 0, borderRadius: RADIUS.btn, border: 'none', cursor: 'pointer', overflow: 'hidden',
          background: 'linear-gradient(90deg, #F58529, #DD2A7B, #8134AF)', boxShadow: '0px 8px 16px rgba(221,42,123,0.3)', ...TOUCH_OPT,
        }}>
          <div style={{ position: 'absolute', left: 16, top: 14, width: 48, height: 48, borderRadius: RADIUS.xxl, background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <InstagramLogoIcon size={26} weight="fill" color="#fff" />
          </div>
          <span style={{ position: 'absolute', left: 78, top: 17, ...TYPE.btn, lineHeight: '19px', color: '#fff' }}>인스타그램</span>
          <span style={{ position: 'absolute', left: 78, top: 42, ...TYPE.meta, lineHeight: '14px', color: 'rgba(255,255,255,0.85)' }}>{PLAY_LINKS.instagram.handle}</span>
        </button>
        </Reveal>
        {/* 유튜브·블로그 — 166×46 r16 흰 버튼(1.5px 보더), 아이콘 20 + 간격 8 + 라벨 14 */}
        <Reveal i={2}>
          <div style={{ display: 'flex', gap: SPACE.lg }}>
            {[PLAY_LINKS.youtube, PLAY_LINKS.blog].map((s) => (
              <button key={s.label} className="tg-press" onClick={() => openLink(s.href, s.id)} style={{
                flex: 1, minWidth: 0, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: 0, borderRadius: RADIUS.lg,
                background: '#fff', border: `1.5px solid ${TG.BORDER}`, cursor: 'pointer', ...TOUCH_OPT,
              }}>
                <s.Icon size={20} weight={s.w} color={s.color} />
                <span style={{ ...TYPE.label, lineHeight: '19px', color: TG.INK }}>{s.label}</span>
              </button>
            ))}
          </div>
        </Reveal>
      </div>
      </div>
      <TgTabBar active="play" onNav={tabNav} dot={achDot ? "ach" : null} />
    </div>
  );
}
