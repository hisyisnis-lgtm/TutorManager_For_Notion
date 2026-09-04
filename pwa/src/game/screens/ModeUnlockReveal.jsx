// 모드 잠금해제 연출 — 난이도(중급·고급)·무한·테마(여행)가 열렸을 때 전용 "새 모드 열림" 오버레이.
// 시안(794:562 시퀀스1 → 757:43 시퀀스2): **잠긴 오브 → 열린 오브** 2단 연출.
//   ① 모드선택 화면과 같은 오브(100)에 검정 80% 덮개 + 자물쇠 40 → ② 덮개·자물쇠가 걷히고 모드 아이콘이 드러남.
// 톤: 어두운 딤(rgba(0,0,0,0.8)) + 미니멀(컨페티·글로우·설명문 없음).
import { useEffect, useState } from 'react';
import { Rocket, Crown, Infinity as InfinityIcon, MapPoint, ChefHat, Stars, LockUnlocked, Lock } from '@solar-icons/react';
import { TYPE, haptic, SPACE, TG, keycap } from '../tgTokens.js';
import { RevealStage, RevealRings, BeatContent } from './shared.jsx';

const ICONS = { Rocket, Crown, Infinity: InfinityIcon, MapPin: MapPoint, ForkKnife: ChefHat, Sparkle: Stars };
// 잠김 색 = 시안의 '검정 80% 덮개'를 **오브 색에 미리 합성**한 값(#F3A75B → #312112).
//  ★원 위에 같은 크기의 반투명 원을 겹치면 두 테두리의 안티에일리어싱이 따로 계산돼 1px 주황 링이 생긴다
//    (2026-08-06 사용자 지적 "애매하게 외곽이 보인다"). → 오브 원은 **하나만**(테두리도 하나만) 두고,
//    연출용 레이어는 그 안에서 `overflow:hidden`으로 잘리게 한다(레이어 자신의 테두리가 화면에 안 닿음).
const dim20 = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * 0.2).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};
// 시안 794:562(잠김)·757:43(해제) 2026-08-07 개편 — 오브·아이콘이 커지고 라벨도 커졌다.
const ORB = 130;          // 오브 지름(시안 130, 구 100)
const ICON_SIZE = 69;     // 모드 아이콘(시안 69, 구 53.06)
// ★타이밍 규칙: 등장(scale)이 끝난 **뒤에** 잠금이 풀려야 한다. 겹치면 잠긴 원이 100%로 보이는 프레임이 없어
//   "검은 원이 미세하게 작다"로 보인다(2026-08-06 사용자 지적). 등장 0.02+0.40=0.42s → 잠김 유지 0.2s → 해제 0.62~1.04s.
const UNLOCK_DELAY = 0.9;  // 자물쇠 덮개 페이드 시작(s) — 등장(0.42s) 뒤 '잠김' 상태를 0.48s 보여주고 푼다
const UNLOCK_DUR = 0.42;   // 덮개 페이드 길이(s)
const OPEN_AT = (UNLOCK_DELAY + UNLOCK_DUR) * 1000; // 덮개가 다 사라지는 순간 아이콘 공개

