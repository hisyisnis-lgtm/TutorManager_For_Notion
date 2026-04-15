import { NavLink } from 'react-router-dom';
import {
  HomeOutlined,
  TeamOutlined,
  CalendarOutlined,
  BookOutlined,
  DollarOutlined,
} from '@ant-design/icons';

const PRIMARY = '#7f0005';

const TABS = [
  { to: '/home',     label: '홈',   icon: <HomeOutlined />     },
  { to: '/students', label: '학생', icon: <TeamOutlined />     },
  { to: '/classes',  label: '수업', icon: <CalendarOutlined /> },
  { to: '/bookings', label: '예약', icon: <BookOutlined />     },
  { to: '/payments', label: '결제', icon: <DollarOutlined />   },
];

export default function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(255,255,255,0.82)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: '0px -1px 0px 0px rgba(0,0,0,0.06), 0px -2px 8px 0px rgba(0,0,0,0.04)',
        zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex' }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '8px 0 10px',
              gap: 3,
              fontSize: 11, fontWeight: isActive ? 600 : 500,
              color: isActive ? PRIMARY : '#8c8c8c',
              textDecoration: 'none',
              transitionProperty: 'color, transform',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
              minHeight: 56,
              WebkitTapHighlightColor: 'transparent',
              outline: 'none',
            })}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">{icon}</span>
            <span aria-hidden="true">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
