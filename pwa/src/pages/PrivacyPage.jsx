// 개인정보처리방침 — 성조게임(성조 다락방) 회원 대상.
//
// ⚠️ 왜 필요한가: 개인정보보호법 제30조(수립·공개 의무, 규모별 예외 없음)이자,
//   **카카오·구글 OAuth 콘솔이 방침 URL을 요구**하기 때문. 없으면 소셜 로그인 심사/게시가 막힌다.
//   (게스트 플레이는 서버로 아무것도 안 보내므로 이 방침의 적용 대상이 아니다 — 본문 §1에 명시)
//
// 수집 항목이 3개(제공자·제공자 회원식별자·닉네임)뿐이라 문서도 짧다. 항목을 늘리면 §2·§3을 같이 고칠 것.
// 디자인은 새로 만들지 않고 ConsentPage(수업 동의서) 패턴을 그대로 재사용한다.
import { ConfigProvider, Card, Flex, Space, Typography, Divider } from 'antd';
import {
  ShieldCheckIcon, DatabaseIcon, ClockCounterClockwiseIcon, GlobeHemisphereWestIcon,
  UserCircleIcon, CookieIcon, BabyIcon, LockKeyIcon, PhoneCallIcon, CheckCircleIcon,
} from '@phosphor-icons/react';
import { PRIMARY, BG_SECTION_ALT, TEXT_SECONDARY, BG_DARK } from '../constants/theme.js';

const { Title, Text, Paragraph } = Typography;

const EFFECTIVE_DATE = '2026년 8월 18일';

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
            <CheckCircleIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0, marginTop: 2 }} />
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

