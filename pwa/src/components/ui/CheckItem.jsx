import { Space, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { PRIMARY } from '../../constants/theme';

const { Text } = Typography;

export default function CheckItem({ children, color = PRIMARY, textColor = '#595959', size = 14 }) {
  return (
    <Space size={8} align="start">
      <CheckCircleOutlined style={{ color, fontSize: size, flexShrink: 0, marginTop: 2 }} />
      <Text style={{ fontSize: size, color: textColor, lineHeight: 1.6 }}>{children}</Text>
    </Space>
  );
}
