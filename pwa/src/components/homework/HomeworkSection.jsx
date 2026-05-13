import { TEXT_SECONDARY, TEXT_INACTIVE } from '../../constants/theme.js';
import { SECTION_HEADING } from '../../constants/styles.js';

/**
 * HomeworkSection — 섹션 헤더(icon + label + count) + 카드 목록 래퍼
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 * design_system.md §3.4 섹션 헤딩 규칙: 17px / 600 / TEXT_PRIMARY (SECTION_HEADING 상수)
 * flex 컨텍스트라 display·marginBottom은 override.
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
        <span style={{ ...SECTION_HEADING, display: 'inline', marginBottom: 0 }}>
          {label}
        </span>
        {count != null && (
          <span style={{ ...SECTION_HEADING, display: 'inline', marginBottom: 0, color: TEXT_INACTIVE, marginLeft: 'auto' }} className="tabular-nums">{count}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
