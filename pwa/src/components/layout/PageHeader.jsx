import { useNavigate } from 'react-router-dom';
import { Flex, Typography } from 'antd';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { TEXT_PRIMARY, TEXT_SECONDARY } from '../../constants/theme.js';

const { Text } = Typography;

export default function PageHeader({ title, back, onBack, action }) {
  const navigate = useNavigate();

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      // 예전엔 풀블리드를 위해 `width: 100vw; marginLeft: calc(50% - 50vw)`를 썼는데,
      // 100vw는 세로 스크롤바 폭까지 포함해서 콘텐츠 영역보다 8~15px 넓어졌다.
      // → 가로 스크롤바가 생기고, 그 높이만큼 `position:fixed`인 BottomNav가 밀려 올라가
      //   화면마다 탭바 위치가 달라 보였다(2026-08-25). 부모 폭(100%)에 맞추면 그 일이 없다.
      //   모바일에선 부모가 화면 전체라 결과가 같고, 데스크톱에선 앱 컬럼 폭에 맞춰진다.
      width: '100%',
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
                cursor: 'pointer', color: TEXT_SECONDARY, flexShrink: 0, marginLeft: -8,
                borderRadius: 12,
                transition: 'color 100ms ease-out',
              }}
              onPointerDown={(e) => { e.currentTarget.style.color = TEXT_PRIMARY; }}
              onPointerUp={(e) => { e.currentTarget.style.color = TEXT_SECONDARY; }}
              onPointerLeave={(e) => { e.currentTarget.style.color = TEXT_SECONDARY; }}
            >
              <CaretLeftIcon size={20} weight="bold" />
            </button>
          )}
          <Text
            strong
            style={{ flex: 1, fontSize: 17, color: TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {title}
          </Text>
          {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </Flex>
      </div>
    </header>
  );
}
