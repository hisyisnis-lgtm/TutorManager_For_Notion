import {
  useState,
  useEffect } from 'react';
import { Button } from '../components/shadcn/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  } from '../components/shadcn/accordion';
import {
  CalendarBlankIcon,
  ClockIcon,
  VideoCameraIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  GiftIcon,
  CreditCardIcon,
  WarningCircleIcon,
  InfoIcon,
  FileLockIcon,
  MicrophoneStageIcon,
  CaretDownIcon,
  } from '@phosphor-icons/react';
import {
  PRIMARY,
  PRIMARY_BG,
  TEXT_PRIMARY,
  TEXT_BODY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_INACTIVE,
  BORDER_DEFAULT,
  BG_SECTION_ALT,
  BG_LETTER,
  GRADIENTS } from '../constants/theme';
import FadeUp from '../components/FadeUp';
import PublicFooter from '../components/public/PublicFooter';
import FloatingCtaButton from '../components/public/FloatingCtaButton';


// 신청 폼 (구글폼)
const APPLY_FORM_URL = 'https://forms.gle/1bwL7MPjhnsdF8uz9';
const KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_jFnFn/chat';
const openApply = () => window.open(APPLY_FORM_URL, '_blank', 'noopener');

// ── 콘텐츠 데이터 (이번 7~8월 기수 한정 · 대표님 안내서 원문 유지) ──────
const HERO_CHIPS = ['주 1회 라이브', '1:1 녹음 피드백', '4~8주 완성'];

// 한눈에 보기 — 추천 대상
const RECOMMEND = [
  '기초 단어(HSK 2~4급)는 아는데, 막상 입 밖으로 말이 안 나오는 분',
  '머릿속으로 한국어를 옮기느라 말이 한 박자 느린 분',
  "외운 단어를 이제 진짜 '내 말'로 꺼내보고 싶은 분",
];

// 커리큘럼 + 월말 1:1 녹음 피드백
const CURRICULUM = [
  {
    pill: '7월', summary: '중국어 어순의 큰 틀 이해하기',
    sessions: [
      ['7/2', "‘주+술+목’ 어법 용어가 아닌, 말하기 훈련으로 중국말의 큰 틀 익히기"],
      ['7/9', '양사가 발달한 중국어의 특징을 이해하고 덩어리로 암기하는 훈련하기'],
      ['7/16', '기본 틀을 벗어난 표현들을 어법 용어가 아닌 입으로 체화하기'],
      ['7/23', '부가적인 단어들을 사용함으로써 맛깔나는 중국말 내뱉기'],
    ],
    feedback: {
      period: '7/24~31',
      desc: '7월 수업이 끝나면, 배운 팁을 적용해 연습할 엄선한 5문장을 파일로 보내드립니다! 충분히 연습한 뒤 녹음해서 [하늘하늘중국어] 채널톡으로 보내주시면, 하늘쌤이 받은 순서대로 1:1 피드백을 드립니다.',
      notes: [
        '7/31까지 보내주신 녹음에 한해 피드백 드립니다.',
        '충분히 연습한 후 하나의 파일로 보내주세요. (여러 개 보내시면 마지막 파일로 피드백 드립니다)',
        '피드백은 제공된 5문장에 한해 드립니다.',
      ],
    },
  },
  {
    pill: '8월', summary: '디테일과 뉘앙스 챙기기',
    sessions: [
      ['8/6', '한국어로는 다 같은 말로 해석되는 표현, 뉘앙스 차이 확실하게 이해하기'],
      ['8/13', '원어민들이 밥 먹듯 쓰는 표현, 중국인의 사고로 이야기하기'],
      ['8/20', '여행가서 당장 쓸 수 있는 무적의 실전 표현, 입 밖으로 나오게 훈련하기'],
      ['8/27', '강의 후에도 스스로 입을 열 수 있도록, 회화 훈련법 총정리!'],
    ],
    feedback: {
      period: '8/28~9/4',
      desc: '8월에도 동일하게 진행됩니다. 8월 수업이 끝나면 엄선한 5문장을 보내드리고, 충분히 연습한 뒤 녹음해서 [하늘하늘중국어] 채널톡으로 보내주시면 받은 순서대로 1:1 피드백을 드립니다.',
      notes: [
        '9/4까지 보내주신 녹음에 한해 피드백 드립니다.',
        '그 외 안내는 7월과 동일하게 적용됩니다.',
      ],
    },
  },
];

