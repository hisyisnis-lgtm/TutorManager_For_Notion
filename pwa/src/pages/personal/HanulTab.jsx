import { ArticleIcon, InstagramLogoIcon, YoutubeLogoIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import { BRAND_EXTERNAL, TEXT_PRIMARY, TEXT_TERTIARY, TEXT_INACTIVE } from '../../constants/theme.js';

// ===== 하늘하늘 탭 =====
// 브랜드 링크 허브 — 지금은 SNS 채널, 나중에 교재·단어장 구매 링크나 게임 링크가 들어올 자리.
// 새 링크는 SECTIONS에 항목만 추가하면 된다 (섹션 단위로도 확장 가능).

const SECTIONS = [
  {
    heading: '하늘하늘 소식',
    links: [
      {
        label: '블로그',
        desc: '수업 이야기와 학습 팁',
        Icon: ArticleIcon,
        color: BRAND_EXTERNAL.naver,
        href: 'https://blog.naver.com/tiantian_chinese/224100509217',
      },
      {
        label: '인스타그램',
        desc: '@tiantian_laoshi',
        Icon: InstagramLogoIcon,
        color: BRAND_EXTERNAL.instagram,
        href: 'https://www.instagram.com/tiantian_laoshi?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==',
      },
      {
        label: '유튜브',
        desc: '@tiantian_chinese',
        Icon: YoutubeLogoIcon,
        color: BRAND_EXTERNAL.youtube,
        href: 'https://www.youtube.com/@tiantian_chinese',
      },
    ],
  },
  // 예: { heading: '학습 자료', links: [{ label: '교재 구매', ... }] }
];

export default function HanulTab() {
  return (
    <div style={{ padding: '16px 16px 0' }}>
      {SECTIONS.map(({ heading, links }) => (
        <div key={heading} style={{ marginBottom: 24 }}>
          <SectionHeading>{heading}</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {links.map(({ label, desc, Icon, color, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="press"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 16,
                  background: '#fff', borderRadius: 16,
                  boxShadow: 'var(--shadow-border)',
                  textDecoration: 'none',
                  WebkitTapHighlightColor: 'transparent' }}
              >
                <Icon size={24} weight="fill" color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY }}>{label}</div>
                  <div style={{ fontSize: 13, color: TEXT_TERTIARY, marginTop: 1 }}>{desc}</div>
                </div>
                <ArrowSquareOutIcon size={16} weight="bold" color={TEXT_INACTIVE} />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
