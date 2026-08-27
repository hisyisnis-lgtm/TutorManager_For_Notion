import { TEXT_SECONDARY } from '../../constants/theme.js';
import { SECTION_HEADING } from '../../constants/styles.js';

/**
 * HomeworkSection — 섹션 헤더(icon + label) + 카드 목록 래퍼
 * ⛔ 헤더 오른쪽 총합 숫자는 넣지 않는다(2026-08-27 사용자 지시) — 카드가 바로 아래 보이는데
 *    개수를 또 적을 이유가 없었다.
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 * design_system.md §3.4 섹션 헤딩 규칙: 17px / 600 / TEXT_PRIMARY (SECTION_HEADING 상수)
 * flex 컨텍스트라 display·marginBottom은 override.
 */
export default function HomeworkSection({ icon, label, color = TEXT_SECONDARY, children }) {
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
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
