import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPrivateNtfyTopic, publicNtfyAlert } from './ntfyPrivacy.js';

const env = { NTFY_TOKEN: 'synthetic-token' };
const account = reservations => ({ username: 'synthetic-user', role: 'user', reservations,
  tokens: [{ token: 'must-never-appear-in-logs' }], emails: [{ address: 'never-log@example.invalid' }] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('live ntfy topic privacy boundary', () => {
  it('public notifications contain only a fixed title, guidance, app URL and safe level metadata', () => {
    for (const level of ['critical', 'warn', 'info', 'digest', 'attacker-title', '__proto__']) {
      const data = publicNtfyAlert(level);
      expect(data.message).toBe('강사앱의 수업·상담 등 관련 항목을 확인해주세요.\nhttps://tiantian-chinese.pages.dev/');
      expect(data.title).not.toContain('attacker');
      expect([2, 3, 4, 5]).toContain(data.priority);
      expect(Object.keys(data).sort()).toEqual(['message', 'priority', 'tags', 'title']);
    }
    expect(publicNtfyAlert('unknown')).toEqual(publicNtfyAlert('info'));
  });
  it('preserves actual alert categories using fixed titles and never copies input text', () => {
    const cases = [
      ['숙제 제출', '새 숙제 제출 알림'], ['⚠️ 숙제 제출 실패', '숙제 제출 오류 알림'],
      ['📩 무료상담 신청', '새 상담 신청 알림'], ['🚨 무료상담 신청 저장 실패', '상담 신청 저장 오류 알림'],
      ['📅 내일 수업 안내', '내일 수업 안내'], ['⚠️ 수업 충돌 감지', '수업 일정 충돌 알림'],
      ['❌ 수납 현황 갱신 실패', '결제 관리 확인 알림'], ['결제 백업 완료', '결제 백업 알림'],
      ['주간 백업 실패', '백업 작업 알림'], ['월간 아카이브 완료', '백업 작업 알림'],
      ['📋 9/8(화) 브리핑', '일일 수업 관리 요약 알림'], ['일일 운영 리포트 2026-09-08', '일일 수업 관리 요약 알림'],
      ['⚠️ PWA 클라이언트 에러', '앱 오류 확인 알림'], ['🚨 Worker 에러 (POST /path)', '시스템 오류 확인 알림'],
      ['10분 후 수업 시작', '수업 안내'], ['곧 수업이 시작됩니다', '수업 안내'],
    ];
    for (const [input, expected] of cases) {
      const data = publicNtfyAlert('info', `${input} 김개인정보 01012345678 50000원 https://evil.invalid/<script>secret</script>`);
      expect(data.title).toBe(expected);
      expect(JSON.stringify(data)).not.toMatch(/김개인정보|01012345678|50000|evil|script|secret|2026-09-08|9\/8/);
      expect(data.message).toBe(publicNtfyAlert('info').message);
    }
    expect(publicNtfyAlert('warn', '<img src=https://evil.invalid>')).toEqual(publicNtfyAlert('warn'));
  });
  it('requires an exact account-owned reservation with everyone denied', async () => {
    const fetch = vi.fn(async () => Response.json(account([{ topic: 'private-fixture', everyone: 'deny-all' }])));
    vi.stubGlobal('fetch', fetch);
    expect(await isPrivateNtfyTopic(env, 'private-fixture')).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://ntfy.sh/v1/account', expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-token', Accept: 'application/json' }, redirect: 'error', cache: 'no-store',
    }));
  });
  it('unreserved, anonymous, readable, writable, and wildcard reservations are denied', async () => {
    const invalid = [
      account([]), account([{ topic: 'fixture', everyone: 'read-write' }]),
      account([{ topic: 'fixture', everyone: 'read-only' }]), account([{ topic: 'fixture', everyone: 'write-only' }]),
      account([{ topic: 'fix*', everyone: 'deny-all' }]), account([{ topic: 'other', everyone: 'deny-all' }]),
      { ...account([{ topic: 'fixture', everyone: 'deny-all' }]), role: 'anonymous' },
      account([{ topic: 'fixture', everyone: 'deny-all' }, { topic: 'fixture', everyone: 'read-only' }]),
      { username: 'user', role: 'user', reservations: null },
    ];
    for (const data of invalid) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
      expect(await isPrivateNtfyTopic(env, 'fixture')).toBe(false);
    }
  });
  it('checks every operation again, including after a private topic becomes public', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(account([{ topic: 'fixture', everyone: 'deny-all' }])))
      .mockResolvedValueOnce(Response.json(account([{ topic: 'fixture', everyone: 'read-write' }])));
    vi.stubGlobal('fetch', fetch);
    expect(await isPrivateNtfyTopic(env, 'fixture')).toBe(true);
    expect(await isPrivateNtfyTopic(env, 'fixture')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('missing credentials or malformed topics never make a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await isPrivateNtfyTopic({}, 'fixture')).toBe(false);
    expect(await isPrivateNtfyTopic(env, 'fixture/other')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('HTTP, malformed JSON, and network failures do not expose account data or authorize', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const response of [Response.json(account([]), { status: 403 }), new Response('not-json'), new Response('x'.repeat(128 * 1024 + 1))]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      expect(await isPrivateNtfyTopic(env, 'fixture')).toBe(false);
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('never-log-secret'); }));
    expect(await isPrivateNtfyTopic(env, 'fixture')).toBe(false);
    expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it('account requests time out closed', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    const pending = isPrivateNtfyTopic(env, 'fixture');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
  });
});