// 표 형태(항목 : 값) — 수집 항목·국외 이전처럼 대조가 필요한 곳에.
function DefList({ rows }) {
  return (
    <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
      <Flex vertical gap={12} style={{ width: '100%' }}>
        {rows.map(([label, value], i) => (
          <Flex key={i} gap={12} align="start">
            <Text style={{ fontSize: 13.5, fontWeight: 600, minWidth: 92, flexShrink: 0, lineHeight: 1.7 }}>{label}</Text>
            <Text style={{ fontSize: 13.5, color: TEXT_SECONDARY, lineHeight: 1.7 }}>{value}</Text>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}

export default function PrivacyPage() {
  return (
    <ConfigProvider theme={theme}>
      <div style={{ minHeight: '100vh', backgroundColor: BG_SECTION_ALT, fontFamily: 'inherit' }}>

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

          <div style={{ marginBottom: 8 }}>
            <Title level={4} style={{ marginBottom: 4 }}>개인정보처리방침</Title>
            <Text type="secondary">하늘하늘중국어 · 성조 다락방(성조 게임)</Text>
          </div>

          {/* 요약 — 가장 먼저 알아야 할 것 */}
          <Card
            variant="borderless"
            style={{ borderRadius: 16, marginBottom: 28, backgroundColor: '#fff8f8', border: '1px solid #ffe0e0' }}
          >
            <Paragraph style={{ fontSize: 13.5, color: TEXT_SECONDARY, lineHeight: 1.75, margin: 0 }}>
              <Text strong style={{ color: '#262626' }}>로그인 없이 게스트로 즐기시면 저희는 아무것도 수집하지 않습니다.</Text>{' '}
              기록은 이용자 기기 안에만 저장됩니다. 아래 내용은 <Text strong style={{ color: '#262626' }}>카카오·구글로 로그인한 회원</Text>에게만
              적용되며, 이는 기기를 바꿔도 기록이 남도록 하기 위한 것입니다.
            </Paragraph>
          </Card>

          <Divider style={{ marginTop: 0, marginBottom: 28 }} />

          <Section icon={<ShieldCheckIcon weight="fill" />} title="1. 적용 범위">
            <BulletList items={[
              '이 방침은 「하늘하늘중국어」가 운영하는 성조 게임(성조 다락방)의 회원 기능에 적용됩니다.',
              '로그인하지 않은 게스트 이용자의 게임 기록은 이용자 기기(브라우저 저장소)에만 저장되며, 저희 서버로 전송되지 않습니다.',
              '게스트 이용자에 대해서는 수집·보관하는 개인정보가 없습니다.',
            ]} />
          </Section>

          <Section icon={<DatabaseIcon weight="fill" />} title="2. 수집하는 개인정보 항목과 방법">
            <Flex vertical gap={12}>
              <DefList rows={[
                ['수집 방법', '이용자가 카카오 또는 구글 계정으로 로그인할 때, 해당 제공자로부터 전달받아 수집합니다.'],
                ['수집 항목', '로그인 제공자 구분(카카오/구글), 제공자가 발급한 회원 식별번호, 프로필 닉네임'],
                ['자동 생성', '게임 기록(점수·진도·업적·학습 통계), 가입 일시, 최종 접속 일시'],
              ]} />
              <NoteList items={[
                '이름·이메일·전화번호·생년월일·성별·프로필 사진은 수집하지 않습니다.',
                '결제 정보는 수집하지 않습니다. 게임은 전부 무료입니다.',
                '이용자가 게임 안에서 직접 정한 닉네임을 입력한 경우, 제공자 닉네임 대신 그 값이 저장됩니다.',
              ]} />
            </Flex>
          </Section>

          <Section icon={<CheckCircleIcon weight="fill" />} title="3. 개인정보의 처리 목적">
            <BulletList items={[
              '회원 식별 및 로그인 상태 유지',
              '게임 기록(점수·진도·업적)의 저장과 기기 간 동기화',
              '게임 화면에 이용자의 닉네임 표시',
            ]} />
          </Section>

          <Section icon={<ClockCounterClockwiseIcon weight="fill" />} title="4. 보유 기간 및 파기">
            <Flex vertical gap={12}>
              <BulletList items={[
                '회원 탈퇴 시까지 보유하며, 탈퇴 요청 즉시 서버에 저장된 회원 정보와 게임 기록을 삭제합니다.',
                '탈퇴는 게임 안 프로필 화면에서 이용자가 직접 할 수 있으며, 별도의 승인 절차 없이 바로 처리됩니다.',
                '삭제된 정보는 복구할 수 없습니다.',
              ]} />
              <NoteList items={[
                '이용자 기기에 남아 있는 기록은 게임 안 설정의 「데이터 초기화」로 지울 수 있습니다.',
                '관계 법령에 따라 보존해야 하는 정보가 있는 경우 해당 기간 동안 보관합니다. 현재 해당하는 항목은 없습니다.',
              ]} />
            </Flex>
          </Section>

          <Section icon={<UserCircleIcon weight="fill" />} title="5. 제3자 제공">
            <BulletList items={[
              '수집한 개인정보를 제3자에게 제공하지 않습니다.',
              '법령에 따라 수사기관 등이 적법한 절차로 요구하는 경우에 한해 제공될 수 있습니다.',
            ]} />
          </Section>

          <Section icon={<GlobeHemisphereWestIcon weight="fill" />} title="6. 처리 위탁 및 국외 이전">
            <Flex vertical gap={12}>
              <Paragraph style={{ fontSize: 13.5, color: TEXT_SECONDARY, lineHeight: 1.75, margin: 0 }}>
                서비스 운영을 위해 아래와 같이 개인정보 처리를 위탁하고 있으며, 이 과정에서 정보가 국외 서버에 저장됩니다.
              </Paragraph>
              <DefList rows={[
                ['위탁받는 자', 'Cloudflare, Inc.'],
                ['이전 국가', '미국 등 Cloudflare가 운영하는 데이터센터 소재 국가'],
                ['이전 항목', '위 2항의 수집 항목 및 게임 기록 전체'],
                ['이전 목적', '서비스 제공에 필요한 데이터 보관 및 처리(데이터베이스·서버 운영)'],
                ['이전 방법', '서비스 이용 시 네트워크를 통한 전송'],
                ['보유 기간', '회원 탈퇴 시까지'],
              ]} />
            </Flex>
          </Section>

          <Section icon={<UserCircleIcon weight="fill" />} title="7. 정보주체의 권리와 행사 방법">
            <Flex vertical gap={12}>
              <BulletList items={[
                '이용자는 언제든지 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수 있습니다.',
                '닉네임 변경과 회원 탈퇴(전체 삭제)는 게임 안 프로필 화면에서 즉시 처리할 수 있습니다.',
                '그 밖의 요청은 아래 9항의 연락처로 접수하며, 접수일로부터 10일 이내에 처리합니다.',
              ]} />
              <NoteList items={[
                '만 14세 미만 아동의 경우 법정대리인이 권리를 행사할 수 있습니다.',
              ]} />
            </Flex>
          </Section>

          <Section icon={<CookieIcon weight="fill" />} title="8. 자동 수집 장치의 운영">
            <Flex vertical gap={12}>
              <BulletList items={[
                '게임 진행 상황을 저장하기 위해 이용자 기기의 브라우저 저장소(로컬 스토리지)를 사용합니다.',
                '광고 추적을 위한 쿠키는 사용하지 않습니다.',
                '서비스 개선을 위해 이용 통계를 수집하나, 여기에는 이용자를 식별할 수 있는 정보가 포함되지 않습니다.',
              ]} />
              <NoteList items={[
                '브라우저 저장소는 이용자가 브라우저 설정에서 직접 삭제할 수 있습니다. 삭제 시 게임 기록이 초기화됩니다.',
              ]} />
            </Flex>
          </Section>

          <Section icon={<BabyIcon weight="fill" />} title="9. 만 14세 미만 아동">
            <BulletList items={[
              '만 14세 미만 아동의 회원 가입을 받지 않습니다.',
              '만 14세 미만 이용자는 로그인 없이 게스트로 게임의 모든 기능을 이용할 수 있으며, 이 경우 개인정보가 수집되지 않습니다.',
              '만 14세 미만 아동의 정보가 수집된 사실이 확인되면 지체 없이 삭제합니다.',
            ]} />
          </Section>

          <Section icon={<LockKeyIcon weight="fill" />} title="10. 안전성 확보 조치">
            <BulletList items={[
              '개인정보는 암호화된 통신 구간(HTTPS)을 통해서만 전송됩니다.',
              '개인정보에 접근할 수 있는 인원을 운영자 본인으로 최소화하고 있습니다.',
              '서비스 제공에 필요한 최소한의 항목만 수집하고 있습니다.',
            ]} />
          </Section>

          <Section icon={<PhoneCallIcon weight="fill" />} title="11. 개인정보 보호책임자">
            <Flex vertical gap={12}>
              <DefList rows={[
                ['보호책임자', '최하늘 (하늘하늘중국어 대표)'],
                ['이메일', 'tiantianchinese_@naver.com'],
                ['카카오 채널', 'https://pf.kakao.com/_jFnFn'],
              ]} />
              <NoteList items={[
                '개인정보 침해에 대한 신고·상담이 필요하신 경우 개인정보침해신고센터(privacy.kisa.or.kr, 국번없이 118), 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972)로 문의하실 수 있습니다.',
              ]} />
            </Flex>
          </Section>

          <Section icon={<ShieldCheckIcon weight="fill" />} title="12. 방침의 변경">
            <BulletList items={[
              `이 개인정보처리방침은 ${EFFECTIVE_DATE}부터 적용됩니다.`,
              '내용이 추가·삭제·수정되는 경우 변경 사항을 이 페이지에 공개하고, 중요한 변경은 시행 7일 전부터 안내합니다.',
            ]} />
          </Section>

        </main>

        {/* 푸터 — 사업자 정보 */}
        <footer style={{ backgroundColor: BG_DARK, padding: '32px 16px 40px' }}>
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
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                Copyright © 2025 하늘하늘중국어. All rights reserved.
              </Text>
            </div>
          </div>
        </footer>
      </div>
    </ConfigProvider>
  );
}
