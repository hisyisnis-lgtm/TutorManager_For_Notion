import { Flex, Spin, Typography } from 'antd';

const { Text } = Typography;

export default function LoadingSpinner({ message = '불러오는 중...' }) {
  return (
    <Flex vertical align="center" justify="center" gap={12} style={{ padding: '80px 0' }}>
      <Spin size="large" />
      <Text type="secondary" style={{ fontSize: 14 }}>{message}</Text>
    </Flex>
  );
}
