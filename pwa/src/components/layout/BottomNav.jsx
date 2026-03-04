import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const TABS = [
  { to: '/home', label: '홈', icon: '🏠' },
  { to: '/students', label: '학생', icon: '👥' },
  { to: '/classes', label: '수업', icon: '📅' },
  { to: '/payments', label: '결제', icon: '💰' },
  { to: '/logs', label: '일지', icon: '📝' },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex">
        {TABS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs font-medium transition-colors ${
                isActive ? 'text-brand-600' : 'text-gray-400'
              }`
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
