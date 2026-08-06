import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeNotion } from './notion.js';

// 대기 없이 재시도 횟수만 검증하기 위해 backoff를 0으로 주입.
const noWait = { backoffMs: [0, 0] };

function mockFetch(impl) {
  const spy = vi.fn(impl);
  globalThis.fetch = spy;
  return spy;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeNotion', () => {
  it('정상 응답은 그대로 파싱해서 반환한다', async () => {
    mockFetch(async () => new Response(JSON.stringify({ results: [{ id: 'a' }] }), { status: 200 }));
    const n = makeNotion('tok', noWait);
    await expect(n('POST', '/databases/x/query', {})).resolves.toEqual({ results: [{ id: 'a' }] });
  });

  // 2026-08-06 장애의 핵심: 3분짜리 Notion 흔들림에 학생 요청이 그대로 실패했다.
  it('연결이 끊겨도 재시도해서 성공시킨다 (ECONNRESET)', async () => {
    let calls = 0;
    const spy = mockFetch(async () => {
      if (++calls <= 2) {
        const e = new TypeError('fetch failed');
        e.cause = { code: 'ECONNRESET' };
        throw e;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('5xx도 재시도해서 성공시킨다', async () => {
    let calls = 0;
    const spy = mockFetch(async () =>
      ++calls <= 1
        ? new Response('error code: 525\n', { status: 525 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('429도 재시도 대상이다', async () => {
    let calls = 0;
    const spy = mockFetch(async () =>
      ++calls <= 2
        ? new Response(JSON.stringify({ object: 'error' }), { status: 429 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  // 예전엔 "SyntaxError: Unexpected token 'e'"로 둔갑해 원인 추적이 불가능했다.
  it('525가 계속되면 상태 코드와 본문이 드러나는 에러를 던진다', async () => {
    const spy = mockFetch(async () => new Response('error code: 525\n', { status: 525 }));
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).rejects.toThrow(/Notion 525 .*error code: 525/s);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('연결 끊김이 계속되면 원인을 담아 던진다', async () => {
    const spy = mockFetch(async () => {
      const e = new TypeError('fetch failed');
      e.cause = { code: 'ETIMEDOUT' };
      throw e;
    });
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).rejects.toThrow(/Notion 연결 실패 .*3회 시도/s);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  // 기존 호출부(findStudentByToken 등)가 4xx의 JSON 에러 객체 형태에 의존하므로
  // 여기서 던지면 안 된다 — 회귀 방지용.
  it('4xx는 던지지 않고 JSON 에러 객체를 그대로 넘긴다', async () => {
    const spy = mockFetch(async () =>
      new Response(JSON.stringify({ object: 'error', status: 404 }), { status: 404 })
    );
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).resolves.toEqual({ object: 'error', status: 404 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('본문이 JSON이 아니면 원문을 담아 던진다', async () => {
    mockFetch(async () => new Response('<html>gateway</html>', { status: 200 }));
    const n = makeNotion('tok', noWait);
    await expect(n('GET', '/pages/abc')).rejects.toThrow(/JSON이 아님.*gateway/s);
  });
});
