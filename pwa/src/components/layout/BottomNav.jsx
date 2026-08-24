import { NavLink } from 'react-router-dom';
import { HouseIcon, UsersIcon, CalendarBlankIcon, ClipboardTextIcon, CurrencyDollarIcon } from '@phosphor-icons/react';
import { PRIMARY, TEXT_INACTIVE } from '../../constants/theme.js';

// 숙제는 매 수업마다 쓰는 기능이라 1급 네비에 둔다.
// 그 자리에 있던 '예약'(= 예약 불가 설정)은 학생 자가예약 폐기 후 등록 항목이 한둘뿐이라
// 설정 화면으로 내렸다(라우트 /bookings는 그대로 유지).
const TABS = [
  { to: '/home',     label: '홈',   icon: <HouseIcon weight="fill" />           },
  { to: '/students', label: '학생', icon: <UsersIcon weight="fill" />           },
  { to: '/classes',  label: '수업', icon: <CalendarBlankIcon weight="fill" />   },
  { to: '/homework', label: '숙제', icon: <ClipboardTextIcon weight="fill" />   },
  { to: '/payments', label: '결제', icon: <CurrencyDollarIcon weight="fill" />  },
];

export default function BottomNav() {
  return (
    <nav
      className="bottom-nav-glass"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        // 프로스티드 배경·blur는 .bottom-nav-glass::before(비-고정 레이어)로 분리.
        // iOS Safari는 position:fixed 요소에 backdrop-filter가 직접 걸리면 스크롤 중
        // 바가 화면 중간으로 떠오르는 합성 버그가 있어, blur를 자식 레이어로 옮겨 회피한다.
        boxShadow: 'var(--shadow-nav)',
        zIndex: 50,
        // 고정 요소를 자체 합성 레이어로 승격해 iOS 스크롤 중 위치 튐을 추가로 방지.
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
        paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className=""
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '8px 0 10px',
              gap: 3,
              fontSize: 11, fontWeight: isActive ? 600 : 500,
              color: isActive ? PRIMARY : TEXT_INACTIVE,
              textDecoration: 'none',
              transitionProperty: 'color',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
              minHeight: 56,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none' })}
          >
            <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">{icon}</span>
            <span aria-hidden="true">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
