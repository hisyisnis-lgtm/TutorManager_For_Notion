import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Input } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import MonthRangeFilter, { yearsOf, filterByMonthRange } from '../components/ui/MonthRangeFilter.jsx';
import HomeworkSection from '../components/homework/HomeworkSection.jsx';
import { fetchStudentHomework, parseHomework } from '../api/homework.js';
import { getPage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import { ClipboardTextIcon, HourglassIcon, ChatTeardropTextIcon, CaretRightIcon, MagnifyingGlassIcon, NotePencilIcon, PaperclipIcon } from '@phosphor-icons/react';
import { formatDateDot } from '../utils/dateUtils.js';
import { ABOVE_BOTTOM_NAV } from '../constants/styles.js';
import {
  STATUS_ERROR_TEXT,
  STATUS_INFO,
  STATUS_SUCCESS_DARK,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  TEXT_DISABLED,
  BORDER_NEUTRAL,
  GRAY_100,
} from '../constants/theme.js';

/** 플로팅 '숙제 추가' 버튼(원형 56px) + 여백까지 비워둘 스크롤 하단 여백 */
const FAB_CLEARANCE = 152;
/** 섹션당 처음 보여줄 개수 */
const INITIAL = 3;
/** '더 보기' 한 번에 늘어나는 개수 */
const STEP = 5;

// 섹션 순서·아이콘·색. 상태값을 그대로 키로 쓴다(노션 '상태' select와 동일 문자열).
const SECTIONS = [
  { key: '미제출', icon: <ClipboardTextIcon size={20} weight="fill" />, color: STATUS_ERROR_TEXT },
  { key: '제출완료', icon: <HourglassIcon size={20} weight="fill" />, color: STATUS_INFO },
  { key: '피드백완료', icon: <ChatTeardropTextIcon size={20} weight="fill" />, color: STATUS_SUCCESS_DARK },
];

export default function StudentHomeworkPage() {
  const { id } = useParams();  // studentId
  const navigate = useNavigate();

  const [student, setStudent] = useState(null);
  const [homeworkList, setHomeworkList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 검색 + 필터
  const [searchText, setSearchText] = useState('');
  // 날짜 범위 필터 — 수업·결제 목록과 같은 어법(components/ui/MonthRangeFilter).
  // 등록일(createdTime) 기준. 값을 안 건드리면 데이터 전 구간 = 전체.
  const [range, setRange] = useState({ sy: '', sm: '', ey: '', em: '' });
  // 섹션별로 몇 개까지 펼쳤는지. 피드백완료가 수십 건씩 쌓여 한 번에 다 그리면 화면이 끝없이 길어진다.
  const [limits, setLimits] = useState({ 미제출: INITIAL, 제출완료: INITIAL, 피드백완료: INITIAL });

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

  const years = yearsOf(homeworkList.map((h) => h.createdTime));
  const inRange = filterByMonthRange(homeworkList, (h) => h.createdTime, range, years);
  const filteredList = searchText
    ? inRange.filter((h) => h.title.toLowerCase().includes(searchText.toLowerCase()))
    : inRange;

  const groups = {
    미제출: filteredList.filter((h) => h.status === '미제출'),
    제출완료: filteredList.filter((h) => h.status === '제출완료'),
    피드백완료: filteredList.filter((h) => h.status === '피드백완료'),
  };

  const studentName = student?.name?.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim() ?? '';


  if (loading) return <><PageHeader title="숙제" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="숙제" back /><ErrorMessage message={error} /></>;

  return (
    <>
      <PageHeader
        title={`${studentName} 숙제`}
        back
      />

      <div className="px-4 pt-4" style={{ paddingBottom: FAB_CLEARANCE }}>

        {/* 검색 + 날짜 범위 필터.
            상태(미제출·제출완료·피드백완료) Select는 뺐다 — 목록이 이미 상태별 섹션으로
            나뉘어 있어 중복이었다(2026-08-26). */}
        {homeworkList.length > 0 && (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Input
              prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
              placeholder="숙제 이름 검색"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ borderRadius: 12, height: 40 }}
            />
            {years.length > 0 && (
              <MonthRangeFilter years={years} value={range} onChange={setRange} />
            )}
          </div>
        )}

        {/* 빈 상태 */}
        {homeworkList.length === 0 && (
          <EmptyState icon={<ClipboardTextIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="숙제가 없어요" description="오른쪽 아래 + 버튼으로 숙제를 등록해보세요" />
        )}

        {/* 필터 결과 없음 */}
        {homeworkList.length > 0 && filteredList.length === 0 && (
          <EmptyState icon={<MagnifyingGlassIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="검색 결과가 없어요" />
        )}

        {SECTIONS.map(({ key, icon, color }) => {
          const items = groups[key];
          if (!items.length) return null;
          const limit = limits[key];
          const rest = items.length - limit;
          return (
            <HomeworkSection key={key} icon={icon} label={key} color={color}>
              {items.slice(0, limit).map((hw) => (
                <HomeworkCard key={hw.id} hw={hw} onClick={() => navigate(`/homework/${hw.id}`)} />
              ))}
              {rest > 0 && (
                <button
                  type="button"
                  onClick={() => setLimits((l) => ({ ...l, [key]: l[key] + STEP }))}
                  className="w-full"
                  style={{
                    height: 40, borderRadius: 12, background: GRAY_100, border: 'none',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600, color: TEXT_SECONDARY,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  더 보기
                </button>
              )}
            </HomeworkSection>
          );
        })}
      </div>

      {/* 숙제 추가 — 학생별 수업 관리와 같은 형태(원형 FAB, 브랜드 채움) */}
      <div
        style={{
          position: 'fixed', right: 16,
          bottom: `calc(${ABOVE_BOTTOM_NAV} + 16px)`,
          zIndex: 40,
        }}
      >
        <Button
          type="primary"
          shape="circle"
          aria-label="숙제 추가"
          onClick={() => navigate(`/homework/new?studentId=${id}`)}
          style={{
            width: 56, height: 56,
            boxShadow: 'var(--shadow-brand-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <NotePencilIcon weight="fill" size={24} />
        </Button>
      </div>
    </>
  );
}

function HomeworkCard({ hw, onClick }) {
  const fileCount = hw.submitFiles?.length ?? 0;

  const dateLabel = hw.submitDate
    ? `제출 ${formatDateDot(hw.submitDate)}`
    : hw.createdTime
    ? `등록 ${formatDateDot(hw.createdTime)}`
    : '';

  return (
    <div
      className="tap-wrap"
      onClick={onClick}
    >
    <Card
      variant="borderless"
      className="card-tap"
      style={{ borderRadius: 16, cursor: 'pointer' }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* 텍스트 영역 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY,
            marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hw.title}
          </p>
          {hw.content && (
            <p style={{
              fontSize: 12, color: TEXT_SECONDARY,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
            }}>
              {hw.content}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {dateLabel && (
              <span style={{ fontSize: 11, color: TEXT_DISABLED }}>{dateLabel}</span>
            )}
            {fileCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: TEXT_TERTIARY }}>
                <PaperclipIcon size={12} weight="bold" />
                {fileCount}개
              </span>
            )}
          </div>
        </div>

        {/* 상태 배지는 없다 — 카드가 상태별 섹션 안에 있어 헤더가 이미 말해준다(2026-08-27).
            초록 '피드백완료' 배지가 목록 전체에서 가장 강조돼 보이던 게 문제였다. */}
        <CaretRightIcon size={16} weight="bold" color={BORDER_NEUTRAL} style={{ flexShrink: 0 }} />
      </div>
    </Card>
    </div>
  );
}
