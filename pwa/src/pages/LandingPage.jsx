import { useState } from 'react';

import {
  ConfigProvider, Button, Card, Flex, Form, Input,
  Typography, Space, Divider,
} from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { submitConsultation } from '../api/consultApi';
import { PRIMARY, antdTheme } from '../constants/theme';
import TabPanel from '../components/TabPanel';
import IntroContent from '../components/IntroContent';
import PublicHeader from '../components/public/PublicHeader';
import PublicFooter from '../components/public/PublicFooter';
import FloatingCtaButton from '../components/public/FloatingCtaButton';
import ToggleButton from '../components/ui/ToggleButton';

const { Title, Text } = Typography;

const TABS = ['소개', '무료상담'];
const LEVEL_OPTIONS = ['완전 처음이에요', '조금 배운 적 있어요', '어느 정도 배웠는데 막혀있어요'];

// ─── 탭 2: 무료 상담 신청 ─────────────────────────────────────
function ConsultContent() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kakaoId, setKakaoId] = useState('');
  const [level, setLevel] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  async function handleSubmit() {
    setError('');
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!phone.trim()) { setError('전화번호를 입력해주세요.'); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setError('전화번호를 올바르게 입력해주세요.'); return; }
    setLoading(true);
    try {
      await submitConsultation({
        name: name.trim(), phone: digits,
        kakaoId: kakaoId.trim() || null,
        level: level || null,
        message: message.trim() || null,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || '신청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <Card variant="borderless" style={{ borderRadius: 16 }}>
          <div style={{ padding: '20px 0' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              backgroundColor: '#f6ffed', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 24, color: '#52c41a',
            }}>
              <CheckCircleOutlined />
            </div>
            <Title level={4} style={{ marginBottom: 8 }}>신청 완료!</Title>
            <Text type="secondary" style={{ fontSize: 14, lineHeight: 1.6 }}>
              신청해주셔서 감사합니다.<br />확인 후 문자로 연락드릴게요.
            </Text>
            <Divider style={{ margin: '20px 0 16px' }} />
            <Text style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 10 }}>
              더 빨리 연락받고 싶다면
            </Text>
            <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.7, display: 'block', marginBottom: 14 }}>
              채널톡으로 신청 완료 메시지를 보내주시면<br />우선적으로 확인해드릴게요.
            </Text>
            <Button
              size="large" block
              href="https://pf.kakao.com/_jFnFn"
              target="_blank" rel="noopener noreferrer"
              style={{
                height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15,
                backgroundColor: '#FEE500', borderColor: '#FEE500', color: '#000',
              }}
            >
              채널톡으로 알리기
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 4 }}>무료 상담 신청</Title>
        <Text type="secondary">Zoom 화상통화 30분 · 완전 무료</Text>
      </div>

      {/* 상담 혜택 */}
      <Card variant="borderless" style={{ borderRadius: 16, marginBottom: 24 }}>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>상담에서 해드리는 것</Text>
        <Flex vertical gap={8} style={{ width: '100%' }}>
          {[
            '현재 수준 진단 (입문~초중급)',
            '회화 실력이 안 느는 이유 찾기',
            '발음 교정 포인트 체크',
            '나에게 맞는 학습 방향 제안',
          ].map(item => (
            <Space key={item} size={10}>
              <CheckCircleOutlined style={{ color: PRIMARY, fontSize: 14, flexShrink: 0 }} />
              <Text style={{ fontSize: 14 }}>{item}</Text>
            </Space>
          ))}
        </Flex>
        <Divider style={{ margin: '16px 0 12px' }} />
        <Flex vertical gap={4}>
          <Text type="secondary" style={{ fontSize: 13 }}>· 신청 후 문자로 일정을 안내해드려요</Text>
          <Text type="secondary" style={{ fontSize: 13 }}>· 완전 무료, 부담 없이 신청하세요</Text>
        </Flex>
      </Card>

      {/* 폼 */}
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={<span>이름 <span style={{ color: PRIMARY }}>*</span></span>}>
          <Input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="홍길동" size="large" autoComplete="name"
            style={{ borderRadius: 12 }}
          />
        </Form.Item>

        <Form.Item label={<span>전화번호 <span style={{ color: PRIMARY }}>*</span></span>}>
          <Input
            type="tel" value={phone}
            onChange={e => setPhone(formatPhone(e.target.value))}
            placeholder="010-0000-0000" size="large"
            inputMode="numeric" autoComplete="tel"
            style={{ borderRadius: 12 }}
          />
        </Form.Item>

        <Form.Item
          label={<span>카카오톡 ID <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>(선택)</Text></span>}
          extra={<Text type="secondary" style={{ fontSize: 12 }}>카카오톡 설정 → 계정 → 계정 정보 → 아이디</Text>}
        >
          <Input
            value={kakaoId} onChange={e => setKakaoId(e.target.value)}
            placeholder="kakao_id" size="large"
            autoComplete="off" autoCorrect="off" autoCapitalize="off"
            style={{ borderRadius: 12 }}
          />
        </Form.Item>

        <Form.Item label="현재 중국어 수준">
          <Flex vertical gap={8} style={{ width: '100%' }}>
            {LEVEL_OPTIONS.map(opt => (
              <ToggleButton
                key={opt} label={opt}
                selected={level === opt}
                onClick={() => setLevel(prev => prev === opt ? '' : opt)}
                fullWidth
              />
            ))}
          </Flex>
        </Form.Item>

        <Form.Item label={
          <span>상담 희망 내용 <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>(선택)</Text></span>
        }>
          <Input.TextArea
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="궁금한 점이나 학습 목표를 자유롭게 적어주세요."
            rows={3} style={{ borderRadius: 12 }}
          />
        </Form.Item>

        {error && (
          <div style={{
            marginBottom: 20, padding: '12px 16px',
            backgroundColor: '#fff2f0', border: '1px solid #ffccc7',
            borderRadius: 12, fontSize: 14, color: '#cf1322',
          }}>
            {error}
          </div>
        )}

        <Button
          type="primary" size="large" loading={loading}
          onClick={handleSubmit} block
          style={{ height: 52, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
        >
          무료 상담 신청하기
        </Button>
      </Form>
    </div>
  );
}

