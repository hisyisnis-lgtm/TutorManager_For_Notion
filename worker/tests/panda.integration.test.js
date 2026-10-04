import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { pandaD1 } from './helpers/pandaD1.js';

const CODE = 'QAABCD123456', OTHER_CODE = 'QAOTHER12345';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111', OTHER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_DB = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb', CLASS_DB = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const SECRET = 'isolated-panda-test-secret';
let local, env, token, calls, classes, props, upstream, sequence, sameStudentForOtherCode;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = ({ code = CODE, auth = token, action, method = action ? 'POST' : 'GET', rawBody } = {}) => worker.fetch(new Request(`https://worker.fixture.invalid/personal/student/${code}/panda${action || rawBody ? '/action' : ''}`, {
  method, headers: { Origin: 'http://localhost:5173', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(action || rawBody ? { 'Content-Type': 'application/json' } : {}) },
  ...(action || rawBody ? { body: rawBody || JSON.stringify(action) } : {}),
}), env, ctx);
const action = (type, fields = {}, expectedRevision = 0) => ({ requestId: `integration-${String(++sequence).padStart(12, '0')}`, expectedRevision, type, ...fields });
const classRow = (id, date = '2026-01-02', duration = 6000, special = null, paid = 1) => ({ id, properties: {
  '특이사항': { select: special ? { name: special } : null }, '무료 수업': { rollup: { number: paid } },
  '수업 일시': { date: { start: date } }, '수업 시간(분)': { select: { name: String(duration) } },
} });

