import { stripEmoji } from '../../utils/stringUtils.js';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_TERTIARY } from '../../constants/theme.js';
import { BADGE_SMALL } from '../../constants/styles.js';

/**
 * 수업 일지 본문 — 내일수업준비 카드와 일지 상세 공용.
 * 읽기 전용이며, 비어 있는 항목은 아예 그리지 않는다(빈 라벨만 남는 것을 막는다).
 */
export default function LessonLogBody({ log }) {
  const empty = !log.content && !log.homework && !log.nextPrepare && !log.memo && !log.engagement;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <LogSection label="오늘 내용" text={log.content} />
      <LogSection label="숙제" text={log.homework} />
      <LogSection label="다음 수업 준비" text={log.nextPrepare} />
      {log.engagement && (
        <div>
          <LogLabel>학생 참여도</LogLabel>
          <span style={{ ...BADGE_SMALL, display: 'inline-block', borderRadius: 980, background: PRIMARY_BG, color: PRIMARY }}>
            {stripEmoji(log.engagement)}
          </span>
        </div>
      )}
      <LogSection label="메모" text={log.memo} />
      {empty && (
        <p style={{ fontSize: 14, color: TEXT_TERTIARY, textAlign: 'center', padding: '16px 0', margin: 0 }}>
          작성된 일지 내용이 없습니다.
        </p>
      )}
    </div>
  );
}

function LogLabel({ children }) {
  return (
    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT_TERTIARY, marginBottom: 4 }}>
      {children}
    </span>
  );
}

function LogSection({ label, text }) {
  if (!text?.trim()) return null;
  // 항목마다 다른 강조를 주지 않는다 — 파스텔 배경 박스도, 굵은 본문도 둘 다 거절됐다(2026-08-27).
  // 라벨이 이미 무엇인지 말하고, 순서가 위계를 맡는다.
  return (
    <div>
      <LogLabel>{label}</LogLabel>
      <p style={{
        fontSize: 14, lineHeight: 1.65, margin: 0,
        color: TEXT_PRIMARY, fontWeight: 400,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {text}
      </p>
    </div>
  );
}
