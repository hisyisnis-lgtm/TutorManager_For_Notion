import { Input, Select } from 'antd';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';

/**
 * HomeworkFilterBar — 숙제 검색 + 월별/상태별 필터
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 *
 * props:
 *   searchText / onSearchChange
 *   searchType: 'title' | 'content'  — 검색 타입 (pillMode에서만 표시)
 *   onSearchTypeChange
 *   filterMonth / onMonthChange
 *   filterStatus / onStatusChange
 *   availableMonths: string[]  — 'YYYY-MM' 형식, 내림차순
 *   hideStatus: bool           — 상태 Select 숨김 (기본 false)
 *   pillMode: bool             — 월 필터를 pill 칩으로 표시 (기본 false)
 *   showSearchType: bool       — 검색 타입 토글 표시 (기본 false)
 */
export default function HomeworkFilterBar({
  searchText,
  onSearchChange,
  searchType = 'title',
  onSearchTypeChange,
  filterMonth,
  onMonthChange,
  filterStatus,
  onStatusChange,
  availableMonths = [],
  hideStatus = false,
  pillMode = false,
  showSearchType = false,
}) {
  const currentYear = new Date().getFullYear();

  const monthOptions = [
    { value: '', label: '전체 기간' },
    ...availableMonths.map((m) => {
      const [y, mo] = m.split('-');
      return { value: m, label: `${y}년 ${Number(mo)}월` };
    }),
  ];

  const statusOptions = [
    { value: '', label: '전체 상태' },
    { value: '미제출', label: '미제출' },
    { value: '제출완료', label: '제출완료' },
    { value: '피드백완료', label: '피드백완료' },
  ];

  const searchPlaceholder = searchType === 'content' ? '숙제 내용 검색' : '숙제 이름 검색';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 검색 + 검색 타입 토글 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          prefix={<MagnifyingGlassIcon weight="fill" style={{ color: '#767676' }} />}
          placeholder={searchPlaceholder}
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          allowClear
          style={{ borderRadius: 12, height: 40, flex: 1 }}
        />
        {showSearchType && onSearchTypeChange && (
          <div style={{ display: 'flex', border: '1.5px solid #e0e0e0', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
            {[{ value: 'title', label: '제목' }, { value: 'content', label: '내용' }].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onSearchTypeChange(value)}
                style={{
                  height: 40, padding: '0 12px', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: searchType === value ? 700 : 400,
                  background: searchType === value ? '#7f0005' : '#fff',
                  color: searchType === value ? '#fff' : '#595959',
                  transition: 'background 150ms ease-out, color 150ms ease-out',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 월 필터 — pill 칩 모드 */}
      {pillMode && availableMonths.length >= 1 && (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto',
          scrollbarWidth: 'none', msOverflowStyle: 'none', paddingBottom: 2,
        }}>
          {['', ...availableMonths].map((m) => {
            const isActive = filterMonth === m;
            let label = '전체';
            if (m) {
              const [y, mo] = m.split('-').map(Number);
              label = y === currentYear ? `${mo}월` : `${y}년 ${mo}월`;
            }
            return (
              <button
                key={m}
                type="button"
                onClick={() => onMonthChange(m)}
                className="active:scale-[0.96]"
                style={{
                  flexShrink: 0,
                  height: 32, padding: '0 14px', borderRadius: 100,
                  border: isActive ? 'none' : '1.5px solid #e0e0e0',
                  background: isActive ? '#7f0005' : '#fff',
                  color: isActive ? '#fff' : '#595959',
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  transitionProperty: 'background, color, border-color, scale',
                  transitionDuration: '150ms',
                  transitionTimingFunction: 'ease-out',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* 월 + 상태 필터 — Select 드롭다운 모드 */}
      {!pillMode && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={filterMonth}
            onChange={onMonthChange}
            options={monthOptions}
            style={{ flex: 1 }}
            styles={{ popup: { root: { borderRadius: 12 } } }}
          />
          {!hideStatus && (
            <Select
              value={filterStatus}
              onChange={onStatusChange}
              options={statusOptions}
              style={{ flex: 1 }}
              styles={{ popup: { root: { borderRadius: 12 } } }}
            />
          )}
        </div>
      )}
    </div>
  );
}
