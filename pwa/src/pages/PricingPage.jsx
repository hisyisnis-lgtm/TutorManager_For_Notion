import { useState } from 'react';
import { ConfigProvider, Card, Flex, Space, Tag, Typography, Divider } from 'antd';
import { CheckCircleIcon, GiftIcon, CaretRightIcon, InfoIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { PRIMARY, antdTheme } from '../constants/theme';
import FadeUp from '../components/FadeUp';
import TabPanel from '../components/TabPanel';
import CheckItem from '../components/ui/CheckItem';
import SectionLabel from '../components/ui/SectionLabel';
import HeroSection from '../components/ui/HeroSection';
import IntroContent from '../components/IntroContent';
import PublicHeader from '../components/public/PublicHeader';
import PublicFooter from '../components/public/PublicFooter';
import FloatingCtaButton from '../components/public/FloatingCtaButton';
import CtaSection from '../components/public/CtaSection';

const { Title, Text } = Typography;


const TABS = ['소개', '수강료 안내'];

export default function PricingPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('수강료 안내');
  const [showFloat, setShowFloat] = useState(false);

  function switchTab(t) {
    setTab(t);
    setShowFloat(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <ConfigProvider theme={antdTheme}>
      <style>{`
        @keyframes cardShimmer {
          0%   { transform: translateX(-100%); animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1); }
          20%  { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes sparkFloat {
          0%   { transform: translateY(0) scale(1); opacity: 0.9; }
          100% { transform: translateY(-22px) scale(0); opacity: 0; }
        }
        @keyframes glintPop {
          0%   { transform: scale(0); opacity: 0; }
          35%  { transform: scale(1.15); opacity: 1; }
          65%  { transform: scale(1); opacity: 0.85; }
          100% { transform: scale(0); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-particle] { display: none !important; }
        }
        @media (hover: none) {
          .review-nav-btn { display: none !important; }
        }
        .cta-btn { transition: transform 100ms ease, box-shadow 100ms ease !important; }
        .cta-btn:active { transform: scale(0.96) !important; }
      `}</style>

      <FloatingCtaButton
        visible={showFloat && tab === '소개'}
        onClick={() => navigate('/intro', { state: { tab: '무료상담' } })}
      />

      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', fontFamily: 'inherit' }}>

        <PublicHeader tabs={TABS} activeTab={tab} onTabChange={switchTab} />

        <TabPanel active={tab === '소개'} id="panel-소개" labelledBy="tab-소개">
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <IntroContent
              onConsult={() => navigate('/intro', { state: { tab: '무료상담' } })}
              onFloatChange={setShowFloat}
            />
          </div>
        </TabPanel>

        <TabPanel active={tab === '수강료 안내'} id="panel-수강료 안내" labelledBy="tab-수강료 안내">
        <main style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>

          {/* ── 히어로 ── */}
          <HeroSection style={{ padding: '44px 24px 52px' }}>

            {/* 강사 프로필 */}
            <FadeUp delay={0}>
              <Flex align="center" gap={10} style={{ marginBottom: 28 }}>
                <img
                  src="/img/profile.jpg"
                  alt="하늘쌤"
                  style={{
                    width: 46, height: 46, borderRadius: '50%',
                    objectFit: 'cover', objectPosition: 'center top',
                    outline: '2px solid rgba(255,255,255,0.28)',
                    outlineOffset: 2,
                  }}
                />
                <div>
                  <Text style={{ color: 'white', fontSize: 14, fontWeight: 700, display: 'block', lineHeight: 1.3 }}>하늘쌤</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, display: 'block', lineHeight: 1.4 }}>하늘하늘 중국어 대표 강사</Text>
                </div>
              </Flex>
            </FadeUp>

            <FadeUp delay={80}>
              <div style={{ margin: '0 0 20px' }}>
                <p style={{
                  color: 'rgba(255,255,255,0.82)', fontSize: 16, fontWeight: 500,
                  margin: '0 0 6px', lineHeight: 1.4, letterSpacing: '0.01em',
                }}>
                  아는 중국어가 아니라,
                </p>
                <h1 style={{
                  color: 'white', fontSize: 32, fontWeight: 700,
                  lineHeight: 1.3, margin: 0, textWrap: 'balance',
                }}>
                  말할 수 있는<br />중국어로
                </h1>
              </div>
            </FadeUp>

            <FadeUp delay={180}>
              <Flex vertical gap={8} style={{ marginBottom: 32 }}>
                {[
                  '발음 교정 → 문장 구조 → 실전 말하기까지 연결',
                  '머리로 이해가 아닌, 입에서 바로 나오는 훈련',
                  "수업 안에서 반드시 '말하게' 만드는 구조",
                ].map(item => (
                  <Space key={item} size={8} align="start">
                    <CheckCircleIcon weight="fill" size={14} style={{ color: 'rgba(255,255,255,0.75)', flexShrink: 0, marginTop: 3 }} />
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.6, textWrap: 'pretty' }}>{item}</Text>
                  </Space>
                ))}
              </Flex>
            </FadeUp>

            {/* 하단 스탯 칩 */}
            <FadeUp delay={280}>
              <Flex gap={8} wrap="wrap">
                {['1:1 맞춤 수업', '말하기 중심', '유연한 스케줄'].map(label => (
                  <div key={label} style={{
                    display: 'inline-flex', alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.13)',
                    borderRadius: 20, padding: '5px 13px',
                  }}>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: 600, lineHeight: 1 }}>{label}</Text>
                  </div>
                ))}
              </Flex>
            </FadeUp>
          </HeroSection>

          {/* ── STEP 1 ── */}
          <section style={{ padding: '32px 16px 24px' }}>
            <FadeUp>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 20, padding: '4px 14px', marginBottom: 10 }}>
                  <Text style={{ color: 'white', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em' }}>STEP 1</Text>
                </div>
                <Title level={5} style={{ margin: '0 0 4px' }}>나에게 맞는 시작 방법</Title>
                <Text type="secondary" style={{ fontSize: 13 }}>본격 수강 전, 실력 진단 & 방향 설정 · 택 1</Text>
              </div>
            </FadeUp>

            <Flex vertical gap={12}>

              {/* 옵션 1: 무료 맞춤 상담 */}
              <FadeUp delay={80}>
                <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: 16 } }}>
                  <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
                    <Tag style={{ backgroundColor: '#f6ffed', color: '#389e0d', border: '1px solid #d9f7be', borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '1px 9px', margin: 0 }}>
                      FREE
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>30분</Text>
                  </Flex>
                  <Text strong style={{ fontSize: 15, color: '#1a1a1a', display: 'block', marginBottom: 6 }}>무료 맞춤 상담</Text>
                  <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.65, display: 'block', marginBottom: 12 }}>
                    처음 시작하시는 분, 또는 공부는 했지만 회화가 막막하신 분께 추천드립니다.
                  </Text>
                  <div style={{ backgroundColor: '#f6ffed', borderRadius: 10, padding: '11px 14px' }}>
                    <CheckItem color="#52c41a" textColor="#3d3d3d">
                      내 연습 방법이 맞는지 점검하고, 앞으로의 방향을 명확하게 잡을 수 있습니다.
                    </CheckItem>
                  </div>
                </Card>
              </FadeUp>

              {/* OR 구분자 */}
              <Flex align="center" gap={10} style={{ padding: '0 4px' }}>
                <div style={{ flex: 1, height: 1, backgroundColor: '#e8e8e8' }} />
                <div style={{
                  display: 'inline-flex', alignItems: 'center',
                  border: '1px solid #d9d9d9', borderRadius: 20,
                  padding: '3px 12px', backgroundColor: '#e8e8e8',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: 700, color: '#595959', letterSpacing: '0.06em', lineHeight: 1 }}>OR</Text>
                </div>
                <div style={{ flex: 1, height: 1, backgroundColor: '#e8e8e8' }} />
              </Flex>

              {/* 옵션 2: 집중 상담 + 프리미엄 첫 수업 */}
              <FadeUp delay={160}>
                <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border-brand)' }} styles={{ body: { padding: 16 } }}>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                    <Flex align="center" gap={8}>
                      <Tag style={{ backgroundColor: '#fff0f1', color: PRIMARY, border: `1px solid #ffb3b5`, borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '1px 9px', margin: 0 }}>
                        체험
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>90분</Text>
                    </Flex>
                    <Text className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: PRIMARY }}>
                      50,000원
                    </Text>
                  </Flex>
                  <Text strong style={{ fontSize: 15, color: '#1a1a1a', display: 'block', marginBottom: 6 }}>집중 상담 & 프리미엄 첫 수업</Text>
                  <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.65, display: 'block', marginBottom: 12 }}>
                    하늘쌤의 수업 방식을 직접 경험해보고 결정하고 싶은 분께 추천드립니다.
                  </Text>

                  {/* 수업 구성 흐름 */}
                  <Flex align="center" gap={6} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                    {['사전 설문', '30분 집중상담', '60분 본수업'].flatMap((step, i, arr) => {
                      const els = [
                        <div key={step} style={{ backgroundColor: '#f5f5f5', borderRadius: 20, padding: '4px 11px' }}>
                          <Text style={{ fontSize: 12, color: '#595959' }}>{step}</Text>
                        </div>,
                      ];
                      if (i < arr.length - 1) {
                        els.push(<CaretRightIcon weight="fill" key={`arr-${i}`} size={10} style={{ color: '#bfbfbf' }} />);
                      }
                      return els;
                    })}
                  </Flex>

                  <Flex vertical gap={8}>
                    {[
                      '수업 방식이 나와 맞는지 직접 경험해볼 수 있습니다.',
                      '왜 말이 안 나오는지 정확하게 짚어드립니다.',
                      "실제 '말해보는 수업'으로 바로 변화를 느끼실 수 있습니다.",
                    ].map(item => <CheckItem key={item}>{item}</CheckItem>)}
                  </Flex>
                </Card>
              </FadeUp>

              <FadeUp delay={200}>
                <div style={{ backgroundColor: '#e8e8e8', borderRadius: 10, padding: '11px 14px' }}>
                  <Space size={8} align="start">
                    <InfoIcon weight="fill" size={13} style={{ color: '#8c8c8c', marginTop: 2, flexShrink: 0 }} />
                    <Text style={{ fontSize: 13, color: '#595959', lineHeight: 1.6 }}>
                      두 가지 방법 중 <Text strong style={{ color: '#1a1a1a' }}>하나만 선택</Text> 가능합니다.
                    </Text>
                  </Space>
                </div>
              </FadeUp>
            </Flex>
          </section>

          {/* ── STEP 2 ── */}
          <section style={{ padding: '32px 16px 24px' }}>
            <FadeUp>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: PRIMARY, borderRadius: 20, padding: '4px 14px', marginBottom: 10 }}>
                  <Text style={{ color: 'white', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em' }}>STEP 2</Text>
                </div>
                <Title level={5} style={{ margin: '0 0 4px' }}>정규 클래스 & 멤버십</Title>
                <Text type="secondary" style={{ fontSize: 13 }}>나의 목표와 페이스에 맞는 플랜을 선택하세요.</Text>
              </div>
            </FadeUp>

            {/* 첫 등록 혜택 배너 */}
            <FadeUp delay={80}>
              <div style={{ backgroundColor: '#fffbef', border: '1px solid #ffe58f', borderRadius: 12, padding: '13px 16px', marginBottom: 16 }}>
                <Space size={10} align="start">
                  <GiftIcon weight="fill" size={16} style={{ color: '#d4a017', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <Text strong style={{ fontSize: 13, color: '#a07800', display: 'block', marginBottom: 4 }}>
                      첫 등록 스페셜 혜택
                    </Text>
                    <Text style={{ fontSize: 13, color: '#595959', lineHeight: 1.65 }}>
                      첫 상담·수업 후 <Text strong>3일 이내</Text> 30만 원 이상 등록 시<br />
                      <Text strong>교재 & 학습 굿즈 3종 세트</Text> 무료 증정
                    </Text>
                  </div>
                </Space>
              </div>
            </FadeUp>

            <Flex vertical gap={12}>

              {/* ── 베이직 플랜 ── */}
              <FadeUp delay={120}>
                <div style={{ position: 'relative', borderRadius: 14, padding: 2, overflow: 'hidden', boxShadow: '0 4px 16px rgba(82,196,26,0.2)', background: '#52c41a' }}>
                <div style={{ position: 'relative', zIndex: 1, borderRadius: 12, overflow: 'hidden' }}>
                <Card variant="borderless" style={{ borderRadius: 12, backgroundColor: 'white', border: 'none' }} styles={{ body: { padding: 16 } }}>
                  <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                      <Tag style={{ backgroundColor: 'rgba(82,196,26,0.1)', color: '#389e0d', border: '1px solid rgba(82,196,26,0.25)', borderRadius: 20, fontSize: 12, fontWeight: 700, padding: '2px 10px', margin: 0 }}>
                        🌱 꾸준히 성장
                      </Tag>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 8,  top: -8,  width: 3.5, height: 3.5, borderRadius: '50%', backgroundColor: '#52c41a', animation: 'sparkFloat 2.2s ease-out 0s infinite',    pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 18, top: -13, width: 2.5, height: 2.5, borderRadius: '50%', backgroundColor: '#95de64', animation: 'sparkFloat 1.9s ease-out 0.6s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 3,  top: -6,  width: 3,   height: 3,   borderRadius: '50%', backgroundColor: '#73d13d', animation: 'sparkFloat 2.4s ease-out 1.2s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 25, top: -10, width: 2.5, height: 2.5, borderRadius: '50%', backgroundColor: '#b7eb8f', animation: 'sparkFloat 2.0s ease-out 1.8s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 13, top: -16, width: 2,   height: 2,   borderRadius: '50%', backgroundColor: '#52c41a', animation: 'sparkFloat 1.6s ease-out 1.0s infinite',  pointerEvents: 'none' }} />
                    </div>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', letterSpacing: '0.12em' }}>BASIC</Text>
                  </Flex>
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
                    <div>
                      <Text strong style={{ fontSize: 16, color: '#1a1a1a', display: 'block', marginBottom: 2 }}>베이직 플랜</Text>
                      <Text type="secondary" style={{ fontSize: 13 }}>안정적인 학습 습관 형성</Text>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text className="tabular-nums" style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a', display: 'block', lineHeight: 1.2 }}>300,000</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>원 / 월</Text>
                    </div>
                  </Flex>
                  <Divider style={{ margin: '0 0 14px' }} />
                  <Flex gap={8}>
                    {[
                      { label: '옵션 A', sub: '주 1회 90분', note: '총 4회' },
                      { label: '옵션 B', sub: '주 2회 60분', note: '총 6회' },
                    ].map(({ label, sub, note }) => (
                      <div key={label} style={{ flex: 1, backgroundColor: '#fafafa', borderRadius: 10, padding: '11px 13px' }}>
                        <Text style={{ fontSize: 11, fontWeight: 700, color: '#bfbfbf', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>{label}</Text>
                        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>{sub}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>
                      </div>
                    ))}
                  </Flex>
                </Card>
                </div>
                </div>
              </FadeUp>

              {/* ── 부스터 플랜 ── */}
              <FadeUp delay={180}>
                <div style={{ position: 'relative', borderRadius: 14, padding: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(127,0,5,0.3)', background: PRIMARY }}>
                <div aria-hidden="true" style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(105deg, transparent 30%, rgba(127,0,5,0.06) 50%, transparent 70%)',
                  animation: 'cardShimmer 10s linear infinite',
                  willChange: 'transform',
                  pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative', zIndex: 1, borderRadius: 12, overflow: 'hidden' }}>
                <Card
                  variant="borderless"
                  style={{ borderRadius: 12, backgroundColor: 'white', border: 'none' }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                      <Tag style={{ backgroundColor: 'rgba(127,0,5,0.08)', color: PRIMARY, border: '1px solid rgba(127,0,5,0.2)', borderRadius: 20, fontSize: 12, fontWeight: 700, padding: '2px 10px', margin: 0 }}>
                        🔥 빠른 성장
                      </Tag>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 8,  top: -8,  width: 3.5, height: 3.5, borderRadius: '50%', backgroundColor: '#ff6b35', animation: 'sparkFloat 2s ease-out 0s infinite',    pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 15, top: -13, width: 2.5, height: 2.5, borderRadius: '50%', backgroundColor: '#ffd23f', animation: 'sparkFloat 1.7s ease-out 0.5s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 3,  top: -6,  width: 3,   height: 3,   borderRadius: '50%', backgroundColor: '#ff4d4d', animation: 'sparkFloat 2.2s ease-out 1.1s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 21, top: -10, width: 2.5, height: 2.5, borderRadius: '50%', backgroundColor: '#ffaa00', animation: 'sparkFloat 1.9s ease-out 1.7s infinite',  pointerEvents: 'none' }} />
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 11, top: -16, width: 2,   height: 2,   borderRadius: '50%', backgroundColor: '#ff8c00', animation: 'sparkFloat 1.5s ease-out 0.9s infinite',  pointerEvents: 'none' }} />
                    </div>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', letterSpacing: '0.12em' }}>BOOSTER</Text>
                  </Flex>
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: 10 }}>
                    <div>
                      <Text strong style={{ color: '#1a1a1a', fontSize: 16, display: 'block' }}>부스터 플랜</Text>
                      <Text strong style={{ color: '#1a1a1a', fontSize: 16, display: 'block', marginBottom: 3 }}>+발음 교정 1시간</Text>
                      <Text style={{ color: '#595959', fontSize: 13 }}>주 2회 · 90분 · 총 8회 + 60분 1회</Text>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text className="tabular-nums" style={{ color: '#1a1a1a', fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1.2 }}>600,000</Text>
                      <Text style={{ color: '#595959', fontSize: 12 }}>원 / 월</Text>
                    </div>
                  </Flex>
                  <Text style={{ color: '#595959', fontSize: 13, display: 'block', lineHeight: 1.7, marginBottom: 14 }}>
                    빠른 실력 향상을 원한다면 가장 추천합니다. 실제로 가장 눈에 띄는 성장을 보이는 수강생들의 선택입니다.
                  </Text>
                  <div style={{ backgroundColor: 'rgba(127,0,5,0.05)', borderRadius: 10, padding: '12px 14px' }}>
                    <Text style={{ color: '#1a1a1a', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 8 }}>포함 혜택</Text>
                    <Flex vertical gap={8} style={{ marginBottom: 10 }}>
                      {[
                        '교재 & 학습 굿즈 3종 세트',
                        '정규 수업 시작 전 발음 교정 1시간 무료 제공',
                      ].map(item => (
                        <CheckItem key={item} color={PRIMARY} textColor="#595959" size={13}>{item}</CheckItem>
                      ))}
                    </Flex>
                    <Text style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.6 }}>
                      해당 혜택은 첫 등록 시에만 적용됩니다.
                    </Text>
                  </div>
                </Card>
                </div>
                </div>
              </FadeUp>

              {/* ── VIP 멤버십 ── */}
              <FadeUp delay={240}>
                <div style={{ position: 'relative', borderRadius: 14, padding: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.22)', background: 'linear-gradient(155deg, #1a1a1a, #2a2a2a)' }}>
                <div aria-hidden="true" style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(105deg, transparent 30%, rgba(212,184,150,0.45) 50%, transparent 70%)',
                  mixBlendMode: 'screen',
                  animation: 'cardShimmer 10s linear infinite',
                  willChange: 'transform',
                  pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative', zIndex: 1, borderRadius: 12, overflow: 'hidden' }}>
                <Card
                  variant="borderless"
                  style={{ borderRadius: 12, background: 'linear-gradient(155deg, #1a1a1a, #2a2a2a)', border: 'none' }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                      <Tag style={{ backgroundColor: 'rgba(212,184,150,0.15)', color: '#d4b896', border: '1px solid rgba(212,184,150,0.3)', borderRadius: 20, fontSize: 12, fontWeight: 700, padding: '2px 10px', margin: 0 }}>
                        💎 VIP 멤버십
                      </Tag>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: -8,  top: -8,  fontSize: 7,  lineHeight: 1, color: '#d4b896', animation: 'glintPop 2.5s ease-in-out 0s infinite',    pointerEvents: 'none' }}>✦</span>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 15,  top: -11, fontSize: 6,  lineHeight: 1, color: '#fff',    animation: 'glintPop 2.2s ease-in-out 0.8s infinite',  pointerEvents: 'none' }}>✦</span>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', right: -8,  top: -5,  fontSize: 8,  lineHeight: 1, color: '#d4b896', animation: 'glintPop 2.8s ease-in-out 1.5s infinite',  pointerEvents: 'none' }}>✦</span>
                      <span data-particle aria-hidden="true" style={{ position: 'absolute', left: 3,   bottom: -8, fontSize: 6, lineHeight: 1, color: '#ecd9be', animation: 'glintPop 2.3s ease-in-out 2.1s infinite',  pointerEvents: 'none' }}>✦</span>
                    </div>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: '#d4b896', letterSpacing: '0.12em' }}>MEMBERSHIP</Text>
                  </Flex>
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: 10 }}>
                    <div>
                      <Text strong style={{ color: 'white', fontSize: 16, display: 'block' }}>VIP 멤버십 플랜</Text>
                      <Text strong style={{ color: 'white', fontSize: 16, display: 'block' }}>+발음 교정 1시간</Text>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Text className="tabular-nums" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 17, textDecoration: 'line-through', display: 'block' }}>
                        1,000,000원
                      </Text>
                      <Text className="tabular-nums" style={{ color: '#d4b896', fontSize: 24, fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
                        950,000
                      </Text>
                      <Text style={{ color: 'rgba(212,184,150,0.6)', fontSize: 12 }}>원 · 5% 할인</Text>
                    </div>
                  </Flex>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.7, display: 'block', marginBottom: 14, textWrap: 'pretty' }}>
                    장기적으로 중국어를 마스터할 VIP 수강생을 위한 특별 혜택 플랜입니다.
                  </Text>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
                    <Text style={{ color: '#d4b896', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 8 }}>VIP 단독 혜택</Text>
                    <Flex vertical gap={8} style={{ marginBottom: 6 }}>
                      <CheckItem color="#d4b896" textColor="rgba(255,255,255,0.7)" size={13}>1시간당 5% 할인 된 수강료</CheckItem>
                    </Flex>
                    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 12 }}>※ VIP 단독 혜택은 재등록 시에도 유효합니다.</Text>
                    <Text style={{ color: '#d4b896', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 8 }}>포함 혜택</Text>
                    <Flex vertical gap={8} style={{ marginBottom: 10 }}>
                      {[
                        '교재 & 학습 굿즈 3종 세트',
                        '정규 수업 시작 전 발음 교정 1시간 무료 제공',
                      ].map(item => (
                        <CheckItem key={item} color="#d4b896" textColor="rgba(255,255,255,0.7)" size={13}>{item}</CheckItem>
                      ))}
                    </Flex>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, display: 'block', marginBottom: 10 }}>
                      해당 혜택은 첫 등록 시에만 적용됩니다.
                    </Text>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.7 }}>
                        ※ 결제일로부터 3개월(90일) 이내 소진<br />
                        ※ 환불 시 정가 기준 차감 후 재결제 방식
                      </Text>
                    </div>
                  </div>
                </Card>
                </div>
                </div>
              </FadeUp>

            </Flex>
          </section>

          {/* ── 수강 추천 패턴 ── */}
          <section style={{ padding: '28px 16px 20px' }}>
            <FadeUp>
              <SectionLabel>TIPS</SectionLabel>
              <Title level={5} style={{ margin: '0 0 8px', textWrap: 'balance' }}>가장 빠르게 실력이 느는 수강 패턴</Title>
              <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.75, display: 'block', marginBottom: 14, textWrap: 'pretty' }}>
                주 2회 이상 수강하시는 분들이 발음 교정과 말하기 속도가 훨씬 빠르게 향상됩니다.
              </Text>
              <Flex vertical gap={8} style={{ marginBottom: 14 }}>
                {[
                  '발음 → 문장 → 말하기까지 반복 노출이 중요합니다.',
                  '일정 간격을 두고 자주 말하는 구조가 핵심입니다.',
                ].map(item => <CheckItem key={item}>{item}</CheckItem>)}
              </Flex>
              <Text style={{ fontSize: 13, color: '#595959', lineHeight: 1.7, textWrap: 'pretty' }}>
                특히 초반에 발음과 말하기 습관을 잡는 과정에서는 공부 시간보다는 공부 빈도가 중요합니다.
              </Text>
            </FadeUp>
          </section>

          {/* ── 안내 사항 ── */}
          <section style={{ padding: '28px 16px 24px' }}>
            <FadeUp>
              <Title level={5} style={{ margin: '0 0 16px', textWrap: 'balance' }}>안내 사항</Title>
              {[
                { label: '결제 방식', desc: '수업은 선결제 기준으로 진행됩니다.' },
                { label: '일정 변경', desc: '수업 시작 최소 24시간 전까지 요청해 주세요.' },
                { label: '취소·결석', desc: '당일 취소 및 무단결석 시 환불이 어렵습니다.' },
                { label: 'VIP 조건', desc: '결제일로부터 3개월 이내 소진. 환불 시 정가 기준 차감 후 재결제 방식입니다.' },
              ].map(({ label, desc }, i, arr) => (
                <div
                  key={label}
                  style={{
                    display: 'flex', gap: 14, alignItems: 'flex-start',
                    marginBottom: i < arr.length - 1 ? 10 : 0,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: 700, color: PRIMARY, width: 60, flexShrink: 0, paddingTop: 1 }}>{label}</Text>
                  <Text style={{ fontSize: 13, color: '#595959', lineHeight: 1.65, flex: 1, textWrap: 'pretty' }}>{desc}</Text>
                </div>
              ))}
            </FadeUp>
          </section>

          {/* ── CTA ── */}
          <CtaSection
            className="cta-btn"
            onCtaClick={() => { window.location.hash = '#/intro'; }}
          />

        </main>
        </TabPanel>

        <PublicFooter />

      </div>
    </ConfigProvider>
  );
}
