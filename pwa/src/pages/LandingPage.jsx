import { useState, useRef, useEffect } from 'react';
import {
  ConfigProvider, Button, Card, Flex, Form, Input,
  Typography, Tag, Space, Avatar, Divider,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, EnvironmentOutlined,
  ReadOutlined, UserOutlined, ArrowRightOutlined,
  SoundOutlined, LineChartOutlined, BulbOutlined, MessageOutlined,
  LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import { submitConsultation } from '../api/consultApi';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// ─── 수강생 후기 블로그 링크 목록 ─────────────────────────────
// 새 링크 추가 시 여기에만 추가하면 됩니다
const REVIEW_URLS = [
  'https://blog.naver.com/strolling-around/224202928037',
  'https://m.blog.naver.com/naningumusme/224232796614',
];

const { Title, Text, Paragraph } = Typography;

const PRIMARY = '#7f0005';
const TABS = ['소개', '무료상담'];
const LEVEL_OPTIONS = ['완전 처음이에요', '조금 배운 적 있어요', '어느 정도 배웠는데 막혀있어요'];

const theme = {
  token: {
    colorPrimary: PRIMARY,
    borderRadius: 12,
    colorBgContainer: '#ffffff',
    fontFamily: 'inherit',
  },
};

// ─── prefers-reduced-motion 감지 ─────────────────────────────
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// ─── 스크롤 애니메이션 ────────────────────────────────────────
function useInView(threshold = 0.12) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function FadeUp({ children, delay = 0, style = {} }) {
  const [ref, inView] = useInView();
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div ref={ref} style={{
      opacity: reducedMotion || inView ? 1 : 0,
      transform: reducedMotion || inView ? 'translateY(0)' : 'translateY(24px)',
      transition: reducedMotion ? 'none' : `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── 아이콘 박스 헬퍼 ────────────────────────────────────────
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

// ─── 선택 버튼 (레벨·요일·시간) ─────────────────────────────
function ToggleButton({ label, selected, onClick, fullWidth = false, style = {} }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        width: fullWidth ? '100%' : undefined,
        height: 44, borderRadius: 12, fontSize: 14, fontWeight: 500,
        cursor: 'pointer',
        transition: 'background-color 0.2s, border-color 0.2s, color 0.2s, transform 0.1s',
        border: `1px solid ${selected ? PRIMARY : '#d9d9d9'}`,
        backgroundColor: selected ? PRIMARY : '#ffffff',
        color: selected ? '#ffffff' : '#595959',
        textAlign: fullWidth ? 'left' : 'center',
        padding: fullWidth ? '0 16px' : '0',
        ...style,
      }}
    >
      {label}
    </button>
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
        {/* 좌우 버튼 — 모바일에서는 숨김 */}
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

// ─── 탭 1: 서비스 소개 ────────────────────────────────────────
function LandingContent({ onConsult, onFloatChange }) {
  const heroRef = useRef(null);
  const ctaRef = useRef(null);
  const heroVisible = useRef(true);
  const ctaVisible = useRef(false);

  function update() {
    onFloatChange(!heroVisible.current && !ctaVisible.current);
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
    <div style={{ paddingBottom: 80 }}>
      {/* Hero */}
      <section ref={heroRef} style={{
        background: `linear-gradient(135deg, ${PRIMARY} 0%, #a00008 100%)`,
        padding: '56px 24px 48px',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* 배경 장식 */}
        <div style={{
          position: 'absolute', top: -60, right: -40,
          width: 200, height: 200, borderRadius: '50%',
          backgroundColor: 'rgba(255,255,255,0.05)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -30, left: -30,
          width: 120, height: 120, borderRadius: '50%',
          backgroundColor: 'rgba(255,255,255,0.04)',
          pointerEvents: 'none',
        }} />
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
            중국어로<br />말하고 싶다면
          </h1>
        </FadeUp>
        <FadeUp delay={200}>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.6, margin: '0 0 36px' }}>
            10년 경력의 중국어 전문 강사와 함께<br />
            입문부터 초중급까지 체계적으로.
          </p>
        </FadeUp>
        <FadeUp delay={300}>
          <Button
            size="large" onClick={onConsult} block
            style={{ backgroundColor: 'white', color: PRIMARY, fontWeight: 700, height: 48, borderRadius: 12, border: 'none' }}
          >
            무료 상담 신청
          </Button>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
            수강료 문의는{' '}
            <a href="https://pf.kakao.com/_jFnFn" target="_blank" rel="noopener noreferrer"
              style={{ color: 'rgba(255,255,255,0.9)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.4)' }}
            >채널톡</a>
            으로 부탁드립니다.
          </p>
        </FadeUp>
      </section>

      {/* 이런 분께 */}
      <section style={{ padding: '24px 20px 16px' }}>
        <FadeUp>
          <Title level={5} style={{ marginBottom: 16 }}>이런 분께 맞아요</Title>
        </FadeUp>
        <Flex vertical gap={10} style={{ width: '100%' }}>
          {[
            { icon: <BulbOutlined />, title: '중국어를 처음 시작하고 싶은 분', desc: '어디서부터 시작할지 같이 잡아드려요.' },
            { icon: <SoundOutlined />, title: '발음 교정으로 자신감을 키우고 싶은 분', desc: '자연스럽게 말할 수 있도록 체계적으로 교정해드려요.' },
            { icon: <MessageOutlined />, title: '배웠지만 막상 말이 안 나오는 분', desc: '왜 입이 안 열리는지, 어떻게 해결할지 이야기해요.' },
            { icon: <LineChartOutlined />, title: '초·중급인데 방향을 못 잡겠는 분', desc: '수준 진단 후 맞춤 방향을 제안해드려요.' },
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
      <FadeUp>
        <section ref={ctaRef} style={{ padding: '24px 20px' }}>
          <Card variant="borderless" style={{ borderRadius: 16, backgroundColor: '#fff0f1', textAlign: 'center' }}>
            <Title level={5} style={{ color: PRIMARY, marginBottom: 6 }}>Zoom 30분 무료 상담</Title>
            <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
              부담 없이 신청하세요.<br />완전 무료, 신청 후 문자로 연락드립니다.
            </Paragraph>
            <Button
              type="primary" size="large" onClick={onConsult}
              style={{ borderRadius: 12, fontWeight: 700, height: 48, paddingInline: 32 }}
            >
              무료 상담 신청하기 <ArrowRightOutlined />
            </Button>
          </Card>
        </section>
      </FadeUp>
    </div>
  );
}

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

// ─── 탭 패널 페이드인 래퍼 ───────────────────────────────────
function TabPanel({ active, id, labelledBy, children }) {
  const [visible, setVisible] = useState(active);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setAnimKey(k => k + 1);
    } else {
      setVisible(false);
    }
  }, [active]);

  return (
    <div
      role="tabpanel" id={id} aria-labelledby={labelledBy}
      style={{ display: visible ? 'block' : 'none' }}
    >
      <div key={animKey} style={{
        animation: active ? 'tabFadeIn 0.35s ease forwards' : 'none',
      }}>
        {children}
      </div>
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
  const [tab, setTab] = useState('소개');
  const [showFloat, setShowFloat] = useState(false);

  function switchTab(t) {
    setTab(t);
    setShowFloat(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <ConfigProvider theme={theme}>
      <style>{`
        @keyframes tabFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (hover: none) {
          .review-nav-btn { display: none !important; }
        }
      `}</style>
      {/* 플로팅 무료상담 버튼 — TabPanel 애니메이션 바깥에 렌더링해야 position:fixed 정상 작동 */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%',
        zIndex: 200,
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        opacity: showFloat && tab === '소개' ? 1 : 0,
        transform: showFloat && tab === '소개' ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(16px)',
        pointerEvents: showFloat && tab === '소개' ? 'auto' : 'none',
      }}>
        <Button
          type="primary" size="large" onClick={() => switchTab('무료상담')}
          style={{
            height: 48, borderRadius: 24, fontWeight: 700, fontSize: 15,
            paddingInline: 28, boxShadow: '0 4px 16px rgba(127,0,5,0.35)',
          }}
        >
          무료 상담 신청 <ArrowRightOutlined />
        </Button>
      </div>
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', fontFamily: 'inherit' }}>
        {/* Sticky 헤더 */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 50,
          backgroundColor: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 20px' }}>
            <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <img src="/logo/logo-red.png" alt="하늘하늘 중국어" style={{ height: 24, objectFit: 'contain' }} />
              <ShareButton />
            </div>
            <div role="tablist" aria-label="페이지 섹션" style={{ display: 'flex', marginBottom: -1 }}>
              {TABS.map(t => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  id={`tab-${t}`}
                  onClick={() => switchTab(t)}
                  style={{
                    minHeight: 44, marginRight: 24, paddingBottom: 10, paddingTop: 10,
                    fontSize: 14, fontWeight: 500,
                    border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: `2px solid ${tab === t ? PRIMARY : 'transparent'}`,
                    color: tab === t ? PRIMARY : '#595959',
                    transition: 'color 0.2s, border-color 0.2s',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 480, margin: '0 auto' }}>
          <TabPanel active={tab === '소개'} id="panel-소개" labelledBy="tab-소개">
            <LandingContent onConsult={() => switchTab('무료상담')} onFloatChange={setShowFloat} />
          </TabPanel>
          <TabPanel active={tab === '무료상담'} id="panel-무료상담" labelledBy="tab-무료상담">
            <ConsultContent />
          </TabPanel>
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
