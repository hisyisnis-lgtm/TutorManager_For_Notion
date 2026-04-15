/**
 * HomeworkSection — 섹션 헤더 + 카드 목록 래퍼
 * 강사용 StudentHomeworkPage, 학생용 PersonalPage 공용
 *
 * props:
 *   title: string   — 섹션 제목 (이모지 포함 가능)
 *   count: number   — 표시할 개수 (title에 이미 포함된 경우 생략)
 *   children
 */
export default function HomeworkSection({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{
        fontSize: 12,
        fontWeight: 700,
        color: '#767676',
        margin: '0 0 8px',
        letterSpacing: 0.2,
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}
