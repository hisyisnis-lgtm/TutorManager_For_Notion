import { Flex, Typography } from 'antd';

const { Text } = Typography;

export default function EmptyState({ icon = '📭', title, description }) {
  return (
    <Flex vertical align="center" justify="center" gap={8} style={{ padding: '80px 24px', textAlign: 'center' }}>
      <span style={{ fontSize: 48 }}>{icon}</span>
      {title && (
        <Text strong style={{ fontSize: 15, color: '#595959', marginTop: 8, display: 'block' }}>
          {title}
        </Text>
      )}
      {description && (
        <Text type="secondary" style={{ fontSize: 14 }}>{description}</Text>
      )}
    </Flex>
  );
}
