import { Tag } from 'antd';

export default function Badge({ label, bg, text }) {
  if (!label) return null;

  // Tailwind bg/text 클래스를 인라인 스타일로 변환
  const bgMap = {
    'bg-gray-100': '#f5f5f5',
    'bg-green-100': '#f6ffed',
    'bg-yellow-100': '#fffbe6',
    'bg-red-100': '#fff1f0',
    'bg-blue-100': '#e6f4ff',
    'bg-amber-100': '#fffbe6',
    'bg-orange-100': '#fff7e6',
    'bg-purple-100': '#f9f0ff',
  };
  const textMap = {
    'text-gray-600': '#595959',
    'text-gray-400': '#bfbfbf',
    'text-gray-500': '#8c8c8c',
    'text-green-700': '#389e0d',
    'text-yellow-700': '#d48806',
    'text-red-600': '#cf1322',
    'text-red-500': '#f5222d',
    'text-blue-700': '#096dd9',
    'text-amber-700': '#d46b08',
    'text-orange-700': '#d46b08',
    'text-purple-700': '#531dab',
  };

  const bgColor = bgMap[bg] || '#f5f5f5';
  const textColor = textMap[text] || '#595959';

  return (
    <Tag
      style={{
        backgroundColor: bgColor,
        color: textColor,
        border: 'none',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        margin: 0,
        padding: '1px 8px',
      }}
    >
      {label}
    </Tag>
  );
}