// ─── 공유 버튼 ───────────────────────────────────────────────
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const url = 'https://hisyisnis-lgtm.github.io/TutorManager_For_Notion/#/intro';

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: '하늘하늘중국어', url });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleShare}
      aria-label="공유하기"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        border: '1px solid #d9d9d9', borderRadius: 20,
        background: 'none', cursor: 'pointer',
        padding: '5px 12px',
        fontSize: 12, fontWeight: 600, color: '#8c8c8c',
        transition: 'background 0.15s',
      }}
    >
      {copied ? '링크 복사됨 ✓' : '공유하기'}
    </button>
  );
}

// ─── 메인 랜딩 페이지 ─────────────────────────────────────────
export default function LandingPage() {
  const location = useLocation();
  const [tab, setTab] = useState(location.state?.tab || '소개');
  const [showFloat, setShowFloat] = useState(false);

  function switchTab(t) {
    setTab(t);
    setShowFloat(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <ConfigProvider theme={antdTheme}>
      <FloatingCtaButton
        visible={showFloat && tab === '소개'}
        onClick={() => switchTab('무료상담')}
      />
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', fontFamily: 'inherit' }}>
        <PublicHeader
          tabs={TABS}
          activeTab={tab}
          onTabChange={switchTab}
          rightSlot={<ShareButton />}
        />

        <main style={{ maxWidth: 480, margin: '0 auto' }}>
          <TabPanel active={tab === '소개'} id="panel-소개" labelledBy="tab-소개">
            <IntroContent onConsult={() => switchTab('무료상담')} onFloatChange={setShowFloat} />
          </TabPanel>
          <TabPanel active={tab === '무료상담'} id="panel-무료상담" labelledBy="tab-무료상담">
            <ConsultContent />
          </TabPanel>
        </main>

        <PublicFooter />
      </div>
    </ConfigProvider>
  );
}
