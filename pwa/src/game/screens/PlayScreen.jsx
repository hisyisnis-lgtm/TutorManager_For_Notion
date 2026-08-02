// 놀러가기 탭 화면 — 구 PlayModal(모달)을 탭바 도입(2026-07-27 홈 리디자인)과 함께 풀스크린 화면으로 전환.
// 콘텐츠·측정은 모달과 동일(PLAY_LINKS 단일 출처): 인스타그램(메인 그라데이션) + 유튜브·블로그(보조).
import { HandStars, AltArrowRight } from '@solar-icons/react';
import { InstagramLogoIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { track } from '../gameAnalytics.js';
import { PLAY_LINKS } from './gameModals.jsx';
import { TgTabBar, TAB_BAR_H } from './shared.jsx';

export function PlayScreen({ tabNav }) {
  const openLink = (href, channel) => { track('cta_play_link', { m: channel }); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ } };
  return (
    <div style={{ position: 'absolute', inset: 0, background: TG.BG, ...TOUCH_OPT }}>
      {/* 스크롤 레이어 — 탭바(형제)는 고정. 진입 애니(tg-enter)는 콘텐츠에만(탭바 깜빡임 방지) */}
      <div className="tg-enter" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2, padding: `calc(72px + env(safe-area-inset-top)) 24px calc(${TAB_BAR_H + 24}px + env(safe-area-inset-bottom))` }}>
        <div style={{ width: 72, height: 72, borderRadius: 36, background: 'rgba(255,107,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <HandStars size={30} weight="Bold" color={TG.CORAL_DK} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm, textAlign: 'center', width: '100%' }}>
          <span style={{ ...TYPE.titleLg, color: TG.INK }}>놀러 오세요</span>
          <span style={{ ...TYPE.sub, color: TG.SUB }}>하늘쌤 채널에서 더 많은 중국어 이야기를</span>
        </div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: SPACE.lg, marginTop: SPACE.md }}>
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
      </div>
      </div>
      <TgTabBar active="play" onNav={tabNav} />
    </div>
  );
}
