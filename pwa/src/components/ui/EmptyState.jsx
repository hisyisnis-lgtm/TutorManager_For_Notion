import React from 'react';

export default function EmptyState({ icon = '📭', title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-2 text-center px-6">
      <span className="text-5xl">{icon}</span>
      {title && <p className="text-base font-semibold text-gray-600 mt-2">{title}</p>}
      {description && <p className="text-sm text-gray-400">{description}</p>}
    </div>
  );
}
