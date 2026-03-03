import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function PageHeader({ title, back, action }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-100">
      <div className="max-w-lg mx-auto flex items-center h-14 px-4 gap-3">
        {back && (
          <button
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 text-gray-500 active:text-gray-700"
            aria-label="뒤로가기"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h1 className="flex-1 text-lg font-bold text-gray-900 truncate">{title}</h1>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </header>
  );
}
