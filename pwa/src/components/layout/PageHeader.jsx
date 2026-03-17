import { useNavigate } from 'react-router-dom';
import { Flex, Typography } from 'antd';
import { LeftOutlined } from '@ant-design/icons';

const { Text } = Typography;

export default function PageHeader({ title, back, action }) {
  const navigate = useNavigate();

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      backgroundColor: '#ffffff',
      borderBottom: '1px solid #f0f0f0',
    }}>
      <div style={{ maxWidth: 512, margin: '0 auto' }}>
        <Flex align="center" gap={8} style={{ height: 56, padding: '0 16px' }}>
          {back && (
            <button
              onClick={() => navigate(-1)}
              aria-label="뒤로가기"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, border: 'none', background: 'none',
                cursor: 'pointer', color: '#595959', flexShrink: 0, marginLeft: -4,
              }}
            >
              <LeftOutlined style={{ fontSize: 16 }} />
            </button>
          )}
          <Text
            strong
            style={{ flex: 1, fontSize: 17, color: '#262626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {title}
          </Text>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </Flex>
      </div>
    </header>
  );
}
