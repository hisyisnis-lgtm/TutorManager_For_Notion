// 수업 횟수에 따라 팬더가 성장하는 인터랙티브 위젯
import { useState, useRef, useCallback } from 'react';

const STAGES = [
  { min: 0,   max: 0,        label: '알에서 깨어나는 중', message: '첫 수업이 기다려져요! 🥚', img: '/panda/Cha_Panda_Step_00.svg', nextAt: 1 },
  { min: 1,   max: 9,        label: '아기 팬더',           message: '이제 막 시작했어요 🌱',     img: '/panda/Cha_Panda_Step_01.svg', nextAt: 10 },
  { min: 10,  max: 24,       label: '꼬마 팬더',           message: '쑥쑥 자라고 있어요 🌿',     img: '/panda/Cha_Panda_Step_02.svg', nextAt: 25 },
  { min: 25,  max: 49,       label: '청소년 팬더',         message: '많이 성장했어요 🌳',         img: '/panda/Cha_Panda_Step_03.svg', nextAt: 50 },
  { min: 50,  max: 99,       label: '어른 팬더',           message: '완전히 성장했어요 ✨',       img: '/panda/Cha_Panda_Step_04.svg', nextAt: 100 },
  { min: 100, max: Infinity, label: '마스터 팬더',         message: '전설이 되었어요 👑',         img: '/panda/Cha_Panda_Step_05.svg', nextAt: null },
];

function getStageInfo(fedTotal) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (fedTotal >= STAGES[i].min) return { stage: STAGES[i], idx: i };
  }
  return { stage: STAGES[0], idx: 0 };
}

const FEED_KEY = 'panda_fed_total';
let _pid = 0;

// 2차 베지어 곡선을 N개 샘플로 keyframe 문자열 생성
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

// 먹이 파티클 keyframe 생성 (버튼→팬더 호 궤적)
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

// 하트 파티클 keyframe 생성 (팬더 주변 부유)
function makeHeartParticle(pRect, index) {
  const startX = pRect.left + 14 + Math.random() * (pRect.width - 28);
  const startY = pRect.top + 18 + Math.random() * (pRect.height * 0.5);

  // 목적지: 위로 60~90px + 좌우 소량 표류
  const p2x = (Math.random() - 0.5) * 44;
  const p2y = -(62 + Math.random() * 28);

  // 제어점: 자연스러운 곡선을 만드는 랜덤 방향
  const p1x = (Math.random() - 0.5) * 72;
  const p1y = -(26 + Math.random() * 26);

  const size = 14 + Math.floor(Math.random() * 10);
  const delay = index * 88;
  const pid = ++_pid;
  const kfName = `panda-heart-${pid}`;

  const body = makeBezierKeyframes(
    p1x, p1y, p2x, p2y,
    t => {
      if (t < 0.1) return t / 0.1;
      if (t < 0.62) return 1;
      return 1 - (t - 0.62) / 0.38;
    },
    t => {
      if (t < 0.13) return (t / 0.13) * 1.22;
      if (t < 0.24) return 1.22 - ((t - 0.13) / 0.11) * 0.22;
      return 1 - (t - 0.24) * 0.58;
    },
    18,
  );
  injectKeyframe(kfName, body);
  removeKeyframe(kfName, 2200 + delay);

  return { id: pid, type: 'heart', x: startX - size / 2, y: startY - size / 2, kfName, size, delay };
}