// 혜택 — 모두에게 제공
const BENEFIT_ALL = [
  '회차별 강의 자료 PDF (수업 PPT는 제공되지 않아요)',
  '회차별 녹화본 링크 (시청 기간은 수강 유형마다 달라요 — 아래 참고)',
  '매월 종강 후, 하늘쌤이 엄선한 5문장 1:1 발음 교정 녹음 피드백',
];
// 수강 유형별 녹화본
const RECORDING_BY_TYPE = [
  ['7월만 수강', '녹화본 총 4개, 8월 31일까지'],
  ['8월만 수강', '녹화본 총 4개, 9월 30일까지'],
];
// 7~8월 동시 등록 전용 혜택
const PACKAGE_BONUS = [
  '녹화본을 10월 말까지 여유롭게 — 휴가철로 바쁜 여름, 천천히 반복 학습하세요!',
  '8회 수업 종강 후, 하늘쌤이 직접 만든 연습문제 & 풀이본 제공',
];

// 수강료 · 결제
const PAYMENT = [
  '월 80,000원',
  '커리큘럼 확인하신 후, 7월 또는 8월만 개별 결제도 가능합니다.',
  '카드 결제만 가능합니다.',
];
// 신청 안내
const APPLY_NOTE = [
  '수업 신청 및 동의서를 작성해주신 분에 한해, 문자로 결제링크가 발송됩니다.',
  '선착순으로 마감되며, 두 달 모두 수강하실 분은 한 번에 신청하시는 걸 추천드립니다.',
];

// 수업 진행 방법
const PROCEDURE = [
  {
    phase: '개강 전', items: [
      '결제 완료 후, 개강 하루 전 6월 30일에 오픈채팅방이 개설됩니다.',
      '입장 시 본인의 중국어 이름을 한글 발음대로 표기해 주시기 바랍니다. (예: 추이티엔)',
    ],
  },
  {
    phase: '수업 당일', items: [
      '수업 시작 10분 전, 오픈채팅방으로 Zoom 링크가 발송됩니다.',
    ],
  },
  {
    phase: '수업 중', items: [
      '카메라는 켜고 참여해 주시기 바랍니다. 입모양과 참여도를 확인할 수 있어 더 꼼꼼히 봐드릴 수 있습니다. 녹화 관련 내용은 아래에서 확인 부탁드립니다.',
      '마이크는 평소 OFF로 진행됩니다. 손들기 기능을 쓰거나 하늘쌤이 발언권을 드릴 때 켜주시면 됩니다. (그룹 수업 특성상 소음 방지)',
      '수업 중 질문·호응은 Zoom 채팅창을 이용해 주시기 바랍니다.',
    ],
  },
  {
    phase: '수업 후', items: [
      '매 수업 다음 날, 오픈채팅방에 녹화본 링크가 공유됩니다.',
    ],
  },
  {
    phase: '채널 안내', items: [
      '오픈채팅방: Zoom 링크 공유 + 전체 공지용',
      '수업 중 질문: Zoom 채팅창',
      '개별 문의: 카카오 채널톡',
    ],
  },
];

