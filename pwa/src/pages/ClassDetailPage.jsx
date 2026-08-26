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
import { getPage } from '../api/notionClient.js';
import { formatDuration } from '../utils/dateUtils.js';
import { parseClass,
  classStatusColor,
  notesColor } from '../api/classes.js';
import { useData } from '../context/DataContext.jsx';
import { stripEmoji } from '../utils/stringUtils.js';
import { isOnlineGroupTitle } from '../utils/classTypeKind.js';
import { PRIMARY,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
  GRAY_100 } from '../constants/theme.js';

function Row({ label, value }) {
  if (value === null || value === undefined || value === '' ) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: `1px solid ${GRAY_100}` }}>
      <span style={{ fontSize: 13, color: TEXT_TERTIARY, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

export default function ClassDetailPage() {
  const { id } = useParams();
  const { studentNameMap, classTypeMap } = useData();
  // 수업 상세 캐시(항목별 키). 재방문 즉시 표시 + 백그라운드 갱신.
  const clsRes = useCachedResource(`class:detail:${id}`, async () => parseClass(await getPage(id)));
  const cls = clsRes.data ?? null;
  const loading = clsRes.loading;
  const error = clsRes.error;

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
      </div>
    </>
  );
}
