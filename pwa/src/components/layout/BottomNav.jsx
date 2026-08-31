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

/**
 * 플로팅 캡슐 탭바 (2026-08-31 — 화면 하단에 붙은 바 → 떠 있는 알약형으로 리디자인).
 *
 * 형태가 바뀌면 같이 움직여야 하는 값들:
 *  · 점유 높이 = 하단 여백 10 + 캡슐 56 = **66px + safe-area** (탭바 위 고정 요소는
 *    `ABOVE_BOTTOM_NAV`(constants/styles.js)를 쓸 것 — 이 값도 함께 갱신됨)
 *  · 페이지 하단 여유는 전역 `.page-container pb-24`(96px)가 담당 — 66 + 숨쉴 틈으로 충분
 *  · ⚠️ width에 100vw 금지([[bug_bottomnav_100vw_shift]]) — 세로 스크롤바가 있으면 밀린다
 */
export default function BottomNav() {
  return (
    <>
      {/* 캡슐 뒤 하단 스크림 — 뒤로 지나가는 콘텐츠가 탭바 근처에서 배경색으로 잦아들어
          캡슐이 화면에 자연스럽게 앉는다. rgba 값 = BG_APP 토큰의 알파 변주. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          height: 'calc(104px + env(safe-area-inset-bottom))',
          // 스크롤 콘텐츠(z auto) 위 · 모든 플로팅 크롬 아래 — FAB(40)·준비화면 컨트롤(45)·
          // 업데이트 인디케이터(45)·설치 배너(150)·캡슐(50)이 스크림에 씻기면 안 된다
          // (2026-08-31 '업데이트 중' 알약이 그라데이션에 가려진 지적).
          zIndex: 20,
          pointerEvents: 'none',
          background: 'linear-gradient(to top, rgba(249,250,251,0.97) 0%, rgba(249,250,251,0.88) 38%, rgba(249,250,251,0.45) 68%, rgba(249,250,251,0) 100%)',
        }}
      />
    <nav
      className="bottom-nav-glass"
      style={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: 'calc(10px + env(safe-area-inset-bottom))',
        marginInline: 'auto',
        // 좌우 12px 띄운 캡슐. 넓은 화면에선 페이지 폭(max-w-lg)보다 살짝 좁게.
        width: 'min(calc(100% - 24px), 440px)',
        borderRadius: 999,
        // 프로스티드 배경·blur는 .bottom-nav-glass::before(비-고정 레이어)로 분리.
        // iOS Safari는 position:fixed 요소에 backdrop-filter가 직접 걸리면 스크롤 중
        // 바가 화면 중간으로 떠오르는 합성 버그가 있어, blur를 자식 레이어로 옮겨 회피한다.
        // overflow:hidden으로 그 레이어를 캡슐 곡률에 맞춰 자른다.
        overflow: 'hidden',
        boxShadow: 'var(--shadow-nav-float)',
        zIndex: 50,
        // 고정 요소를 자체 합성 레이어로 승격해 iOS 스크롤 중 위치 튐을 추가로 방지.
        transform: 'translateZ(0)',
        WebkitTransform: 'translateZ(0)',
      }}
    >
      <div style={{ display: 'flex' }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className=""
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '8px 0',
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
    </>
  );
}
