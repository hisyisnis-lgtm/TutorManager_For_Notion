import React from 'react';

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = '삭제', loading = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-base font-bold text-gray-900 mb-2">{title}</h2>
        {message && <p className="text-sm text-gray-500 mb-6">{message}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 bg-white text-gray-600 active:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white active:bg-red-600 disabled:opacity-60"
          >
            {loading ? '삭제 중...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
