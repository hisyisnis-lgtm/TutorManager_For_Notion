import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadWorker(overrides = {}) {
  const source = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');
  const listeners = {};
  const context = {
    self: {
      addEventListener(type, listener) { listeners[type] = listener; },
      ...overrides,
    },
    URL,
  };
  runInNewContext(source, context);
  return { self: context.self, listeners };
}

describe('Web Push system notification preview', () => {
  it('shows one compact section and directs long alerts to the full in-app history', () => {
    const { notificationPreview: preview } = loadWorker().self;
    const message = '[오늘 수업 2건]\n  · 10:00 김학생\n  · 14:00 이학생\n\n[피드백 대기 1건]\n  · 숙제';

    expect(preview(message)).toBe('[오늘 수업 2건] · 10:00 김학생 · 14:00 이학생\n눌러서 전체 내용 보기');
  });

  it('does not add a full-content hint to an already short alert', () => {
    expect(loadWorker().self.notificationPreview('수업이 곧 시작됩니다.')).toBe('수업이 곧 시작됩니다.');
  });

  it('navigates an already open app to the exact notification history item', async () => {
    const client = {
      navigate: vi.fn(async () => client),
      focus: vi.fn(async () => client),
    };
    const openWindow = vi.fn();
    const { listeners } = loadWorker({
      location: { origin: 'https://app.example.test' },
      clients: { matchAll: vi.fn(async () => [client]), openWindow },
    });
    let completion;

    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: '/#/notifications?id=notice-1' } },
      waitUntil(promise) { completion = promise; },
    });
    await completion;

    expect(client.navigate).toHaveBeenCalledWith('https://app.example.test/#/notifications?id=notice-1');
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });
});
