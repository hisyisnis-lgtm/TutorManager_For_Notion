// 성조 캐릭터 공용 '눈' — 홈/타이틀/로딩 화면에 3벌 복붙돼 있던 것을 단일 모듈로 통합(정본=HomeScreen 버전).
// EYES=성조별 눈 위치표, markSize=마크 크기, Eyes=깜빡이는 눈 캡슐 한 쌍(tg-blinkeye).
import { TG } from '../tgTokens.js';

// 마크 크기 — 경성(점)은 너무 작아 키움(size100→점 ~42px), 나머지 선/V는 68.
export const markSize = (num) => (num === 0 ? 100 : 68);

// 성조별 눈 위치 — ToneMark 박스(선/V=68×34, 경성=점 ~42×42) 기준 px. cx/cy=눈쌍 중심, gap=좌우, w/h=세로 캡슐
export const EYES = {
  // 2026-07-28 사용자 요청으로 눈 확대(w4→5·h9→11, 경성 h8→10). gap도 반영해 살짝 벌림.
  1: { cx: 34, cy: 9, gap: 6.5, w: 5, h: 11 },
  2: { cx: 37, cy: 10, gap: 6.5, w: 5, h: 11 },
  3: { cx: 34, cy: 8, gap: 6.5, w: 5, h: 11 },
  4: { cx: 31, cy: 10, gap: 6.5, w: 5, h: 11 },
  0: { cx: 21, cy: 17, gap: 5.5, w: 5, h: 10 },
};
// i=깜빡임 시차 계수(delay=i*0.7s — 캐릭터마다 어긋나게), scale=마크 스케일에 맞춘 눈 배율.
export function Eyes({ num, i, scale = 1 }) {
  const e = EYES[num]; if (!e) return null;
  return [-1, 1].map((s) => (
    <div key={s} style={{ position: 'absolute', left: (e.cx + s * e.gap - e.w / 2) * scale, top: (e.cy - e.h / 2) * scale, width: e.w * scale, height: e.h * scale, borderRadius: (e.w * scale) / 2, background: TG.INK, transformOrigin: 'center', animation: `tg-blinkeye ${4.4 + (num % 5) * 0.5}s ease-in-out ${i * 0.7}s infinite`, pointerEvents: 'none', zIndex: 1 }} />
  ));
}
