import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNotificationFollowups, resolveNotificationFollowup } from './notificationFollowups.js';
import { notifyHomework } from './homework.js';
import { setAuth, clearAuth, getToken } from './authUtils.js';
import { fixtureSession } from './authFixtures.js';
import { notifyAuthChange } from './authState.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.unstubAllGlobals(); });

describe('발송 후속 API 인증 경계', () => {
  it('강사 bearer와 최소 처리 방법만 전송하고 캐시하지 않는다', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [] })); vi.stubGlobal('fetch', fetch);
    await fetchNotificationFollowups('open', '123:cursor');
    await resolveNotificationFollowup('record', 'contacted');
    expect(fetch.mock.calls[0][0]).toContain('filter=open&before=123%3Acursor');
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers.Authorization).toBe('Bearer ' + getToken()); expect(options.cache).toBe('no-store');
    }
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ resolutionKind: 'contacted' });
  });
  it('인증 없음은 요청하지 않고 401 응답은 강사 인증을 정리한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '만료' }, { status: 401 })));
    await expect(fetchNotificationFollowups('open')).rejects.toThrow();
    expect(getToken()).toBe('');
    await expect(fetchNotificationFollowups('open')).rejects.toThrow('강사 로그인');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('로그아웃 뒤 도착한 조회 결과를 거절한다', async () => {
    let respond; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { respond = resolve; })));
    const pending = fetchNotificationFollowups('all');
    clearAuth(); respond(Response.json({ items: [{ id: 'private-old-record' }] }));
    await expect(pending).rejects.toThrow('인증 상태가 바뀌었습니다');
  });
});

describe('업무 저장과 분리한 숙제 알림 결과', () => {
  it.each([
    [200, { ok: true, sent: true, delivery: 'accepted' }, 'accepted'],
    [502, { ok: false, sent: false, delivery: 'failed' }, 'failed'],
    [502, { ok: false, sent: false, delivery: 'unknown' }, 'unknown'],
    [200, { ok: false, reason: 'no_phone' }, 'failed'],
    [200, { ok: true }, 'unknown'],
  ])('HTTP %s 응답 %j를 %s로 안내하며 재발송하지 않는다', async (status, data, state) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(data, { status })));
    const result = await notifyHomework('assign', 'homework');
    expect(result).toMatchObject({ state, ok: state === 'accepted' });
    if (!result.ok) expect(result.message).toContain('저장은 완료');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('응답 유실도 저장 실패 예외를 던지거나 자동 재시도하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(notifyHomework('feedback', 'homework')).resolves.toMatchObject({ ok: false, state: 'unknown' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('이전 강사 요청에서 늦게 온 알림 실패는 새 화면에 안내하지 않는다', async () => {
    let respond; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { respond = resolve; })));
    const pending = notifyHomework('feedback', 'homework');
    clearAuth(); respond(Response.json({ delivery: 'failed' }, { status: 502 }));
    await expect(pending).resolves.toEqual({ ok: false, ignored: true });
  });
});
