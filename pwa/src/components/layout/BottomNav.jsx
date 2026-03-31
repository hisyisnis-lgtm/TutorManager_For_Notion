import { NavLink } from 'react-router-dom';

const PRIMARY = '#7f0005';

const TABS = [
  { to: '/home', label: '홈', icon: '🏠' },
  { to: '/students', label: '학생', icon: '👥' },
  { to: '/classes', label: '수업', icon: '📅' },
  { to: '/bookings', label: '예약', icon: '🗓️' },
  { to: '/payments', label: '결제', icon: '💰' },
];

export default function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0px -1px 0px 0px rgba(0,0,0,0.06), 0px -2px 8px 0px rgba(0,0,0,0.04)',
        zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div style={{ maxWidth: 512, margin: '0 auto', display: 'flex' }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '10px 0 8px',
              gap: 2,
              fontSize: 11, fontWeight: 500,
              color: isActive ? PRIMARY : '#8c8c8c',
              textDecoration: 'none',
              transitionProperty: 'color, transform',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
              minHeight: 44,
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
