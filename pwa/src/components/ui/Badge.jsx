import { Tag } from 'antd';
import {
  STATUS_SUCCESS_BG,
  STATUS_WARNING_BG,
  STATUS_SUCCESS_DARK,
  STATUS_ERROR_TEXT,
  TEXT_SECONDARY,
  TEXT_INACTIVE,
  TEXT_DISABLED,
} from '../../constants/theme.js';

export default function Badge({ label, bg, text, style: styleProp }) {
  if (!label) return null;

  // Tailwind bg/text 클래스를 인라인 스타일로 변환
  const bgMap = {
    'bg-gray-100': '#f5f5f5',
    'bg-green-100': STATUS_SUCCESS_BG,
    'bg-yellow-100': '#fffbe6',
    'bg-red-100': '#fff1f0',
    'bg-blue-100': '#e6f4ff',
    'bg-amber-100': '#fffbe6',
    'bg-orange-100': STATUS_WARNING_BG,
    'bg-purple-100': '#f9f0ff',
  };
  const textMap = {
    'text-gray-600': TEXT_SECONDARY,
    'text-gray-400': TEXT_DISABLED,
    'text-gray-500': TEXT_INACTIVE,
    'text-green-700': STATUS_SUCCESS_DARK,
    'text-yellow-700': '#d48806',
    'text-red-600': STATUS_ERROR_TEXT,
    'text-red-500': '#f5222d',
    'text-blue-700': '#096dd9',
    'text-amber-700': '#d46b08',
    'text-orange-700': '#d46b08',
    'text-purple-700': '#531dab',
  };

  // Tailwind 클래스명이면 맵핑, 그 외 (hex 등) 직접 사용
  const isHex = (v) => typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'));
  const bgColor = isHex(bg) ? bg : (bgMap[bg] || '#f5f5f5');
  const textColor = isHex(text) ? text : (textMap[text] || TEXT_SECONDARY);

  return (
    <Tag
      style={{
        backgroundColor: bgColor,
        color: textColor,
        border: 'none',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        margin: 0,
        padding: '1px 8px',
        ...styleProp,
      }}
    >
      {label}
    </Tag>
  );
}
