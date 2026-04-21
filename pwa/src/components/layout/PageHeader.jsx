import { useNavigate } from 'react-router-dom';
import { Flex, Typography } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';

const { Text } = Typography;

export default function PageHeader({ title, back, onBack, action }) {
  const navigate = useNavigate();

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      width: '100vw',
      marginLeft: 'calc(50% - 50vw)',
      backgroundColor: 'rgba(255,255,255,0.82)',
      backdropFilter: 'saturate(180%) blur(20px)',
      WebkitBackdropFilter: 'saturate(180%) blur(20px)',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <Flex align="center" gap={8} style={{ height: 56, padding: '0 20px' }}>
          {back && (
            <button
              onClick={() => onBack ? onBack() : navigate(-1)}
              aria-label="뒤로가기"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 40, height: 40, border: 'none', background: 'none',
                cursor: 'pointer', color: '#595959', flexShrink: 0, marginLeft: -8,
                borderRadius: 12,
                transition: 'scale 150ms ease-out, color 100ms ease-out',
              }}
              onPointerDown={(e) => { e.currentTarget.style.scale = '0.96'; e.currentTarget.style.color = '#1d1d1f'; }}
              onPointerUp={(e) => { e.currentTarget.style.scale = '1'; e.currentTarget.style.color = '#595959'; }}
              onPointerLeave={(e) => { e.currentTarget.style.scale = '1'; e.currentTarget.style.color = '#595959'; }}
            >
              <CaretLeftIcon size={20} weight="bold" />
            </button>
          )}
          <Text
            strong
            style={{ flex: 1, fontSize: 17, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {title}
          </Text>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </Flex>
      </div>
    </header>
  );
}
