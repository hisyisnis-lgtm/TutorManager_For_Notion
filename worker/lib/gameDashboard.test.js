import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { assembleByDay, embedMembers, renderDashboard } from './gameDashboard.js';

// 실제 직렬화된 브라우저 함수를 실행하고 탭/회원 클릭 때 생성하는 HTML을 검사한다.
function dashboard(data) {
  const html = renderDashboard(data, { nonce: 'test-nonce' });
  const payload = html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1];
  const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: id === 'gad' ? payload : '', innerHTML: '', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return elements.get(id);
  };
  const tabs = ['overview', 'traffic', 'content', 'members'].map((tab) => ({
    getAttribute: () => tab, classList: { toggle() {} }, addEventListener(_event, fn) { this.click = fn; },
  }));
  runInNewContext(script, { document: { getElementById: (id) => id === 'chart' ? null : element(id), querySelectorAll: (q) => q === '.nav-item' ? tabs : [] } });
  return { html, tabs, element, content: () => element('content').innerHTML };
}

describe('dashboard security', () => {
  it('모든 탭의 저장된 라벨·닉네임·공급자 문자열을 텍스트로만 렌더한다', () => {
    const marker = '<b data-audit="marker">주입</b>';
    const { days, byDay } = assembleByDay({ ch: [{ day: '2026-09-08', k: marker, n: 1 }], mp: [{ day: '2026-09-08', k: marker, n: 1 }], src: [{ day: '2026-09-08', k: marker, n: 1 }], id: [{ day: '2026-09-08', k: marker, n: 1 }] }, 1, Date.parse('2026-09-08'));
    const members = embedMembers([{ nickname: marker, provider: marker, created_at: '2026-09-08', last_seen_at: '2026-09-08', game_data: JSON.stringify({ best: { [marker]: { bestScore: 100, playCount: 1 } } }) }]);
    const d = dashboard({ days, byDay, members, maxDays: 1, generatedAt: marker, source: marker });
    for (const tab of d.tabs) { tab.click(); expect(d.content()).not.toContain('<b data-audit'); }
    expect(d.content()).toContain('&lt;b data-audit=');
    d.element('content').listeners.click({ target: { closest: (q) => q === '.memrow.clk' ? { getAttribute: () => '0' } : null } });
    expect(d.content()).not.toContain('<b data-audit');
    expect(d.content()).toContain('&lt;b data-audit=');
    expect(d.html).not.toContain('<b data-audit');
    expect(d.html.match(/nonce="test-nonce"/g)).toHaveLength(2);
  });

  it('prototype 키·잘못된 숫자·깨진 과거 저장값은 코드 실행이나 집계 오염을 만들지 않는다', () => {
    const { days, byDay } = assembleByDay({ mp: [{ day: '2026-09-08', k: '__proto__', n: '3' }, { day: '2026-09-08', k: 'constructor', n: 'Infinity' }] }, 1, Date.parse('2026-09-08'));
    expect(Object.getPrototypeOf(byDay['2026-09-08'].mode)).toBeNull();
    expect(byDay['2026-09-08'].mode.__proto__.plays).toBe(3);
    expect(byDay['2026-09-08'].mode.constructor.plays).toBe(0);
    const members = embedMembers([{ provider: 'constructor', game_data: '{"best":{"__proto__":{"bestScore":"<img>","playCount":"<svg>"}},"xp":"Infinity"}' }, { game_data: 'null' }]);
    expect(members[0].xp).toBe(0);
    expect(members[0].best.__proto__).toBe(0);
    const d = dashboard({ days, byDay, members, maxDays: 1, generatedAt: 'now' });
    for (const tab of d.tabs) expect(() => tab.click()).not.toThrow();
    expect({}.plays).toBeUndefined();
  });
});
