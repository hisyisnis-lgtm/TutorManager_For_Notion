import { Flex, Typography } from 'antd';

const { Text } = Typography;

export default function EmptyState({ icon, title, description }) {
  const iconNode = typeof icon === 'string'
    ? <span style={{ fontSize: 44, lineHeight: 1 }}>{icon}</span>
    : (icon ?? null);

  return (
    <Flex vertical align="center" justify="center" gap={8} style={{ padding: '80px 24px', textAlign: 'center' }}>
      {iconNode && <div style={{ marginBottom: 4 }}>{iconNode}</div>}
      {title && (
        <Text strong style={{ fontSize: 15, color: '#595959', display: 'block' }}>
          {title}
        </Text>
      )}
      {description && (
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{description}</Text>
      )}
    </Flex>
  );
}
