import {
  PRIMARY_BG,
  PRIMARY_DARK,
  STATUS_SUCCESS_BG,
  STATUS_WARNING_BG,
  STATUS_WARNING_TEXT,
  STATUS_SUCCESS_DARK,
  STATUS_ERROR_BG,
  STATUS_ERROR_TEXT,
  TEXT_SECONDARY,
  TEXT_INACTIVE,
  TEXT_DISABLED,
} from '../../constants/theme.js';

export default function Badge({ label, bg, text, style: styleProp }) {
  if (!label) return null;

  // Tailwind bg/text 클래스를 인라인 스타일로 변환
  // ⚠️ 맵에 없는 키는 조용히 회색으로 폴백한다 — 호출부에 새 상태색을 추가하면
  //    여기 맵도 같이 늘려야 한다 (아래 DEV 경고가 누락을 잡아준다).
  const bgMap = {
    'bg-gray-100': '#f5f5f5',
    'bg-green-100': STATUS_SUCCESS_BG,
    'bg-yellow-100': '#fffbe6',
    'bg-red-50': STATUS_ERROR_BG,
    'bg-red-100': '#fff1f0',
    'bg-blue-100': '#e6f4ff',
    'bg-amber-100': '#fffbe6',
    'bg-orange-50': STATUS_WARNING_BG,
    'bg-orange-100': STATUS_WARNING_BG,
    'bg-purple-100': '#f9f0ff',
    'bg-brand-50': PRIMARY_BG,
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
    'text-orange-600': STATUS_WARNING_TEXT,
    'text-orange-700': '#d46b08',
    'text-purple-700': '#531dab',
    'text-brand-700': PRIMARY_DARK,
  };

  // Tailwind 클래스명이면 맵핑, 그 외 (hex 등) 직접 사용
  const isHex = (v) => typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'));
  if (import.meta.env.DEV) {
    if (bg && !isHex(bg) && !bgMap[bg]) console.warn(`[Badge] 알 수 없는 bg 키 "${bg}" — 회색으로 폴백됩니다`);
    if (text && !isHex(text) && !textMap[text]) console.warn(`[Badge] 알 수 없는 text 키 "${text}" — 기본색으로 폴백됩니다`);
  }
  const bgColor = isHex(bg) ? bg : (bgMap[bg] || '#f5f5f5');
  const textColor = isHex(text) ? text : (textMap[text] || TEXT_SECONDARY);

  // antd Tag는 스타일 입힌 span에 불과했다 — 표준 엘리먼트로 충분하다(코드 절약 사다리 3).
  // display:inline-block을 명시하는 이유: Tag 기본값이 inline-block이라
  // bare span(inline)으로 바꾸면 세로 패딩·margin이 다르게 먹는다.
  return (
    <span
      style={{
        display: 'inline-block',
        // antd Tag가 주던 것 중 span에 없는 두 가지를 이어받는다.
        // lineHeight는 무단위로 둔다 — 호출부가 fontSize를 키울 때(예: 숙제 상세 15px)
        // 같이 커져야 세로 균형이 유지된다. 고정 20px이면 그 경우 깨진다.
        lineHeight: 1.6667,
        whiteSpace: 'nowrap',
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
    </span>
  );
}
