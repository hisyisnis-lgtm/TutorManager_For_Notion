import { Button } from '../components/shadcn/button';
import { Card,
  CardContent } from '../components/shadcn/card';
import { BookOpenIcon,
  CalendarBlankIcon,
  CreditCardIcon,
  FileLockIcon,
  CheckCircleIcon } from '@phosphor-icons/react';
import { PRIMARY,
  BG_SECTION_ALT,
  TEXT_SECONDARY,
  PRIMARY_BG,
  BG_DARK,
  TEXT_TERTIARY,
  BORDER_SUBTLE } from '../constants/theme';


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
      <span style={{ display: 'inline-flex', gap: 8, marginBottom: 12 }}>
        <span style={{ color: PRIMARY, fontSize: 16, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <h5 style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, margin: 0 }}>{title}</h5>
      </span>
      {children}
    </div>
  );
}

function BulletList({ items }) {
  return (
    <Card className="rounded-2xl">
<CardContent className="p-6">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        {items.map((item, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10 }}>
            <CheckCircleIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 14, lineHeight: 1.7 }}>{item}</span>
          </span>
        ))}
      </div>
    </CardContent>
</Card>
  );
}

function NoteList({ items }) {
  return (
    <Card className="rounded-2xl" style={{ backgroundColor: '#fafafa' }}>
<CardContent className="p-6">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        {items.map((item, i) => (
          <span key={i} style={{ color: TEXT_TERTIARY, fontSize: 14, lineHeight: 1.7 }}>{item}</span>
        ))}
      </div>
    </CardContent>
</Card>
  );
}

export default function ConsentPage() {
  return (
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

          {/* 페이지 제목 */}
          <div style={{ marginBottom: 8 }}>
            <h4 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>수업 동의서</h4>
            <span style={{ color: TEXT_TERTIARY }}>하늘하늘 중국어 · 수강 전 필수 확인 사항</span>
          </div>

          {/* 안내 문구 */}
          <Card className="rounded-2xl" style={{ marginBottom: 28, backgroundColor: '#fff8f8', border: '1px solid #ffe0e0' }}>
<CardContent className="p-6">
            <p style={{ fontSize: 13.5, color: TEXT_SECONDARY, lineHeight: 1.75, margin: 0 }}>
              본 동의서는 <span style={{ fontWeight: 600, color: '#262626' }}>「하늘하늘 중국어」</span>와 수강생 간의
              원활한 수업 진행 및 분쟁 예방을 위해 작성되었습니다.
              아래 내용을 충분히 확인하신 후, 하단 버튼을 통해 동의 확인을 완료해 주세요.
            </p>
          </CardContent>
</Card>

          <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, marginTop: 0, marginBottom: 28 }} />

          {/* 1. 수업 형태 및 운영 방식 */}
          <Section icon={<BookOpenIcon weight="fill" />} title="1. 수업 형태 및 운영 방식">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <BulletList items={[
                '성인 대상 중국어 회화·발음 교정 중심 수업입니다.',
                '1:1 또는 2:1 소규모 수업으로 진행됩니다. 3인 이상 그룹 수업은 별도 상담 후 진행합니다.',
                '수업 장소는 강남구 역삼동 봉은사로16길 14이며, 대면 수업이 어려운 경우 Zoom 비대면 수업도 동일한 조건으로 진행 가능합니다.',
              ]} />
              <Card className="rounded-2xl" style={{ backgroundColor: '#fafafa' }}>
<CardContent className="p-6">
                <p style={{ fontSize: 13.5, color: TEXT_SECONDARY, lineHeight: 1.75, margin: 0 }}>
                  <span style={{ fontWeight: 600, color: '#262626' }}>[하늘하늘중국어]</span>의 모든 수업은 수강생 개개인에게 최적화된 1:1 맞춤 커리큘럼으로 진행됩니다. 단기간에 목표하신 실력 향상을 이루기 위해서는 안정적인 수업 진행 외에도 안내해 드리는 가이드와 녹음 과제, 피드백 적용이 반드시 동반되어야 합니다. 잦은 수업 시간 변경/취소 및 가이드 이행이 원활하지 않을 경우 기대하시는 성과 도달이 지연될 수 있음을 안내해 드립니다.
                </p>
              </CardContent>
