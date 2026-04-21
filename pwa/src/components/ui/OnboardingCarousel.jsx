import { useState, useRef, useCallback, useEffect } from 'react';
import { Fragment } from 'react';
import { CalendarBlankIcon, ClipboardTextIcon, CaretRightIcon } from '@phosphor-icons/react';

export const ONBOARDING_KEY = 'onboarding_v1_done';

const SLIDES = [
  {
    id: 'welcome',
    type: 'logo',
    theme: 'brand',
    zoneBg: 'linear-gradient(160deg, #6b0004 0%, #9a0007 100%)',
    tag: '환영해요',
    title: '하늘하늘중국어\n학생 앱이에요',
    desc: '수업 일정, 숙제, 팬더 키우기까지\n모두 여기서 확인할 수 있어요.',
  },
  {
    id: 'classes',
    type: 'icon',
    theme: 'light',
    Icon: CalendarBlankIcon,
    tag: '내 수업',
    title: '수업 일정을\n한눈에 확인해요',
    desc: '예정된 수업과 완료된 수업을 볼 수 있어요.\n수업 취소도 여기서 가능해요.',
  },
  {
    id: 'homework',
    type: 'icon',
    theme: 'light',
    Icon: ClipboardTextIcon,
    tag: '숙제',
    title: '숙제를 제출하고\n피드백을 받아요',
    desc: '파일을 업로드해 숙제를 제출하면\n선생님이 직접 피드백을 남겨줘요.',
  },
  {
    id: 'panda',
    type: 'panda',
    theme: 'light',
    pandaImg: '/panda/Cha_Panda_Step_03.svg',
    tag: '팬더',
    title: '수업을 들을수록\n팬더가 자라요',
    desc: '수업을 완료하면 팬더에게 먹이를 줄 수 있어요.\n마스터 팬더가 될 때까지 함께해요!',
  },
];

// light theme 슬라이드의 상단 비주얼존 고정 높이
const ZONE_HEIGHT = 256;

// 모든 light 슬라이드가 공유하는 단일 배경 — "슬라이드마다 다른 색" 패턴 제거
const ZONE_BG = '#F7F5F3';

