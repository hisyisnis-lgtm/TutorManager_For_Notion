import { useNavigate } from 'react-router-dom';
import { CaretRightIcon, MegaphoneIcon } from '@phosphor-icons/react';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { fetchStudentNotices } from '../../api/notices.js';
import LoadingSpinner from '../../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../../components/ui/ErrorMessage.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { formatDateDot } from '../../utils/dateUtils.js';
import { BADGE_SMALL } from '../../constants/styles.js';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_TERTIARY, TEXT_INACTIVE, BORDER_NEUTRAL } from '../../constants/theme.js';

// 전체 학생 공통 공지 목록. 강사가 강사앱에서 올린다.
// 알림은 붙어 있지 않다 — 학생이 앱을 열었을 때만 보이므로 급한 공지는 카톡이 담당한다.
export default function NoticeTab({ studentToken }) {
  const navigate = useNavigate();
  const res = useCachedResource(`student:notices:${studentToken}`, () => fetchStudentNotices(studentToken));
  const notices = res.data ?? [];

  if (res.loading) return <LoadingSpinner />;
  if (res.error) return <ErrorMessage message={res.error} onRetry={res.refresh} />;

  if (notices.length === 0) {
    return (
      <EmptyState
        icon={<MegaphoneIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
        title="아직 공지가 없어요"
        description={"선생님이 공지를 올리면\n여기에 표시돼요"}
      />
    );
  }

  // 제목 + 본문 첫 줄 미리보기 — 전문은 눌러서 상세로.
  // 본문을 다 펼치면 스크롤 벽이 되지만, 한 줄 프리뷰는 열기 전에 내용을 가늠하게 해준다(2026-08-31 평가).
  return (
    <div style={{ padding: '16px 16px 0' }}>
      {notices.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => navigate(`/personal/${studentToken}/notice/${n.id}`, { state: { tab: '공지' } })}
          style={{
            width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
            background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 10,
            boxShadow: 'var(--shadow-border)', minHeight: 64,
            display: 'flex', alignItems: 'center', gap: 10,
            WebkitTapHighlightColor: 'transparent' }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {n.important && (
                <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY, flexShrink: 0 }}>중요</span>
              )}
              <span style={{
                fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.title}
              </span>
            </span>
            {n.content && (
              <span style={{
                display: 'block', fontSize: 13, color: TEXT_TERTIARY, marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {n.content.split('\n').find((l) => l.trim()) || ''}
              </span>
            )}
            {n.publishedAt && (
              <span className="tabular-nums" style={{ display: 'block', fontSize: 12, color: TEXT_INACTIVE, marginTop: 4 }}>
                {formatDateDot(n.publishedAt)}
              </span>
            )}
          </span>
          <CaretRightIcon size={16} weight="bold" style={{ color: TEXT_INACTIVE, flexShrink: 0 }} />
        </button>
      ))}
    </div>
  );
}

