import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from 'antd';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { MagnifyingGlassIcon, UsersThreeIcon, CaretDownIcon, ChatCircleDotsIcon, WarningCircleIcon, MinusCircleIcon } from '@phosphor-icons/react';
import Card from 'antd/es/card/Card';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { statusColor, STATUS_ACTIVE } from '../api/students.js';
import { stripEmoji } from '../utils/stringUtils.js';
import { useData } from '../context/DataContext.jsx';
import { queryAll } from '../api/notionClient.js';
import { HOMEWORK_DB, parseHomework } from '../api/homework.js';
import {
  TEXT_TERTIARY, TEXT_INACTIVE, STATUS_ERROR_TEXT, STATUS_INFO_DARK, BORDER_NEUTRAL } from '../constants/theme.js';
import { SECTION_HEADING } from '../constants/styles.js';

// 칩 필터(전체·피드백 대기·미제출·완료·없음)는 없앴다(2026-08-27).
// 진행 중 숙제가 5건뿐이라 '피드백 대기'는 눌러도 빈 화면이었고, 목록이 이미
// 액션 필요한 학생을 위로 올려 정렬하고 있어 칩이 정렬을 한 번 더 하는 꼴이었다.
// 학생 관리와 같은 어법 — 액션별 섹션으로 나누고, 안은 오래 방치된 순.
const SECTIONS = [
  { key: '피드백 대기', Icon: ChatCircleDotsIcon, color: STATUS_INFO_DARK, alwaysOpen: true },
  { key: '미제출', Icon: WarningCircleIcon, color: STATUS_ERROR_TEXT, alwaysOpen: true },
  { key: '진행 중 없음', Icon: MinusCircleIcon, color: TEXT_INACTIVE, alwaysOpen: false },
];

/** 며칠 지났는지. 이 페이지의 핵심 정보 — "미제출 1건"만으론 14일째인지 오늘인지 모른다. */
function daysSince(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d < 0 ? 0 : d;
}

function elapsedLabel(iso) {
  const d = daysSince(iso);
  if (d === null) return null;
  return d === 0 ? '오늘' : `${d}일째`;
}