// 환불 및 기타 안내사항 (아코디언)
const POLICY = [
  {
    key: 'refund', icon: CreditCardIcon, title: '환불 기준',
    items: [
      ['1회차 수업 시작 전', '전액 환불 가능합니다. (환불 요청은 채널톡으로 주시면 영업일 기준 3~5일 내 처리됩니다.)'],
      ['수업 시작 후', '이미 진행된 회차(녹화본이 발송된 회차 포함)는 환불되지 않으며, 남은 회차분만 정산됩니다. 재결제 후 기존 결제가 취소되는 방식입니다. (회당 20,000원)'],
      ['패키지(7+8월) 중 8월만 취소', '8월 1회차 시작 전까지 가능합니다. 수강한 7월분(80,000원)만 재결제 후 기존 결제가 취소됩니다.'],
      ['녹화본 시청 옵션', '녹화본 링크 발송 후에는 환불이 불가합니다.'],
      ['환불 시', '오픈채팅방에서 퇴장 처리됩니다.'],
    ],
  },
  {
    key: 'norefund', icon: WarningCircleIcon, title: '아래의 경우 환불이 불가합니다',
    items: [
      ['불참', '수업은 목요일 밤 9시에 실시간 진행되며, 불참 시 녹화본으로 복습 가능합니다. (불참에 따른 환불·연장 불가)'],
      ['통신 환경', 'Zoom 수업이니 인터넷 연결을 미리 확인해 주세요. 개인의 통신 환경 문제는 녹화본으로 복습 가능하므로 환불 사유가 되지 않습니다.'],
      ['녹음 피드백 미제출', '5문장 녹음을 기간 내 제출하지 않으신 경우, 피드백은 제공되지 않으며 환불·연장은 불가합니다.'],
      ['수업 매너', '오픈채팅방·수업 중 분위기를 해치는 언행, 홍보, 다른 수강생에 대한 무례가 있을 경우 강사 판단으로 퇴장될 수 있으며, 이 경우 환불되지 않습니다.'],
    ],
  },
  {
    key: 'nature', icon: InfoIcon, title: '수업 성격에 대한 안내',
    items: [
      ['', '본 수업은 온라인 그룹(다대일) 수업입니다. 개별 맞춤 설명·첨삭은 제공되지 않으며, 1:1 피드백은 약속된 5문장 녹음 피드백에 한합니다. 이에 동의 후 신청하신 것으로 보아, "1:1 케어 부족"을 사유로 한 환불은 불가합니다.'],
    ],
  },
  {
    key: 'privacy', icon: FileLockIcon, title: '녹화 및 개인정보',
    items: [
      ['', '수업은 녹화되며, 복습용으로 수강생에게 공유됩니다. 녹화본은 수업 자료 화면과 발표자(하늘쌤) 중심으로 저장되어, 듣고 계신 수강생의 얼굴은 화면에 거의 노출되지 않습니다. 안심하고 참여하셔도 됩니다.'],
      ['', '다만 발언권을 받아 발표하시는 순간에는 화면에 나타날 수 있습니다. 노출이 부담되신다면 카메라 각도를 조절하셔도 좋습니다.'],
      ['', '수집된 개인정보(이름·연락처 등)는 수업 운영 목적으로만 사용되며, 수업 종료 후 파기됩니다.'],
    ],
  },
  {
    key: 'material', icon: FileLockIcon, title: '자료·녹화본 이용',
    items: [
      ['', '강의 자료·녹화본은 수강생 본인의 학습용입니다. 외부 공유·재배포·캡처 배포를 금하며, 무단 유출 시 법적 책임을 질 수 있습니다.'],
      ['', '녹화본 시청 기간은 수강 유형별 안내를 따르며, 기간 종료 후 연장은 불가합니다.'],
    ],
  },
];

// ── 공통 섹션 타이틀 ───────────────────────────────────
function SectionTitle({ icon: Icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {Icon && <Icon weight="fill" size={18} style={{ color: TEXT_TERTIARY, flexShrink: 0 }} />}
      <h4 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4, margin: 0, letterSpacing: '-0.3px', textWrap: 'balance' }}>{children}</h4>
    </div>
  );
}

// 점 불릿 한 줄
function Bullet({ children, color = TEXT_SECONDARY }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: TEXT_INACTIVE, marginTop: 8, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color, lineHeight: 1.6 }}>{children}</span>
    </div>
  );
}

