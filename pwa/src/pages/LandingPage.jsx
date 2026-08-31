import { useState } from 'react';

import { Button } from '../components/shadcn/button';
import { Card,
  CardContent } from '../components/shadcn/card';
import { Input } from '../components/shadcn/input';
import { Textarea } from '../components/shadcn/textarea';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { useLocation } from 'react-router-dom';
import { submitConsultation } from '../api/consultApi';
import {
  PRIMARY,
  STATUS_SUCCESS,
  STATUS_SUCCESS_BG,
  STATUS_ERROR_BG,
  STATUS_ERROR_BORDER,
  STATUS_ERROR_TEXT,
  TEXT_INACTIVE,
  BORDER_NEUTRAL,
  TEXT_TERTIARY,
  TEXT_BODY,
  BORDER_SUBTLE } from '../constants/theme';
import TabPanel from '../components/TabPanel';
import IntroContent from '../components/IntroContent';
import PublicHeader from '../components/public/PublicHeader';
import PublicFooter from '../components/public/PublicFooter';
import FloatingCtaButton from '../components/public/FloatingCtaButton';
import ToggleButton from '../components/ui/ToggleButton';


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
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <Card className="rounded-2xl">
<CardContent className="p-6">
          <div style={{ padding: '20px 0' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              backgroundColor: STATUS_SUCCESS_BG, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 24, color: STATUS_SUCCESS,
            }}>
              <CheckCircleIcon weight="fill" />
            </div>
            <h4 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginBottom: 8 }}>신청 완료!</h4>
            <span style={{ color: TEXT_TERTIARY, fontSize: 14, lineHeight: 1.6 }}>
              신청해주셔서 감사합니다.<br />확인 후 문자로 연락드릴게요.
            </span>
            <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: '20px 0 16px' }} />
            <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 10 }}>
              더 빨리 연락받고 싶다면
            </span>
            <span style={{ color: TEXT_TERTIARY, fontSize: 13, lineHeight: 1.7, display: 'block', marginBottom: 14 }}>
              채널톡으로 신청 완료 메시지를 보내주시면<br />우선적으로 확인해드릴게요.
            </span>
            <Button
              asChild
              size="lg" block
              className="text-[15px] font-bold"
              style={{ backgroundColor: '#FEE500', borderColor: '#FEE500', color: '#000' }}
            >
              <a href="https://pf.kakao.com/_jFnFn" target="_blank" rel="noopener noreferrer">
                채널톡으로 알리기
              </a>
            </Button>
          </div>
        </CardContent>
</Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>무료 상담 신청</h4>
        <span style={{ color: TEXT_TERTIARY }}>Zoom 화상통화 30분 · 완전 무료</span>
      </div>

      {/* 상담 혜택 */}
      <Card className="rounded-2xl" style={{ marginBottom: 24 }}>
<CardContent className="p-6">
        <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 12 }}>상담에서 해드리는 것</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {[
            '현재 수준 진단 (입문~초중급)',
            '회화 실력이 안 느는 이유 찾기',
            '발음 교정 포인트 체크',
            '나에게 맞는 학습 방향 제안',
          ].map(item => (
            <span key={item} style={{ display: 'inline-flex', gap: 10 }}>
              <CheckCircleIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0 }} />
              <span style={{ fontSize: 14 }}>{item}</span>
            </span>
          ))}
        </div>
        <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: '16px 0 12px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: TEXT_TERTIARY, fontSize: 13 }}>· 신청 후 문자로 일정을 안내해드려요</span>
          <span style={{ color: TEXT_TERTIARY, fontSize: 13 }}>· 완전 무료, 부담 없이 신청하세요</span>
        </div>
      </CardContent>
</Card>

      {/* 폼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <label style={{ display: 'block', fontSize: 14, color: TEXT_BODY, marginBottom: 8 }}><span>이름 <span style={{ color: PRIMARY }}>*</span></span></label>
          <Input
            value={name} onChange={e => { setName(e.target.value); if (error) setError(''); }}
            placeholder="홍길동" size="large" autoComplete="name"
            style={{ borderRadius: 12 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, color: TEXT_BODY, marginBottom: 8 }}><span>전화번호 <span style={{ color: PRIMARY }}>*</span></span></label>
          <Input
            type="tel" value={phone}
            onChange={e => { setPhone(formatPhone(e.target.value)); if (error) setError(''); }}
            placeholder="010-0000-0000" size="large"
            inputMode="numeric" autoComplete="tel"
            style={{ borderRadius: 12 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, color: TEXT_BODY, marginBottom: 8 }}><span>카카오톡 ID <span style={{ color: TEXT_TERTIARY, fontSize: 13, fontWeight: 400 }}>(선택)</span></span></label>
          <Input
            value={kakaoId} onChange={e => setKakaoId(e.target.value)}
            placeholder="kakao_id" size="large"
            autoComplete="off" autoCorrect="off" autoCapitalize="off"
          />
          <span style={{ color: TEXT_TERTIARY, fontSize: 12, display: 'block', marginTop: 4 }}>
            카카오톡 설정 → 계정 → 계정 정보 → 아이디
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, color: TEXT_BODY, marginBottom: 8 }}>현재 중국어 수준</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            {LEVEL_OPTIONS.map(opt => (
              <ToggleButton
                key={opt} label={opt}
                selected={level === opt}
                onClick={() => setLevel(prev => prev === opt ? '' : opt)}
                fullWidth
              />
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 14, color: TEXT_BODY, marginBottom: 8 }}><span>상담 희망 내용 <span style={{ color: TEXT_TERTIARY, fontSize: 13, fontWeight: 400 }}>(선택)</span></span></label>
          <Textarea
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="궁금한 점이나 학습 목표를 자유롭게 적어주세요."
            rows={3}
          />
        </div>

        {error && (
          <div style={{
            marginBottom: 20, padding: '12px 16px',
            backgroundColor: STATUS_ERROR_BG, border: `1px solid ${STATUS_ERROR_BORDER}`,
            borderRadius: 12, fontSize: 14, color: STATUS_ERROR_TEXT,
          }}>
            {error}
          </div>
        )}

        <Button
          loading={loading}
          onClick={handleSubmit} block
          style={{ height: 52, borderRadius: 12, fontWeight: 700, fontSize: 15 }}
        >
          무료 상담 신청하기
        </Button>
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
      className="transition-[background-color,color] duration-150 ease-out"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        border: `1px solid ${BORDER_NEUTRAL}`, borderRadius: 20,
        background: 'none', cursor: 'pointer',
        padding: '5px 12px',
        fontSize: 12, fontWeight: 600, color: TEXT_INACTIVE,
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
      <>
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
      </>
  );
}