</Card>
            </div>
          </Section>

          {/* 2. 수업 예약 및 취소 */}
          <Section icon={<CalendarBlankIcon weight="fill" />} title="2. 수업 예약 및 취소">
            <BulletList items={[
              '수업은 사전 예약제로 운영됩니다.',
              '일정 변경 및 취소는 수업 시작 24시간 전까지 가능합니다.',
              '수업 시작 24시간 이내 취소 또는 무단 결석 시, 해당 수업은 수업 완료(소진) 처리됩니다.',
              '지각으로 인해 늦게 시작하더라도, 수업은 예정된 정규 시간에 종료되며 보강이나 시간 연장은 불가합니다. (15분 이상 지각 시 당일 취소로 간주되어 1회 차감됩니다.)',
              '수강 기간 홀딩(일시 정지): 질병, 장기 출장 등 유사시, 전체 수강 기간 중 단 1회에 한하여 최대 14일간 수강 기간을 홀딩할 수 있습니다.',
              '강사의 사정으로 당일 취소 시, 취소된 수업 시간뿐만 아니라 해당하는 시간만큼 무료 보강을 추가로 진행해 드립니다.',
            ]} />
          </Section>

          {/* 3. 환불 규정 */}
          <Section icon={<CreditCardIcon weight="fill" />} title="3. 환불 규정">
            <Card className="rounded-2xl">
<CardContent className="p-6">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>수업 시작 전</span>
                  <span style={{ color: TEXT_TERTIARY, fontSize: 14, lineHeight: 1.7 }}>
                    첫 수업 시작 전 환불 요청 시 전액 환불이 가능합니다.
                  </span>
                </div>
                <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: 0 }} />
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 4 }}>수업 시작 후</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ color: TEXT_TERTIARY, fontSize: 14, lineHeight: 1.7 }}>
                      수업 시작 이후에는 시작한 달을 포함하여 다음 달 말까지, 잔여 수업 횟수에 한해 환불이 가능합니다. 모든 수업 횟수는 해당 기간 내 소진해 주시기 바랍니다.
                    </span>
                    <span style={{ color: TEXT_TERTIARY, fontSize: 14, lineHeight: 1.7 }}>
                      환불 시에는 진행된 수업 금액을 재결제하신 후 기존 결제를 전체 취소하는 방식으로 처리됩니다. 현재 결제 시스템상 부분 환불이 어려운 점 양해 부탁드립니다.
                    </span>
                  </div>
                </div>
                <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: 0 }} />
                <NoteList items={[
                  '이벤트·원데이 클래스는 특성상 환불이 불가합니다.',
                  '할인 적용 수업의 경우 중도 환불 시, 이미 진행된 수업은 할인가가 아닌 정상가(시간당 50,000원)로 계산하여 차감한 후 잔여 금액이 환불됩니다.',
                  '교재가 제공된 경우, 교재 비용은 환불 대상에서 제외됩니다.',
                  '환불은 영업일 기준 3~7일 이내 처리됩니다.',
                ]} />
              </div>
            </CardContent>
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

          <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: '24px 0', marginBottom: 28 }} />

          {/* 동의 CTA */}
          <Card className="rounded-2xl" style={{ backgroundColor: PRIMARY_BG, textAlign: 'center', marginBottom: 12 }}>
<CardContent className="p-6">
            <span style={{ fontWeight: 600, fontSize: 14, color: PRIMARY, lineHeight: 1.8, display: 'block', marginBottom: 6 }}>
              위 내용을 모두 확인하셨나요?
            </span>
            <span style={{ color: TEXT_TERTIARY, fontSize: 13, display: 'block', marginBottom: 20, lineHeight: 1.7 }}>
              아래 버튼을 눌러 동의 확인을 완료해 주세요.
            </span>
            <Button asChild block className="h-[52px] text-[15px] font-bold">
              <a href="https://forms.gle/GSrU2jruYTuFQxwo8" target="_blank" rel="noopener noreferrer">
                동의 확인 완료하기
              </a>
            </Button>
          </CardContent>
</Card>

          <span style={{ color: TEXT_TERTIARY, display: 'block', textAlign: 'center', fontSize: 13, lineHeight: 1.7 }}>
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
          </span>
        </main>

        {/* 푸터 */}
        <footer style={{ backgroundColor: BG_DARK, padding: '32px 24px 40px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <span style={{ display: 'block', color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
              하늘하늘중국어
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {[
                ['대표', '최하늘'],
                ['사업자등록번호', '747-15-01965'],
                ['이메일', 'tiantianchinese_@naver.com'],
              ].map(([label, value]) => (
                <span key={label} style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  {label} : {value}
                </span>
              ))}
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                Copyright © 2025 하늘하늘중국어. All rights reserved.
              </span>
            </div>
          </div>
        </footer>
      </div>
  );
}
