import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/shadcn/card';
import { CaretRightIcon, SpeakerHighIcon } from '@phosphor-icons/react';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { fetchMyHomework, parseHomework } from '../../api/homework.js';
import { isFeedbackArchived } from '../../utils/homeworkViewed.js';
import HomeworkFilterBar from '../../components/homework/HomeworkFilterBar.jsx';
import LoadingSpinner from '../../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../../components/ui/ErrorMessage.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { FOOTNOTE } from '../../constants/styles.js';
import { TEXT_PRIMARY, TEXT_DISABLED, BORDER_NEUTRAL } from '../../constants/theme.js';

// ===== 발음 보관함 =====
// 학생이 이미 확인한 피드백 숙제를 다시 들춰보는 탭.
// 보관함 판정(isFeedbackArchived)은 utils/homeworkViewed.js 단일 출처 — 로컬 기록과 서버
// '피드백 확인일'을 함께 본다(기기를 바꿔도 확인 이력이 따라가도록).

function ArchiveHwCard({ hw, studentToken }) {
  const navigate = useNavigate();
  // 표시는 Notion 필드 기준 — 학생 첫 확인일(feedbackSeenDate) 우선, 없으면 강사 피드백일.
  // localStorage 의 viewedAt 은 마이그레이션·forceArchive 갱신으로 시점이 바뀔 수 있어 의미가 흐려져 사용 안 함.
  const dateForDisplay = hw.feedbackSeenDate || hw.feedbackDate;
  const viewedDateStr = dateForDisplay
    ? new Date(dateForDisplay).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })
    : "";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
      <button
        type="button"
        onClick={() => navigate(`/personal/${studentToken}/homework/${hw.id}`, { state: { tab: '보관함' } })}
        className=""
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", border: "none", cursor: "pointer",
          WebkitTapHighlightColor: "transparent", textAlign: "left", background: "none" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hw.title}
          </p>
          {viewedDateStr && (
            <p style={{ fontSize: 11, color: TEXT_DISABLED, margin: 0 }}>{viewedDateStr} 확인</p>
          )}
        </div>
        <CaretRightIcon size={16} color={TEXT_DISABLED} />
      </button>
      </CardContent>
    </Card>
  );
}

export default function ArchiveTab({ studentToken }) {
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState('title');
  const [filterMonth, setFilterMonth] = useState('');

  // 숙제 목록 캐시(토큰별) — 보관함은 옛 피드백 다시 보기라 캐시 적합. 열 때마다 백그라운드 갱신.
  const hwRes = useCachedResource(`student:homework:${studentToken}`, async () =>
    (await fetchMyHomework(studentToken)).map(parseHomework));
  const homeworkList = hwRes.data ?? [];
  const loading = hwRes.loading;
  const error = hwRes.error;

  const archivedList = homeworkList.filter(
    (h) => h.status === '피드백완료' && isFeedbackArchived(studentToken, h.id, h.feedbackDate, h.feedbackSeenDate)
  );

  const availableMonths = [...new Set(
    archivedList.map((h) => h.createdTime?.slice(0, 7)).filter(Boolean)
  )].sort().reverse();

  const filteredList = archivedList.filter((h) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (searchType === 'content') {
        if (!h.content?.toLowerCase().includes(q)) return false;
      } else {
        if (!h.title.toLowerCase().includes(q)) return false;
      }
    }
    if (filterMonth && h.createdTime?.slice(0, 7) !== filterMonth) return false;
    return true;
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} onRetry={hwRes.refresh} />;

  if (archivedList.length === 0) {
    return (
      <EmptyState
        icon={<SpeakerHighIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
        title="아직 보관된 발음이 없어요"
        description={"피드백을 확인한 숙제는\n여기에 자동으로 쌓여요"}
      />
    );
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ marginBottom: 16 }}>
        <HomeworkFilterBar
          searchText={searchText}
          onSearchChange={setSearchText}
          searchType={searchType}
          onSearchTypeChange={setSearchType}
          showSearchType
          filterMonth={filterMonth}
          onMonthChange={setFilterMonth}
          availableMonths={availableMonths}
          pillMode
        />
      </div>

      {filteredList.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: TEXT_DISABLED, fontSize: 13 }}>
          검색 결과가 없어요
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredList.map((hw) => (
            <ArchiveHwCard
              key={hw.id}
              hw={hw}
              studentToken={studentToken}
            />
          ))}
        </div>
      )}

      <p style={FOOTNOTE}>
        숙제 관련 문의는 선생님께 해주세요
      </p>
    </div>
  );
}
