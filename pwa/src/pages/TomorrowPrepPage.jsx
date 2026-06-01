import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { CaretLeftIcon, CaretRightIcon, CaretDownIcon, DownloadSimpleIcon, NotePencilIcon, ImageIcon, StackIcon, ClockIcon, MapPinIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Dropdown } from 'antd';
import useEmblaCarousel from 'embla-carousel-react';
import { domToPng } from 'modern-screenshot';
import { useData } from '../context/DataContext.jsx';
import { queryPage, getPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { parseLessonLog } from '../api/lessonLogs.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { stripEmoji } from '../utils/stringUtils.js';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY,
  BG_CARD, BORDER_SUBTLE, BORDER_NEUTRAL,
} from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';

const KST = 'Asia/Seoul';
const pad = (n) => String(n).padStart(2, '0');

/** KST 기준 내일 "YYYY-MM-DD" */
function getKSTTomorrowStr() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
  const [y, m, d] = todayStr.split('-').map(Number);
  const t = new Date(y, m - 1, d + 1);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** ISO → "M/D(요일)" */
function fmtDateOnly(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', {
    timeZone: KST, month: 'numeric', day: 'numeric', weekday: 'short',
  });
}

/** ISO → "HH:MM" */
function fmtTimeOnly(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', {
    timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function TomorrowPrepPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { studentNameMap } = useData();
  const [slides, setSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Embla 캐러셀 (드래그·스냅·끝 러버밴드·마우스+터치 모두 처리)
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start', containScroll: false });
  const [index, setIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const cardRefs = useRef([]);    // off-screen 각 카드 (단일 저장 캡처 대상)
  const batchRef = useRef(null);  // off-screen 합본 (일괄 저장)

  const tomorrowStr = getKSTTomorrowStr();

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setIndex(emblaApi.selectedScrollSnap());
    setCanPrev(emblaApi.canScrollPrev());
    setCanNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  // 슬라이드 로드/변경 시 Embla 재초기화
  useEffect(() => {
    if (emblaApi) emblaApi.reInit();
  }, [emblaApi, slides.length]);

  const load = async () => {
    setLoading(true);
    try {
      // 1. 내일 수업 조회 (취소 제외, 시간순)
      const data = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '수업 일시', date: { on_or_after: `${tomorrowStr}T00:00:00+09:00` } },
            { property: '수업 일시', date: { on_or_before: `${tomorrowStr}T23:59:59+09:00` } },
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
          ],
        },
        [{ property: '수업 일시', direction: 'ascending' }],
        undefined,
        50
      );
      const tomorrowClasses = (data?.results ?? []).map(parseClass);

      // 2. 학생별로 내일 수업 묶기 (2:1이면 학생마다, 중복 학생은 1슬라이드)
      const byStudent = new Map(); // studentId -> classes[]
      for (const cls of tomorrowClasses) {
        for (const sid of cls.studentIds) {
          if (!byStudent.has(sid)) byStudent.set(sid, []);
          byStudent.get(sid).push(cls);
        }
      }

      // 첫 수업 시간 순으로 학생 정렬
      const studentEntries = [...byStudent.entries()].sort((a, b) => {
        const ta = a[1][0]?.datetime ?? '';
        const tb = b[1][0]?.datetime ?? '';
        return ta.localeCompare(tb);
      });

      // 3. 학생별 직전 완료 수업 일지 병렬 조회
      const built = await Promise.all(
        studentEntries.map(async ([sid, classes]) => {
          const name = stripEmoji(studentNameMap[sid] || '') || '학생';
          let prevLog = null;
          let prevClassDate = null;
          try {
            const prevData = await queryPage(
              CLASSES_DB,
              {
                and: [
                  { property: '학생', relation: { contains: sid } },
                  { property: '수업 일시', date: { before: new Date().toISOString() } },
                  { property: '수업 일지', relation: { is_not_empty: true } },
                  { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
                ],
              },
              [{ property: '수업 일시', direction: 'descending' }],
              undefined,
              1
            );
            const prevPage = (prevData?.results ?? [])[0];
            if (prevPage) {
              const prevClass = parseClass(prevPage);
              prevClassDate = prevClass.datetime;
              const logId = prevClass.lessonLogIds?.[0];
              if (logId) {
                const logPage = await getPage(logId);
                prevLog = parseLessonLog(logPage);
              }
            }
          } catch (e) {
            console.error('[내일 수업 준비] 직전 일지 로드 오류', name, e);
          }
          return { studentId: sid, studentName: name, classes, prevLog, prevClassDate };
        })
      );

      setSlides(built);
    } catch (e) {
      console.error('[내일 수업 준비] 불러오기 오류', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 이 페이지가 마운트된 동안 페이지 세로 스크롤을 완전히 제거.
  // ① page-container를 실제 화면 높이(dvh)에 고정 (모바일 100vh > 보이는 높이 + pb-24 넘침 방지)
  // ② iOS Safari는 div의 overflow:hidden만으로 페이지 스크롤이 안 막히므로 body 자체를 position:fixed로 잠금.
  useEffect(() => {
    const el = document.querySelector('.page-container');
    el?.classList.add('page-fixed-viewport');

    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position, top: body.style.top,
      left: body.style.left, right: body.style.right,
      width: body.style.width, overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      el?.classList.remove('page-fixed-viewport');
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const triggerDownload = (dataUrl, filename) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  // 이 일지만 저장 (현재 슬라이드 — 내용 맞춤 off-screen 카드 캡처)
  const handleDownloadOne = async () => {
    const node = cardRefs.current[index];
    if (!node || downloading) return;
    setDownloading(true);
    try {
      const dataUrl = await domToPng(node, { scale: 2, backgroundColor: BG_CARD });
      const slide = slides[index];
      const dateTag = slide?.classes?.[0]?.datetime
        ? new Date(slide.classes[0].datetime).toLocaleDateString('en-CA', { timeZone: KST }).slice(5)
        : tomorrowStr.slice(5);
      triggerDownload(dataUrl, `${slide?.studentName || '학생'}_${dateTag}.png`);
      message.success('일지 이미지를 저장했어요');
    } catch (e) {
      console.error('[내일 수업 준비] 단일 캡처 오류', e);
      message.error('이미지 저장에 실패했어요');
    } finally {
      setDownloading(false);
    }
  };

  // 일괄 저장 (전체를 세로로 이어붙인 합본 1장)
  const handleDownloadAll = async () => {
    if (!batchRef.current || downloading) return;
    setDownloading(true);
    try {
      const dataUrl = await domToPng(batchRef.current, { scale: 2, backgroundColor: BG_CARD });
      triggerDownload(dataUrl, `내일수업준비_${tomorrowStr.slice(5)}.png`);
      message.success(`전체 ${slides.length}명 일지를 저장했어요`);
    } catch (e) {
      console.error('[내일 수업 준비] 일괄 캡처 오류', e);
      message.error('이미지 저장에 실패했어요');
    } finally {
      setDownloading(false);
    }
  };

  const menuItems = [
    { key: 'one', label: '이 일지만 저장', icon: <ImageIcon size={16} /> },
    { key: 'all', label: '일괄 저장', icon: <StackIcon size={16} /> },
  ];

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader title="내일 수업 준비" back />

      {loading ? (
        <div className="px-4 pt-8"><LoadingSpinner /></div>
      ) : slides.length === 0 ? (
        <p className="text-center" style={{ fontSize: 14, color: TEXT_TERTIARY, padding: '64px 0' }}>
          내일 예정된 수업이 없습니다.
        </p>
      ) : (
        <>
          {/* 상단 안내 + 다운로드 메뉴 */}
          <div className="px-4 flex items-center justify-between" style={{ paddingTop: 16, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: TEXT_TERTIARY }}>
              내일 수업 {slides.length}명 · 직전 수업 일지
            </span>
            <Dropdown
              menu={{ items: menuItems, onClick: ({ key }) => (key === 'one' ? handleDownloadOne() : handleDownloadAll()) }}
              trigger={['click']}
              placement="bottomRight"
              disabled={downloading}
            >
              <button
                type="button"
                aria-label="이미지 저장"
                style={{
                  background: 'none', border: 'none', padding: 6, cursor: 'pointer',
                  color: PRIMARY, display: 'flex', alignItems: 'center',
                  opacity: downloading ? 0.5 : 1,
                }}
              >
                <DownloadSimpleIcon size={22} weight="bold" />
              </button>
            </Dropdown>
          </div>

          {/* Embla 캐러셀 — 드래그/스냅/끝 러버밴드.
              page-fixed-viewport(flex column) 안에서 flex:1로 남은 공간을 정확히 차지 →
              하단 컨트롤·BottomNav 공간만큼 띄우고 페이지 스크롤 없이 카드만 표시. */}
          <div
            className="overflow-hidden pull-isolate"
            ref={emblaRef}
            style={{
              flex: '1 1 0',
              minHeight: 0,
              // 하단 ◀1/N▶ 컨트롤(bottom 80+safe, 높이 ~64) + BottomNav 공간 확보.
              marginBottom: 'calc(160px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ display: 'flex', height: '100%' }}>
              {slides.map((s) => (
                <div
                  key={s.studentId}
                  // 상하 여백(12px): 카드 그림자가 캐러셀 overflow-hidden에 잘리지 않도록 공간 확보.
                  style={{ flex: '0 0 100%', minWidth: 0, boxSizing: 'border-box', padding: '12px 16px', height: '100%' }}
                >
                  <div style={{ position: 'relative', height: '100%' }}>
                    {/* 고정 헤더 + 스크롤 본문 카드 */}
                    <FillLogCard slide={s} />

                    {/* 일지 수정 — 아이콘만, 카드 우상단 */}
                    {s.prevLog && (
                      <button
                        type="button"
                        onClick={() => navigate(`/logs/${s.prevLog.id}/edit`)}
                        aria-label="일지 수정"
                        style={{
                          position: 'absolute', top: 14, right: 14, zIndex: 3,
                          padding: 8, background: 'none', border: 'none',
                          color: TEXT_TERTIARY, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <NotePencilIcon size={20} weight="fill" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* off-screen 합본 컨테이너 (일괄 저장용 — 화면 밖에서 캡처) */}
      {!loading && slides.length > 0 && (
        <div
          ref={batchRef}
          aria-hidden="true"
          style={{
            position: 'fixed', left: '-99999px', top: 0, width: 380,
            background: BG_CARD, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 14,
            pointerEvents: 'none',
          }}
        >
          {slides.map((s, i) => (
            <LogCard key={s.studentId} ref={(el) => { cardRefs.current[i] = el; }} slide={s} />
          ))}
        </div>
      )}

      {/* 하단 컨트롤 (배경 없음): ◀ · 1/N · ▶ */}
      {!loading && slides.length > 0 && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0, zIndex: 45,
            bottom: 'calc(80px + env(safe-area-inset-bottom))',
            padding: '8px 40px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            maxWidth: 512, margin: '0 auto',
            pointerEvents: 'none',
          }}
        >
          <button
            type="button"
            onClick={() => emblaApi && emblaApi.scrollPrev()}
            disabled={!canPrev}
            aria-label="이전"
            style={{
              width: 48, height: 48, background: 'none', border: 'none',
              color: canPrev ? PRIMARY : BORDER_NEUTRAL,
              cursor: canPrev ? 'pointer' : 'default', pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CaretLeftIcon size={26} weight="bold" />
          </button>

          <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY }}>
            {index + 1} / {slides.length}
          </span>

          <button
            type="button"
            onClick={() => emblaApi && emblaApi.scrollNext()}
            disabled={!canNext}
            aria-label="다음"
            style={{
              width: 48, height: 48, background: 'none', border: 'none',
              color: canNext ? PRIMARY : BORDER_NEUTRAL,
              cursor: canNext ? 'pointer' : 'default', pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CaretRightIcon size={26} weight="bold" />
          </button>
        </div>
      )}
    </PullToRefresh>
  );
}

/** 카드 헤더 — 학생명 + 내일 수업 시간/장소 (구분선 포함). 화면/캡처 공용. */
function LogCardHead({ slide }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER_SUBTLE}`, paddingBottom: 14 }}>
      <p style={{ fontSize: 20, fontWeight: 700, color: PRIMARY, margin: 0, lineHeight: 1.2 }}>
        {slide.studentName}
      </p>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slide.classes.map((c) => (
          // 시간과 장소는 무조건 한 줄 (nowrap). 시간·회차·핀은 고정, 장소명만 필요 시 말줄임.
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
            <ClockIcon size={16} weight="fill" color={PRIMARY} style={{ flexShrink: 0 }} />
            <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {fmtTimeOnly(c.datetime)}{c.endTime && `~${fmtTimeOnly(c.endTime)}`}
            </span>
            {c.duration && (
              <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, flexShrink: 0, whiteSpace: 'nowrap' }}>
                ({c.duration}분)
              </span>
            )}
            {c.location && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 }}>
                <span style={{ color: BORDER_NEUTRAL, flexShrink: 0 }}>·</span>
                <MapPinIcon size={16} weight="fill" color={PRIMARY} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {stripEmoji(c.location)}
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 카드 본문 — 직전 수업 일지. 화면/캡처 공용. */
function LogCardBody({ slide }) {
  const log = slide.prevLog;
  if (!log) {
    return (
      <p style={{ fontSize: 14, color: TEXT_TERTIARY, textAlign: 'center', padding: '24px 0' }}>
        직전 수업 일지가 없습니다.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {slide.prevClassDate && (
        <p className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, margin: 0 }}>
          직전 수업: {fmtDateOnly(slide.prevClassDate)}
        </p>
      )}
      <LogSection label="오늘 내용" text={log.content} />
      <LogSection label="숙제" text={log.homework} />
      <LogSection label="다음 수업 준비" text={log.nextPrepare} highlight />
      {log.engagement && (
        <div>
          <SectionLabel>학생 참여도</SectionLabel>
          <span style={{ ...BADGE_SMALL, display: 'inline-block', borderRadius: 980, background: PRIMARY_BG, color: PRIMARY }}>
            {stripEmoji(log.engagement)}
          </span>
        </div>
      )}
      <LogSection label="메모" text={log.memo} />
      {!log.content && !log.homework && !log.nextPrepare && !log.memo && !log.engagement && (
        <p style={{ fontSize: 14, color: TEXT_TERTIARY, textAlign: 'center', padding: '16px 0' }}>
          작성된 일지 내용이 없습니다.
        </p>
      )}
    </div>
  );
}

/**
 * 화면 표시용 카드 — 헤더는 상단 고정, 본문만 네이티브 세로 스크롤.
 * (embla는 슬라이드 캐러셀이라 단일 긴 본문 전체 스크롤엔 부적합 → 네이티브 스크롤 사용.)
 * iOS 네이티브 바운스로 끝에서 당겼다 돌아오는 느낌을 살린다.
 * 더 볼 내용이 있으면 하단에 페이드 + ⌄ 스크롤 안내를 표시한다.
 */
function FillLogCard({ slide }) {
  const scrollRef = useRef(null);
  const [hasMore, setHasMore] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    setHasMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);

  useEffect(() => { checkScroll(); }, [checkScroll, slide]);

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column', position: 'relative',
        background: BG_CARD, borderRadius: 12, boxShadow: 'var(--shadow-card)', overflow: 'hidden',
      }}
    >
      {/* 고정 헤더 (배경 있음 — 본문이 뒤로 스크롤돼도 겹치지 않음) */}
      <div style={{ flexShrink: 0, background: BG_CARD, padding: '24px 24px 0' }}>
        <LogCardHead slide={slide} />
      </div>

      {/* 네이티브 세로 스크롤 본문 — iOS 바운스(당겼다 돌아옴) 활용.
          contain은 주지 않아 바운스를 살리고, 페이지 전파는 전역 body contain + 고정 뷰포트가 차단. */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        className="hide-scrollbar"
        style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '16px 24px 24px',
        }}
      >
        <LogCardBody slide={slide} />
      </div>

      {/* 하단 스크롤 안내 — 더 볼 내용이 있을 때만 */}
      {hasMore && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 52,
            borderRadius: '0 0 12px 12px',
            background: `linear-gradient(to bottom, rgba(255,255,255,0), ${BG_CARD} 70%)`,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 8, pointerEvents: 'none',
          }}
        >
          <CaretDownIcon
            size={18} weight="bold" color={TEXT_TERTIARY}
            style={{ animation: 'tprep-scroll-hint 1.4s ease-in-out infinite' }}
          />
        </div>
      )}
    </div>
  );
}

/** off-screen 캡처용 카드 — 전체 내용을 한 장으로 (스크롤 없음). */
const LogCard = forwardRef(function LogCard({ slide }, ref) {
  return (
    <div
      ref={ref}
      style={{
        background: BG_CARD, borderRadius: 12,
        boxShadow: 'var(--shadow-card)', padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <LogCardHead slide={slide} />
      </div>
      <LogCardBody slide={slide} />
    </div>
  );
});

function SectionLabel({ children }) {
  return (
    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_TERTIARY, marginBottom: 4 }}>
      {children}
    </span>
  );
}

function LogSection({ label, text, highlight }) {
  if (!text?.trim()) return null;
  // '다음 수업 준비'는 가장 중요한 항목 — 빨강 텍스트(가이드상 인터랙티브 전용) 대신
  // 연한 브랜드 배경 박스(PRIMARY_BG)로 강조한다.
  if (highlight) {
    return (
      <div style={{ background: PRIMARY_BG, borderRadius: 12, padding: '12px 14px' }}>
        <SectionLabel>{label}</SectionLabel>
        <p style={{
          fontSize: 14, lineHeight: 1.65, margin: 0,
          color: TEXT_PRIMARY, fontWeight: 600,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {text}
        </p>
      </div>
    );
  }
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p style={{
        fontSize: 14, lineHeight: 1.65, margin: 0,
        color: TEXT_PRIMARY, fontWeight: 400,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {text}
      </p>
    </div>
  );
}
