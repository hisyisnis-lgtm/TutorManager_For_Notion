import { TG, TYPE, RADIUS, SPACE, SHADOW, TONE_COLORS } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';

const toneName = tone => tone === 0 ? '경성' : `${tone}성`;

export function TonePracticeSummary({ summary }) {
  if (!summary) return null;
  return (
    <section aria-label="성조 학습 요약" style={{ background: TG.CARD, borderRadius: RADIUS.card, padding: SPACE.x2, boxShadow: SHADOW.level1, display: 'flex', flexDirection: 'column', gap: SPACE.x2 }}>
      <h2 style={{ ...TYPE.h2, color: TG.INK, margin: 0, textAlign: 'center' }}>누적 성조 정답률</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', margin: 0 }}>
          {summary.rows.map(row => <div key={row.tone} style={{ minWidth: 0, textAlign: 'center' }}>
            <dt style={{ ...TYPE.label, color: TG.INK, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs }}>
              <span aria-hidden="true" style={{ height: 32, display: 'flex', alignItems: 'center', color: TONE_COLORS[row.tone] }}>
                <ToneMark tone={row.tone} size={32} stroke={5.6} dotR={6} />
              </span>
              {toneName(row.tone)}
            </dt>
            <dd style={{ margin: `${SPACE.xs}px 0 0`, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
              <span style={{ ...TYPE.numMd, color: row.attempts ? TG.INK : TG.MUTED }}>
                {row.attempts ? <>{Math.round(row.accuracy * 100)}<span style={{ fontSize: TYPE.meta.fontSize }}>%</span></> : '—'}
              </span>
              <span className="sr-only" aria-label={row.attempts ? `${toneName(row.tone)} 정답 ${row.correct}/${row.attempts}회${!row.enough ? ', 기록 적음' : ''}` : `${toneName(row.tone)} 아직 기록 없음`}>
                {row.attempts ? `정답 ${row.correct}/${row.attempts}회` : '기록 없음'}
              </span>
            </dd>
          </div>)}
        </dl>
    </section>
  );
}
