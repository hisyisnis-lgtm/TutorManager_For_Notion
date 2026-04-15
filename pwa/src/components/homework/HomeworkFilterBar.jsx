import { Input, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

/**
 * HomeworkFilterBar — 숙제 검색 + 월별/상태별 필터
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 *
 * props:
 *   searchText / onSearchChange
 *   filterMonth / onMonthChange
 *   filterStatus / onStatusChange
 *   availableMonths: string[]  — 'YYYY-MM' 형식, 내림차순
 */
export default function HomeworkFilterBar({
  searchText,
  onSearchChange,
  filterMonth,
  onMonthChange,
  filterStatus,
  onStatusChange,
  availableMonths = [],
}) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 검색 */}
      <Input
        prefix={<SearchOutlined style={{ color: '#767676' }} />}
        placeholder="숙제 이름 검색"
        value={searchText}
        onChange={(e) => onSearchChange(e.target.value)}
        allowClear
        style={{ borderRadius: 12, height: 40 }}
      />

      {/* 월 + 상태 필터 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Select
          value={filterMonth}
          onChange={onMonthChange}
          options={monthOptions}
          style={{ flex: 1 }}
          styles={{ popup: { root: { borderRadius: 12 } } }}
        />
        <Select
          value={filterStatus}
          onChange={onStatusChange}
          options={statusOptions}
          style={{ flex: 1 }}
          styles={{ popup: { root: { borderRadius: 12 } } }}
        />
      </div>
    </div>
  );
}
