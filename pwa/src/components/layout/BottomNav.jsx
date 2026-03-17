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
        backgroundColor: '#ffffff',
        borderTop: '1px solid #f0f0f0',
        zIndex: 50,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div style={{ maxWidth: 512, margin: '0 auto', display: 'flex' }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '10px 0 8px',
              gap: 2,
              fontSize: 11, fontWeight: 500,
              color: isActive ? PRIMARY : '#8c8c8c',
              textDecoration: 'none',
              transition: 'color 0.2s',
            })}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
