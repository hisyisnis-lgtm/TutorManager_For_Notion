import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button, Card } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import LessonLogBody from '../components/lessonLogs/LessonLogBody.jsx';
import { getPage } from '../api/notionClient.js';
import { parseLessonLog } from '../api/lessonLogs.js';
import { parseClass } from '../api/classes.js';
import { formatDateTime, formatTime } from '../utils/dateUtils.js';
import { useData } from '../context/DataContext.jsx';
import { PRIMARY, TEXT_PRIMARY, TEXT_TERTIARY } from '../constants/theme.js';

/**
 * 수업 일지 상세 — **읽기 전용**. 편집은 카드 안 '편집' 버튼으로 `/logs/:id/edit`에 들어간다.
 * 목록·수업 카드에서 바로 편집 화면으로 던지면 읽으려고 눌렀다가 입력폼을 만나게 된다
 * (ClassDetailPage·PaymentDetailPage와 같은 판단, 2026-08-26).
 * 본문은 내일수업준비 카드와 같은 컴포넌트(LessonLogBody)를 쓴다.
 */
export default function LessonLogDetailPage() {
  const { id } = useParams();
  const { studentNameMap } = useData();

  const [log, setLog] = useState(null);
  const [cls, setCls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const parsed = parseLessonLog(await getPage(id));
      setLog(parsed);
      // 일지에 연결된 수업이 있으면 일시를 함께 보여준다(언제 수업의 일지인지가 먼저 궁금하다).
      if (parsed.classId) {
        try {
          setCls(parseClass(await getPage(parsed.classId)));
        } catch {
          // 수업이 지워졌을 수 있다 — 일지 본문은 그대로 보여준다.
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <><PageHeader title="수업 일지" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="수업 일지" back /><ErrorMessage message={error} onRetry={load} /></>;
  if (!log) return null;

  const studentNames = log.studentIds.map((sid) => studentNameMap[sid]).filter(Boolean).join(', ');

  return (
    <>
      <PageHeader title="수업 일지" back />

      <div className="px-4 pt-4 pb-24">
        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }} styles={{ body: { padding: '16px 18px' } }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, wordBreak: 'keep-all' }}>
                {studentNames || log.title || '수업 일지'}
              </p>
              {cls?.datetime && (
                <p className="tabular-nums" style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '4px 0 0' }}>
                  {formatDateTime(cls.datetime)}
                  {cls.endTime && ` ~ ${formatTime(cls.endTime)}`}
                </p>
              )}
            </div>
            {/* 편집은 헤더 우상단이 아니라 카드 안 — 이 앱의 상세 화면 공통 어법 */}
            <Link to={`/logs/${id}/edit`} style={{ flexShrink: 0 }}>
              <Button type="text" size="small" style={{ color: PRIMARY, fontWeight: 600, paddingInline: 8 }}>편집</Button>
            </Link>
          </div>

          <LessonLogBody log={log} />
        </Card>
      </div>
    </>
  );
}