export function ModeUnlockReveal({ unlock, onDone, hold = false }) {
  const [closing, setClosing] = useState(false);
  // locked(시퀀스1) → unlocking(모드 색이 안에서 차오름) → opened(시퀀스2)
  const [phase, setPhase] = useState('locked');
  const opened = phase === 'opened';
  useEffect(() => {
    haptic([20, 40, 20]);
    const timers = [
      setTimeout(() => { setPhase('unlocking'); haptic([30, 60, 30]); }, UNLOCK_DELAY * 1000),
      setTimeout(() => setPhase('opened'), OPEN_AT), // 차오름이 오브를 다 덮은 순간 = 평평한 모드 색으로 교체
    ];
    if (!hold) {
      timers.push(setTimeout(() => setClosing(true), 2600));
      timers.push(setTimeout(() => onDone && onDone(), 2900));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!unlock) return null;
  const Icon = ICONS[unlock.icon] || LockUnlocked;
  const fill = unlock.fill || unlock.accent || TG.ENDLESS;
  const edge = unlock.edge || 'rgba(0,0,0,0.18)';
  // 덧획(무한 아이콘처럼 획이 얇은 글리프용) — 없으면 그대로. 값은 SVG 뷰박스(24) 기준.
  //  ★모드선택 화면 값(1.4)을 그대로 쓰면 이 연출에선 아이콘이 53px이라 화면상 3.1px로 두꺼워진다.
  //    시안 SVG(53 단위, stroke 1.4 = 화면 1.4px)와 실측 대조해 1.1로 맞춤(0.63은 얇고 1.4는 두꺼움).
  const iconStroke = unlock.iconStroke
    ? { stroke: 'currentColor', strokeWidth: unlock.iconStroke, strokeLinejoin: 'round', strokeLinecap: 'round' }
    : null;
  return (
    <div onClick={() => !hold && onDone && onDone()} style={{
      position: 'fixed', inset: 0, zIndex: 135,
      // 딤은 BeatDim(공용 레이어) 담당 — 체인 사이 깜빡임 방지(2026-08-08)
    }}>
      <style>{`
        @keyframes mu-icon { from{opacity:0;transform:scale(.7)} to{opacity:1;transform:scale(1)} }
        @keyframes mu-unlock { 0%{opacity:1;transform:scale(1) rotate(0)} 55%{opacity:.85;transform:scale(1.22) rotate(-9deg)} 100%{opacity:0;transform:scale(1.6) rotate(-16deg)} }
        @keyframes mu-reveal { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.12)} 100%{transform:scale(1)} }
        @keyframes mu-flood { from{transform:scale(0)} to{transform:scale(1.7)} }
      `}</style>
      {/* 동심원 배경 — 딤 위·콘텐츠 아래. ★BeatContent 밖에 둔다: 안에 있으면 부모 퇴장(170ms)이
          먼저 지워버려 바깥부터 퍼지는 out 모션이 보이지 않는다(2026-08-09) */}
      <RevealRings out={closing} />
      <BeatContent closing={closing}>
      <RevealStage>
      {/* 오브 — 잠김(어두운 색+자물쇠) → 모드 색이 가운데서 차오름 → 해제(모드 색+아이콘).
          ★테두리를 만드는 원은 이 div 하나뿐. 연출 레이어는 overflow로 잘려 자기 테두리가 화면에 닿지 않는다. */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 317, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          position: 'relative', width: ORB, height: ORB, borderRadius: '50%', overflow: 'hidden',
          background: opened ? fill : dim20(fill),
          boxShadow: keycap(opened ? edge : dim20(edge), { lift: null }),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'mu-icon .4s cubic-bezier(.22,1,.36,1) .02s both',
        }}>
          {/* 차오르는 모드 색 — 가운데서 퍼져 오브를 덮는다(scale 1.7이라 끝엔 테두리 밖까지 = 잘림) */}
          {phase === 'unlocking' && (
            <span aria-hidden="true" style={{
              position: 'absolute', inset: 0, borderRadius: '50%', background: fill,
              animation: `mu-flood ${UNLOCK_DUR}s cubic-bezier(.22,1,.36,1) both`,
            }} />
          )}
          {opened
            ? <Icon size={ICON_SIZE} weight="Bold" color="#fff" style={{ ...iconStroke, animation: 'mu-reveal .5s cubic-bezier(.34,1.56,.64,1) both' }} />
            /* 자물쇠 — 해제 순간 튕겨 나가며 사라진다 */
            : <Lock size={40} weight="Bold" color="#fff" style={{ position: 'relative', animation: `mu-unlock ${UNLOCK_DUR}s ease-in ${UNLOCK_DELAY}s both` }} />}
        </div>
      </div>
      {/* 라벨 — 시안 y467(eyebrow 20/19) · y498(모드명 40/44) */}
      <span style={{ position: 'absolute', left: 0, right: 0, top: 467, textAlign: 'center', ...TYPE.head, fontSize: 20, lineHeight: '19px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .16s both' }}>새 모드 열림</span>
      <span style={{ position: 'absolute', left: 0, right: 0, top: 498, textAlign: 'center', ...TYPE.head, fontSize: 40, lineHeight: '44px', color: '#fff', animation: 'tg-rise .5s cubic-bezier(.22,1,.36,1) .22s both' }}>{unlock.label}</span>
      </RevealStage>
      </BeatContent>
    </div>
  );
}
