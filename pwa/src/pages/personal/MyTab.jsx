import { CaretRightIcon, ChatTeardropTextIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import LoadingSpinner from '../../components/ui/LoadingSpinner.jsx';
import { getStageInfo, getPandaStorageKey } from '../../components/ui/PandaWidget.jsx';
import { formatDuration } from '../../utils/dateUtils.js';
import { PRIMARY, TEXT_PRIMARY, TEXT_TERTIARY, TEXT_INACTIVE } from '../../constants/theme.js';

// 설정 패널 '피드백 남기기'와 같은 구글 폼(서비스 개선의견) — 별도 폼이 생기면 여기만 바꾼다
const FEEDBACK_URL = 'https://forms.gle/dCwXvZAdfG12AxoJ9';

// ===== MY 탭 =====
// 홈에 있던 '내 현황'(지표 + 팬더)을 이사시킨 개인 공간 (2026-08-31 하단탭 재편).
// 홈은 수업·숙제 흐름에 집중하고, 나에 대한 정보는 여기로 모은다.

export default function MyTab({ student, studentToken, foodSources, onOpenPanda }) {
  if (!student) return <LoadingSpinner />;

  const total = foodSources.reduce((s, x) => s + (x.count || 0), 0);
  // 학생별 키 사용 → 다른 학생의 EXP가 섞여 표시되던 문제 해결 (HomeTab에서 이어짐)
  const fed = Math.min(parseInt(localStorage.getItem(getPandaStorageKey(studentToken)) || '0', 10), total);
  const { stage } = getStageInfo(fed);

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <SectionHeading>내 현황</SectionHeading>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: '남은 수업 시간', value: formatDuration((student.remainingHours ?? 0) * 60) },
            { label: '완료한 수업', value: formatDuration(student.completedMinutes ?? 0) },
          ].map(({ label, value }) => (
            <div key={label} style={{
              flex: 1, background: '#fff', borderRadius: 12, padding: '12px 14px',
              boxShadow: 'var(--shadow-border)' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: TEXT_TERTIARY, margin: '0 0 4px' }}>{label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.15 }} className="tabular-nums">
                {value}
              </p>
            </div>
          ))}
        </div>
        <button
          data-coach="panda"
          type="button"
          onClick={onOpenPanda}
          style={{
            marginTop: 8, width: '100%',
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#fff', border: 'none', cursor: 'pointer',
            borderRadius: 16, boxShadow: 'var(--shadow-border)',
            padding: '12px 14px', textAlign: 'left',
            WebkitTapHighlightColor: 'transparent' }}
        >
          <img
            src={stage.img} alt="" aria-hidden="true"
            width={44} height={44}
            style={{ objectFit: 'contain', flexShrink: 0 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>내 팬더</span>
            <span style={{ display: 'block', fontSize: 13, color: TEXT_TERTIARY, marginTop: 2 }}>
              {stage.label} · 수업할수록 자라요
            </span>
          </span>
          <CaretRightIcon size={16} weight="bold" color={TEXT_INACTIVE} style={{ flexShrink: 0 }} />
        </button>
      </div>

      {/* 피드백 남기기 — 하늘하늘 탭 링크 카드와 같은 어법(아이콘 + 라벨·설명 + 외부 링크 표시) */}
      <div style={{ marginBottom: 24 }}>
        <a
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="press"
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 16,
            background: '#fff', borderRadius: 16,
            boxShadow: 'var(--shadow-border)',
            textDecoration: 'none',
            WebkitTapHighlightColor: 'transparent' }}
        >
          <ChatTeardropTextIcon size={24} weight="fill" color={PRIMARY} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY }}>피드백 남기기</span>
            <span style={{ display: 'block', fontSize: 13, color: TEXT_TERTIARY, marginTop: 1 }}>
              불편한 점이나 바라는 점을 들려주세요
            </span>
          </span>
          <ArrowSquareOutIcon size={16} weight="bold" color={TEXT_INACTIVE} />
        </a>
      </div>
    </div>
  );
}
