// 수업 횟수에 따라 팬더가 성장하는 인터랙티브 위젯
import { useState, useRef, useCallback } from 'react';
import { LeafIcon, HandHeartIcon } from '@phosphor-icons/react';

export const STAGES = [
  { min: 0,   max: 0,        label: '알에서 깨어나는 중', message: '첫 수업이 기다려져요! 🥚', img: '/panda/Cha_Panda_Step_00.svg', nextAt: 1 },
  { min: 1,   max: 9,        label: '아기 팬더',           message: '이제 막 시작했어요 🌱',     img: '/panda/Cha_Panda_Step_01.svg', nextAt: 10 },
  { min: 10,  max: 24,       label: '꼬마 팬더',           message: '쑥쑥 자라고 있어요 🌿',     img: '/panda/Cha_Panda_Step_02.svg', nextAt: 25 },
  { min: 25,  max: 49,       label: '청소년 팬더',         message: '많이 성장했어요 🌳',         img: '/panda/Cha_Panda_Step_03.svg', nextAt: 50 },
  { min: 50,  max: 99,       label: '어른 팬더',           message: '완전히 성장했어요 ✨',       img: '/panda/Cha_Panda_Step_04.svg', nextAt: 100 },
  { min: 100, max: Infinity, label: '마스터 팬더',         message: '전설이 되었어요 👑',         img: '/panda/Cha_Panda_Step_05.svg', nextAt: null },
];

export function getStageInfo(fedTotal) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (fedTotal >= STAGES[i].min) return { stage: STAGES[i], idx: i };
  }
  return { stage: STAGES[0], idx: 0 };
}

// 옛 공통 키 — 학생 구분 없이 모든 학생의 EXP가 섞여 누적되던 버그가 있었음.
// 호환을 위해 export는 유지하되, 신규 호출부는 getPandaStorageKey(studentToken) 사용.
export const PANDA_FEED_KEY = 'panda_fed_total';

/**
 * 학생별 EXP 저장소 키. studentToken이 없으면 옛 공통 키로 fallback.
 * PandaPage·PersonalPage 등 학생 컨텍스트가 있는 곳은 반드시 이 헬퍼 사용.
 */
export function getPandaStorageKey(studentToken) {
  return studentToken ? `panda_fed_total_${studentToken}` : PANDA_FEED_KEY;
}

const DEFAULT_FEED_KEY = PANDA_FEED_KEY;
let _pid = 0;

function makeBezierKeyframes(p1x, p1y, p2x, p2y, opacityFn, scaleFn, steps = 20) {
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = (2 * mt * t * p1x + t * t * p2x).toFixed(2);
    const y = (2 * mt * t * p1y + t * t * p2y).toFixed(2);
    const pct = (t * 100).toFixed(1);
    const opacity = Math.max(0, opacityFn(t)).toFixed(3);
    const scale = Math.max(0, scaleFn(t)).toFixed(3);
    frames.push(`${pct}%{transform:translate(${x}px,${y}px) scale(${scale});opacity:${opacity}}`);
  }
  return frames.join('');
}

function injectKeyframe(name, body) {
  const el = document.createElement('style');
  el.id = `kf-${name}`;
  el.textContent = `@keyframes ${name}{${body}}`;
  document.head.appendChild(el);
}

function removeKeyframe(name, delay) {
  setTimeout(() => document.getElementById(`kf-${name}`)?.remove(), delay);
}

function makeFeedParticle(srcX, srcY, destX, destY, particleDelay = 0) {
  const tx = destX - srcX;
  const ty = destY - srcY;
  const len = Math.sqrt(tx * tx + ty * ty) || 1;
  const perpX = -ty / len;
  const perpY = tx / len;
  const side = Math.random() > 0.5 ? 1 : -1;
  const curve = side * (90 + Math.random() * 80);
  const p1x = tx / 2 + perpX * curve;
  const p1y = ty / 2 + perpY * curve;
  const pid = ++_pid;
  const kfName = `panda-feed-${pid}`;
  const body = makeBezierKeyframes(
    p1x, p1y, tx, ty,
    t => (t < 0.88 ? 1 : 1 - (t - 0.88) / 0.12),
    t => 1 + 0.15 * Math.sin(t * Math.PI) - 0.75 * t * t,
  );
  injectKeyframe(kfName, body);
  removeKeyframe(kfName, 2200 + particleDelay);
  return { id: pid, type: 'feed', x: srcX - 9, y: srcY - 9, kfName, delay: particleDelay };
}

