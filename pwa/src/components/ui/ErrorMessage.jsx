import React from 'react';

export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="mx-4 mt-6 p-4 bg-red-50 border border-red-200 rounded-xl">
      <p className="text-sm font-semibold text-red-700 mb-1">오류가 발생했습니다</p>
      <p className="text-sm text-red-600 mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm font-medium text-red-700 underline"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
