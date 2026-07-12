// 예약 API — 충돌 검사 실패를 "충돌 없음"으로 위장하지 않는지 검증 (가짜 fetch).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({ WORKER_URL: 'https://dummy.workers.dev' }));
vi.mock('./authUtils.js', () => ({ getToken: () => 'jwt' }));
vi.mock('./studentAuth.js', () => ({ studentBearer: () => '', handleStudentAuthExpiry: () => false }));

import { checkConflict } from './bookingApi.js';

beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => vi.restoreAllMocks());

describe('checkConflict — 확인 실패를 "충돌 없음"으로 위장하지 않기', () => {
  it('정상 응답이면 서버 결과를 그대로 반환', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ conflict: true, conflictTime: '10:00' }) });
    const r = await checkConflict('2026-07-12', '10:00', 60);
    expect(r.conflict).toBe(true);
    expect(r.checkFailed).toBeUndefined();
  });

  it('네트워크 실패 시 conflict:false + checkFailed:true (호출부가 "확인 불가" 안내)', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    const r = await checkConflict('2026-07-12', '10:00', 60);
    expect(r.conflict).toBe(false);
    expect(r.checkFailed).toBe(true); // 이전엔 이 플래그가 없어 "충돌 없음"으로 조용히 통과
  });
});
