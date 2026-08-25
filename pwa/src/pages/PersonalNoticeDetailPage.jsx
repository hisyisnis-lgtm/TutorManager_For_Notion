import { useParams, useNavigate } from 'react-router-dom';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { fetchStudentNotices } from '../api/notices.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import AutoLink from '../components/ui/AutoLink.jsx';
import { formatDateDot } from '../utils/dateUtils.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_TERTIARY, BORDER_NEUTRAL, BORDER_SUBTLE } from '../constants/theme.js';
import { MegaphoneIcon } from '@phosphor-icons/react';

// 공지 상세 — 목록에서 제목만 보고 들어온 학생이 본문을 읽는 화면.
// 별도 fetch를 만들지 않고 목록 캐시(student:notices:<token>)를 그대로 재사용한다.
// 목록을 거치지 않고 주소로 바로 들어와도 캐시가 없으면 알아서 받아온다.
export default function PersonalNoticeDetailPage() {
  const { studentToken, noticeId } = useParams();
  const navigate = useNavigate();

  const res = useCachedResource(`student:notices:${studentToken}`, () => fetchStudentNotices(studentToken));
  const notice = (res.data ?? []).find((n) => n.id === noticeId);

  const goList = () => navigate(`/personal/${studentToken}`, { state: { tab: '공지' } });

  if (res.loading) return <><PageHeader title="공지" back onBack={goList} /><LoadingSpinner /></>;
  if (res.error) return <><PageHeader title="공지" back onBack={goList} /><ErrorMessage message={res.error} onRetry={res.refresh} /></>;

  if (!notice) {
    return (
      <>
        <PageHeader title="공지" back onBack={goList} />
        <EmptyState
          icon={<MegaphoneIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
          title="공지를 찾을 수 없어요"
          description={"선생님이 내렸거나\n주소가 바뀌었을 수 있어요"}
        />
      </>
    );
  }

  // 화면 전체가 공지 한 건이므로 카드로 감싸지 않는다 —
  // 목록에서 카드를 눌렀는데 안에 또 카드가 나오면 한 겹 더 들어온 것처럼 보인다.
  return (
    <>
      <PageHeader title="공지" back onBack={goList} />
      {/* 100vh는 iOS 주소창 높이가 빠지지 않아 화면보다 커진다 — dvh로 잡는다(게임에서 겪은 것과 같은 건). */}
      <div style={{ background: '#fff', minHeight: 'calc(100dvh - 56px)', padding: '24px 20px 40px' }}>
        {notice.important && (
          <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY, display: 'inline-block', marginBottom: 8 }}>
            중요
          </span>
        )}

        <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.35, wordBreak: 'keep-all' }}>
          {notice.title}
        </h1>

        {notice.publishedAt && (
          <p className="tabular-nums" style={{ fontSize: 13, color: TEXT_TERTIARY, margin: '8px 0 0' }}>
            {formatDateDot(notice.publishedAt)}
          </p>
        )}

        <div style={{ height: 1, background: BORDER_SUBTLE, margin: '18px 0 20px' }} />

        {notice.content && (
          <p style={{ fontSize: 15, color: '#262626', lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0, wordBreak: 'keep-all' }}>
            <AutoLink text={notice.content} />
          </p>
        )}
      </div>
    </>
  );
}
