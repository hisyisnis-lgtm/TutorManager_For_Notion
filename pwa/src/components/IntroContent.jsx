/**
 * IntroContent — 서비스 소개 탭 컨텐츠 (공유 컴포넌트)
 * LandingPage 와 PricingPage 에서 공통으로 사용합니다.
 * 내용을 수정할 때 이 파일만 수정하면 두 페이지에 모두 반영됩니다.
 */
import { useState, useRef, useEffect } from 'react';
import { Button, Card, Flex, Space, Tag, Avatar, Typography } from 'antd';
import {
  ClockCircleOutlined, EnvironmentOutlined,
  ReadOutlined, UserOutlined,
  SoundOutlined, LineChartOutlined, BulbOutlined, MessageOutlined,
  LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import { PRIMARY } from '../constants/theme';
import FadeUp from './FadeUp';
import HeroSection from './ui/HeroSection';
import CtaSection from './public/CtaSection';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

const REVIEW_URLS = [
  'https://blog.naver.com/strolling-around/224202928037',
  'https://m.blog.naver.com/naningumusme/224232796614',
];

const { Title, Text, Paragraph } = Typography;

function IconBox({ icon, color = '#767676', bg = '#f9fafb' }) {
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, color, fontSize: 16,
    }}>
      {icon}
    </div>
  );
}

