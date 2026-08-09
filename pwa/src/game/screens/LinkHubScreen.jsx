// 하늘하늘중국어 링크 허브 — 홈 우측 플로팅(天) 버튼으로 여는 풀스크린 오버레이. Figma "29. 하늘하늘중국어 (링크 허브)".
// 카드는 카카오톡 링크 공유 미리보기 스타일(상단 썸네일 + 제목/설명/도메인)의 세로 리스트.
// 항목은 전부 데이터(HUB_LINKS) — 특강·교재·단어장 등 새 링크는 배열에 추가만 하면 됨.
// image: 썸네일 경로(권장 2:1 가로형). 없으면 tint+라벨 — 파일 없는 경로 금지(깨진 아이콘 뜸). SNS는 놀러가기 모달 전담.
import { AltArrowRight, Stars } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { track } from '../gameAnalytics.js';
import { TgTabBar, TAB_BAR_H, Reveal } from './shared.jsx';

const SITE = 'https://tiantian-chinese.pages.dev';

// image = 각 링크의 카톡 미리보기(OG) 이미지 그대로 (public/img, 1200×630. intro.html·group-class.html og:image와 동일)
const HUB_LINKS = [
  { id: 'consult', title: '무료상담', desc: '고민만 들고 오세요, 부담 없이', href: `${SITE}/#/intro`, image: '/img/카카오톡링크미리보기이미지_소개및무료상담신청.png', tint: '#7f0005' },
];

// 측정: 게임→서비스 전환 클릭(유입 깔때기의 출구) — 기존 cta_play_link 이벤트에 m: consult/group 추가
function openLink(href, channel) {
  track('cta_play_link', { m: channel });
  try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ }
}

// 탭바 도입(2026-07-27 홈 리디자인) — 오버레이(onClose)에서 '하늘하늘' 탭 화면으로 전환. 뒤로가기 대신 탭 전환.
export function LinkHubScreen({ tabNav }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: TG.BG, ...TOUCH_OPT }}>
      {/* 스크롤 레이어 — 탭바(형제)는 고정. 진입 애니(tg-enter)는 콘텐츠에만(탭바 깜빡임 방지) */}
      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column', paddingBottom: `calc(${TAB_BAR_H + 28}px + env(safe-area-inset-bottom))` }}>
        {/* 히어로 — 브랜드 로고만. 시안 16(2026-08-05 2차): 로고 y40(188×27.3), 부제는 숨김 처리됨 */}
        <Reveal i={0} style={{ paddingTop: 'calc(40px + env(safe-area-inset-top))' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img src="/logo/logo-red.png" alt="하늘하늘중국어" style={{ width: 188, height: 'auto', objectFit: 'contain' }} />
          </div>
        </Reveal>

        {/* 링크 카드 — 카톡 공유 미리보기 스타일 세로 리스트. 시안: 첫 카드 y140(로고 아래 72.7) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.x2, padding: '72.7px 24px 0' }}>
          {HUB_LINKS.map((l, li) => (
            <Reveal key={l.id} i={li + 1}>
            <button className="tg-press" onClick={() => openLink(l.href, l.id)} style={{
              display: 'block', width: '100%', padding: 0, borderRadius: RADIUS.xl, overflow: 'hidden',
              background: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0px 4px 18px rgba(43,39,48,0.07)', textAlign: 'left', ...TOUCH_OPT,
            }}>
              {/* 상단 썸네일 — OG 표준 비율(1200×630). 이미지 없는 항목은 tint+라벨 */}
              <div style={{ width: '100%', aspectRatio: '1200 / 630', background: l.image ? TG.SURFACE : l.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {l.image
                  ? <img src={l.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ ...TYPE.btn, color: 'rgba(255,255,255,0.92)' }}>{l.title}</span>}
              </div>
              {/* 하단 텍스트 패널 — 제목/설명 + 바로가기 어포던스(카드별 tint로 구분) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, padding: '14px 16px' }}>
                {/* 시안 16 실측: 제목 16 Bold(라인 26) · 설명 13 Bold(라인 21) · 사이 4 */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
                  <span style={{ ...TYPE.btn, lineHeight: '26px', color: TG.INK }}>{l.title}</span>
                  <span style={{ ...TYPE.sub, fontWeight: 700, lineHeight: '21px', color: TG.SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.desc}</span>
                </div>
                <AltArrowRight aria-hidden="true" size={24} weight="Bold" color={l.tint} style={{ flexShrink: 0 }} />
              </div>
            </button>
            </Reveal>
          ))}
        </div>

        {/* 새 콘텐츠 준비 안내 — 시안 16(2차): 카드 아래 30 · 232×40 · TG.SURFACE · 반짝 17 + 문구 13 Bold(gap 6, 좌우 16) */}
        <div style={{ paddingTop: 30, display: 'flex', justifyContent: 'center' }}>
          <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '0 16px', borderRadius: RADIUS.pill, background: TG.SURFACE }}>
            <Stars size={17} weight="Bold" color={TG.MUTED} />
            <span style={{ ...TYPE.sub, fontWeight: 700, lineHeight: '20px', color: TG.SUB }}>새로운 콘텐츠를 준비하고 있어요</span>
          </div>
        </div>
      </div>
      </div>
      <TgTabBar active="hub" onNav={tabNav} />
    </div>
  );
}
