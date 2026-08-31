import { useState, useEffect, useLayoutEffect, useRef, useCallback, forwardRef } from 'react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { CaretLeftIcon, CaretRightIcon, CaretDownIcon, DownloadSimpleIcon, ImageIcon, StackIcon, ClockIcon, MapPinIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/shadcn/dropdown-menu';
import useEmblaCarousel from 'embla-carousel-react';
import { domToPng } from 'modern-screenshot';
import { useData } from '../context/DataContext.jsx';
import { queryPage, getPage } from '../api/notionClient.js';
import { swrLoad } from '../hooks/useCachedResource.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { parseLessonLog, isEmpty } from '../api/lessonLogs.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import LessonLogBody from '../components/lessonLogs/LessonLogBody.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { stripEmoji } from '../utils/stringUtils.js';
import {
  PRIMARY,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY,
  BG_CARD, BORDER_SUBTLE, BORDER_NEUTRAL,
} from '../constants/theme.js';

import { KST, formatDuration } from '../utils/dateUtils.js';
const pad = (n) => String(n).padStart(2, '0');

/** KST 기준 오늘로부터 offset일 뒤 "YYYY-MM-DD" (0=오늘, 1=내일) */
function getKSTDateStr(offset) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
  const [y, m, d] = todayStr.split('-').map(Number);
  const t = new Date(y, m - 1, d + offset);
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

/**
 * 수업 준비 카드 — 하루치 수업을 학생별 카드로 넘겨 보는 화면.
 * `dayOffset`으로 오늘(0)·내일(1)을 같은 화면이 처리한다. 화면 두 벌을 두지 않으려는 것.
 * `?student=<id>`가 붙어 오면 그 학생 카드에서 시작한다(홈의 오늘 수업 줄에서 넘어올 때).
 */
