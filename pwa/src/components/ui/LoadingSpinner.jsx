import React from 'react';

export default function LoadingSpinner({ message = '불러오는 중...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-8 h-8 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin" />
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
