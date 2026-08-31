import { CheckCircleIcon } from '@phosphor-icons/react';
import { PRIMARY, TEXT_SECONDARY } from '../../constants/theme';

export default function CheckItem({ children, color = PRIMARY, textColor = TEXT_SECONDARY, size = 14 }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'flex-start' }}>
      <CheckCircleIcon weight="fill" size={size} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: size, color: textColor, lineHeight: 1.6 }}>{children}</span>
    </span>
  );
}
