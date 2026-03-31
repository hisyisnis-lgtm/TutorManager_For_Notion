import { ConfigProvider, Button, Card, Flex, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, UserOutlined, TeamOutlined, GiftOutlined,
  CalendarOutlined, CreditCardOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const PRIMARY = '#7f0005';

const theme = {
  token: {
    colorPrimary: PRIMARY,
    borderRadius: 12,
    colorBgContainer: '#ffffff',
    fontFamily: 'inherit',
  },
};

export default function PricingPage() {
  return (
    <ConfigProvider theme={theme}>
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', fontFamily: 'inherit' }}>
        {/* 헤더 */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 50,
          backgroundColor: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 20px' }}>
            <div style={{ height: 48, display: 'flex', alignItems: 'center' }}>
              <img src="/logo/logo-red.png" alt="하늘하늘 중국어" style={{ height: 24, objectFit: 'contain' }} />
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 80px' }}>
          <div className="stagger-item" style={{ marginBottom: 24 }}>
            <Title level={4} style={{ marginBottom: 4 }}>수강료 안내</Title>
            <Text type="secondary">하늘하늘 중국어 · 회화·발음 교정 전문</Text>
          </div>

          {/* 수업 철학 */}
          <Card variant="borderless" className="stagger-item" style={{ borderRadius: 16, marginBottom: 24, boxShadow: 'var(--shadow-border)' }}>
            <Paragraph style={{ fontSize: 14, color: '#595959', lineHeight: 1.7, margin: 0 }}>
              필기 시험이 아닌{' '}
              <Text strong style={{ color: '#262626' }}>'중국인처럼 자연스럽게 말하는 회화'</Text>
              를 목표로 합니다. 발음, 억양, 리듬, 실전 표현을 중심으로
              개인의 말하기 습관에 맞춰 진행합니다.
            </Paragraph>
          </Card>

          {/* 수강 대상 */}
          <div style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 13, fontWeight: 600, color: '#595959', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 12 }}>
              수강 대상
            </Text>
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
              <Flex vertical gap={10} style={{ width: '100%' }}>
                {[
                  '성인 학습자',
                  '왕초보 ~ 중급 회화 수준 (TSC 3–5급)',
                  '회화 및 발음 교정에 집중하고 싶은 분',
                ].map(item => (
                  <Space key={item} size={10}>
                    <CheckCircleOutlined style={{ color: PRIMARY, fontSize: 14, flexShrink: 0 }} />
                    <Text style={{ fontSize: 14 }}>{item}</Text>
                  </Space>
                ))}
                <Text type="secondary" style={{ fontSize: 13, paddingTop: 4 }}>
                  ※ 고급 회화, 전문 번역, 비즈니스 중국어는 현재 운영하지 않습니다.
                </Text>
              </Flex>
            </Card>
          </div>

          {/* 1:1 프라이빗 */}
          <div style={{ marginBottom: 24 }}>
            <Space size={8} style={{ marginBottom: 12 }}>
              <UserOutlined style={{ color: PRIMARY }} />
              <Title level={5} style={{ margin: 0 }}>1:1 프라이빗 수업</Title>
            </Space>
            <Flex vertical gap={10} style={{ width: '100%' }}>
              <Card variant="borderless" style={{ borderRadius: 16, backgroundColor: PRIMARY, boxShadow: '0 4px 16px rgba(127,0,5,0.25)' }}>
                <Tag style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  추천
                </Tag>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Text strong style={{ color: 'white', fontSize: 15, display: 'block', marginBottom: 4 }}>90분 실속 수업</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>회화 연습 + 발음 교정 균형</Text>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <Text className="tabular-nums" style={{ color: 'white', fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1 }}>75,000원</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4, display: 'block' }}>1회 기준</Text>
                  </div>
                </div>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, display: 'block', marginTop: 12 }}>직장인·입문자께 추천</Text>
              </Card>

              <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>120분 집중 수업</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>개념 → 발음 → 문장 → 실전 말하기</Text>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <Text className="tabular-nums" style={{ fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1 }}>100,000원</Text>
                    <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>1회 기준</Text>
                  </div>
                </div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 12 }}>빠르게 말하기 변화를 체감하고 싶은 분께 추천</Text>
              </Card>

              <div style={{ backgroundColor: '#fafafa', borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-border)' }}>
                <Text style={{ fontSize: 14, color: '#595959' }}>60분 기본 수업</Text>
                <Text className="tabular-nums" strong style={{ fontSize: 14 }}>50,000원</Text>
              </div>
            </Flex>
          </div>

          {/* 2:1 소그룹 */}
          <div style={{ marginBottom: 24 }}>
            <Space size={8} align="center" style={{ marginBottom: 12 }}>
              <TeamOutlined style={{ color: PRIMARY }} />
              <Title level={5} style={{ margin: 0 }}>2:1 소규모 그룹 수업</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>1인 기준</Text>
            </Space>
            <Flex vertical gap={10} style={{ width: '100%' }}>
              <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>120분 그룹 수업</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>친구 · 동료 · 커플 수강 추천</Text>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <Text className="tabular-nums" style={{ fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1 }}>80,000원</Text>
                    <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>1인 기준</Text>
                  </div>
                </div>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 12 }}>서로의 피드백으로 학습 효과를 높이는 구조</Text>
              </Card>

              <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>90분 그룹 수업</Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>반복 말하기로 회화 자신감 형성</Text>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <Text className="tabular-nums" style={{ fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1 }}>60,000원</Text>
                    <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>1인 기준</Text>
                  </div>
                </div>
              </Card>

              <div style={{ backgroundColor: '#fafafa', borderRadius: 12, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-border)' }}>
                <Text style={{ fontSize: 14, color: '#595959' }}>60분 기본 수업</Text>
                <Text className="tabular-nums" strong style={{ fontSize: 14 }}>40,000원 (1인)</Text>
              </div>
              <Text type="secondary" style={{ fontSize: 13, paddingLeft: 4 }}>※ 3인 이상 그룹은 별도 상담 진행</Text>
            </Flex>
          </div>

          {/* 수강 혜택 */}
          <div style={{ marginBottom: 24 }}>
            <Space size={8} style={{ marginBottom: 12 }}>
              <GiftOutlined style={{ color: PRIMARY }} />
              <Title level={5} style={{ margin: 0 }}>수강 혜택</Title>
            </Space>
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
              <Flex vertical gap={10} style={{ width: '100%' }}>
                {[
                  '주 N회 자유롭게 일정 조정 가능',
                  '하늘하늘 중국어 학습 굿즈 증정',
                  '패키지 등록 시 첫 교재 제공',
                  '대면 불가 시 Zoom 비대면 수업 (동일 가격)',
                ].map(item => (
                  <Space key={item} size={10}>
                    <CheckCircleOutlined style={{ color: PRIMARY, fontSize: 14, flexShrink: 0 }} />
                    <Text style={{ fontSize: 14 }}>{item}</Text>
                  </Space>
                ))}
              </Flex>
            </Card>
          </div>

          {/* 수업 일정 */}
          <div style={{ marginBottom: 24 }}>
            <Space size={8} style={{ marginBottom: 12 }}>
              <CalendarOutlined style={{ color: PRIMARY }} />
              <Title level={5} style={{ margin: 0 }}>수업 일정 안내</Title>
            </Space>
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
              <Flex vertical gap={8} style={{ width: '100%' }}>
                {[
                  '월~일 수업 가능 · 토요일 제외',
                  '학습자와 협의 후 유연하게 일정 조율',
                  '사전 예약제 운영',
                  '주 고정 시간 확보 시 계획적인 학습에 유리',
                ].map(item => (
                  <Text key={item} type="secondary" style={{ fontSize: 14 }}>{item}</Text>
                ))}
              </Flex>
            </Card>
          </div>

          {/* 결제·환불 */}
          <div style={{ marginBottom: 24 }}>
            <Space size={8} style={{ marginBottom: 12 }}>
              <CreditCardOutlined style={{ color: PRIMARY }} />
              <Title level={5} style={{ margin: 0 }}>결제 및 환불 안내</Title>
            </Space>
            <Card variant="borderless" style={{ borderRadius: 16, backgroundColor: '#fafafa', boxShadow: 'var(--shadow-border)' }}>
              <Flex vertical gap={12} style={{ width: '100%' }}>
                {[
                  { label: '결제 방식', desc: '수업은 선결제 기준으로 진행됩니다. 카드 결제 및 현금영수증 발행 모두 가능하니 편하신 방법으로 연락 주세요.' },
                  { label: '환불 기준', desc: '잔여 수업 횟수 기준으로 계산합니다. (이미 진행된 수업 금액 차감)' },
                  { label: '취소·결석', desc: '당일 취소 및 무단결석 시 해당 회차 환불이 어렵습니다.' },
                  { label: '일정 변경', desc: '수업 시작 최소 24시간 전까지 요청해주셔야 합니다.' },
                ].map(({ label, desc }) => (
                  <div key={label}>
                    <Text strong style={{ fontSize: 13, color: '#262626', display: 'block', marginBottom: 2 }}>{label}</Text>
                    <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>{desc}</Text>
                  </div>
                ))}
              </Flex>
            </Card>
          </div>

          {/* CTA */}
          <Card variant="borderless" style={{ borderRadius: 16, backgroundColor: '#fff0f1', textAlign: 'center', marginBottom: 12, boxShadow: 'var(--shadow-border)' }}>
            <Text strong style={{ fontSize: 14, color: PRIMARY, lineHeight: 1.7, display: 'block', marginBottom: 8 }}>
              빠르게 배우는 중국어보다,<br />오래 남는 중국어를 함께 만들어 갑니다.
            </Text>
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 20 }}>
              정확한 일정·수업 방식은 무료 상담에서 안내드려요
            </Text>
            <Button
              type="primary" size="large" block
              onClick={() => { window.location.hash = '#/intro'; }}
              style={{ height: 52, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
            >
              무료 상담 신청하기
            </Button>
          </Card>
          <a
            href="https://pf.kakao.com/_jFnFn"
            target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', fontSize: 13, color: '#595959', textDecoration: 'underline', textDecorationColor: '#d9d9d9' }}
          >
            문의는 채널톡으로 편하게 연락주세요
          </a>
        </main>

        <footer style={{ backgroundColor: '#1a1a1a', padding: '32px 24px 40px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <Text style={{ display: 'block', color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
              하늘하늘중국어
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {[
                ['대표', '최하늘'],
                ['사업자등록번호', '747-15-01965'],
                ['이메일', 'tiantianchinese_@naver.com'],
              ].map(([label, value]) => (
                <Text key={label} style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  {label} : {value}
                </Text>
              ))}
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                Copyright © 2025 하늘하늘중국어. All rights reserved.
              </Text>
            </div>
          </div>
        </footer>
      </div>
    </ConfigProvider>
  );
}
