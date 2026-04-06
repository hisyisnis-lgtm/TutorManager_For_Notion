import { PRIMARY } from '../../constants/theme';

/**
 * PublicHeader — 공개 페이지 공통 스티키 헤더
 * LandingPage · PricingPage 에서 사용합니다.
 *
 * @param {string[]}  tabs        - 탭 라벨 배열 (예: ['소개', '무료상담'])
 * @param {string}    activeTab   - 현재 활성 탭 라벨
 * @param {Function}  onTabChange - 탭 클릭 시 호출되는 콜백 (tab: string) => void
 * @param {React.ReactNode} rightSlot - 헤더 오른쪽 슬롯 (선택, 예: <ShareButton />)
 */
export default function PublicHeader({ tabs, activeTab, onTabChange, rightSlot }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      backgroundColor: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid #ebebeb',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 20px' }}>
        <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img
            src="/logo/logo-red.png"
            alt="하늘하늘 중국어"
            style={{ height: 24, objectFit: 'contain', outline: 'none' }}
          />
          {rightSlot}
        </div>
        <div role="tablist" aria-label="페이지 섹션" style={{ display: 'flex', marginBottom: -1 }}>
          {tabs.map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={activeTab === t}
              aria-controls={`panel-${t}`}
              id={`tab-${t}`}
              onClick={() => onTabChange(t)}
              style={{
                minHeight: 44, marginRight: 24, paddingBottom: 10, paddingTop: 10,
                fontSize: 14, fontWeight: 500,
                border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: `2px solid ${activeTab === t ? PRIMARY : 'transparent'}`,
                color: activeTab === t ? PRIMARY : '#595959',
                transition: 'color 0.2s, border-color 0.2s',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
