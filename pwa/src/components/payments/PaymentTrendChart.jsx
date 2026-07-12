import { useMemo, useState } from 'react';
import { PRIMARY, PRIMARY_BG, TEXT_PRIMARY, TEXT_TERTIARY, TEXT_DISABLED } from '../../constants/theme.js';

import { KST } from '../../utils/dateUtils.js';

/**
 * 최근 6개월 결제 추이 꺾은선 그래프.
 * - payments: parsePayment된 결제 배열
 * - studentFilter: 학생 ID (있으면 그 학생만 집계)
 * - loading: 로딩 상태
 */
export default function PaymentTrendChart({ payments, studentFilter, loading }) {
  // 6개월 배열 중 마지막 = 이번 달, 초기 선택 상태
  const [activeIdx, setActiveIdx] = useState(5);

  // 최근 6개월 (현재 달 포함, KST 기준)
  const months = useMemo(() => {
    const todayKstStr = new Date().toLocaleDateString('en-CA', { timeZone: KST });
    const [y, m] = todayKstStr.split('-').map(Number);
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      arr.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: `${d.getMonth() + 1}월`,
      });
    }
    return arr;
  }, []);

  const data = useMemo(() => {
    return months.map((m) => {
      const total = payments
        .filter((p) => {
          if (!p.paymentDate) return false;
          if (studentFilter && !p.studentIds.includes(studentFilter)) return false;
          const pd = new Date(p.paymentDate);
          // KST 기준 월 판정
          const pdY = parseInt(pd.toLocaleString('en-CA', { timeZone: KST, year: 'numeric' }), 10);
          const pdM = parseInt(pd.toLocaleString('en-CA', { timeZone: KST, month: '2-digit' }), 10) - 1;
          return pdY === m.year && pdM === m.month;
        })
        .reduce((s, p) => s + ((p.actualAmount || 0) - (p.refundAmount || 0)), 0);
      return { ...m, total };
    });
  }, [months, payments, studentFilter]);

  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const total6m = data.reduce((s, d) => s + d.total, 0);

  // SVG 좌표계
  const W = 320;
  const H = 180;
  const padX = 24;
  const padTop = 24;
  const padBottom = 30;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const points = data.map((d, i) => ({
    x: padX + (innerW * i) / (data.length - 1),
    y: padTop + innerH * (1 - d.total / maxVal),
    value: d.total,
    label: d.label,
    isCurrent: i === data.length - 1, // 마지막 점 = 이번 달
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  // 영역 채움용 path (아래 그라데이션)
  const areaD = `${pathD} L${points[points.length - 1].x},${padTop + innerH} L${points[0].x},${padTop + innerH} Z`;

  const fmtShort = (n) => {
    if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만`;
    if (n === 0) return '0';
    return n.toLocaleString('ko-KR');
  };

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      boxShadow: 'var(--shadow-border)',
      padding: '14px 16px 4px',
    }}>
      {/* 헤더 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
          최근 6개월 결제 추이
        </span>
        <span className="tabular-nums" style={{ fontSize: 12, color: TEXT_TERTIARY }}>
          합계 ₩{total6m.toLocaleString('ko-KR')}
        </span>
      </div>

      {loading ? (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
        </div>
      ) : total6m === 0 ? (
        <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, color: TEXT_TERTIARY }}>최근 6개월 결제 내역이 없습니다.</span>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
          <defs>
            <linearGradient id="payment-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.18" />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 그리드 라인 (4등분 가로선) */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i}
              x1={padX}
              x2={W - padX}
              y1={padTop + (innerH * i) / 4}
              y2={padTop + (innerH * i) / 4}
              stroke="#f0f0f0"
              strokeWidth="1"
            />
          ))}

          {/* 영역 (그라데이션) */}
          <path d={areaD} fill="url(#payment-area)" />

          {/* 라인 */}
          <path
            d={pathD}
            stroke={PRIMARY}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 점 + 클릭 영역 */}
          {points.map((p, i) => (
            <g key={i}>
              {/* 큰 투명 hit area (탭 편의) */}
              <rect
                x={p.x - innerW / data.length / 2}
                y={padTop}
                width={innerW / data.length}
                height={innerH + padBottom}
                fill="transparent"
                onClick={() => setActiveIdx(activeIdx === i ? null : i)}
                style={{ cursor: 'pointer' }}
              />
              {/* 이번 달 펄스 — 한 방향 퍼지는 ripple */}
              {p.isCurrent && (
                <circle cx={p.x} cy={p.y} r="6" fill={PRIMARY} opacity="0" style={{ pointerEvents: 'none' }}>
                  <animate attributeName="r" values="6;16" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={p.isCurrent ? 5 : (activeIdx === i ? 5 : 3.5)}
                fill={PRIMARY}
                stroke="#fff"
                strokeWidth={p.isCurrent ? 2.5 : 2}
                style={{ pointerEvents: 'none' }}
              />
              {/* 활성 점 위 툴팁 */}
              {activeIdx === i && p.value > 0 && (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={Math.max(padX, Math.min(W - padX - 60, p.x - 30))}
                    y={Math.max(2, p.y - 28)}
                    width={60}
                    height={20}
                    rx={6}
                    fill={PRIMARY}
                  />
                  <text
                    x={Math.max(padX + 30, Math.min(W - padX - 30, p.x))}
                    y={Math.max(16, p.y - 14)}
                    textAnchor="middle"
                    style={{ fontSize: 11, fontWeight: 700, fill: '#fff' }}
                  >
                    {fmtShort(p.value)}
                  </text>
                </g>
              )}
            </g>
          ))}

          {/* X축 라벨 */}
          {points.map((p, i) => (
            <text
              key={`label-${i}`}
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              style={{
                fontSize: 11,
                fill: activeIdx === i ? PRIMARY : TEXT_TERTIARY,
                fontWeight: activeIdx === i ? 600 : 400,
              }}
            >
              {p.label}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
