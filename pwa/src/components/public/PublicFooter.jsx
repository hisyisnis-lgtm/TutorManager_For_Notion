import { Flex, Typography } from 'antd';

const { Text } = Typography;

const BUSINESS_INFO = [
  ['대표', '최하늘'],
  ['사업자등록번호', '747-15-01965'],
  ['이메일', 'tiantianchinese_@naver.com'],
];

/**
 * PublicFooter — 공개 페이지 공통 푸터
 * LandingPage · PricingPage 에서 사용합니다.
 */
export default function PublicFooter() {
  return (
    <footer style={{ backgroundColor: '#1a1a1a', padding: '32px 24px 40px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <Text style={{ display: 'block', color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
          하늘하늘중국어
        </Text>
        <Flex vertical gap={6} style={{ marginBottom: 20 }}>
          {BUSINESS_INFO.map(([label, value]) => (
            <Text key={label} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              {label} : {value}
            </Text>
          ))}
        </Flex>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            Copyright © 2025 하늘하늘중국어. All rights reserved.
          </Text>
        </div>
      </div>
    </footer>
  );
}