export default function PandaWidget({ totalSessions }) {
  const [fedTotal, setFedTotal] = useState(() => {
    const saved = parseInt(localStorage.getItem(FEED_KEY) || '0', 10);
    return Math.min(saved, totalSessions);
  });
  const [particles, setParticles] = useState([]);
  const [levelingUp, setLevelingUp] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [isFeeding, setIsFeeding] = useState(false);

  const pandaRef = useRef(null);
  const feedBtnRef = useRef(null);
  const feedAllBtnRef = useRef(null);

  const { stage, idx: stageIdx } = getStageInfo(fedTotal);
  const available = Math.max(0, totalSessions - fedTotal);
  const progress = stage.nextAt == null
    ? 100
    : Math.round(((fedTotal - stage.min) / (stage.nextAt - stage.min)) * 100);
  const remaining = stage.nextAt == null ? 0 : stage.nextAt - fedTotal;

  const spawnParticles = useCallback((list, lifetime) => {
    setParticles(prev => [...prev, ...list]);
    const ids = list.map(p => p.id);
    const maxDelay = Math.max(0, ...list.map(p => p.delay || 0));
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !ids.includes(p.id)));
    }, lifetime + maxDelay);
  }, []);

  // 팬더에서 버스트 + 필요시 레벨업 연출
  const triggerArrival = useCallback((newFed, isLevelUp) => {
    localStorage.setItem(FEED_KEY, String(newFed));
    setFedTotal(newFed);

    const pRect = pandaRef.current?.getBoundingClientRect();
    if (pRect) {
      const cx = pRect.left + pRect.width / 2 - 3;
      const cy = pRect.top + pRect.height / 2 - 3;
      const bursts = Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.35;
        const dist = 28 + Math.random() * 36;
        return { id: ++_pid, type: 'burst', x: cx, y: cy,
          tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist,
          delay: Math.floor(Math.random() * 60) };
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
          return { id: ++_pid, type: 'sparkle', x: cx2, y: cy2,
            tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist,
            delay: Math.floor(Math.random() * 180) };
        });
        spawnParticles(sparkles, 950);
      }
      setTimeout(() => { setLevelingUp(false); setShowBadge(false); }, 1600);
    }
  }, [spawnParticles]);

  // 먹이 1개
  const handleFeed = useCallback(() => {
    if (available <= 0 || isFeeding) return;
    const newFed = fedTotal + 1;
    const { idx: newIdx } = getStageInfo(newFed);
    setIsFeeding(true);

    const fRect = feedBtnRef.current?.getBoundingClientRect();
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (fRect && pRect) {
      const p = makeFeedParticle(
        fRect.left + fRect.width / 2,
        fRect.top + fRect.height / 2,
        pRect.left + pRect.width / 2,
        pRect.top + pRect.height / 2,
      );
      spawnParticles([p], 850);
      setTimeout(() => {
        triggerArrival(newFed, newIdx > stageIdx);
        setTimeout(() => setIsFeeding(false), 200);
      }, 750);
    } else {
      triggerArrival(newFed, newIdx > stageIdx);
      setIsFeeding(false);
    }
  }, [available, fedTotal, stageIdx, isFeeding, spawnParticles, triggerArrival]);

  // 먹이 전부
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
      const srcX = fRect.left + fRect.width / 2;
      const srcY = fRect.top + fRect.height / 2;
      const dstX = pRect.left + pRect.width / 2;
      const dstY = pRect.top + pRect.height / 2;

      const feedPs = Array.from({ length: count }, (_, i) =>
        makeFeedParticle(srcX, srcY, dstX, dstY, i * STAGGER)
      );
      spawnParticles(feedPs, 850 + (count - 1) * STAGGER);

      setTimeout(() => {
        triggerArrival(newFed, newIdx > stageIdx);
        setTimeout(() => setIsFeeding(false), 200);
      }, 750 + (count - 1) * STAGGER);
    } else {
      triggerArrival(newFed, newIdx > stageIdx);
      setIsFeeding(false);
    }
  }, [available, fedTotal, stageIdx, isFeeding, spawnParticles, triggerArrival]);

  // 쓰다듬기
  const handlePet = useCallback(() => {
    const pRect = pandaRef.current?.getBoundingClientRect();
    if (!pRect) return;
    const hearts = Array.from({ length: 7 }, (_, i) => makeHeartParticle(pRect, i));
    spawnParticles(hearts, 1100);
  }, [spawnParticles]);

  const canFeed = available > 0 && !isFeeding;

  return (
    <>
      {/* 파티클 레이어 */}
      {particles.map(p => {
        if (p.type === 'feed') return (
          <div key={p.id} style={{
            position: 'fixed', zIndex: 9999, pointerEvents: 'none',
            left: p.x, top: p.y,
            width: 18, height: 18, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #dcfce7, #22c55e)',
            boxShadow: '0 0 14px rgba(34,197,94,0.9), 0 0 28px rgba(34,197,94,0.45)',
            animationName: p.kfName,
            animationDuration: '0.8s',
            animationTimingFunction: 'linear',
            animationFillMode: 'both',
            animationDelay: `${p.delay || 0}ms`,
          }} />
        );
        if (p.type === 'burst') return (
          <div key={p.id} style={{
            position: 'fixed', zIndex: 9999, pointerEvents: 'none',
            left: p.x, top: p.y,
            width: 14, height: 14, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #bbf7d0, #16a34a)',
            boxShadow: '0 0 12px rgba(34,197,94,0.95), 0 0 22px rgba(34,197,94,0.5)',
            animationName: 'panda-burst',
            animationDuration: '0.5s',
            animationTimingFunction: 'ease-out',
            animationFillMode: 'forwards',
            animationDelay: `${p.delay}ms`,
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
          }} />
        );
        if (p.type === 'heart') return (
          <div key={p.id} style={{
            position: 'fixed', zIndex: 9999, pointerEvents: 'none',
            left: p.x, top: p.y,
            fontSize: p.size, userSelect: 'none', lineHeight: 1,
            animationName: p.kfName,
            animationDuration: '1.05s',
            animationTimingFunction: 'linear',
            animationFillMode: 'both',
            animationDelay: `${p.delay}ms`,
          }}>❤️</div>
        );
        if (p.type === 'sparkle') return (
          <div key={p.id} style={{
            position: 'fixed', zIndex: 9999, pointerEvents: 'none',
            left: p.x, top: p.y,
            fontSize: 17, userSelect: 'none',
            animationName: 'panda-sparkle-burst',
            animationDuration: '0.85s',
            animationTimingFunction: 'ease-out',
            animationFillMode: 'forwards',
            animationDelay: `${p.delay}ms`,
            '--tx': `${p.tx}px`,
            '--ty': `${p.ty}px`,
          }}>✨</div>
        );
        return null;
      })}

      {/* 플로팅 마스코트 (카드 배경 없음) */}
      <div style={{ userSelect: 'none', position: 'relative' }}>

        {/* 레벨업 배지 */}
        {showBadge && (
          <div style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
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
            🎉 레벨 업!
          </div>
        )}

        {/* 팬더 + 라벨 + 메시지 — 중앙 정렬 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8 }}>
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
              width={160}
              height={160}
              style={{
                display: 'block', border: 'none', outline: 'none',
                background: 'transparent',
                filter: levelingUp
                  ? 'brightness(1.28) drop-shadow(0 0 16px rgba(251,191,36,0.75))'
                  : 'none',
                transition: 'filter 0.35s ease',
              }}
            />
          </div>

          {/* 단계 라벨 */}
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#7f0005',
            background: '#fff0f1', borderRadius: 20, padding: '3px 12px',
          }}>
            {stage.label}
          </div>

          <p style={{ fontSize: 13, color: '#595959', margin: 0, textAlign: 'center', wordBreak: 'keep-all' }}>
            {stage.message}
          </p>

          {/* 먹이 배지 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: available > 0 ? '#fff0f1' : '#f5f5f5',
            borderRadius: 10, padding: '3px 10px',
            transition: 'background 0.3s ease',
          }}>
            <span style={{ fontSize: 14 }}>🥬</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: available > 0 ? '#7f0005' : '#8c8c8c' }}>
              {available > 0 ? `먹이 ${available}개` : '먹이 없음 (수업 후 획득)'}
            </span>
          </div>
        </div>

        {/* 구분선 */}
        <div style={{ height: 1, background: '#f0f0f0', margin: '16px 0' }} />

        {/* 성장 게이지 */}
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 6,
          }}>
            <span style={{ fontSize: 12, color: '#767676' }}>
              성장 <strong style={{ color: '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>{fedTotal}</strong>회
            </span>
            {stage.nextAt != null ? (
              <span style={{ fontSize: 12, color: '#767676' }}>
                다음까지 <strong style={{ color: '#7f0005', fontVariantNumeric: 'tabular-nums' }}>{remaining}</strong>회
              </span>
            ) : (
              <span style={{ fontSize: 12, color: '#7f0005', fontWeight: 700 }}>최고 단계 👑</span>
            )}
          </div>
          <div style={{ width: '100%', height: 8, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: stage.nextAt == null
                ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                : 'linear-gradient(90deg, #7f0005, #c8000a)',
              borderRadius: 99,
              transition: 'width 0.65s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }} />
          </div>
        </div>

        {/* 버튼 행 */}
        <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 12 }}>
          <button
            ref={feedBtnRef}
            onClick={handleFeed}
            disabled={!canFeed}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              border: 'none',
              cursor: canFeed ? 'pointer' : 'not-allowed',
              background: canFeed
                ? 'linear-gradient(135deg, #7f0005, #9a0007)'
                : '#f0f0f0',
              color: canFeed ? '#ffffff' : '#bfbfbf',
              fontSize: 14, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              WebkitTapHighlightColor: 'transparent',
              opacity: available > 0 ? 1 : 0.55,
              transition: 'opacity 0.2s, background 0.2s',
            }}
          >
            🥬 먹이주기
          </button>
          <button
            onClick={handlePet}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              border: '1.5px solid #e5e5e5',
              cursor: 'pointer',
              background: '#ffffff',
              color: '#595959',
              fontSize: 14, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            🤚 쓰다듬기
          </button>
        </div>

        {/* 먹이 전부 주기 (2개 이상일 때만 표시) */}
        {available >= 2 && (
          <button
            ref={feedAllBtnRef}
            onClick={handleFeedAll}
            disabled={!canFeed}
            style={{
              width: '100%', height: 38, borderRadius: 12, marginTop: 8,
              border: '1.5px solid #7f0005',
              cursor: canFeed ? 'pointer' : 'not-allowed',
              background: canFeed ? '#fff0f1' : '#f5f5f5',
              color: canFeed ? '#7f0005' : '#bfbfbf',
              fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              WebkitTapHighlightColor: 'transparent',
              transition: 'background 0.2s',
            }}
          >
            🥬✕{available} 먹이 전부 주기
          </button>
        )}
      </div>
    </>
  );
}
