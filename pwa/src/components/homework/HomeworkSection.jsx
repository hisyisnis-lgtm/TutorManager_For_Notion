import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_INACTIVE } from '../../constants/theme.js';

/**
 * HomeworkSection — 섹션 헤더 + 카드 목록 래퍼
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 *
 * props:
 *   icon     ReactNode  — Phosphor 아이콘
 *   label    string     — 섹션 제목 텍스트
 *   count    number     — 항목 수
 *   color    string     — 아이콘 색상
 *   children
 */
export default function HomeworkSection({ icon, label, count, color = TEXT_SECONDARY, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 10,
      }}>
        <span style={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {icon}
        </span>
        <span style={{ fontSize: 17, fontWeight: 600, color: TEXT_PRIMARY }}>
          {label}
        </span>
        {count != null && (
          <span style={{ fontSize: 17, fontWeight: 600, color: TEXT_INACTIVE, marginLeft: 'auto' }} className="tabular-nums">{count}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
