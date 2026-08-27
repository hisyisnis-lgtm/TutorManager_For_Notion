import {
  useParams,
  Link } from 'react-router-dom';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { Button,
  Card } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import Badge from '../components/ui/Badge.jsx';
import { getPage, queryPage } from '../api/notionClient.js';
import { parseLessonLog, isEmpty } from '../api/lessonLogs.js';
import LessonLogBody from '../components/lessonLogs/LessonLogBody.jsx';
import { formatDuration } from '../utils/dateUtils.js';
import { parseClass,
  classStatusColor,
  notesColor,
  CLASSES_DB } from '../api/classes.js';
import { useData } from '../context/DataContext.jsx';
import { stripEmoji } from '../utils/stringUtils.js';
import { isOnlineGroupTitle } from '../utils/classTypeKind.js';
import { PRIMARY,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
  GRAY_100 } from '../constants/theme.js';
import { SECTION_HEADING } from '../constants/styles.js';

function Row({ label, value }) {
  if (value === null || value === undefined || value === '' ) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: `1px solid ${GRAY_100}` }}>
      <span style={{ fontSize: 13, color: TEXT_TERTIARY, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

/**
 * 이 수업의 **직전 수업 일지**를 학생별로 가져온다 — 내일 수업 준비 화면과 같은 자료.
 * (내일 것만 보던 걸 아무 수업에서나 볼 수 있게 한 것뿐이라, 카드 본문은 LessonLogBody 공용.)
 * 2:1 수업은 학생마다 직전 일지가 다르므로 학생 수만큼 만든다.
 */
async function loadPrepSlides(cls) {
  // 학생별로 병렬 — 2:1 수업에서 순서대로 기다리면 왕복이 두 배가 된다.
  const slides = await Promise.all((cls.studentIds ?? []).map(async (sid) => {
    try {
      const prev = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '학생', relation: { contains: sid } },
            // 이 수업 '이전'이 기준이다 — 완료된 수업을 열어봐도 그때의 준비 내용이 나온다.
            { property: '수업 일시', date: { before: cls.datetime } },
            // ⛔ '일지가 붙은 수업'으로 좁히지 않는다 — 수업 완료 시 빈 일지가 자동 생성되므로
            //    이 조건은 내용 유무를 못 가리고, 진짜 직전 수업을 건너뛰어 날짜가 틀어진다(2026-08-27).
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
          ],
        },
        [{ property: '수업 일시', direction: 'descending' }],
        undefined,
        1
      );
      const page = (prev?.results ?? [])[0];
      if (!page) return null;
      const prevClass = parseClass(page);
      const logId = prevClass.lessonLogIds?.[0];
      // 일지가 없어도 '직전 수업이 언제였는지'는 알려준다 — 날짜가 맞아야 카드를 믿는다.
      // 학생 이름은 캐시에 넣지 않는다 — 이름이 바뀌면 옛 이름이 남는다. 렌더에서 map으로 푼다.
      return {
        studentId: sid,
        prevClassDate: prevClass.datetime,
        log: logId ? parseLessonLog(await getPage(logId)) : null,
      };
    } catch (e) {
      // 준비 자료가 없다고 수업 상세 자체가 막히면 안 된다 — 조용히 건너뛴다.
      console.error('[수업 상세] 직전 일지 로드 오류', sid, e);
      return null;
    }
  }));
  return slides.filter(Boolean);
}

export default function ClassDetailPage() {
  const { id } = useParams();
  const { studentNameMap, classTypeMap } = useData();
  // 수업 정보 + 수업 준비를 **한 캐시에 함께** 담는다.
  //  - 따로 두면 정보가 먼저 뜨고 준비 카드만 몇 초 뒤 튀어나온다(2026-08-27 지적).
  //  - 한 덩어리면 재방문 때 localStorage에서 **둘 다 즉시** 그려진다(로딩 없음).
  // 편집 후 ClassFormPage가 invalidateCache('class')를 부르므로 이 키도 함께 비워진다.
  const res = useCachedResource(`class:full:${id}`, async () => {
    const parsed = parseClass(await getPage(id));
    return { cls: parsed, prep: await loadPrepSlides(parsed) };
  });
  const cls = res.data?.cls ?? null;
  const prep = res.data?.prep ?? [];
  const loading = res.loading;
  const error = res.error;

  if (loading) return <><PageHeader title="수업 상세" back /><LoadingSpinner /></>;
  if (error || !cls) return <><PageHeader title="수업 상세" back /><ErrorMessage message={error || '불러올 수 없습니다'} /></>;

  const studentNames = cls.studentIds.map((sid) => studentNameMap[sid]).filter(Boolean).join(', ');
  const ct = classTypeMap[cls.classTypeId];
  const isGroup = isOnlineGroupTitle(ct?.title);
  const dt = cls.datetime
    ? new Date(cls.datetime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  const sc = classStatusColor(cls.status);
  const nc = notesColor(cls.notes);
  const locationText = [cls.location, cls.locationMemo].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title="수업 상세" back />
      <div className="px-4 pt-4 pb-24">
        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: '16px 18px' } }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <p style={{ fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>
              {cls.title || studentNames || '수업'}
            </p>
            <Link to={`/classes/${id}/edit`} style={{ flexShrink: 0 }}>
              <Button type="text" size="small" style={{ color: PRIMARY, fontWeight: 600, paddingInline: 8 }}>편집</Button>
            </Link>
          </div>
          <Row label="상태" value={cls.status ? <Badge label={stripEmoji(cls.status)} bg={sc.bg} text={sc.text} /> : null} />
          {studentNames && <Row label="학생" value={studentNames} />}
          {isGroup && cls.roster && <Row label="수강생" value={cls.roster} />}
          <Row label="수업 유형" value={ct?.title} />
          <Row label="일시" value={dt} />
          <Row label="수업 시간" value={cls.duration ? formatDuration(parseInt(cls.duration)) : null} />
          <Row label="장소" value={locationText} />
          <Row label="특이사항" value={cls.notes ? <Badge label={stripEmoji(cls.notes)} bg={nc?.bg || 'bg-gray-100'} text={nc?.text || 'text-gray-500'} /> : null} />
          <Row label="메모" value={cls.noteMemo} />
          <Row label="전화번호" value={cls.phone} />
        </Card>

        {/* 수업 준비 — 직전 수업 일지. 위 정보와 같은 캐시라 따로 로딩 문구가 필요 없다.
            자료가 없으면 카드째 안 그린다(빈 카드 금지). */}
        {prep.map((slide) => (
          <Card
            key={slide.studentId}
            variant="borderless"
            style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', marginTop: 12 }}
            styles={{ body: { padding: '16px 18px' } }}
          >
            <p style={{ ...SECTION_HEADING, marginBottom: 4 }}>
              수업 준비{prep.length > 1 && studentNameMap[slide.studentId] ? ` · ${stripEmoji(studentNameMap[slide.studentId])}` : ''}
            </p>
            <p className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '0 0 12px' }}>
              직전 수업: {new Date(slide.prevClassDate).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })}
            </p>
            {/* 수업이 끝나면 빈 일지가 자동 생성된다 — '일지가 있다 = 내용이 있다'가 아니다 */}
            {!slide.log || isEmpty(slide.log) ? (
              <p style={{ fontSize: 14, color: TEXT_TERTIARY, textAlign: 'center', padding: '16px 0', margin: 0 }}>
                직전 수업 일지가 아직 작성되지 않았어요.
              </p>
            ) : (
              <LessonLogBody log={slide.log} />
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