export default function TomorrowPrepPage({ dayOffset = 1 }) {
  const dayLabel = dayOffset === 0 ? '오늘' : '내일';
  const [searchParams] = useSearchParams();
  const focusStudentId = searchParams.get('student');
  const { studentNameMap } = useData();
  const [slides, setSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 콜드 스타트(마스터 캐시 없음)로 직진하면 load 시점에 이름 맵이 비어 전부 '학생'으로
  // 굳던 문제 — 맵이 늦게 도착해도 슬라이드 이름을 재해석해 갱신한다.
  useEffect(() => {
    setSlides((prev) => prev.map((s) => {
      if (!s.studentId) return s;   // 학생없는 수업 — 이름은 수업명 그대로 둔다
      const name = stripEmoji(studentNameMap[s.studentId] || '') || s.studentName;
      return name === s.studentName ? s : { ...s, studentName: name };
    }));
  }, [studentNameMap]);

  // 홈의 '오늘 수업' 줄에서 `?student=`로 넘어오면 그 학생 카드에서 **시작**한다.
  // 이펙트에서 scrollTo로 점프하는 방식은 emblaApi 도착 타이밍에 따라 첫 카드가
  // 먼저 그려졌다 넘어가는 깜빡임이 남았다(2026-08-31 두 차례 지적) —
  // 초기화 옵션(startIndex)으로 주면 어떤 렌더 순서에서도 처음부터 그 위치다.
  const focusIndex = focusStudentId && slides.length
    ? Math.max(0, slides.findIndex((s) => s.studentId === focusStudentId))
    : 0;

  // Embla 캐러셀 (드래그·스냅·끝 러버밴드·마우스+터치 모두 처리)
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start', containScroll: false, startIndex: focusIndex });
  const [index, setIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const cardRefs = useRef([]);    // off-screen 각 카드 (단일 저장 캡처 대상)
  const batchRef = useRef(null);  // off-screen 합본 (일괄 저장)

  const tomorrowStr = getKSTDateStr(dayOffset);

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

  // 슬라이드 로드/변경 시 Embla 재초기화.
  // ⚠️ 아래 포커스 점프와 함께 **useLayoutEffect**여야 한다 — useEffect는 페인트 뒤에 돌아서
  // 첫 카드가 한 번 그려졌다가 목표 카드로 넘어가는 깜빡임이 보였다(2026-08-31 지적).
  useLayoutEffect(() => {
    if (emblaApi) emblaApi.reInit();
  }, [emblaApi, slides.length]);

  // (포커스 이동은 위 startIndex가 담당한다 — scrollTo 이펙트 방식은 타이밍 경쟁으로 폐기)

  const load = async () => {
    setLoading(true);
    try {
      // 학생마다 '직전 수업 + 그 일지'를 따로 부르는 N+1 구조라(학생 5명이면 최대 10회 왕복)
      // 이 화면은 열 때마다 눈에 띄게 느렸다. 완성된 슬라이드를 통째로 캐시해
      // 재방문 시 즉시 띄우고 뒤에서 갱신한다. 키에 내일 날짜가 들어가 날이 바뀌면 자동 무효.
      await swrLoad(`prep:${tomorrowStr}`, async () => {
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
      // 학생이 연결되지 않은 수업(온라인그룹수업·게스트 상담)은 **수업 자체를 한 묶음**으로 잡는다.
      // 예전엔 통째로 빠져서 그날 수업이 있는데도 카드가 안 나왔다(2026-08-27).
      const noStudent = [];
      for (const cls of tomorrowClasses) {
        if (!cls.studentIds?.length) { noStudent.push(cls); continue; }
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
                  // 기준은 '지금'이 아니라 **그 학생의 그날 첫 수업 직전**이다.
                  // 오늘치로 볼 때 '지금 이전'을 쓰면 오늘 이미 끝난 수업이 직전으로 잡혀
                  // "직전 수업: 오늘"이 나온다(2026-08-27). 내일치에서도 결과는 같다.
                  { property: '수업 일시', date: { before: classes[0]?.datetime ?? new Date().toISOString() } },
                  // ⛔ '수업 일지 relation이 있는 수업'으로 좁히지 말 것 —
                  //    수업이 끝나면 **빈 일지가 자동 생성**되므로 이 조건은 내용 유무를 못 가린다.
                  //    게다가 진짜 직전 수업을 건너뛰고 옛 수업 날짜를 보여주게 된다(2026-08-27).
                  //    직전 수업은 있는 그대로 찾고, 일지가 없거나 비었으면 카드가 그렇게 말한다.
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
              // 일지가 없어도 '직전 수업이 언제였는지'는 알려준다 — 날짜가 맞아야 카드를 믿는다.
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
          return { key: sid, studentId: sid, studentName: name, classes, prevLog, prevClassDate };
        })
      );

      // 학생없는 수업 슬라이드 — 직전 일지를 찾을 상대가 없으니 수업 정보만 담는다.
      const guestSlides = noStudent.map((cls) => ({
        key: `cls:${cls.id}`,
        studentId: null,
        studentName: stripEmoji(cls.title || '') || '학생 미정',
        classes: [cls],
        prevLog: null,
        prevClassDate: null,
      }));

      // 시작 시간 순으로 합친다 — 하루를 시간 흐름대로 넘겨 보게.
      const merged = [...built, ...guestSlides].sort((a, b) =>
        String(a.classes[0]?.datetime ?? '').localeCompare(String(b.classes[0]?.datetime ?? ''))
      );

      return merged;
      }, (built) => {
        setSlides(built);
        setLoadError(false);
        setLoading(false); // 캐시가 있으면 여기서 이미 화면이 찬다
      });
    } catch (e) {
      console.error('[내일 수업 준비] 불러오기 오류', e);
      setLoadError(true); // 오류를 "수업 없음"으로 위장하지 않기
    } finally {
      setLoading(false);
    }
  };

  // 날짜가 바뀌면 다시 부른다. 오늘/내일 두 라우트가 **같은 컴포넌트**라 라우터가
  // 인스턴스를 재사용한다 — 마운트 1회([])로 두면 오늘 화면에 내일 데이터가 그대로 남는다
  // (2026-08-27 실측). 자정을 넘겨 날짜가 바뀌는 경우도 이 의존성이 받아 준다.
  useEffect(() => { load(); }, [tomorrowStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // 오늘↔내일 화면이 **실제로 바뀔 때만** 첫 카드로. 남은 슬라이드 위치가 다른 날짜에 이어지면 어긋난다.
  // ⚠️ [emblaApi, tomorrowStr]로 걸면 emblaApi가 '도착'하는 순간에도 실행돼,
  //    ?student= 포커스로 잡아둔 위치를 0번으로 되돌렸다 — "누른 학생이 떴다가
  //    첫 학생으로 넘어가는" 깜빡임의 진범(2026-08-31). 날짜 변화만 감지한다.
  const prevDayRef = useRef(tomorrowStr);
  useEffect(() => {
    if (prevDayRef.current === tomorrowStr) return;
    prevDayRef.current = tomorrowStr;
    if (emblaApi) emblaApi.scrollTo(0, true);
  }, [emblaApi, tomorrowStr]);

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
      toast.success('일지 이미지를 저장했어요');
    } catch (e) {
      console.error('[내일 수업 준비] 단일 캡처 오류', e);
      toast.error('이미지 저장에 실패했어요');
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
      triggerDownload(dataUrl, `${dayLabel}수업준비_${tomorrowStr.slice(5)}.png`);
      toast.success(`전체 ${slides.length}명 일지를 저장했어요`);
    } catch (e) {
      console.error('[내일 수업 준비] 일괄 캡처 오류', e);
      toast.error('이미지 저장에 실패했어요');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader title={`${dayLabel} 수업 준비`} back />

      {loading ? (
        <div className="px-4 pt-8"><LoadingSpinner /></div>
      ) : loadError ? (
        <div className="text-center" style={{ padding: '64px 0' }}>
          <p style={{ fontSize: 14, color: TEXT_TERTIARY, marginBottom: 12 }}>
            {dayLabel} 수업 정보를 불러오지 못했어요.
          </p>
          <Button onClick={load}>다시 시도</Button>
        </div>
      ) : slides.length === 0 ? (
        <p className="text-center" style={{ fontSize: 14, color: TEXT_TERTIARY, padding: '64px 0' }}>
          {dayLabel} 예정된 수업이 없습니다.
        </p>
      ) : (
        <>
          {/* Embla 캐러셀 — 드래그/스냅/끝 러버밴드.
              page-fixed-viewport(flex column) 안에서 flex:1로 남은 공간을 정확히 차지 →
              하단 컨트롤·BottomNav 공간만큼 띄우고 페이지 스크롤 없이 카드만 표시. */}
          <div
            className="overflow-hidden pull-isolate"
            ref={emblaRef}
            style={{
              flex: '1 1 0',
              minHeight: 0,
              marginTop: 12,
              // 하단 ◀1/N▶ 컨트롤(bottom 80+safe, 높이 ~64) + BottomNav 공간 확보.
              marginBottom: 'calc(160px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ display: 'flex', height: '100%' }}>
              {slides.map((s) => (
                <div
                  key={s.key ?? s.studentId}
                  // 상하 여백(12px): 카드 그림자가 캐러셀 overflow-hidden에 잘리지 않도록 공간 확보.
                  style={{ flex: '0 0 100%', minWidth: 0, boxSizing: 'border-box', padding: '12px 16px', height: '100%' }}
                >
                  <div style={{ position: 'relative', height: '100%' }}>
                    {/* 고정 헤더 + 스크롤 본문 카드 */}
                    <FillLogCard slide={s} />

                    {/* 이미지 저장 — 카드 우상단 (이 일지만 / 일괄 저장) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={downloading}>
                        <button
                          type="button"
                          aria-label="이미지 저장"
                          style={{
                            position: 'absolute', top: 14, right: 14, zIndex: 3,
                            padding: 8, background: 'none', border: 'none',
                            color: PRIMARY, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: downloading ? 0.5 : 1,
                          }}
                        >
                          <DownloadSimpleIcon size={20} weight="bold" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={handleDownloadOne}>
                          <ImageIcon size={16} />
                          이 일지만 저장
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleDownloadAll}>
                          <StackIcon size={16} />
                          일괄 저장
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
            <LogCard key={s.key ?? s.studentId} ref={(el) => { cardRefs.current[i] = el; }} slide={s} />
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
            <CaretLeftIcon size={24} weight="bold" />
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
            <CaretRightIcon size={24} weight="bold" />
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
      <p style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.2 }}>
        {slide.studentName}
      </p>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slide.classes.map((c) => (
          // 장소는 시간 **아랫줄** — 한 줄에 붙이면 "온라인 (Zoom/화상)"이 잘렸다(2026-08-31 지적).
          // 아랫줄은 전폭을 쓰므로 잘릴 일이 없고, 말줄임은 극단 케이스 안전망으로만 남긴다.
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
              <ClockIcon size={16} weight="fill" color={PRIMARY} style={{ flexShrink: 0 }} />
              <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: TEXT_PRIMARY, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {fmtTimeOnly(c.datetime)}{c.endTime && `~${fmtTimeOnly(c.endTime)}`}
              </span>
              {c.duration && (
                <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  ({formatDuration(parseInt(c.duration))})
                </span>
              )}
            </div>
            {c.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <MapPinIcon size={16} weight="fill" color={PRIMARY} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {stripEmoji(c.location)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 카드 본문 — 직전 수업 일지. 화면/캡처 공용.
 * 일지가 없거나 **비어 있어도 직전 수업 날짜는 그대로 보여준다** — 날짜가 맞아야 카드를 믿는다.
 * 수업 완료 시 빈 일지가 자동 생성되므로 "일지가 있다 = 내용이 있다"가 아니다(2026-08-27).
 */
function LogCardBody({ slide }) {
  const log = slide.prevLog;
  const blank = !log || isEmpty(log);
  if (blank) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {slide.prevClassDate && (
          <p className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, margin: 0 }}>
            직전 수업: {fmtDateOnly(slide.prevClassDate)}
          </p>
        )}
        <p style={{ fontSize: 14, color: TEXT_TERTIARY, textAlign: 'center', padding: '24px 0', margin: 0 }}>
          {slide.prevClassDate
            ? '직전 수업 일지가 아직 작성되지 않았어요.'
            : slide.studentId
            ? '직전 수업이 없습니다.'
            /* 그룹수업·게스트 상담 — 학생이 연결돼 있지 않아 직전 일지를 찾을 상대가 없다 */
            : '학생이 연결되지 않아 직전 일지를 찾을 수 없어요.'}
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {slide.prevClassDate && (
        <p className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, margin: 0 }}>
          직전 수업: {fmtDateOnly(slide.prevClassDate)}
        </p>
      )}
      {/* 일지 상세(LessonLogDetailPage)와 같은 본문 — 마크업을 두 벌 두지 않는다 */}
      <LessonLogBody log={log} />
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
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 60,
            borderRadius: '0 0 12px 12px',
            background: `linear-gradient(to bottom, rgba(255,255,255,0), ${BG_CARD} 65%)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
            gap: 1, paddingBottom: 6, pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_TERTIARY, lineHeight: 1 }}>더보기</span>
          <CaretDownIcon
            size={16} weight="bold" color={TEXT_TERTIARY}
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

