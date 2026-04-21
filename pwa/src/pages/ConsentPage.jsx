import { ConfigProvider, Button, Card, Flex, Space, Typography, Divider } from 'antd';
import { BookOpenIcon, CalendarBlankIcon, CreditCardIcon, FileLockIcon, CheckCircleIcon } from '@phosphor-icons/react';

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

function Section({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <Space size={8} style={{ marginBottom: 12 }}>
        <span style={{ color: PRIMARY, fontSize: 16, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <Title level={5} style={{ margin: 0 }}>{title}</Title>
      </Space>
      {children}
    </div>
  );
}

function BulletList({ items }) {
  return (
    <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
      <Flex vertical gap={12} style={{ width: '100%' }}>
        {items.map((item, i) => (
          <Space key={i} size={10} align="start">
            <CheckCircleIcon weight="fill" size={14} style={{ color: PRIMARY, flexShrink: 0, marginTop: 2 }} />
            <Text style={{ fontSize: 14, lineHeight: 1.7 }}>{item}</Text>
          </Space>
        ))}
      </Flex>
    </Card>
  );
}

function NoteList({ items }) {
  return (
    <Card variant="borderless" style={{ borderRadius: 16, backgroundColor: '#fafafa', boxShadow: 'var(--shadow-border)' }}>
      <Flex vertical gap={8} style={{ width: '100%' }}>
        {items.map((item, i) => (
          <Text key={i} type="secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>{item}</Text>
        ))}
      </Flex>
    </Card>
  );
}

export default function ConsentPage() {
  return (
    <ConfigProvider theme={theme}>
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f7', fontFamily: 'inherit' }}>

        {/* 헤더 */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 50,
          backgroundColor: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>
            <div style={{ height: 48, display: 'flex', alignItems: 'center' }}>
              <img src="/logo/logo-red.png" alt="하늘하늘 중국어" style={{ height: 24, objectFit: 'contain', outline: 'none' }} />
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px 80px' }}>

          {/* 페이지 제목 */}
          <div style={{ marginBottom: 8 }}>
            <Title level={4} style={{ marginBottom: 4 }}>수업 동의서</Title>
            <Text type="secondary">하늘하늘 중국어 · 수강 전 필수 확인 사항</Text>
          </div>

          {/* 안내 문구 */}
          <Card
            variant="borderless"
            style={{ borderRadius: 16, marginBottom: 28, backgroundColor: '#fff8f8', border: '1px solid #ffe0e0' }}
          >
            <Paragraph style={{ fontSize: 13.5, color: '#595959', lineHeight: 1.75, margin: 0 }}>
              본 동의서는 <Text strong style={{ color: '#262626' }}>「하늘하늘 중국어」</Text>와 수강생 간의
              원활한 수업 진행 및 분쟁 예방을 위해 작성되었습니다.
              아래 내용을 충분히 확인하신 후, 하단 버튼을 통해 동의 확인을 완료해 주세요.
            </Paragraph>
          </Card>

          <Divider style={{ marginTop: 0, marginBottom: 28 }} />

          {/* 1. 수업 형태 및 운영 방식 */}
          <Section icon={<BookOpenIcon weight="fill" />} title="1. 수업 형태 및 운영 방식">
            <BulletList items={[
              '성인 대상 중국어 회화·발음 교정 중심 수업입니다.',
              '1:1 또는 2:1 소규모 수업으로 진행됩니다. 3인 이상 그룹 수업은 별도 상담 후 진행합니다.',
              '수업 장소는 강남구 역삼동 봉은사로16길 14이며, 대면 수업이 어려운 경우 Zoom 비대면 수업도 동일한 조건으로 진행 가능합니다.',
            ]} />
          </Section>

          {/* 2. 수업 예약 및 취소 */}
          <Section icon={<CalendarBlankIcon weight="fill" />} title="2. 수업 예약 및 취소">
            <BulletList items={[
              '수업은 사전 예약제로 운영됩니다.',
              '일정 변경 및 취소는 수업 시작 24시간 전까지 가능합니다.',
              '수업 시작 24시간 이내 취소 또는 무단 결석 시, 해당 수업은 수업 완료(소진) 처리됩니다.',
              '강사 사정으로 수업이 취소되는 경우, 해당 횟수와 별도로 무료 보강을 진행합니다.',
            ]} />
          </Section>

          {/* 3. 환불 규정 */}
          <Section icon={<CreditCardIcon weight="fill" />} title="3. 환불 규정">
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
              <Flex vertical gap={14} style={{ width: '100%' }}>
                <div>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>수업 시작 전</Text>
                  <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>
                    첫 수업 시작 전 환불 요청 시 전액 환불이 가능합니다.
                  </Text>
                </div>
                <Divider style={{ margin: 0 }} />
                <div>
                  <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>수업 시작 후</Text>
                  <Flex vertical gap={8}>
                    <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>
                      수업 시작 이후에는 시작한 달을 포함하여 다음 달 말까지, 잔여 수업 횟수에 한해 환불이 가능합니다. 모든 수업 횟수는 해당 기간 내 소진해 주시기 바랍니다.
                    </Text>
                    <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.7 }}>
                      환불 시에는 진행된 수업 금액을 재결제하신 후 기존 결제를 전체 취소하는 방식으로 처리됩니다. 현재 결제 시스템상 부분 환불이 어려운 점 양해 부탁드립니다.
                    </Text>
                  </Flex>
                </div>
                <Divider style={{ margin: 0 }} />
                <NoteList items={[
                  '이벤트·원데이 클래스·할인 적용 수업은 환불이 불가합니다.',
                  '교재가 제공된 경우, 교재 비용은 환불 대상에서 제외됩니다.',
                  '환불은 영업일 기준 3~7일 이내 처리됩니다.',
                ]} />
              </Flex>
            </Card>
          </Section>

          {/* 4. 수업 자료 및 유의사항 */}
          <Section icon={<FileLockIcon weight="fill" />} title="4. 수업 자료 및 유의사항">
            <BulletList items={[
              '수업 중 녹음·녹화는 사전 동의 없이 불가합니다.',
              '수업 자료 및 피드백 자료는 개인 학습 목적으로만 활용 가능하며, 무단 배포 또는 상업적 사용을 금합니다.',
              '개인 사정으로 인한 학습 효과 미달성은 환불 사유가 되지 않습니다.',
            ]} />
          </Section>

          <Divider style={{ marginBottom: 28 }} />

          {/* 동의 CTA */}
          <Card
            variant="borderless"
            style={{ borderRadius: 16, backgroundColor: '#fff0f1', textAlign: 'center', marginBottom: 12 }}
          >
            <Text
              strong
              style={{ fontSize: 14, color: PRIMARY, lineHeight: 1.8, display: 'block', marginBottom: 6 }}
            >
              위 내용을 모두 확인하셨나요?
            </Text>
            <Text
              type="secondary"
              style={{ fontSize: 13, display: 'block', marginBottom: 20, lineHeight: 1.7 }}
            >
              아래 버튼을 눌러 동의 확인을 완료해 주세요.
            </Text>
            <Button
              type="primary"
              size="large"
              block
              href="https://forms.gle/GSrU2jruYTuFQxwo8"
              target="_blank"
              rel="noopener noreferrer"
              style={{ height: 52, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
            >
              동의 확인 완료하기
            </Button>
          </Card>

          <Text
            type="secondary"
            style={{ display: 'block', textAlign: 'center', fontSize: 13, lineHeight: 1.7 }}
          >
            문의 사항이 있으시면{' '}
            <a
              href="https://pf.kakao.com/_jFnFn"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PRIMARY, textDecoration: 'underline' }}
            >
              채널톡
            </a>
            으로 편하게 연락주세요.
          </Text>
        </main>

        {/* 푸터 */}
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