function makeHeartParticle(pRect, index) {
  const startX = pRect.left + 14 + Math.random() * (pRect.width - 28);
  const startY = pRect.top + 18 + Math.random() * (pRect.height * 0.5);
  const p2x = (Math.random() - 0.5) * 44;
  const p2y = -(62 + Math.random() * 28);
  const p1x = (Math.random() - 0.5) * 72;
  const p1y = -(26 + Math.random() * 26);
  const size = 14 + Math.floor(Math.random() * 10);
  const delay = index * 88;
  const pid = ++_pid;
  const kfName = `panda-heart-${pid}`;
  const body = makeBezierKeyframes(
    p1x, p1y, p2x, p2y,
    t => { if (t < 0.1) return t / 0.1; if (t < 0.62) return 1; return 1 - (t - 0.62) / 0.38; },
    t => { if (t < 0.13) return (t / 0.13) * 1.22; if (t < 0.24) return 1.22 - ((t - 0.13) / 0.11) * 0.22; return 1 - (t - 0.24) * 0.58; },
    18,
  );
  injectKeyframe(kfName, body);
  removeKeyframe(kfName, 2200 + delay);
  return { id: pid, type: 'heart', x: startX - size / 2, y: startY - size / 2, kfName, size, delay };
}

/**
 * foodSources: 먹이 공급원 배열
 * 각 항목: { key: string, label: string, count: number }
 * 예시:
 *   [
 *     { key: 'sessions', label: '완료 수업', count: 12 },
 *     { key: 'referral', label: '친구 추천', count: 5 },
 *   ]
 * 총 먹이 = foodSources의 count 합계
 */
