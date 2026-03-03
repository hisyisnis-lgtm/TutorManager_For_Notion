import React from 'react';

export default function Badge({ label, bg = 'bg-gray-100', text = 'text-gray-600' }) {
  if (!label) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      {label}
    </span>
  );
}