export default function HomeworkManagePage() {
  const { students, remainingByStudent, loading: studentsLoading, error: studentsError, refresh: refreshStudents } = useData();
  const [search, setSearch] = useState('');
  // 액션이 필요한 두 섹션은 늘 펼쳐 둔다. '진행 중 없음'만 접었다 편다.
  const [openSection, setOpenSection] = useState({});

  // 학생별 진행중 숙제 카운트 + **가장 오래된 건의 시각** — 캐시(기억+갱신).
  // queryPage(100) 단발이었는데 카운트는 집계라 빠지면 조용히 틀린다 → queryAll([[bug_calendar_querypage_truncation]]).
  const countsRes = useCachedResource('homework:counts', async () => {
    // 진행 중 숙제만 (미제출 / 제출완료) — 피드백완료는 강사 액션 불필요
    const results = await queryAll(HOMEWORK_DB, {
      or: [
        { property: '제출 상태', select: { equals: '미제출' } },
        { property: '제출 상태', select: { equals: '제출완료' } },
      ],
    });
    const map = {};
    const older = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
    for (const page of results) {
      const hw = parseHomework(page);
      for (const sid of hw.studentIds) {
        if (!map[sid]) map[sid] = { pending: 0, submitted: 0, oldestPending: null, oldestSubmitted: null };
        if (hw.status === '미제출') {
          map[sid].pending += 1;
          // 미제출은 '언제 내준 숙제인지'가 방치 기간이다 — 제출일이 아직 없다.
          map[sid].oldestPending = older(map[sid].oldestPending, hw.createdTime);
        } else if (hw.status === '제출완료') {
          map[sid].submitted += 1;
          // 피드백 대기는 '학생이 낸 날'부터가 내가 미룬 기간이다.
          map[sid].oldestSubmitted = older(map[sid].oldestSubmitted, hw.submitDate || hw.createdTime);
        }
      }
    }
    return map;
  });
  const counts = countsRes.data ?? {};
  const countsLoading = countsRes.loading;
  const countsError = countsRes.error;

  const handleRefresh = async () => {
    await Promise.all([refreshStudents(), countsRes.refresh()]);
  };

  const searching = Boolean(search.trim());
  const filtered = students.filter((s) => !searching || s.name.includes(search));

  const countOf = (s) => counts[s.id] || { pending: 0, submitted: 0, oldestPending: null, oldestSubmitted: null };
  // 학생 1명은 한 섹션에만. 피드백 대기가 있으면 그쪽이 먼저다 — 내가 할 일이니까.
  const sectionOf = (s) => {
    const c = countOf(s);
    if (c.submitted > 0) return '피드백 대기';
    if (c.pending > 0) return '미제출';
    return '진행 중 없음';
  };
  // 섹션 안은 **오래 방치된 순**. 같으면 수강중 우선 → 잔여 시간 많은 순.
  const bySection = (key) => (a, b) => {
    const ca = countOf(a); const cb = countOf(b);
    if (key !== '진행 중 없음') {
      const oa = key === '피드백 대기' ? ca.oldestSubmitted : ca.oldestPending;
      const ob = key === '피드백 대기' ? cb.oldestSubmitted : cb.oldestPending;
      if (oa && ob && oa !== ob) return oa < ob ? -1 : 1;   // ISO 문자열 비교 = 오래된 것 먼저
    }
    const activeA = a.status === '🟢 수강중' ? 0 : 1;
    const activeB = b.status === '🟢 수강중' ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    return (remainingByStudent[b.id] ?? 0) - (remainingByStudent[a.id] ?? 0);
  };
  const groups = SECTIONS.map((sec) => ({
    ...sec,
    items: filtered.filter((s) => sectionOf(s) === sec.key).sort(bySection(sec.key)),
  }));

  const loading = studentsLoading || countsLoading;
  const error = studentsError || countsError;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageHeader title="숙제 관리" back />

      <div className="px-4 pt-3 pb-2">
        <Input
          size="large"
          placeholder="이름으로 검색"
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: TEXT_TERTIARY }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ borderRadius: 12 }}
          allowClear
        />
      </div>

      {loading && students.length === 0 && <LoadingSpinner />}
      {error && students.length === 0 && <ErrorMessage message={error} onRetry={handleRefresh} />}

      {students.length > 0 && (
        <>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<UsersThreeIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
              title={searching ? '검색 결과가 없어요' : '학생이 없습니다'}
              description={searching ? undefined : '학생 관리에서 학생을 추가하세요.'}
            />
          ) : (
            <div className="px-4 pb-24" style={{ paddingTop: 20 }}>
              {groups.map(({ key, Icon, color, alwaysOpen, items }) => {
                if (!items.length) return null;   // 피드백 대기 0건이면 섹션 자체를 안 그린다
                // 검색 중에는 전부 펼친다 — 접힌 섹션에 결과가 숨으면 안 된다.
                const forced = alwaysOpen || searching;
                const open = forced || !!openSection[key];
                return (
                  <section key={key} style={{ marginBottom: open ? 20 : 28 }}>
                    <button
                      type="button"
                      onClick={() => !forced && setOpenSection((o) => ({ ...o, [key]: !o[key] }))}
                      aria-expanded={open}
                      disabled={forced}
                      className="w-full flex items-center gap-2"
                      style={{
                        background: 'none', border: 'none', padding: 0, minHeight: 34,
                        cursor: forced ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <Icon size={20} weight="fill" color={color} style={{ flexShrink: 0 }} />
                      <span style={{ ...SECTION_HEADING, display: 'inline', marginBottom: 0 }}>{key}</span>
                      {!forced && (
                        <CaretDownIcon
                          size={16}
                          weight="bold"
                          color={TEXT_TERTIARY}
                          style={{
                            // 총합 숫자를 뺐으니 화살표가 오른쪽 끝을 맡는다.
                            marginLeft: 'auto',
                            transform: open ? 'rotate(180deg)' : 'none',
                            transitionProperty: 'transform',
                            transitionDuration: '0.2s',
                            transitionTimingFunction: 'var(--ease-out)',
                          }}
                        />
                      )}
                    </button>
                    <div className="reveal" data-open={open}>
                      {/* overflow:hidden이 걸리는 건 .reveal의 직속 자식이다 — 여백은 이 상자에
                          줘야 카드 그림자가 안 잘린다(학생 관리에서 실측 0px, 2026-08-26). */}
                      <div style={{ marginInline: -8, paddingInline: 8 }}>
                        <ul className="space-y-3 pt-3 pb-2">
                          {items.map((student) => (
                            <HomeworkStudentCard key={student.id} student={student} count={countOf(student)} />
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </PullToRefresh>
  );
}

function HomeworkStudentCard({ student, count }) {
  // '수강중' 배지는 안 그린다 — 거의 모든 카드에 똑같이 붙어 정보량이 0이다(2026-08-27).
  // 대신 **수강중이 아닌** 학생은 배지를 남긴다. 수강종료 학생이 미제출로 떠 있으면 그건 알아야 한다.
  const showStatus = student.status !== STATUS_ACTIVE;
  const { bg, text } = statusColor(student.status);
  return (
    <li>
      <Link
        to={`/students/${student.id}/homework`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 16 }}
          styles={{ body: { padding: '16px' } }}
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-base font-bold text-gray-900">{student.name}</span>
            {showStatus && <Badge label={stripEmoji(student.status)} bg={bg} text={text} />}
          </div>
          <div className="flex gap-4 text-sm">
            {count.submitted > 0 && (
              <HomeworkCount
                label="피드백 대기"
                n={count.submitted}
                color={STATUS_INFO_DARK}
                elapsed={elapsedLabel(count.oldestSubmitted)}
              />
            )}
            {count.pending > 0 && (
              <HomeworkCount
                label="미제출"
                n={count.pending}
                color={STATUS_ERROR_TEXT}
                elapsed={elapsedLabel(count.oldestPending)}
              />
            )}
            {count.submitted === 0 && count.pending === 0 && (
              <div>
                <span className="text-gray-400 text-xs">진행 중 숙제 없음</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}

/**
 * "미제출 1건 · 14일째" — 건수만으론 오늘 낸 숙제와 2주 방치된 숙제가 똑같아 보인다.
 * 경과일은 **가장 오래된 건** 기준이고, 색은 쓰지 않는다(§18 — 강조는 순서가 맡는다).
 */
function HomeworkCount({ label, n, color, elapsed }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label} </span>
      <span className="font-semibold tabular-nums" style={{ color }}>{n}건</span>
      {elapsed && (
        <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY }}> · {elapsed}</span>
      )}
    </div>
  );
}