export default function GroupClassPage() {
  const [showFloat, setShowFloat] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const scrolledEnough = window.scrollY > 600;
      const nearBottom = window.innerHeight + window.scrollY > document.body.scrollHeight - 320;
      setShowFloat(scrolledEnough && !nearBottom);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
      <>
      <FloatingCtaButton visible={showFloat} onClick={openApply} label="참여 동의서 작성하기" />
      <style>{`
        .gc-header { -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
        .gc-cta { transition: transform 0.12s cubic-bezier(0.2,0,0,1); }
        .gc-cta:active { transform: scale(0.96); }
        .gc-inquire { transition: transform 0.12s cubic-bezier(0.2,0,0,1), color 0.15s ease; }
        .gc-inquire:hover { color: ${PRIMARY}; }
        .gc-inquire:active { transform: scale(0.97); }
      `}</style>
      <div style={{ minHeight: '100vh', backgroundColor: '#ffffff', fontFamily: 'inherit', wordBreak: 'keep-all', textWrap: 'pretty', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>

        {/* ── 로고 헤더 ── */}
        <header className="gc-header" style={{
          position: 'sticky', top: 0, zIndex: 50,
          backgroundColor: 'rgba(255,255,255,0.95)',
          borderBottom: `1px solid ${BORDER_DEFAULT}`,
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 20px' }}>
            <div style={{ height: 48, display: 'flex', alignItems: 'center' }}>
              <img src="/logo/logo-red.png" alt="하늘하늘 중국어" style={{ height: 24, objectFit: 'contain', outline: 'none' }} />
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 80 }}>

          {/* ── 히어로 (하단 라운드 없음 — 시안 일치) ── */}
          <section style={{ background: GRADIENTS.hero, padding: '44px 24px 44px' }}>
            <FadeUp delay={0}>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 980,
                padding: '5px 13px', marginBottom: 16,
              }}>
                <span style={{ fontSize: 12, color: 'white', fontWeight: 700, lineHeight: 1 }}>7~8월 온라인 회화 그룹 수업</span>
              </div>
            </FadeUp>
            <FadeUp delay={80}>
              <h1 style={{ color: 'white', fontSize: 32, fontWeight: 700, lineHeight: 1.2, margin: '0 0 14px', letterSpacing: '-0.3px', textWrap: 'balance' }}>
                말할 줄 알아야<br />진짜 아는 언어지!
              </h1>
            </FadeUp>
            <FadeUp delay={160}>
              <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 1.65, margin: '0 0 22px', textWrap: 'pretty' }}>
                단어장 씹어 먹고 HSK 땄는데, 막상 원어민 앞에서는 머리가 하얘지나요? 한국어를 중국어로 1:1 번역하는 ‘직역 습관’, 이제 끊어낼 시간입니다.
              </p>
            </FadeUp>
            <FadeUp delay={240}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {HERO_CHIPS.map(c => (
                  <div key={c} style={{
                    display: 'inline-flex', alignItems: 'center',
                    border: '1px solid rgba(255,255,255,0.4)', borderRadius: 980,
                    padding: '5px 14px',
                  }}>
                    <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.92)', fontWeight: 600, lineHeight: 1 }}>{c}</span>
                  </div>
                ))}
              </div>
            </FadeUp>
          </section>

          {/* ── 한눈에 보기 ── */}
          <section style={{ padding: '28px 24px 24px' }}>
            <FadeUp><SectionTitle>한눈에 보기</SectionTitle></FadeUp>

            {/* 수강료 + 개강/시간 스탯 */}
            <FadeUp>
              <div style={{ background: BG_SECTION_ALT, borderRadius: 16, padding: 20 }}>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY, display: 'block', marginBottom: 4 }}>월 수강료</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 18 }}>
                  <span className="tabular-nums" style={{ fontSize: 34, fontWeight: 700, color: TEXT_BODY, lineHeight: 1.1 }}>80,000</span>
                  <span style={{ fontSize: 15, color: TEXT_SECONDARY, fontWeight: 600 }}>원 / 월</span>
                </div>
                <div style={{ height: 1, background: BORDER_DEFAULT, marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 16 }}>
                  {[
                    { icon: CalendarBlankIcon, label: '개강', value: '7/2 · 8/6' },
                    { icon: ClockIcon, label: '수업', value: '목 21:00' },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                        <Icon weight="fill" size={14} style={{ color: TEXT_TERTIARY }} />
                        <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>{label}</span>
                      </div>
                      <span className="tabular-nums" style={{ fontSize: 17, fontWeight: 700, color: TEXT_BODY }}>{value}</span>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 12.5, color: TEXT_TERTIARY, display: 'block', marginTop: 14 }}>온라인 그룹(Zoom) · 매주 목 저녁 9시 · 월 4회 · 회당 50분</span>
              </div>
            </FadeUp>

            {/* 추천 대상 */}
            <FadeUp delay={80}>
              <div style={{ marginTop: 18 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, display: 'block', marginBottom: 10 }}>이런 분께 추천해요</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {RECOMMEND.map(r => (
                    <div key={r} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <CheckCircleIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13.5, color: TEXT_BODY, lineHeight: 1.55 }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeUp>

            <FadeUp delay={140}>
              <span style={{ fontSize: 12.5, color: TEXT_TERTIARY, display: 'block', marginTop: 16, lineHeight: 1.6 }}>
                모든 회차 수업은 복습을 위한 녹화본이 일정 기간 제공됩니다. 상세 커리큘럼과 추가 혜택은 아래에서 확인해 주세요.
              </span>
            </FadeUp>
          </section>

          {/* ── 커리큘럼 (회색 밴드) ── */}
          <section style={{ background: BG_SECTION_ALT, padding: '32px 24px' }}>
            <FadeUp><SectionTitle>입이 트이는 8주, 이렇게 진행됩니다</SectionTitle></FadeUp>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {CURRICULUM.map((m, i) => (
                <FadeUp key={m.pill} delay={i * 80}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span style={{ backgroundColor: PRIMARY, color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 980, padding: '4px 10px' }}>{m.pill}</span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY }}>{m.summary}</span>
                    </div>
                    <div style={{ height: 1, background: BORDER_DEFAULT, marginBottom: 12 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {m.sessions.map(([d, desc]) => (
                        <div key={d} style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                          <span className="tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: PRIMARY, width: 36, flexShrink: 0, marginTop: 1 }}>{d}</span>
                          <span style={{ fontSize: 13, color: TEXT_BODY, lineHeight: 1.5 }}>{desc}</span>
                        </div>
                      ))}
                    </div>

                    {/* 월말 1:1 녹음 피드백 — 회색 밴드 위 흰 카드로 강조 */}
                    <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginTop: 14, boxShadow: 'var(--shadow-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                        <MicrophoneStageIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: 13.5, color: TEXT_BODY }}>1:1 녹음 피드백</span>
                        <span className="tabular-nums" style={{ fontWeight: 600, fontSize: 12, color: PRIMARY, marginLeft: 'auto', flexShrink: 0 }}>{m.feedback.period}</span>
                      </div>
                      <span style={{ fontSize: 12.5, color: TEXT_SECONDARY, display: 'block', lineHeight: 1.7, marginBottom: 14 }}>{m.feedback.desc}</span>
                      <span style={{ fontWeight: 600, fontSize: 11.5, color: PRIMARY, display: 'block', marginBottom: 9, letterSpacing: '-0.2px' }}>보내실 때 꼭 확인해주세요</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {m.feedback.notes.map(n => (
                          <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ width: 3, height: 3, borderRadius: '50%', background: PRIMARY, marginTop: 7, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{n}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </FadeUp>
              ))}
            </div>
          </section>

          {/* ── 혜택 ── */}
          <section style={{ padding: '28px 24px 24px' }}>
            <FadeUp><SectionTitle icon={GiftIcon}>혜택 들여다보기</SectionTitle></FadeUp>

            {/* 모두에게 제공 */}
            <FadeUp delay={60}>
              <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, display: 'block', marginBottom: 10 }}>모두에게 제공돼요</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {BENEFIT_ALL.map(b => (
                  <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <CheckCircleIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 13.5, color: TEXT_BODY, lineHeight: 1.55 }}>{b}</span>
                  </div>
                ))}
              </div>
            </FadeUp>

            {/* 수강 유형별 녹화본 */}
            <FadeUp delay={100}>
              <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, display: 'block', marginBottom: 10 }}>수강 유형별 녹화본</span>
              <div style={{ background: BG_SECTION_ALT, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {RECORDING_BY_TYPE.map(([t, v]) => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: TEXT_BODY, flexShrink: 0 }}>{t}</span>
                      <span className="tabular-nums" style={{ fontSize: 12.5, color: TEXT_SECONDARY, textAlign: 'right' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeUp>

            {/* 동시 등록 전용 혜택 */}
            <FadeUp delay={140}>
              <div style={{ background: PRIMARY_BG, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                  <GiftIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_BODY }}>7~8월 동시 등록 전용 혜택</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PACKAGE_BONUS.map(b => (
                    <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: PRIMARY, marginTop: 8, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: TEXT_BODY, lineHeight: 1.6 }}>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeUp>
          </section>

          {/* ── 수강료 · 결제 · 신청 안내 (회색 밴드) ── */}
          <section style={{ background: BG_SECTION_ALT, padding: '32px 24px' }}>
            <FadeUp><SectionTitle icon={CreditCardIcon}>수강료 · 신청 안내</SectionTitle></FadeUp>
            <FadeUp delay={60}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 18 }}>
                {PAYMENT.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: TEXT_INACTIVE, marginTop: 7, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: TEXT_BODY, lineHeight: 1.55 }}>{p}</span>
                  </div>
                ))}
              </div>
            </FadeUp>
            <FadeUp delay={100}>
              <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {APPLY_NOTE.map(n => (
                    <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <InfoIcon weight="fill" size={16} style={{ color: TEXT_TERTIARY, flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeUp>
          </section>

          {/* ── 수업 진행 방법 ── */}
          <section style={{ padding: '28px 24px 24px' }}>
            <FadeUp><SectionTitle icon={VideoCameraIcon}>수업 진행 방법</SectionTitle></FadeUp>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {PROCEDURE.map((p, i) => (
                <FadeUp key={p.phase} delay={i * 50}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 700, color: PRIMARY, background: PRIMARY_BG, borderRadius: 980, padding: '3px 9px' }}>{p.phase}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {p.items.map(it => <Bullet key={it}>{it}</Bullet>)}
                    </div>
                  </div>
                </FadeUp>
              ))}
            </div>
          </section>

          {/* ── 환불 및 기타 안내사항 (회색 밴드 + 안심 + 아코디언) ── */}
          <section style={{ background: BG_SECTION_ALT, padding: '32px 24px' }}>
            <FadeUp><SectionTitle icon={ShieldCheckIcon}>환불 및 기타 안내사항</SectionTitle></FadeUp>
            <FadeUp delay={60}>
              <div style={{ background: PRIMARY_BG, borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheckIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: TEXT_BODY }}>1회차 수업 시작 전이면 전액 환불돼요</span>
                </div>
              </div>
            </FadeUp>
            <FadeUp delay={120}>
              <Accordion type="single" collapsible defaultValue="refund" className="w-full">
                {POLICY.map(({ key, title, items }) => (
                  <AccordionItem
                    key={key}
                    value={key}
                    className="mb-2.5 overflow-hidden rounded-lg border-0 bg-card shadow-[shadow:var(--shadow-border)]"
                  >
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_BODY }}>{title}</span>
                    </AccordionTrigger>
                    <AccordionContent className="px-4">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {items.map(([label, value], i) => (
                          <div key={i}>
                            {label && <span style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY, display: 'block', marginBottom: 2 }}>{label}</span>}
                            <span style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </FadeUp>
          </section>

          {/* ── 하늘쌤의 편지 (대표님 원문 그대로) ── */}
          <section style={{ padding: '28px 24px 24px' }}>
            <FadeUp>
              <div style={{ background: BG_LETTER, borderRadius: 16, padding: '24px 22px', boxShadow: 'var(--shadow-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <img src="/img/profile.jpg" alt="하늘쌤" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', objectPosition: 'center top', flexShrink: 0, boxShadow: '0 0 0 1px rgba(0,0,0,0.06)' }} />
                  <span style={{ fontWeight: 600, fontSize: 15, color: TEXT_PRIMARY }}>하늘쌤의 편지</span>
                </div>
                <span style={{ fontSize: 14, color: TEXT_BODY, fontWeight: 600, display: 'block', marginBottom: 14, lineHeight: 1.6 }}>
                  끝까지 읽어주셔서 감사합니다.
                </span>
                <p style={{ fontSize: 14, color: TEXT_BODY, lineHeight: 1.95, margin: 0, textWrap: 'pretty' }}>
                  단어는 충분히 알고 계세요. 이제 그 단어들을 입 밖으로 꺼내는 일만 남았습니다. 그 길을 함께 걸어가며, 여러분의 입이 트이는 순간을 만들어가겠습니다.
                  <br /><br />
                  8주 동안 잘 부탁드립니다!
                </p>
                <div style={{ textAlign: 'right', marginTop: 22 }}>
                  <span style={{ fontSize: 15, color: TEXT_PRIMARY, fontWeight: 700 }}>하늘쌤 드림</span>
                </div>
              </div>
            </FadeUp>
          </section>

          {/* ── CTA ── */}
          <FadeUp delay={60}>
            <section style={{ padding: '24px 24px 36px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheckIcon weight="fill" size={16} style={{ color: PRIMARY, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>
                    첫 수업 전이면 <span style={{ fontWeight: 600, color: TEXT_BODY }}>100% 환불</span> · 선착순 마감
                  </span>
                </div>
                <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>참여 동의서 작성 → 문자로 결제 안내를 드려요</span>
              </div>
              {/* antd 시절 href prop 잔재로 무동작이던 버튼(2026-08-30 검수) —
                  플로팅 CTA와 같은 openApply 핸들러로 통일 */}
              <Button
                block
                onClick={openApply}
                className="gc-cta"
                style={{ height: 48, borderRadius: 12, fontWeight: 700, fontSize: 15, marginBottom: 8 }}
              >
                참여 동의서 작성하기
              </Button>
              <a
                className="gc-inquire"
                href={KAKAO_CHANNEL_URL}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', textAlign: 'center', fontSize: 13, color: TEXT_SECONDARY, textDecoration: 'none', padding: '10px 0' }}
              >
                채널톡으로 문의하기 →
              </a>
            </section>
          </FadeUp>
        </main>

        <PublicFooter />
      </div>
      </>
  );
}
