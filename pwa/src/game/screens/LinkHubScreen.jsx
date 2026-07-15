// 하늘하늘중국어 링크 허브 — 홈 우측 플로팅(天) 버튼으로 여는 풀스크린 오버레이. Figma "29. 하늘하늘중국어 (링크 허브)".
// 카드는 카카오톡 링크 공유 미리보기 스타일(상단 썸네일 + 제목/설명/도메인)의 세로 리스트.
// 항목은 전부 데이터(HUB_LINKS) — 특강·교재·단어장 등 새 링크는 배열에 추가만 하면 됨.
// image: 썸네일 경로(권장 2:1 가로형). 없으면 tint+라벨 — 파일 없는 경로 금지(깨진 아이콘 뜸). SNS는 놀러가기 모달 전담.
import { CaretLeftIcon } from '@phosphor-icons/react';
import { TG, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { track } from '../gameAnalytics.js';

const SITE = 'https://tiantian-chinese.pages.dev';

// image = 각 링크의 카톡 미리보기(OG) 이미지 그대로 (public/img, 1200×630. intro.html·group-class.html og:image와 동일)
const HUB_LINKS = [
  { id: 'consult', title: '무료상담', desc: '고민만 들고 오세요, 부담 없이', href: `${SITE}/#/intro`, image: '/img/카카오톡링크미리보기이미지_소개및무료상담신청.png', tint: '#7f0005' },
  { id: 'group', title: '그룹 수업', desc: '함께 배우는 라이브 클래스', href: `${SITE}/#/group-class`, image: '/img/og-group-class.png', tint: '#C9723F' },
];

// 측정: 게임→서비스 전환 클릭(유입 깔때기의 출구) — 기존 cta_play_link 이벤트에 m: consult/group 추가
function openLink(href, channel) {
  track('cta_play_link', { m: channel });
  try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* noop */ }
}

export function LinkHubScreen({ onClose }) {
  return (
    <div className="tg-enter" style={{ position: 'fixed', inset: 0, zIndex: 60, background: TG.BG, overflowY: 'auto', ...TOUCH_OPT }}>
      <div style={{ position: 'relative', minHeight: '100%', paddingBottom: 'calc(40px + env(safe-area-inset-bottom))' }}>
        {/* 뒤로 */}
        <button aria-label="뒤로" className="tg-press" onClick={onClose} style={{
          position: 'absolute', left: 24, top: 'calc(20px + env(safe-area-inset-top))', width: 40, height: 40, borderRadius: 20,
          background: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 3px 8px rgba(26,16,20,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT,
        }}>
          <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
        </button>

        {/* 히어로 — 브랜드 로고 */}
        <div style={{ paddingTop: 'calc(96px + env(safe-area-inset-top))', display: 'flex', justifyContent: 'center' }}>
          <img src="/logo/logo-red.png" alt="하늘하늘중국어" style={{ width: 200, height: 'auto', objectFit: 'contain' }} />
        </div>

        {/* 링크 카드 — 카톡 공유 미리보기 스타일 세로 리스트 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '34px 24px 0' }}>
          {HUB_LINKS.map((l) => (
            <button key={l.id} className="tg-press" onClick={() => openLink(l.href, l.id)} style={{
              display: 'block', width: '100%', padding: 0, borderRadius: 20, overflow: 'hidden',
              background: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 5px 14px rgba(26,16,20,0.07)', textAlign: 'left', ...TOUCH_OPT,
            }}>
              {/* 상단 썸네일 — OG 표준 비율(1200×630). 이미지 없는 항목은 tint+라벨 */}
              <div style={{ width: '100%', aspectRatio: '1200 / 630', background: l.image ? '#f4efe8' : l.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {l.image
                  ? <img src={l.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: 'rgba(255,255,255,0.92)' }}>{l.title}</span>}
              </div>
              {/* 하단 텍스트 패널 — 제목/설명/도메인 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px 15px' }}>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: TG.INK }}>{l.title}</span>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: TG.SUB }}>{l.desc}</span>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11, color: '#B8B2BE', marginTop: 3 }}>{new URL(l.href).host}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
