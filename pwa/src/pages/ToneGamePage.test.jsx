// 인게임 배선 회귀 테스트 (2026-08-10 검수) — 순수 로직이 아니라 **컴포넌트 배선**에서 났던 버그들.
//
// DEV 미리보기 백도어(`?screen=game`)로 게임 화면을 바로 띄운다. 이때 단어는 PREVIEW_WORDS 고정이라
// (老师 = 3성+1성) 정답을 결정적으로 넣을 수 있다.
//
// ⚠️ QS(쿼리 파라미터)는 ToneGamePage **모듈 로드 시점**에 한 번 읽는다 → 주소를 먼저 바꾸고 동적 import 해야 한다.
// ⚠️ 질의는 반드시 그 판의 container 안에서 — 렌더 트리가 쌓이면 같은 이름의 버튼이 여러 개 잡힌다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, within, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';

async function renderGame(search = '?screen=game') {
  window.history.replaceState({}, '', `/game/tone${search}`);
  const { default: ToneGamePage } = await import('./ToneGamePage.jsx');
  const { container } = render(
    <MemoryRouter>
      <App>
        <ToneGamePage />
      </App>
    </MemoryRouter>,
  );
  const q = within(container);
  return {
    // 성조 버튼은 pointerdown으로 즉시 판정한다(클릭이 아니라)
    tapTone: (label) => fireEvent.pointerDown(q.getByRole('button', { name: label })),
    press: (label) => fireEvent.click(q.getByRole('button', { name: label })),
    score: () => q.getByTestId('tg-score').textContent,
  };
}

// jsdom에는 Web Animations API가 없다 — 성조 발사체·셰이크가 el.animate()를 쓰므로 최소 shim을 깐다.
//  판정·점수는 탭 순간 이미 끝나고 animate는 연출 전용이라, 애니메이션이 실제로 돌지 않아도 검증에 지장 없다.
if (!Element.prototype.animate) {
  Element.prototype.animate = function animateStub() {
    const a = { onfinish: null, cancel() {}, finish() {}, play() {}, pause() {} };
    return a;
  };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('발음 듣기 페널티 (H4) — 소리가 곧 정답이므로 힌트다', () => {
  it('★발음 듣기를 쓰고 맞히면 플랫 50점 — 콤보·시간 보너스 없음', async () => {
    const g = await renderGame();
    g.press('발음 듣기');
    g.tapTone('3성'); g.tapTone('1성');        // 老师 = 3성 + 1성
    expect(g.score()).toBe('50');
  }, 20000);

  it('대조군: 힌트 없이 맞히면 100점 이상(기본 100 + 콤보 + 남은시간)', async () => {
    const g = await renderGame();
    g.tapTone('3성'); g.tapTone('1성');
    expect(Number(g.score())).toBeGreaterThan(100);
  }, 20000);
});

describe('정답보기 (M6) — 맞힌 문제가 아니다', () => {
  it('정답보기로 공개한 문제는 점수를 주지 않는다', async () => {
    const g = await renderGame();
    g.press('정답보기');
    expect(g.score()).toBe('0');
  }, 20000);
});
