import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Badge from '../components/ui/Badge.jsx';
import HomeworkFilterBar from '../components/homework/HomeworkFilterBar.jsx';
import HomeworkSection from '../components/homework/HomeworkSection.jsx';
import { fetchStudentHomework, parseHomework, homeworkStatusColor } from '../api/homework.js';
import { getPage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export default function StudentHomeworkPage() {
  const { id } = useParams();  // studentId
  const navigate = useNavigate();

  const [student, setStudent] = useState(null);
  const [homeworkList, setHomeworkList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 검색 + 필터
  const [searchText, setSearchText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentPage, hwData] = await Promise.all([
        getPage(id),
        fetchStudentHomework(id),
      ]);
      setStudent(parseStudent(studentPage));
      setHomeworkList(hwData.results.map(parseHomework));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const availableMonths = [...new Set(
    homeworkList.map((h) => h.createdTime?.slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  const filteredList = homeworkList.filter((h) => {
    if (searchText && !h.title.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (filterMonth && h.createdTime?.slice(0, 7) !== filterMonth) return false;
    if (filterStatus && h.status !== filterStatus) return false;
    return true;
  });

  const pending = filteredList.filter((h) => h.status === '미제출');
  const submitted = filteredList.filter((h) => h.status === '제출완료');
  const done = filteredList.filter((h) => h.status === '피드백완료');

  const studentName = student?.name?.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim() ?? '';

  const isFiltering = searchText || filterMonth || filterStatus;

  if (loading) return <><PageHeader title="숙제" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="숙제" back /><ErrorMessage message={error} /></>;

  return (
    <>
      <PageHeader
        title={`${studentName} 숙제`}
        back
        action={
          <Button
            type="primary"
            onClick={() => navigate(`/homework/new?studentId=${id}`)}
            style={{ borderRadius: 12, width: 36, height: 36, padding: 0, fontSize: 20, fontWeight: 600 }}
            aria-label="숙제 추가"
          >
            +
          </Button>
        }
      />

      <div className="px-5 pt-4 pb-24">

        {/* 검색 + 필터 바 */}
        {homeworkList.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <HomeworkFilterBar
              searchText={searchText}
              onSearchChange={setSearchText}
              filterMonth={filterMonth}
              onMonthChange={setFilterMonth}
              filterStatus={filterStatus}
              onStatusChange={setFilterStatus}
              availableMonths={availableMonths}
            />
          </div>
        )}

        {/* 빈 상태 */}
        {homeworkList.length === 0 && (
          <EmptyState icon="📝" title="숙제가 없어요" description="우상단 + 버튼으로 숙제를 등록해보세요" />
        )}

        {/* 필터 결과 없음 */}
        {homeworkList.length > 0 && filteredList.length === 0 && (
          <EmptyState icon="🔍" title="검색 결과가 없어요" />
        )}

        {pending.length > 0 && (
          <HomeworkSection title={`🔴 미제출 (${pending.length})`}>
            {pending.map((hw) => (
              <HomeworkCard key={hw.id} hw={hw} onClick={() => navigate(`/homework/${hw.id}`)} />
            ))}
          </HomeworkSection>
        )}

        {submitted.length > 0 && (
          <HomeworkSection title={`🔵 제출완료 (${submitted.length})`}>
            {submitted.map((hw) => (
              <HomeworkCard key={hw.id} hw={hw} onClick={() => navigate(`/homework/${hw.id}`)} />
            ))}
          </HomeworkSection>
        )}

        {done.length > 0 && (
          <HomeworkSection title={`🟢 피드백완료 (${done.length})`}>
            {done.map((hw) => (
              <HomeworkCard key={hw.id} hw={hw} onClick={() => navigate(`/homework/${hw.id}`)} />
            ))}
          </HomeworkSection>
        )}
      </div>
    </>
  );
}

function HomeworkCard({ hw, onClick }) {
  const { bg, text } = homeworkStatusColor(hw.status);
  const fileCount = hw.submitFiles?.length ?? 0;
  const hasFeedback = hw.feedbackText || (hw.feedbackFiles?.length ?? 0) > 0;

  const dateLabel = hw.submitDate
    ? `제출 ${formatDate(hw.submitDate)}`
    : hw.createdTime
    ? `등록 ${formatDate(hw.createdTime)}`
    : '';

  return (
    <Card
      variant="borderless"
      style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', cursor: 'pointer' }}
      styles={{ body: { padding: '12px 16px' } }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* 텍스트 영역 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 14, fontWeight: 600, color: '#1d1d1f',
            marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hw.title}
          </p>
          {hw.content && (
            <p style={{
              fontSize: 12, color: '#595959',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
            }}>
              {hw.content}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {dateLabel && (
              <span style={{ fontSize: 11, color: '#bfbfbf' }}>{dateLabel}</span>
            )}
            {fileCount > 0 && (
              <span style={{ fontSize: 11, color: '#767676' }}>🎵 {fileCount}개</span>
            )}
            {hasFeedback && (
              <span style={{ fontSize: 11, color: '#52c41a' }}>💬 피드백 있음</span>
            )}
          </div>
        </div>

        {/* 상태 배지 + 화살표 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Badge label={hw.status} bg={bg} text={text} />
          <span style={{ fontSize: 12, color: '#d9d9d9' }}>›</span>
        </div>
      </div>
    </Card>
  );
}
