import { TEXT_SECONDARY, TEXT_TERTIARY } from '../../constants/theme.js';

export default function EmptyState({ icon, title, description }) {
  const iconNode = typeof icon === 'string'
    ? <span style={{ fontSize: 44, lineHeight: 1 }}>{icon}</span>
    : (icon ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '80px 24px', textAlign: 'center' }}>
      {iconNode && <div style={{ marginBottom: 4 }}>{iconNode}</div>}
      {title && (
        <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_SECONDARY, display: 'block' }}>
          {title}
        </span>
      )}
      {description && (
        <span style={{ fontSize: 13, color: TEXT_TERTIARY, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{description}</span>
      )}
    </div>
  );
}