// ─── 수강생 후기 카드 (OG 메타태그 자동 파싱) ──────────────────
function ReviewCard({ url }) {
  const [og, setOg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!WORKER_URL) {
      setLoading(false);
      return;
    }
    fetch(`${WORKER_URL}/og-proxy?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(data => setOg(data))
      .catch(() => setOg(null))
      .finally(() => setLoading(false));
  }, [url]);

  const CARD_HEIGHT = 380;
  const IMG_HEIGHT = 180;

  if (loading) {
    return (
      <Card variant="borderless" style={{ borderRadius: 16, overflow: 'hidden', height: CARD_HEIGHT }} styles={{ body: { padding: 0 } }}>
        <div style={{ height: IMG_HEIGHT, backgroundColor: '#f0f0f0' }} />
        <div style={{ padding: '14px 16px 16px' }}>
          <div style={{ height: 12, width: 80, backgroundColor: '#f0f0f0', borderRadius: 6, marginBottom: 10 }} />
          <div style={{ height: 14, backgroundColor: '#f0f0f0', borderRadius: 6, marginBottom: 6 }} />
          <div style={{ height: 14, width: '70%', backgroundColor: '#f0f0f0', borderRadius: 6 }} />
        </div>
      </Card>
    );
  }

  if (!og || (!og.title && !og.image)) return null;

  const hostname = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block', height: CARD_HEIGHT }}>
      <Card variant="borderless" hoverable style={{ borderRadius: 16, overflow: 'hidden', height: '100%' }} styles={{ body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } }}>
        {og.image && (
          <img
            src={og.image}
            alt={og.title || '후기 썸네일'}
            style={{ width: '100%', height: IMG_HEIGHT, objectFit: 'cover', display: 'block', flexShrink: 0 }}
          />
        )}
        <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Tag style={{ borderRadius: 20, marginBottom: 8, fontSize: 12, fontWeight: 600, backgroundColor: '#fff0f1', borderColor: '#ffccc7', color: PRIMARY, flexShrink: 0 }}>
            {hostname}
          </Tag>
          {og.title && (
            <Text strong style={{
              fontSize: 14, lineHeight: 1.5, marginBottom: 6, color: '#262626', flexShrink: 0,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {og.title}
            </Text>
          )}
          {og.description && (
            <Text type="secondary" style={{
              fontSize: 13, lineHeight: 1.6, flex: 1, minHeight: 0,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>
              {og.description}
            </Text>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, flexShrink: 0 }}>
            <Text style={{ fontSize: 12, color: PRIMARY, fontWeight: 600 }}>전체 보기 →</Text>
          </div>
        </div>
      </Card>
    </a>
  );
}

// ─── 수강생 후기 스크롤 섹션 ─────────────────────────────────
function ReviewScrollSection() {
  const scrollRef = useRef(null);
  const [index, setIndex] = useState(0);
  const canLeft = index > 0;
  const canRight = index < REVIEW_URLS.length - 1;

  function scroll(dir) {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(REVIEW_URLS.length - 1, index + dir));
    setIndex(next);
    el.scrollBy({ left: dir * 292, behavior: 'smooth' });
  }

  const navBtnStyle = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    width: 44, height: 44, borderRadius: '50%',
    backgroundColor: 'white', border: '1px solid #e0e0e0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', zIndex: 10, fontSize: 18, color: '#262626',
  };

  return (
    <FadeUp>
      <section style={{ padding: '24px 0 16px', position: 'relative' }}>
        <Title level={5} style={{ marginBottom: 16, paddingLeft: 20 }}>수강생 후기</Title>
        {canLeft && (
          <div className="review-nav-btn" style={{ ...navBtnStyle, left: 4 }} onClick={() => scroll(-1)} aria-label="이전">
            <LeftOutlined />
          </div>
        )}
        {canRight && (
          <div className="review-nav-btn" style={{ ...navBtnStyle, right: 4 }} onClick={() => scroll(1)} aria-label="다음">
            <RightOutlined />
          </div>
        )}
        <div ref={scrollRef} style={{
          display: 'flex', alignItems: 'stretch', gap: 12, overflowX: 'auto',
          paddingBottom: 4,
          scrollSnapType: 'x mandatory',
          scrollPaddingLeft: 20,
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}>
          <div style={{ minWidth: 20, flexShrink: 0 }} />
          {REVIEW_URLS.map((url) => (
            <div key={url} style={{ minWidth: 260, maxWidth: 280, flexShrink: 0, scrollSnapAlign: 'start' }}>
              <ReviewCard url={url} />
            </div>
          ))}
          <div style={{ minWidth: 8, flexShrink: 0 }} />
        </div>
      </section>
    </FadeUp>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────
// onConsult  : 무료 상담 신청 버튼 클릭 시 호출되는 콜백
// onFloatChange : 플로팅 버튼 표시 여부 변경 시 호출되는 콜백
export default function IntroContent({ onConsult, onFloatChange }) {
  const heroRef = useRef(null);
  const ctaRef = useRef(null);
  const heroVisible = useRef(true);
  const ctaVisible = useRef(false);

  function update() {
    onFloatChange?.(!heroVisible.current && !ctaVisible.current);
  }

  useEffect(() => {
    const heroEl = heroRef.current;
    const ctaEl = ctaRef.current;
    if (!heroEl || !ctaEl) return;

    const heroObs = new IntersectionObserver(([e]) => {
      heroVisible.current = e.isIntersecting;
      update();
    }, { threshold: 0 });

    const ctaObs = new IntersectionObserver(([e]) => {
      ctaVisible.current = e.isIntersecting;
      update();
    }, { threshold: 0.2 });

    heroObs.observe(heroEl);
    ctaObs.observe(ctaEl);
    return () => { heroObs.disconnect(); ctaObs.disconnect(); };
  }, []);

  return (
    <>
      <style>{`
        @media (hover: none) {
          .review-nav-btn { display: none !important; }
        }
      `}</style>
      <div style={{ paddingBottom: 80 }}>
        {/* Hero */}
        <HeroSection sectionRef={heroRef} style={{ padding: '56px 24px 48px' }}>
          <div>
            <FadeUp delay={0}>
              <Tag style={{
                backgroundColor: 'rgba(255,255,255,0.15)', color: 'white',
                border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 600,
                marginBottom: 20, letterSpacing: '0.05em',
              }}>
                회화 · 발음 교정 전문
              </Tag>
            </FadeUp>
            <FadeUp delay={100}>
              <h1 style={{
                color: 'white', fontSize: 32, fontWeight: 700,
                lineHeight: 1.3, margin: '0 0 12px',
                textWrap: 'balance',
              }}>
                말할 수 있어야<br />진짜 아는 언어입니다.
              </h1>
            </FadeUp>
            <FadeUp delay={200}>
              <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.6, margin: '0 0 36px' }}>
                10년의 노하우로 이끄는 다정한 여정.<br />
                서툰 첫걸음이 막힘없는 대화가 되기까지,<br />
                가장 든든한 페이스메이커가 되어드릴게요.
              </p>
            </FadeUp>
            <FadeUp delay={300}>
              <Button
                size="large" onClick={onConsult} block
                style={{ backgroundColor: 'white', color: PRIMARY, fontWeight: 700, height: 48, borderRadius: 12, border: 'none' }}
              >
                무료 상담 신청
              </Button>
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
                수강료 문의는{' '}
                <a href="https://pf.kakao.com/_jFnFn" target="_blank" rel="noopener noreferrer"
                  style={{ color: 'rgba(255,255,255,0.9)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.4)' }}
                >채널톡</a>
                으로 부탁드립니다.
              </p>
            </FadeUp>
          </div>
        </HeroSection>

        {/* 이런 분께 */}
        <section style={{ padding: '24px 20px 16px' }}>
          <FadeUp>
            <Title level={5} style={{ marginBottom: 16 }}>이런 분께 맞아요</Title>
          </FadeUp>
          <Flex vertical gap={10} style={{ width: '100%' }}>
            {[
              { icon: <BulbOutlined />, title: '중국어를 처음 시작하는 분', desc: '성조부터 회화까지, 가장 빠르고 확실하게 첫 단추를 끼워드립니다.' },
              { icon: <SoundOutlined />, title: '어색한 발음이 고민인 분', desc: '디테일한 밀착 교정으로, 원어민처럼 당당하게 말하는 자신감을 찾아드립니다.' },
              { icon: <MessageOutlined />, title: '머리로는 아는데 입이 안 떨어지는 분', desc: '눈으로 하는 공부와, 입 밖으로 꺼내는 훈련은 방식부터 다릅니다.' },
              { icon: <LineChartOutlined />, title: '초·중급인데 방향을 잘 못 잡겠는 분', desc: '예리한 진단으로 지금의 답답함을 뚫고, 한 단계 도약할 돌파구를 찾아드립니다.' },
            ].map(({ icon, title, desc }, i) => (
              <FadeUp key={title} delay={i * 80}>
                <Card variant="borderless" style={{ borderRadius: 12 }} styles={{ body: { padding: 16 } }}>
                  <Space size={14} align="start">
                    <IconBox icon={icon} color={PRIMARY} bg="#fff0f1" />
                    <div>
                      <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>{title}</Text>
                      <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>{desc}</Text>
                    </div>
                  </Space>
                </Card>
              </FadeUp>
            ))}
          </Flex>
        </section>

        {/* 어려운 상담 */}
        <FadeUp>
          <section style={{ padding: '24px 20px 16px' }}>
            <Card variant="borderless" style={{ borderRadius: 12, backgroundColor: '#fafafa' }} styles={{ body: { padding: 20 } }}>
              <Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 8 }}>이런 상담은 어려워요</Text>
              <Paragraph style={{ fontSize: 14, color: '#595959', marginBottom: 12, lineHeight: 1.6 }}>
                하늘쌤은 입문~초중급 회화·발음 교정 전문입니다.<br />
                아래 항목은 충분히 도움드리기 어려울 수 있어요.
              </Paragraph>
              <Flex vertical gap={4}>
                {['HSK 시험 준비', '작문·쓰기 집중 학습', '대학원 진학, 유학, 어학연수 준비'].map(item => (
                  <Text key={item} type="secondary" style={{ fontSize: 14 }}>· {item}</Text>
                ))}
              </Flex>
            </Card>
          </section>
        </FadeUp>

        {/* 강사 프로필 */}
        <FadeUp>
          <section style={{ padding: '24px 20px 16px' }}>
            <Flex vertical align="center" gap={12} style={{ textAlign: 'center', padding: '0' }}>
              <Avatar
                src="/img/profile.jpg" size={120}
                alt="하늘쌤 프로필 사진"
                style={{
                  flexShrink: 0,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  outline: '1px solid rgba(0,0,0,0.08)',
                  outlineOffset: 2,
                }}
              />
              <div>
                <Title level={4} style={{ margin: '0 0 4px' }}>하늘쌤</Title>
                <Text style={{ fontSize: 13, fontWeight: 600, color: PRIMARY, letterSpacing: '0.05em', display: 'block', marginBottom: 12 }}>
                  대표 강사
                </Text>
                <Space size={6} wrap style={{ justifyContent: 'center' }}>
                  {['10년 경력', '회화 전문', '발음 교정'].map(tag => (
                    <Tag key={tag} style={{ borderRadius: 20, margin: 0, fontSize: 13, backgroundColor: 'transparent', borderColor: '#d9d9d9', color: '#262626' }}>{tag}</Tag>
                  ))}
                </Space>
              </div>
            </Flex>
          </section>
        </FadeUp>

        {/* 수업 안내 */}
        <FadeUp>
          <section style={{ padding: '24px 20px 16px' }}>
            <Title level={5} style={{ marginBottom: 16 }}>수업 안내</Title>
            <Card variant="borderless" style={{ borderRadius: 16 }}>
              <Flex vertical gap={16} style={{ width: '100%' }}>
                {[
                  { icon: <ClockCircleOutlined />, label: '수업 시간', value: '60분 기준 (조정 가능)' },
                  { icon: <EnvironmentOutlined />, label: '수업 장소', value: '강남 사무실 · Zoom 화상' },
                  { icon: <ReadOutlined />, label: '수업 방식', value: '회화·발음 교정, 1:1 맞춤형' },
                  { icon: <UserOutlined />, label: '수업 형태', value: '1:1 개인 과외' },
                ].map(({ icon, label, value }) => (
                  <Space key={label} size={12}>
                    <IconBox icon={icon} />
                    <div>
                      <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>{label}</Text>
                      <Text strong style={{ fontSize: 14 }}>{value}</Text>
                    </div>
                  </Space>
                ))}
              </Flex>
            </Card>
          </section>
        </FadeUp>

        {/* 수강생 리뷰 */}
        <ReviewScrollSection />

        {/* CTA */}
        <CtaSection sectionRef={ctaRef} onCtaClick={onConsult} />
      </div>
    </>
  );
}