beforeEach(async () => {
  local = pandaD1(); calls = []; upstream = null; sequence = 0; sameStudentForOtherCode = false;
  env = { GAME_DB: local.db, JWT_SECRET: SECRET, NOTION_TOKEN: 'fixture-only-notion' };
  token = await signTypedToken(SECRET, 'student', `personal:${CODE}`, 600);
  props = { '공유일': { date: { start: '2026-01-01' } }, '숙제 제출 먹이': { rollup: { number: 0 } }, '피드백 확인 먹이': { rollup: { number: 0 } } };
  classes = [classRow('class-1')];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const requestUrl = new URL(url), body = JSON.parse(init.body || '{}');
    if (requestUrl.origin !== 'https://api.notion.com' || init.method !== 'POST' || !requestUrl.pathname.endsWith('/query')) throw new Error('Unexpected external request');
    calls.push({ path: requestUrl.pathname, body });
    if (requestUrl.pathname.includes(STUDENT_DB)) {
      if (upstream === 'student-error') return Response.json({ object: 'error', status: 400, message: `${CODE} ${SECRET}` }, { status: 400 });
      if (upstream === 'missing-student') return Response.json({ results: [], has_more: false });
      const owner = body.filter.rich_text.equals === OTHER_CODE && !sameStudentForOtherCode ? OTHER_ID : STUDENT_ID;
      return Response.json({ results: [{ id: owner, properties: props }], has_more: false });
    }
    if (!requestUrl.pathname.includes(CLASS_DB)) throw new Error('Unexpected database');
    expect([STUDENT_ID, OTHER_ID]).toContain(body.filter.relation.contains);
    if (upstream === 'classes-error') return Response.json({ object: 'error' }, { status: 400 });
    if (upstream === 'missing-cursor') return Response.json({ results: classes.slice(0, 1), has_more: true });
    if (upstream === 'missing-has-more') return Response.json({ results: [] });
    const start = Number(body.start_cursor || 0);
    return Response.json({ results: classes.slice(start, start + 100), has_more: start + 100 < classes.length,
      next_cursor: start + 100 < classes.length ? String(start + 100) : null });
  }));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('학생 판다 API 인증과 서버 원장', () => {
  it('학생·소셜게임 간 경계를 지키고 거부된 요청은 Notion을 조회하지 않는다', async () => {
    const game = await signTypedToken(SECRET, 'game', 'fixture-game', 600);
    for (const options of [{ auth: '' }, { auth: game }, { code: OTHER_CODE }, { code: OTHER_CODE, action: action('feed', { count: 1 }) }]) {
      expect((await send(options)).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
    const teacher = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
    expect((await send({ auth: teacher })).status).toBe(200);
  });

  it('Notion 학생 ID에 저장하고 다른 예약코드의 본인 기록과 분리한다', async () => {
    const result = await send({ action: action('feed', { count: 3 }) });
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await result.json()).toMatchObject({ profile: { fedTotal: 3, revision: 1 }, earnedTotal: 200, availableFood: 197 });
    const otherAuth = await signTypedToken(SECRET, 'student', `personal:${OTHER_CODE}`, 600);
    const other = await (await send({ code: OTHER_CODE, auth: otherAuth })).json();
    expect(other.profile.fedTotal).toBe(0);
    expect(local.sqlite.prepare('SELECT student_id FROM student_panda_profiles ORDER BY student_id').all().map(row => row.student_id)).toEqual([STUDENT_ID.replaceAll('-', ''), OTHER_ID.replaceAll('-', '')]);
    expect(JSON.stringify(await (await send()).json())).not.toContain(CODE);
  });

  it('예약코드가 바뀌어도 같은 Notion 학생의 성장과 안내 확인을 복원한다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    await send({ action: action('dismiss-transition', {}, 1) });
    const before = await (await send()).json();
    sameStudentForOtherCode = true;
    const otherAuth = await signTypedToken(SECRET, 'student', `personal:${OTHER_CODE}`, 600);
    const after = await (await send({ code: OTHER_CODE, auth: otherAuth })).json();
    expect(after).toEqual(before);
    expect(after).toMatchObject({ profile: { fedTotal: 112, revision: 2 }, availableFood: 88,
      transition: { version: 1, startingFood: 200, noticeSeen: true } });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_profiles').get().count).toBe(1);
  });

  it.each([true, false])('기존 기기 먼저 접속=%s여도 로컬 성장 업로드는 거부하고 서버 전환을 한 번만 한다', async oldDeviceFirst => {
    const oldUpload = () => send({ action: action('migrate', { fedTotal: 112 }) });
    if (oldDeviceFirst) expect((await oldUpload()).status).toBe(400);
    const initial = await (await send()).json();
    expect(initial).toMatchObject({ availableFood: 200, profile: { fedTotal: 0, revision: 0 },
      transition: { version: 1, startingFood: 200, noticeSeen: false } });
    await send({ action: action('feed', { count: 1 }) });
    if (!oldDeviceFirst) expect((await oldUpload()).status).toBe(400);
    expect(await (await send()).json()).toMatchObject({ availableFood: 199, profile: { fedTotal: 1, revision: 1 }, transition: initial.transition });
  });

  it('공유 이후 유료수업·숙제 지급 기준과 100개 이후 페이지를 모두 포함한다', async () => {
    classes = Array.from({ length: 101 }, (_, i) => classRow(`paid-${i}`, '2026-01-02', 30));
    classes.push(classRow('before', '2025-01-01'), classRow('future', '2099-01-01'), classRow('cancel', '2026-01-02', 60, '🚫 취소'), classRow('makeup', '2026-01-02', 60, '🟠 보강'), classRow('free', '2026-01-02', 60, null, 0));
    props['숙제 제출 먹이'].rollup.number = 2; props['피드백 확인 먹이'].rollup.number = 3;
    expect(await (await send()).json()).toMatchObject({ earnedTotal: 106, availableFood: 106 });
    expect(calls.some(call => call.body.start_cursor === '100')).toBe(true);
  });

  it('공유 전에는 모든 먹이가 0이며 미확인 숙제 rollup은 0으로 저장하지 않는다', async () => {
    props['공유일'].date = null;
    expect(await (await send()).json()).toMatchObject({ earnedTotal: 0 });
    props['공유일'].date = { start: '2026-01-01' };
    delete props['숙제 제출 먹이'];
    expect((await send()).status).toBe(502);
    expect(local.sqlite.prepare('SELECT earned_total FROM student_panda_profiles').get().earned_total).toBe(0);
  });

  it('상위 응답 오류·불완전 페이지는 저장과 차감을 막고 이전 기록을 유지한다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    const before = local.sqlite.prepare('SELECT * FROM student_panda_profiles').get();
    for (upstream of ['student-error', 'classes-error', 'missing-cursor', 'missing-has-more']) {
      const response = await send({ action: action('buy', { itemId: 'gardener:neck' }, 1) });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: 'earnings_unavailable' });
      expect(local.sqlite.prepare('SELECT * FROM student_panda_profiles').get()).toEqual(before);
    }
  });

  it('첫 조회의 오류·불완전 실적은 전환을 확정하지 않고 복구한 전체 먹이로 시작한다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (upstream of ['student-error', 'classes-error', 'missing-cursor', 'missing-has-more']) {
      expect((await send()).status).toBe(502);
      expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_profiles').get().count).toBe(0);
    }
    upstream = null;
    const original = props['피드백 확인 먹이'];
    delete props['피드백 확인 먹이'];
    expect((await send()).status).toBe(502);
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_profiles').get().count).toBe(0);
    props['피드백 확인 먹이'] = original;
    expect(await (await send()).json()).toMatchObject({ availableFood: 200, profile: { fedTotal: 0 }, transition: { startingFood: 200, noticeSeen: false } });
    expect(logged).toHaveBeenCalledTimes(5);
  });

  it('버전 0 기록도 실적 조회가 실패하면 초기화하지 않고 복구 후에만 전환한다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    local.sqlite.exec('UPDATE student_panda_profiles SET transition_version = 0, transition_initialized_at = NULL, transition_starting_food = 0;');
    const before = local.sqlite.prepare('SELECT * FROM student_panda_profiles').get();
    upstream = 'missing-cursor';
    expect((await send()).status).toBe(502);
    expect(local.sqlite.prepare('SELECT * FROM student_panda_profiles').get()).toEqual(before);
    upstream = null;
    expect(await (await send()).json()).toMatchObject({ availableFood: 200, profile: { fedTotal: 0, revision: 2 }, transition: { version: 1, startingFood: 200 } });
  });

  it('완전한 Notion 합계가 낮아져도 이미 받은 먹이와 성장·최초 지급량을 보존한다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    const before = await (await send()).json();
    classes = [classRow('class-1', '2026-01-02', 60)];
    expect(await (await send()).json()).toEqual(before);
    expect(await (await send({ action: action('feed', { count: 1 }, 1) })).json()).toMatchObject({
      earnedTotal: 200, availableFood: 87, profile: { fedTotal: 113 }, transition: before.transition });
  });

  it('Notion·D1 장애는 단계와 원인을 기록하되 토큰·학생ID·오류 원문은 노출하지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    upstream = 'student-error';
    const earningsFailure = await send();
    expect(earningsFailure.status).toBe(502);
    expect(JSON.parse(logged.mock.calls[0][0])).toEqual({ event: 'panda_failure', operation: 'earnings', code: 'earnings_unavailable', reason: 'notion_http', upstreamStatus: 400 });
    upstream = null;
    env.GAME_DB = { ...local.db, prepare(sql) {
      if (sql.includes('student_panda_profiles')) throw new Error(`D1_ERROR: no such table: private_${STUDENT_ID} ${CODE} ${SECRET}`);
      return local.db.prepare(sql);
    } };
    const storageFailure = await send();
    expect(storageFailure.status).toBe(503);
    expect(JSON.parse(logged.mock.calls[1][0])).toEqual({ event: 'panda_failure', operation: 'read', code: 'storage_unavailable', reason: 'schema_missing' });
    const output = JSON.stringify(logged.mock.calls) + JSON.stringify(await earningsFailure.json()) + JSON.stringify(await storageFailure.json());
    for (const sensitive of [CODE, STUDENT_ID, SECRET, 'private_']) expect(output).not.toContain(sensitive);
  });

  it('가격 주입·잘못된 ID·이름·큰 요청은 지급 내역을 읽기 전에 거부한다', async () => {
    for (const invalid of [action('buy', { itemId: 'gardener:neck', price: 0 }), action('buy', { itemId: 'unknown:neck' }), action('nickname', { nickname: '\n이름' }), action('nickname', { nickname: '이름\u0085' }), action('migrate', { fedTotal: 112 })]) {
      expect((await send({ action: invalid })).status).toBe(400);
    }
    expect((await send({ method: 'POST', rawBody: JSON.stringify({ pad: 'x'.repeat(9000) }) })).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('같은 액션을 동시에 보내도 한 번 처리하고 오래된 별도 액션은 409 최신 상태를 반환한다', async () => {
    const feed = action('feed', { count: 3 });
    const responses = await Promise.all([send({ action: feed }), send({ action: feed })]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    const stale = await send({ action: action('feed', { count: 1 }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'revision_conflict', profile: { fedTotal: 3, revision: 1 }, availableFood: 197,
      transition: { version: 1, startingFood: 200, noticeSeen: false } });
  });

  it('이름은 NFC·공백 정리 후 저장하고 이름짓기 안내 확인을 유지한다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    const named = await send({ action: action('nickname', { nickname: '  \u1100\u1161  ' }, 1) });
    expect(named.status).toBe(200);
    expect(await named.json()).toMatchObject({ profile: { nickname: '가', namingPromptSeen: true, fedTotal: 112 } });
  });

  it.each([['strawberry:neck', 152], ['reader:neck', 192]])('성체 이후 40개 간격의 %s 구매 경계는 누적 먹이 %i개다', async (itemId, threshold) => {
    expect((await send({ action: action('feed', { count: threshold - 1 }) })).status).toBe(200);
    const locked = await send({ action: action('buy', { itemId }, 1) });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ code: 'level_locked', profile: { fedTotal: threshold - 1, revision: 1 } });
    expect((await send({ action: action('feed', { count: 1 }, 1) })).status).toBe(200);
    const purchased = await send({ action: action('buy', { itemId }, 2) });
    expect(purchased.status).toBe(200);
    expect(await purchased.json()).toMatchObject({ earnedTotal: 200, availableFood: 200 - threshold - 4,
      profile: { fedTotal: threshold, spentFood: 4, owned: [itemId], revision: 3 } });
  });

  it('목장식4·모자6·손소품6·코스튬8로 세트24개를 차감하고 같은 구매 요청 재시도는 중복 차감하지 않는다', async () => {
    await send({ action: action('feed', { count: 112 }) });
    let spentFood = 0, revision = 1;
    for (const [slot, price] of [['neck', 4], ['hat', 6], ['hand', 6], ['costume', 8]]) {
      const buy = action('buy', { itemId: `gardener:${slot}` }, revision);
      const response = await send({ action: buy });
      expect(response.status).toBe(200);
      spentFood += price; revision += 1;
      const purchased = await response.json();
      expect(purchased).toMatchObject({ earnedTotal: 200, availableFood: 88 - spentFood,
        profile: { fedTotal: 112, spentFood, revision, purchasePrices: { [`gardener:${slot}`]: price } } });
      expect(await (await send({ action: buy })).json()).toEqual(purchased);
    }
    expect(await (await send()).json()).toMatchObject({ availableFood: 64, profile: { spentFood: 24, revision: 5 } });
  });

  it('최종 성장 전의 이름 변경과 안내 확인은 직접 API 요청도 저장하지 않는다', async () => {
    await send({ action: action('feed', { count: 111 }) });
    for (const blocked of [action('nickname', { nickname: '작은판다' }, 1), action('dismiss-naming', {}, 1)]) {
      const response = await send({ action: blocked });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'level_locked', profile: { fedTotal: 111, nickname: '', namingPromptSeen: false, revision: 1 } });
    }
    await send({ action: action('feed', { count: 1 }, 1) });
    const dismissed = await send({ action: action('dismiss-naming', {}, 2) });
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toMatchObject({ profile: { fedTotal: 112, nickname: '', namingPromptSeen: true, revision: 3 } });
  });
});
