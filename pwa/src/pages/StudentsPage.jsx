import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { MagnifyingGlassIcon, UsersThreeIcon, CaretDownIcon, CheckCircleIcon, PauseCircleIcon, MinusCircleIcon, UserPlusIcon } from '@phosphor-icons/react';
import Card from 'antd/es/card/Card';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { STATUS_OPTIONS, STATUS_ACTIVE } from '../api/students.js';
import { formatKRW } from '../utils/dateUtils.js';
import { formatSessions } from '../api/payments.js';
import { stripEmoji } from '../utils/stringUtils.js';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import { useData } from '../context/DataContext.jsx';
import { TEXT_PRIMARY, TEXT_INACTIVE, TEXT_TERTIARY, BORDER_NEUTRAL, STATUS_SUCCESS_DARK, STATUS_WARNING_TEXT, STATUS_ERROR_TEXT } from '../constants/theme.js';
import { SECTION_HEADING, ABOVE_BOTTOM_NAV } from '../constants/styles.js';

// 섹션 헤더 아이콘 — 노션 상태값의 이모지(🟢🟡⚫) 대신 phosphor 아이콘을 쓴다(§19.1).
// 같은 원형 계열로 묶어 "하나의 상태 스케일"로 읽히게 하고, 색은 의미색 토큰.
const STATUS_ICON = {
  '🟢 수강중': { Icon: CheckCircleIcon, color: STATUS_SUCCESS_DARK },
  '🟡 일시중단': { Icon: PauseCircleIcon, color: STATUS_WARNING_TEXT },
  '⚫ 수강종료': { Icon: MinusCircleIcon, color: TEXT_INACTIVE },
};