export default function PandaWidget({ foodSources = [], storageKey = DEFAULT_FEED_KEY, fullscreen = false }) {
  const totalFood = foodSources.reduce((sum, s) => sum + (s.count || 0), 0);

  const [fedTotal, setFedTotal] = useState(() => {
    const saved = parseInt(localStorage.getItem(storageKey) || '0', 10);
    // totalFood를 초과한 경우 즉시 localStorage에 기록해 둠.
    // 이렇게 해야 totalFood가 나중에 늘어났을 때(추천 보너스 등)
    // 과거의 높은 값이 되살아나 EXP가 자동으로 오르는 현상을 방지할 수 있음.
    const capped = Math.min(saved, totalFood);
    if (capped !== saved) localStorage.setItem(storageKey, String(capped));
    return capped;
  });
  const [particles, setParticles] = useState([]);
  const [levelingUp, setLevelingUp] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [isFeeding, setIsFeeding] = useState(false);
  const [toast, setToast] = useState(false);

  const pandaRef = useRef(null);
  const feedBtnRef = useRef(null);
  const feedAllBtnRef = useRef(null);
  const toastTimerRef = useRef(null);

  const showFeedToast = useCallback(() => {
    setToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(false), 2400);
  }, []);

  const { stage, idx: stageIdx } = getStageInfo(fedTotal);
  const available = Math.max(0, totalFood - fedTotal);
  const progress = stage.nextAt == null
    ? 100
    : Math.round(((fedTotal - stage.min) / (stage.nextAt - stage.min)) * 100);
  const remaining = stage.nextAt == null ? 0 : stage.nextAt - fedTotal;

  const spawnParticles = useCallback((list, lifetime) => {
    setParticles(prev => [...prev, ...list]);
    const ids = list.map(p => p.id);
    const maxDelay = Math.max(0, ...list.map(p => p.delay || 0));
    setTimeout(() => setParticles(prev => prev.filter(p => !ids.includes(p.id))), lifetime + maxDelay);
  }, []);

  const triggerArrival = useCallback((newFed, isLevelUp) => {
    localStorage.setItem(storageKey, String(newFed));
    setFedTotal(newFed);
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (pRect) {
      const cx = pRect.left + pRect.width / 2 - 3;
      const cy = pRect.top + pRect.height / 2 - 3;
      const bursts = Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.35;
        const dist = 28 + Math.random() * 36;
        return { id: ++_pid, type: 'burst', x: cx, y: cy, tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist, delay: Math.floor(Math.random() * 60) };
      });
      spawnParticles(bursts, 500);
    }
    if (isLevelUp) {
      setLevelingUp(true);
      setShowBadge(true);
      const pRect2 = pandaRef.current?.getBoundingClientRect();
      if (pRect2) {
        const cx2 = pRect2.left + pRect2.width / 2 - 8;
        const cy2 = pRect2.top + pRect2.height / 2 - 8;
        const sparkles = Array.from({ length: 14 }, (_, i) => {
          const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
          const dist = 45 + Math.random() * 50;
          return { id: ++_pid, type: 'sparkle', x: cx2, y: cy2, tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist, delay: Math.floor(Math.random() * 180) };
        });
        spawnParticles(sparkles, 950);
      }
      setTimeout(() => { setLevelingUp(false); setShowBadge(false); }, 1600);
    }
  }, [spawnParticles]);

  const handleFeed = useCallback(() => {
    if (isFeeding) return;
    if (available <= 0) { showFeedToast(); return; }
    const newFed = fedTotal + 1;
    const { idx: newIdx } = getStageInfo(newFed);
    setIsFeeding(true);
    const fRect = feedBtnRef.current?.getBoundingClientRect();
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (fRect && pRect) {
      const p = makeFeedParticle(fRect.left + fRect.width / 2, fRect.top + fRect.height / 2, pRect.left + pRect.width / 2, pRect.top + pRect.height / 2);
      spawnParticles([p], 850);
      setTimeout(() => { triggerArrival(newFed, newIdx > stageIdx); setTimeout(() => setIsFeeding(false), 200); }, 750);
    } else {
      triggerArrival(newFed, newIdx > stageIdx);
      setIsFeeding(false);
    }
  }, [available, fedTotal, stageIdx, isFeeding, showFeedToast, spawnParticles, triggerArrival]);

  const handleFeedAll = useCallback(() => {
    if (available <= 0 || isFeeding) return;
    const newFed = fedTotal + available;
    const { idx: newIdx } = getStageInfo(newFed);
    setIsFeeding(true);
    const fRect = feedAllBtnRef.current?.getBoundingClientRect();
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (fRect && pRect) {
      const count = Math.min(available, 5);
      const STAGGER = 130;
      const srcX = fRect.left + fRect.width / 2, srcY = fRect.top + fRect.height / 2;
      const dstX = pRect.left + pRect.width / 2, dstY = pRect.top + pRect.height / 2;
      const feedPs = Array.from({ length: count }, (_, i) => makeFeedParticle(srcX, srcY, dstX, dstY, i * STAGGER));
      spawnParticles(feedPs, 850 + (count - 1) * STAGGER);
      setTimeout(() => { triggerArrival(newFed, newIdx > stageIdx); setTimeout(() => setIsFeeding(false), 200); }, 750 + (count - 1) * STAGGER);
    } else {
      triggerArrival(newFed, newIdx > stageIdx);
      setIsFeeding(false);
    }
  }, [available, fedTotal, stageIdx, isFeeding, spawnParticles, triggerArrival]);

  const handlePet = useCallback(() => {
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (!pRect) return;
    spawnParticles(Array.from({ length: 7 }, (_, i) => makeHeartParticle(pRect, i)), 1100);
  }, [spawnParticles]);

  const canFeed = available > 0 && !isFeeding;

  return (
    <>
      {/* 파티클 레이어 */}
      {particles.map(p => {
        if (p.type === 'feed') return (
          <div key={p.id} style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: p.x, top: p.y, width: 18, height: 18, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #dcfce7, #22c55e)', boxShadow: '0 0 14px rgba(34,197,94,0.9)', animationName: p.kfName, animationDuration: '0.8s', animationTimingFunction: 'linear', animationFillMode: 'both', animationDelay: `${p.delay || 0}ms` }} />
        );
        if (p.type === 'burst') return (
          <div key={p.id} style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: p.x, top: p.y, width: 14, height: 14, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #bbf7d0, #16a34a)', boxShadow: '0 0 12px rgba(34,197,94,0.95)', animationName: 'panda-burst', animationDuration: '0.5s', animationTimingFunction: 'ease-out', animationFillMode: 'forwards', animationDelay: `${p.delay}ms`, '--tx': `${p.tx}px`, '--ty': `${p.ty}px` }} />
        );
        if (p.type === 'heart') return (
          <div key={p.id} style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: p.x, top: p.y, fontSize: p.size, userSelect: 'none', lineHeight: 1, animationName: p.kfName, animationDuration: '1.05s', animationTimingFunction: 'linear', animationFillMode: 'both', animationDelay: `${p.delay}ms` }}>❤️</div>
        );
        if (p.type === 'sparkle') return (
          <div key={p.id} style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: p.x, top: p.y, fontSize: 17, userSelect: 'none', animationName: 'panda-sparkle-burst', animationDuration: '0.85s', animationTimingFunction: 'ease-out', animationFillMode: 'forwards', animationDelay: `${p.delay}ms`, '--tx': `${p.tx}px`, '--ty': `${p.ty}px` }}>✨</div>
        );
        return null;
      })}

      {/* ── 게임 HUD 위젯 (카드 없음) ── */}
      <div style={{ userSelect: 'none', ...(fullscreen ? { height: '100%', display: 'flex', flexDirection: 'column' } : {}) }}>

        {/* ─ 상단 HUD 행: 레벨 + 스테이지명 / 먹이 카운터 ─ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 4, flexShrink: 0,
        }}>
          {/* 왼쪽: Lv 배지 + 스테이지 이름 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              background: '#7f0005',
              color: 'white',
              fontSize: 12, fontWeight: 800,
              padding: '3px 7px',
              borderRadius: 6,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1.4,
            }}>
              LV.{stageIdx + 1}
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1d1d1f' }}>
              {stage.label}
            </span>
          </div>

          {/* 오른쪽: 먹이 카운터 (게임 재화 스타일) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: available > 0 ? '#fff0f1' : '#f5f5f5',
            border: `1px solid ${available > 0 ? 'rgba(127,0,5,0.12)' : 'rgba(0,0,0,0.05)'}`,
            borderRadius: 8, padding: '4px 10px',
            transitionProperty: 'background-color, border-color',
            transitionDuration: '0.3s',
            transitionTimingFunction: 'ease',
          }}>
            <LeafIcon size={14} weight="fill" color={available > 0 ? '#7f0005' : '#bfbfbf'} />
            <span style={{
              fontSize: 14, fontWeight: 700,
              color: available > 0 ? '#7f0005' : '#bfbfbf',
              fontVariantNumeric: 'tabular-nums',
            }}>
              ×{available}
            </span>
          </div>
        </div>

        {/* ─ 캐릭터 영역 ─ */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', ...(fullscreen ? { flex: 1, minHeight: 0 } : {}) }}>

          {/* 레벨업 배지 */}
          {showBadge && (
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              background: 'linear-gradient(135deg, #7f0005, #9a0007)',
              color: 'white', fontWeight: 700, fontSize: 12,
              padding: '5px 16px', borderRadius: 20,
              zIndex: 10, whiteSpace: 'nowrap',
              boxShadow: '0 4px 14px rgba(127,0,5,0.35)',
              animationName: 'panda-badge-in',
              animationDuration: '0.35s',
              animationTimingFunction: 'ease-out',
              animationFillMode: 'forwards',
            }}>
              레벨 업
            </div>
          )}

          {/* 팬더 이미지 */}
          <div
            ref={pandaRef}
            style={{
              animationName: levelingUp ? 'panda-levelup-bounce' : 'panda-float',
              animationDuration: levelingUp ? '0.55s' : '3s',
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: levelingUp ? 1 : 'infinite',
              animationFillMode: levelingUp ? 'forwards' : 'none',
            }}
          >
            <img
              src={stage.img}
              alt={stage.label}
              width={fullscreen ? 220 : 180}
              height={fullscreen ? 220 : 180}
              style={{
                display: 'block',
                outline: 'none',
                filter: levelingUp
                  ? 'brightness(1.28) drop-shadow(0 0 16px rgba(251,191,36,0.75))'
                  : 'none',
                transitionProperty: 'filter',
                transitionDuration: '0.35s',
                transitionTimingFunction: 'ease',
              }}
            />
          </div>

          {/* 스테이지 메시지 */}
          <p style={{
            fontSize: 15, color: '#595959', margin: '2px 0 0',
            textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.5,
          }}>
            {stage.message}
          </p>
        </div>

        {/* ─ EXP 바 (게임 RPG 스타일) ─ */}
        <div style={{ marginTop: 16, flexShrink: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 6,
          }}>
            <span style={{
              fontSize: 12, fontWeight: 800, color: '#7f0005',
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              EXP
            </span>
            {stage.nextAt != null ? (
              <span style={{ fontSize: 13, color: '#8c8c8c', fontVariantNumeric: 'tabular-nums' }}>
                <strong style={{ color: '#1d1d1f' }}>{fedTotal}</strong>
                {' / '}{stage.nextAt}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#7f0005' }}>
                MAX 👑
              </span>
            )}
          </div>

          {/* 두꺼운 게임형 바 — inset shadow로 홈파인 느낌 */}
          <div style={{
            width: '100%', height: 12,
            background: '#e8e8e8',
            borderRadius: 4,
            overflow: 'hidden',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.12)',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: stage.nextAt == null
                ? 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)'
                : 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)',
              borderRadius: 4,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28)',
              transitionProperty: 'width',
              transitionDuration: '0.65s',
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }} />
          </div>

          {/* 다음 레벨까지 */}
          {stage.nextAt != null && (
            <p style={{
              fontSize: 12, color: '#bfbfbf',
              margin: '5px 0 0', textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}>
              다음 단계까지 {remaining}회
            </p>
          )}
        </div>

        {/* ─ 액션 버튼 ─ */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexShrink: 0 }}>
          {/* 먹이주기 — primary (먹이 없어도 클릭 가능 → 토스트 표시) */}
          <button
            ref={feedBtnRef}
            onClick={handleFeed}
            disabled={isFeeding}
            className="active:scale-[0.96]"
            style={{
              flex: 1, height: 52, borderRadius: 12,
              border: 'none',
              cursor: isFeeding ? 'not-allowed' : 'pointer',
              background: canFeed
                ? 'linear-gradient(180deg, #c8000a 0%, #7f0005 100%)'
                : '#ebebeb',
              color: canFeed ? '#ffffff' : '#bfbfbf',
              fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              WebkitTapHighlightColor: 'transparent',
              opacity: available > 0 ? 1 : 0.55,
              boxShadow: canFeed ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 8px rgba(127,0,5,0.28)' : 'none',
              transitionProperty: 'opacity, background-color, box-shadow, scale',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
            }}
          >
            <LeafIcon size={17} weight="fill" />
            먹이주기
          </button>

          {/* 쓰다듬기 — secondary */}
          <button
            onClick={handlePet}
            className="active:scale-[0.96]"
            style={{
              flex: 1, height: 52, borderRadius: 12,
              border: '1.5px solid rgba(0,0,0,0.1)',
              cursor: 'pointer',
              background: '#ffffff',
              color: '#595959',
              fontSize: 15, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              transitionProperty: 'background-color, scale',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
            }}
          >
            <HandHeartIcon size={17} weight="fill" />
            쓰다듬기
          </button>
        </div>

        {/* 먹이 전부 주기 */}
        {available >= 2 && (
          <button
            ref={feedAllBtnRef}
            onClick={handleFeedAll}
            disabled={!canFeed}
            className="active:scale-[0.96]"
            style={{
              width: '100%', height: 42, borderRadius: 12, marginTop: 8,
              border: '1.5px solid rgba(127,0,5,0.2)',
              cursor: canFeed ? 'pointer' : 'not-allowed',
              background: '#fff0f1',
              color: canFeed ? '#7f0005' : '#bfbfbf',
              fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent',
              transitionProperty: 'background-color, scale',
              transitionDuration: '0.15s',
              transitionTimingFunction: 'ease-out',
            }}
          >
            <LeafIcon size={14} weight="fill" />
            먹이 {available}개 전부 주기
          </button>
        )}

        {/* 먹이 없음 알림 — 위젯 내부 슬라이드인 */}
        <div style={{
          overflow: 'hidden',
          maxHeight: toast ? 48 : 0,
          opacity: toast ? 1 : 0,
          marginTop: toast ? 8 : 0,
          transitionProperty: 'max-height, opacity, margin-top',
          transitionDuration: '0.22s',
          transitionTimingFunction: 'ease',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            background: '#f5f5f5',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 14, color: '#767676', fontWeight: 500,
          }}>
            <LeafIcon size={13} weight="fill" color="#bfbfbf" />
            수업을 완료하면 먹이가 생겨요
          </div>
        </div>
      </div>
    </>
  );
}