export default function OnboardingCarousel({ onDone }) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef(null);
  // 슬라이드별 진입 횟수 — 키가 바뀌면 Fragment 자식이 리마운트돼
  // stagger 애니메이션이 재실행된다.
  const visitCounts = useRef(SLIDES.map(() => 0));
  const isLast = current === SLIDES.length - 1;
  // 슬라이드 1(brand)은 어두운 배경 → 버튼·도트·skip 색상을 흰색 계열로 전환
  const isOnDark = current === 0;

  // 캐러셀이 열려 있는 동안 body 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const finish = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    onDone();
  }, [onDone]);

  const advance = useCallback((nextIdx) => {
    visitCounts.current[nextIdx]++;
    setCurrent(nextIdx);
  }, []);

  const next = useCallback(() => {
    if (isLast) finish();
    else advance(current + 1);
  }, [isLast, current, finish, advance]);

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (diff > 60 && current < SLIDES.length - 1) advance(current + 1);
    if (diff < -60 && current > 0) advance(current - 1);
    touchStartX.current = null;
  }, [current, advance]);

  // 도트 인디케이터 — 컴포넌트가 아닌 JSX 변수로 정의해
  // render 내부 컴포넌트 정의로 인한 unmount/remount 버그를 방지한다.
  const dots = (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
      {SLIDES.map((_, i) => (
        <button
          key={i}
          aria-label={`${i + 1}번째 슬라이드`}
          aria-pressed={i === current}
          onClick={() => advance(i)}
          style={{
            minWidth: 44, minHeight: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{
            width: i === current ? 24 : 8, height: 8,
            borderRadius: 4,
            background: isOnDark
              ? (i === current ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)')
              : (i === current ? '#7f0005' : '#e0e0e0'),
            transitionProperty: 'width, background-color',
            transitionDuration: '0.28s',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }} />
        </button>
      ))}
    </div>
  );

  return (
    <>
      <style>{`
        .onboarding-backdrop {
          position: fixed; inset: 0; z-index: 1000;
          display: flex; align-items: center; justify-content: center;
        }
        .onboarding-card {
          position: relative;
          width: 100%; height: 100dvh;
          display: flex; flex-direction: column;
          overflow: hidden;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          user-select: none;
        }
        @media (min-width: 600px) {
          .onboarding-backdrop {
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }
          .onboarding-card {
            max-width: 480px;
            height: min(720px, 90dvh);
            border-radius: 24px;
            box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
          }
        }

        /* onboarding 전용 stagger — blur 포함 (전역 fadeInUp override) */
        .onboarding-card .stagger-item {
          opacity: 0;
          transform: translateY(14px);
          filter: blur(6px);
          animation: obFadeIn 440ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes obFadeIn {
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}</style>

      <div
        className="onboarding-backdrop"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/*
          카드 배경색을 슬라이드에 따라 전환 —
          brand 슬라이드(dark red) ↔ light 슬라이드(white)가 부드럽게 크로스페이드됨.
          bottom-controls 영역이 transparent이므로 카드 배경이 비쳐 보인다.
        */}
        <div
          className="onboarding-card"
          style={{
            backgroundColor: isOnDark ? '#6b0004' : '#ffffff',
            transitionProperty: 'background-color',
            transitionDuration: '0.40s',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >

          {/* 건너뛰기 */}
          {!isLast && (
            <button
              onClick={finish}
              style={{
                position: 'absolute', top: 12, right: 16, zIndex: 10,
                background: 'none', border: 'none',
                fontSize: 14,
                color: isOnDark ? 'rgba(255,255,255,0.6)' : '#9ca3af',
                fontWeight: 500,
                cursor: 'pointer',
                minWidth: 44, minHeight: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
                letterSpacing: '0.01em',
                transition: 'color 0.20s ease-out, transform 150ms ease-out',
              }}
            >
              건너뛰기
            </button>
          )}

          {/* 슬라이드 트랙 */}
          <div style={{
            flex: 1,
            display: 'flex',
            transform: `translateX(${-current * (100 / SLIDES.length)}%)`,
            transitionProperty: 'transform',
            transitionDuration: '0.40s',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
            width: `${SLIDES.length * 100}%`,
            willChange: 'transform',
            minHeight: 0,
          }}>
            {SLIDES.map((slide, idx) => (
              <div
                key={slide.id}
                style={{
                  width: `${100 / SLIDES.length}%`,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {slide.theme === 'brand' ? (

                  /* ════════════════════════════════════════════
                     Brand 슬라이드 — 전체가 딥레드 배경.
                     로고(white) + 흰색 텍스트로 HeroSection 분위기.
                     ════════════════════════════════════════════ */
                  <div style={{
                    flex: 1,
                    background: slide.zoneBg,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '80px 28px 32px',
                  }}>
                    <Fragment key={`${slide.id}-v${visitCounts.current[idx]}`}>
                      {/* 로고 심볼 (흰색) */}
                      <div
                        className="stagger-item"
                        style={{ marginBottom: 40, animationDelay: '0ms' }}
                      >
                        <img
                          src="/logo/symbol-white.png"
                          alt="하늘하늘중국어"
                          width={112}
                          height={112}
                          style={{
                            display: 'block',
                            objectFit: 'contain',
                            filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.20))',
                          }}
                        />
                      </div>

                      {/* 태그 — pill 제거, 간결한 uppercase 라벨 */}
                      <div
                        className="stagger-item"
                        style={{
                          color: 'rgba(255,255,255,0.65)',
                          fontSize: 13, fontWeight: 600,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          marginBottom: 14,
                          animationDelay: '80ms',
                        }}
                      >
                        {slide.tag}
                      </div>

                      {/* 제목 — brand 슬라이드는 36px로 최대 임팩트 */}
                      <h2
                        className="stagger-item"
                        style={{
                          fontSize: 36, fontWeight: 700,
                          color: '#ffffff',
                          textAlign: 'left', lineHeight: 1.15,
                          margin: '0 0 16px',
                          letterSpacing: '-0.8px',
                          whiteSpace: 'pre-line',
                          textWrap: 'balance',
                          animationDelay: '160ms',
                        }}
                      >
                        {slide.title}
                      </h2>

                      {/* 설명 */}
                      <p
                        className="stagger-item"
                        style={{
                          fontSize: 14, fontWeight: 400,
                          color: 'rgba(255,255,255,0.80)',
                          textAlign: 'left', lineHeight: 1.72,
                          margin: 0,
                          whiteSpace: 'pre-line',
                          textWrap: 'pretty',
                          animationDelay: '240ms',
                        }}
                      >
                        {slide.desc}
                      </p>
                    </Fragment>
                  </div>

                ) : (

                  /* ════════════════════════════════════════════
                     Light 슬라이드 — 상단 컬러존 + 하단 흰색존 2단 구조.
                     ════════════════════════════════════════════ */
                  <>
                    {/* 상단: 비주얼존 — 모든 light 슬라이드가 같은 배경 */}
                    <div style={{
                      height: ZONE_HEIGHT,
                      background: ZONE_BG,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Fragment key={`${slide.id}-v${visitCounts.current[idx]}`}>
                        <div
                          className="stagger-item"
                          style={{ animationDelay: '0ms' }}
                        >
                          {slide.type === 'icon' ? (
                            /*
                              카드 박스 제거 — 아이콘을 직접 노출.
                              컨테이너 없이 drop-shadow만으로 깊이감을 표현.
                            */
                            <slide.Icon
                              size={80}
                              weight="fill"
                              color="#7f0005"
                              style={{ filter: 'drop-shadow(0 6px 20px rgba(127,0,5,0.18))' }}
                            />
                          ) : (
                            /* 팬더 — 비주얼존을 가득 채우는 크기, panda-float 루프 */
                            <img
                              src={slide.pandaImg}
                              alt=""
                              width={210}
                              height={210}
                              style={{
                                display: 'block',
                                animationName: 'panda-float',
                                animationDuration: '3s',
                                animationTimingFunction: 'ease-in-out',
                                animationIterationCount: 'infinite',
                              }}
                            />
                          )}
                        </div>
                      </Fragment>
                    </div>

                    {/* 하단: 흰색 텍스트존 */}
                    <div style={{
                      flex: 1,
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '24px 28px 16px',
                      minHeight: 0,
                    }}>
                      <Fragment key={`${slide.id}-text-v${visitCounts.current[idx]}`}>
                        {/* 태그 — pill 제거, 간결한 uppercase 라벨 */}
                        <div
                          className="stagger-item"
                          style={{
                            color: '#7f0005',
                            fontSize: 11, fontWeight: 500,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            marginBottom: 12,
                            animationDelay: '60ms',
                          }}
                        >
                          {slide.tag}
                        </div>

                        {/* 제목 */}
                        <h2
                          className="stagger-item"
                          style={{
                            fontSize: 30, fontWeight: 700, color: '#1d1d1f',
                            textAlign: 'left', lineHeight: 1.18,
                            margin: '0 0 12px',
                            letterSpacing: '-0.6px',
                            whiteSpace: 'pre-line',
                            textWrap: 'balance',
                            animationDelay: '140ms',
                          }}
                        >
                          {slide.title}
                        </h2>

                        {/* 설명 */}
                        <p
                          className="stagger-item"
                          style={{
                            fontSize: 14, fontWeight: 400, color: '#595959',
                            textAlign: 'left', lineHeight: 1.7,
                            margin: 0,
                            whiteSpace: 'pre-line',
                            textWrap: 'pretty',
                            animationDelay: '220ms',
                          }}
                        >
                          {slide.desc}
                        </p>
                      </Fragment>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* ──────────────────────────────────────────────────
              하단 컨트롤 — 슬라이드 트랙 밖에 고정.
              배경 transparent → 카드 bg(dark/white)가 비쳐 테마에 자동 동기화됨.
              도트 가운데 정렬 + 풀너비 버튼 (레이아웃 항상 동일).
              ────────────────────────────────────────────────── */}
          <div style={{
            paddingTop: 10,
            paddingBottom: 'max(32px, calc(env(safe-area-inset-bottom) + 24px))',
            paddingLeft: 24,
            paddingRight: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}>
            {/* 도트 인디케이터 — 가운데 정렬 */}
            {dots}

            {/* 다음/시작하기 버튼 — 풀너비, 테마에 따라 스타일 전환 */}
            <button
              onClick={next}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 14,
                background: isOnDark
                  ? '#ffffff'
                  : 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)',
                border: 'none',
                color: isOnDark ? '#7f0005' : '#ffffff',
                fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: isOnDark
                  ? '0 4px 16px rgba(0,0,0,0.18)'
                  : '0 4px 16px rgba(127,0,5,0.25)',
                transition: 'background 0.30s ease-out, color 0.30s ease-out, box-shadow 0.30s ease-out, transform 150ms ease-out',
                letterSpacing: '0.01em',
              }}
            >
              {isLast ? '시작하기' : '다음'}
              <CaretRightIcon size={20} weight="fill" />
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