export default function StudentsPage() {
  const navigate = useNavigate();
  // DataContext의 학생 데이터를 그대로 사용 → 다른 페이지가 학생 추가/수정해도 자동 반영
  // stale 캐시가 있으면 즉시 표시하고 백그라운드에서 새로고침되는 패턴
  const { students, remainingByStudent, loading, error, refresh } = useData();
  const [search, setSearch] = useState('');
  // 수강중은 늘 펼쳐 둔다(이 화면에 오는 주 목적). 나머지는 접었다 펼친다.
  const [openStatus, setOpenStatus] = useState({});

  const searching = Boolean(search.trim());
  const filtered = students.filter((s) => !searching || s.name.includes(search));

  // 상태별로 묶는다 — 칩 필터를 눌러 목록을 갈아끼우는 대신 한 화면에서 스크롤로 오간다.
  // 각 묶음 안은 예약 가능 시간이 많은 순(= 수업을 더 잡을 수 있는 학생부터).
  const byRemaining = (a, b) => (remainingByStudent[b.id] ?? 0) - (remainingByStudent[a.id] ?? 0);
  const groups = STATUS_OPTIONS.map((status) => ({
    status,
    items: filtered.filter((s) => s.status === status).sort(byRemaining),
  }));
  // 노션에서 상태가 비었거나 목록에 없는 값이면 사라지지 않게 따로 담는다.
  const others = filtered.filter((s) => !STATUS_OPTIONS.includes(s.status)).sort(byRemaining);
  if (others.length) groups.push({ status: '상태 미지정', items: others });

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageHeader title="학생 관리" />

      <div className="px-4 pt-4">
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
      {error && students.length === 0 && <ErrorMessage message={error} onRetry={refresh} />}

      {students.length > 0 && (
        <>
          {filtered.length === 0 ? (
            <EmptyState icon={<UsersThreeIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title={searching ? '검색 결과가 없어요' : '학생이 없습니다'} description={searching ? undefined : '노션에서 학생을 추가하세요.'} />
          ) : (
            <div className="px-4" style={{ paddingTop: 20, paddingBottom: 152 }}>
              {groups.map(({ status, items }) => {
                if (!items.length) return null;
                // 수강중은 항상, 검색 중에는 전부 펼친다 — 접힌 섹션에 결과가 숨으면 안 된다.
                const alwaysOpen = status === STATUS_ACTIVE || searching;
                const open = alwaysOpen || !!openStatus[status];
                return (
                  <section key={status} style={{ marginBottom: open ? 20 : 28 }}>
                    <button
                      type="button"
                      onClick={() => !alwaysOpen && setOpenStatus((o) => ({ ...o, [status]: !o[status] }))}
                      aria-expanded={open}
                      disabled={alwaysOpen}
                      className="w-full flex items-center gap-2"
                      style={{
                        background: 'none', border: 'none', padding: 0, minHeight: 34,
                        cursor: alwaysOpen ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {(() => {
                        const { Icon, color } = STATUS_ICON[status] ?? { Icon: MinusCircleIcon, color: TEXT_INACTIVE };
                        return <Icon size={20} weight="fill" color={color} style={{ flexShrink: 0 }} />;
                      })()}
                      <span style={{ ...SECTION_HEADING, display: 'inline', marginBottom: 0 }}>{stripEmoji(status)}</span>
                      {!alwaysOpen && (
                        <CaretDownIcon
                          size={16}
                          weight="bold"
                          color={TEXT_TERTIARY}
                          style={{
                            // 총합 숫자를 뺐으니 화살표가 오른쪽 끝을 맡는다.
                            marginLeft: 'auto',
                            // 접힘 ⌄ / 펼침 ⌃ — 아코디언 관용 방향.
                            // 오른쪽 화살표(›)는 "다른 화면으로 이동"으로 읽힌다.
                            transform: open ? 'rotate(180deg)' : 'none',
                            transitionProperty: 'transform',
                            transitionDuration: '0.2s',
                            transitionTimingFunction: 'var(--ease-out)',
                          }}
                        />
                      )}
                    </button>
                    <div className="reveal" data-open={open}>
                      {/* overflow:hidden이 걸리는 건 .reveal의 **직속 자식**이다.
                          그래서 여백도 이 상자에 줘야 한다 — 안쪽 ul에 -mx를 주면
                          그만큼 다시 상자 밖으로 나가 카드 그림자가 그대로 잘린다(2026-08-26 실측 0px). */}
                      <div style={{ marginInline: -8, paddingInline: 8 }}>
                        <ul className="space-y-3 pt-3 pb-2">
                          {items.map((student) => (
                            <StudentCard key={student.id} student={student} remaining={remainingByStudent[student.id] ?? 0} />
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

      {/* 학생 추가 — 수업 캘린더·결제 내역·숙제 관리와 같은 원형 FAB(브랜드 채움).
          ⛔ 헤더 '+ 학생 추가' 채움 버튼으로 되돌리지 말 것(2026-08-27 사용자 지시) */}
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
          aria-label="학생 추가"
          onClick={() => navigate('/students/new')}
          style={{
            width: 56, height: 56,
            boxShadow: 'var(--shadow-brand-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <UserPlusIcon weight="fill" size={24} />
        </Button>
      </div>
    </PullToRefresh>
  );
}

function StudentCard({ student, remaining }) {
  return (
    <li>
      <Link
        to={`/students/${student.id}`}
        className="block tap-wrap"
      >
        <Card
          variant="borderless"
          className="card-tap"
          style={{ borderRadius: 16 }}
          styles={{ body: { padding: '16px' } }}
        >
          {/* 상태 배지는 없다 — 카드가 상태별 섹션 안에 있어 헤더가 이미 말해준다(2026-08-26) */}
          <p className="text-base font-bold text-gray-900" style={{ margin: '0 0 8px' }}>{student.name}</p>
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-gray-500 text-xs">예약 가능 </span>
              {/* ⛔ 잔여가 적다고 색을 바꾸지 않는다 — Tailwind 빨강도 경고색(주황)도 둘 다 거절됐다(2026-08-27).
                  목록이 이미 예약 가능 시간 적은 순으로 정렬돼 있어 **순서가 위계를 맡는다**([[design_system]] §18). */}
              <span className="font-semibold tabular-nums" style={{ color: TEXT_PRIMARY }}>
                {formatSessions(remaining)}시간
              </span>
            </div>
            {student.unpaidAmount > 0 && (
              <div>
                <span className="text-gray-500 text-xs">미수금 </span>
                {/* 미수금은 실제로 받아야 할 돈 → 앱의 오류색 토큰 */}
                <span className="font-semibold tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>{formatKRW(student.unpaidAmount)}</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
