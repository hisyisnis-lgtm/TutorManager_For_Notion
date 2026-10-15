import { normalizeId, stripEmoji } from './string.js';

// GitHub schedule 대신 Worker cron에서 실행한다. 수업 내용은 강사가 작성한다.
const CLASS_DB_ID = '314838fa-f2a6-81bc-8b67-d9e1c8fb7ecb';
const LOG_DB_ID = '318838fa-f2a6-81f1-9b9c-fd379b1026ed';
const LEASE_KEY = 'automation/lesson-logs/v1/lease';
const CURSOR_KEY = 'automation/lesson-logs/v1/cursor';
const CLASS_LEASE_PREFIX = 'automation/lesson-logs/v2/class-lease/';
const CLASS_STATE_PREFIX = 'automation/lesson-logs/v2/class-state/';
const COOLDOWN_KEY = 'automation/lesson-logs/v2/cooldown';
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_SECONDS = 900;
const CLASS_LEASE_SECONDS = 180;
// 최근 7일 자동 생성 범위의 삭제 억제 정책. 기간 안의 명시적 수동 재작성은 해제한다.
const STATE_SECONDS = 8 * 24 * 60 * 60;
const UNKNOWN_WRITE_MS = 120_000;
const MAX_SCANNED = 100;
const MAX_CREATED = 5;
const MAX_REQUESTS = 40;
const MAX_DATABASE_QUERIES = 44;
const PAGE_SIZE = 25;
const RESPONSE_LIMIT = 2 * 1024 * 1024;

// 오류에는 Notion 응답 본문, 학생 이름, 페이지 ID, 토큰을 포함하지 않는다.
export class LessonLogAutomationError extends Error {
  constructor(code, details = {}) {
    super(`Lesson log automation failed: ${code}`);
    this.name = 'LessonLogAutomationError';
    this.code = code;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
    Object.defineProperty(this, 'committedId', { value: details.committedId });
  }
}

function fail(code, details) { throw new LessonLogAutomationError(code, details); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value); }
function canonical(value) { if (!safeId(value)) fail('invalid-id', { status: 400 }); return normalizeId(value).toLowerCase(); }
function sameId(first, second) { return safeId(first) && safeId(second) && canonical(first) === canonical(second); }
function inDatabase(value, databaseId) { return sameId(value?.parent?.database_id, databaseId); }

// 호출별 실제 first/all/run만 센다. cursor 저장과 finally 잠금 해제는 별도로 남긴다.
function databaseBudget(database) {
  let used = 0;
  const wrap = statement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    ...Object.fromEntries(['first', 'all', 'run'].map(method => [method, async (...args) => {
      if (used >= MAX_DATABASE_QUERIES) fail('database-budget');
      used++;
      return statement[method](...args);
    }])),
  });
  return { database: { prepare: sql => wrap(database.prepare(sql)) }, remaining: () => MAX_DATABASE_QUERIES - used };
}
function page(value) {
  if (!record(value) || value.object !== 'page' || !safeId(value.id) || !record(value.properties)) {
    fail('invalid-page');
  }
  return value;
}

function relation(property) {
  if (!record(property) || !Array.isArray(property.relation)
    || property.relation.some(item => !record(item) || typeof item.id !== 'string' || !item.id)) {
    fail('invalid-relation');
  }
  return property.relation;
}

function eligible(value, now) {
  page(value);
  if (value.archived || value.in_trash) return false;
  const properties = value.properties;
  const dateProperty = properties['수업 일시'];
  const statusProperty = properties['특이사항'];
  if (!record(dateProperty) || !('date' in dateProperty) || !record(statusProperty) || !('select' in statusProperty)) {
    fail('invalid-class-properties');
  }
  if (relation(properties['수업 일지']).length || statusProperty.select?.name === '🚫 취소') return false;
  if (!dateProperty.date) return false;
  const start = Date.parse(dateProperty.date.start);
  if (!Number.isFinite(start)) fail('invalid-class-date');
  const parsedDuration = parseInt(properties['수업 시간(분)']?.select?.name, 10);
  const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 60;
  return start >= now - LOOKBACK_MS && start + duration * 60 * 1000 <= now;
}

function queryResult(value) {
  if (!record(value) || value.object !== 'list' || !Array.isArray(value.results)
    || typeof value.has_more !== 'boolean' || (value.has_more && (typeof value.next_cursor !== 'string' || !value.next_cursor))) {
    fail('invalid-query-result');
  }
  for (const item of value.results) page(item);
  return value;
}

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) fail('response-too-large');
  if (!response.body) fail('empty-response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RESPONSE_LIMIT) {
      await reader.cancel();
      fail('response-too-large');
    }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { fail('invalid-json'); }
}

function notionClient(env, { automation = false } = {}) {
  let requests = 0;
  const request = async (method, path, body) => {
    if (requests >= MAX_REQUESTS) fail('request-budget');
    // 자동화는 PWA 요청과 예산을 공유하므로 초당 약 1.5회로 여유를 남긴다.
    if (requests) await new Promise(resolve => setTimeout(resolve, automation ? 650 : 350));
    requests++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        let detail;
        try { detail = await readJson(response); } catch { /* 오류 원문은 사용하지 않는다. */ }
        const committedId = safeId(detail?.additional_data?.committed_resource_id) ? detail.additional_data.committed_resource_id : undefined;
        let retryAfter;
        if (response.status === 429 || response.status === 529) {
          const supplied = Number(response.headers.get('Retry-After') ?? detail?.additional_data?.retry_after);
          const remainingEpoch = Number.MAX_SAFE_INTEGER - Math.floor(Date.now() / 1000);
          retryAfter = Number.isSafeInteger(supplied) && supplied > 0 && supplied <= remainingEpoch ? supplied : 60;
          await saveCooldown(env.GAME_DB, retryAfter);
        }
        fail(`notion-http-${response.status}`, { status: response.status, committedId, retryAfter });
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof LessonLogAutomationError) throw error;
      fail(controller.signal.aborted ? 'notion-timeout' : 'notion-request');
    } finally { clearTimeout(timeout); }
  };
  // POST /pages는 응답을 잃어도 재전송하지 않는다. 다음 cron에서 relation 쿼리로 확인한다.
  return { request, remaining: () => MAX_REQUESTS - requests };
}

async function acquireLease(db, owner, now, key = LEASE_KEY, ttl = LEASE_SECONDS) {
  try {
    const row = await db.prepare(`
      INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at) VALUES (?1, ?2, '{}', ?3)
      ON CONFLICT(key_hash) DO UPDATE SET proof_hash=excluded.proof_hash, payload=excluded.payload, expires_at=excluded.expires_at
      WHERE security_challenges.expires_at <= ?4 RETURNING proof_hash
    `).bind(key, owner, Math.floor(now / 1000) + ttl, Math.floor(now / 1000)).first();
    if (row && row.proof_hash !== owner) fail('invalid-lease');
    return row != null;
  } catch { fail('lease-unavailable'); }
}

async function releaseLease(db, owner, key = LEASE_KEY) {
  try {
    const result = await db.prepare('DELETE FROM security_challenges WHERE key_hash=?1 AND proof_hash=?2')
      .bind(key, owner).run();
    if (!result.success) fail('lease-release');
  } catch { fail('lease-release'); }
}

async function checkLease(db, owner, key = LEASE_KEY) {
  try {
    const row = await db.prepare('SELECT proof_hash FROM security_challenges WHERE key_hash=?1 AND proof_hash=?2 AND expires_at>?3')
      .bind(key, owner, Math.floor(Date.now() / 1000)).first();
    if (!row) fail('lease-lost');
  } catch { fail('lease-unavailable'); }
}

async function renewLease(db, owner, key) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare('UPDATE security_challenges SET expires_at=?1 WHERE key_hash=?2 AND proof_hash=?3 AND expires_at>?4 RETURNING proof_hash')
      .bind(now + CLASS_LEASE_SECONDS, key, owner, now).first();
    if (!row) fail('lease-lost');
  } catch { fail('lease-unavailable'); }
}

async function acquireClassLeases(db, ids, owner) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(`INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at)
      SELECT ?1 || value, ?2, '{}', ?3 FROM json_each(?4) WHERE 1
      ON CONFLICT(key_hash) DO UPDATE SET proof_hash=excluded.proof_hash, payload=excluded.payload, expires_at=excluded.expires_at
      WHERE security_challenges.expires_at <= ?5 RETURNING key_hash`)
      .bind(CLASS_LEASE_PREFIX, owner, now + CLASS_LEASE_SECONDS, JSON.stringify(ids.map(canonical)), now).all();
    if (!Array.isArray(result.results)) fail('invalid-lease');
    return result.results.length === ids.length;
  } catch { fail('lease-unavailable'); }
}

async function renewClassLeases(db, ids, owner) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(`UPDATE security_challenges SET expires_at=?1
      WHERE proof_hash=?2 AND expires_at>?3 AND key_hash IN (SELECT ?4 || value FROM json_each(?5)) RETURNING key_hash`)
      .bind(now + CLASS_LEASE_SECONDS, owner, now, CLASS_LEASE_PREFIX, JSON.stringify(ids.map(canonical))).all();
    if (!Array.isArray(result.results) || result.results.length !== ids.length) fail('lease-lost');
  } catch { fail('lease-unavailable'); }
}

async function releaseClassLeases(db, ids, owner) {
  try {
    const result = await db.prepare(`DELETE FROM security_challenges WHERE proof_hash=?1
      AND key_hash IN (SELECT ?2 || value FROM json_each(?3))`)
      .bind(owner, CLASS_LEASE_PREFIX, JSON.stringify(ids.map(canonical))).run();
    if (!result.success) fail('lease-release');
  } catch { fail('lease-release'); }
}

async function suppressClasses(db, ids, owner, logId) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(`INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at)
      SELECT ?1 || value, 'class-state', ?2, ?3 FROM json_each(?4) WHERE EXISTS (
        SELECT 1 FROM security_challenges WHERE key_hash=?5 || value AND proof_hash=?6 AND expires_at>?7
      ) ON CONFLICT(key_hash) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at RETURNING key_hash`)
      .bind(CLASS_STATE_PREFIX, JSON.stringify({ logId, pendingUntil: 0, suppressed: true }), now + STATE_SECONDS,
        JSON.stringify(ids.map(canonical)), CLASS_LEASE_PREFIX, owner, now).all();
    if (!Array.isArray(result.results) || result.results.length !== ids.length) fail('lease-lost');
  } catch { fail('class-state-unavailable'); }
}

async function saveCooldown(db, seconds) {
  try {
    const result = await db.prepare(`INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at) VALUES (?1, 'cooldown', '{}', ?2)
      ON CONFLICT(key_hash) DO UPDATE SET expires_at=MAX(security_challenges.expires_at, excluded.expires_at)`)
      .bind(COOLDOWN_KEY, Math.floor(Date.now() / 1000) + seconds).run();
    if (!result.success) fail('cooldown-unavailable');
  } catch { fail('cooldown-unavailable'); }
}

async function cooldown(db) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare('SELECT expires_at FROM security_challenges WHERE key_hash=?1 AND expires_at>?2').bind(COOLDOWN_KEY, now).first();
    return row ? row.expires_at - now : 0;
  } catch { fail('cooldown-unavailable'); }
}

function emptyClassState() { return { logId: null, pendingUntil: 0, suppressed: false }; }

async function loadClassState(db, classId) {
  try {
    const row = await db.prepare('SELECT payload FROM security_challenges WHERE key_hash=?1 AND expires_at>?2')
      .bind(CLASS_STATE_PREFIX + canonical(classId), Math.floor(Date.now() / 1000)).first();
    if (!row) return emptyClassState();
    const state = JSON.parse(row.payload);
    if (!record(state) || (state.logId !== null && !safeId(state.logId))
      || !Number.isSafeInteger(state.pendingUntil) || state.pendingUntil < 0 || typeof state.suppressed !== 'boolean') fail('invalid-class-state');
    return state;
  } catch { fail('class-state-unavailable'); }
}

async function saveClassState(db, classId, owner, state) {
  try {
    const row = await db.prepare(`INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at)
      SELECT ?1, 'class-state', ?2, ?3 WHERE EXISTS (
        SELECT 1 FROM security_challenges WHERE key_hash=?4 AND proof_hash=?5 AND expires_at>?6
      ) ON CONFLICT(key_hash) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at RETURNING key_hash`)
      .bind(CLASS_STATE_PREFIX + canonical(classId), JSON.stringify(state), Math.floor(Date.now() / 1000) + STATE_SECONDS,
        CLASS_LEASE_PREFIX + canonical(classId), owner, Math.floor(Date.now() / 1000)).first();
    if (!row) fail('lease-lost');
  } catch { fail('class-state-unavailable'); }
}

function validateClassParent(value, classId) {
  page(value);
  if (!sameId(value.id, classId)) fail('class-id-mismatch');
  if (!inDatabase(value, CLASS_DB_ID)) fail('invalid-class-parent', { status: 403 });
  return value;
}

function validateClass(value, classId) {
  validateClassParent(value, classId);
  if (value.archived || value.in_trash) fail('inactive-class', { status: 400 });
  if (value.properties['학생']?.has_more) fail('incomplete-class-students', { status: 400 });
  relation(value.properties['학생']);
  return value;
}

function validateLog(value, classId) {
  page(value);
  if (!inDatabase(value, LOG_DB_ID) || !relation(value.properties['수업']).some(item => sameId(item.id, classId))) fail('invalid-log-relation');
  return value;
}

function validateManualStudents(body, current) {
  const supplied = body.properties?.['학생'] ? relation(body.properties['학생']) : [];
  const expected = relation(current.properties['학생']);
  const first = supplied.map(item => canonical(item.id)).sort();
  const second = expected.map(item => canonical(item.id)).sort();
  if (first.length !== second.length || first.some((id, index) => id !== second[index])) fail('student-relation-mismatch', { status: 400 });
}

// 자동 생성과 PWA 수동 생성이 같은 수업 잠금·상태·중복 조회를 사용한다.
async function createForClass(env, notion, classId, { manualBody, now = Date.now(), names = new Map(), globalOwner, budget } = {}) {
  canonical(classId);
  const owner = crypto.randomUUID();
  const key = CLASS_LEASE_PREFIX + canonical(classId);
  if (!await acquireLease(env.GAME_DB, owner, Date.now(), key, CLASS_LEASE_SECONDS)) return { kind: 'busy', retryAfter: 3 };
  let renewedAt = Date.now();
  const renew = async (force = false) => {
    if (!force && Date.now() - renewedAt < 60_000) return;
    // class release, cursor 저장, global release 세 쿼리를 남긴다.
    if (budget && budget.remaining() < 4) fail('database-budget');
    await renewLease(env.GAME_DB, owner, key);
    renewedAt = Date.now();
  };
  const request = async (...args) => {
    await renew();
    return notion.request(...args);
  };
  try {
    let state = await loadClassState(env.GAME_DB, classId);
    if (!manualBody && state.suppressed) return { kind: 'suppressed' };
    const current = page(await request('GET', `/pages/${classId}`));
    // 자동화가 조회한 뒤 수업이 취소·이동·삭제되었다면 생성하지 않는다.
    if (!manualBody && !eligible(current, now)) return { kind: 'skipped' };
    if (!manualBody && current.properties['학생']?.has_more) return { kind: 'skipped' };
    validateClass(current, classId);
    if (manualBody) validateManualStudents(manualBody, current);
    if (state.logId) {
      if (notion.remaining() < 3) return { kind: 'budget' };
      const known = validateLog(await request('GET', `/pages/${state.logId}`), classId);
      if (!known.archived && !known.in_trash) {
        await saveClassState(env.GAME_DB, classId, owner, { logId: known.id, pendingUntil: 0, suppressed: false });
        return { kind: 'existing', page: known };
      }
      state = { ...state, suppressed: true, pendingUntil: 0 };
      await saveClassState(env.GAME_DB, classId, owner, state);
      if (!manualBody) return { kind: 'suppressed' };
    }
    if (notion.remaining() < 2) return { kind: 'budget' };
    const existing = queryResult(await request('POST', `/databases/${LOG_DB_ID}/query`, {
      page_size: 25, filter: { property: '수업', relation: { contains: current.id } },
    }));
    const active = existing.results.find(log => !log.archived && !log.in_trash);
    if (active) {
      validateLog(active, classId);
      await saveClassState(env.GAME_DB, classId, owner, { logId: active.id, pendingUntil: 0, suppressed: false });
      return { kind: 'existing', page: active };
    }
    if (existing.has_more) return { kind: 'budget' };
    if (state.pendingUntil > Date.now()) return { kind: 'pending', retryAfter: Math.ceil((state.pendingUntil - Date.now()) / 1000) };
    let body = manualBody;
    if (!body) {
      const students = relation(current.properties['학생']);
      const missingNames = students.filter(student => !names.has(student.id));
      if (notion.remaining() < missingNames.length + 1) return { kind: 'budget' };
      for (const student of missingNames) {
        const studentPage = page(await request('GET', `/pages/${student.id}`));
        if (!sameId(studentPage.id, student.id)) fail('student-id-mismatch');
        names.set(student.id, studentName(studentPage));
      }
      const kst = new Date(Date.parse(current.properties['수업 일시'].date.start) + 9 * 60 * 60 * 1000);
      const title = `${students.length ? students.map(student => names.get(student.id)).join(', ') : '수업'} ${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
      body = {
        parent: { database_id: LOG_DB_ID },
        properties: {
          '제목': { title: [{ text: { content: title } }] },
          '수업': { relation: [{ id: current.id }] },
          '학생': { relation: students.map(student => ({ id: student.id })) },
        },
      };
    }
    // POST 전 확인/갱신/pending 저장/결과 저장 + 세 finally/cursor 쿼리를 예약한다.
    // 429/529 응답의 cooldown 저장도 가능하도록 한 쿼리 여유를 둔다.
    if (!notion.remaining() || budget && budget.remaining() < 8) return { kind: 'budget' };
    if (globalOwner) await checkLease(env.GAME_DB, globalOwner);
    await renew(true);
    // 요청을 보내기 전에 기록한다. 응답 유실 후 서버 처리와 조회 전파를 기다리는
    // 보수적인 완충시간으로, 전파 지연 전체에 대한 단일 실행 보장은 아니다.
    const pending = { logId: null, pendingUntil: Date.now() + UNKNOWN_WRITE_MS, suppressed: false };
    await saveClassState(env.GAME_DB, classId, owner, pending);
    let raw;
    try { raw = await request('POST', '/pages', body); }
    catch (error) {
      if (error.committedId) {
        await saveClassState(env.GAME_DB, classId, owner, { ...pending, logId: error.committedId });
      } else if ((error.status >= 400 && error.status < 500) || error.status === 529) {
        // 명시적으로 거부된 요청은 저장되지 않았다. 5xx·네트워크·timeout은 모호하다.
        await saveClassState(env.GAME_DB, classId, owner, state);
      }
      throw error;
    }
    let created;
    try {
      created = validateLog(raw, classId);
      if (created.archived || created.in_trash) fail('invalid-created-log');
    } catch (error) {
      // 불완전한 성공 응답도 ID를 잃지 않는다. 정상 응답은 최종 상태만 한 번 저장한다.
      if (safeId(raw?.id)) await saveClassState(env.GAME_DB, classId, owner, { ...pending, logId: raw.id });
      throw error;
    }
    await saveClassState(env.GAME_DB, classId, owner, { logId: created.id, pendingUntil: 0, suppressed: false });
    return { kind: 'created', page: created };
  } catch (error) {
    if (error.code === 'database-budget') return { kind: 'budget' };
    throw error;
  } finally { await releaseLease(env.GAME_DB, owner, key); }
}

async function loadCursor(db) {
  try {
    const row = await db.prepare('SELECT payload FROM security_challenges WHERE key_hash=?1 AND expires_at>?2')
      .bind(CURSOR_KEY, Math.floor(Date.now() / 1000)).first();
    if (!row) return { cursor: null, pending: [] };
    const value = JSON.parse(row.payload);
    if (!record(value) || (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor))
      || !Array.isArray(value.pending) || value.pending.length > PAGE_SIZE
      || value.pending.some(id => typeof id !== 'string' || !id)) fail('invalid-cursor');
    return value;
  } catch { fail('cursor-unavailable'); }
}

async function saveCursor(db, owner, state) {
  try {
    // 만료된 실행이 새 실행의 cursor를 덮어쓰지 못하도록 lease 소유권도 확인한다.
    const row = await db.prepare(`
      INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at)
      SELECT ?1, 'cursor', ?2, ?3 WHERE EXISTS (
        SELECT 1 FROM security_challenges WHERE key_hash=?4 AND proof_hash=?5 AND expires_at>?6
      )
      ON CONFLICT(key_hash) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at
      RETURNING key_hash
    `).bind(CURSOR_KEY, JSON.stringify(state), Math.floor(Date.now() / 1000) + 8 * 24 * 60 * 60,
      LEASE_KEY, owner, Math.floor(Date.now() / 1000)).first();
    if (!row) fail('lease-lost');
  } catch { fail('cursor-unavailable'); }
}

function studentName(value) {
  page(value);
  const properties = value.properties;
  const title = properties['이름']?.title?.length ? properties['이름'].title
    : Object.values(properties).find(property => Array.isArray(property?.title) && property.title.length)?.title ?? [];
  if (!Array.isArray(title)) fail('invalid-student-title');
  const raw = title.map(item => item?.plain_text ?? item?.text?.content ?? '').join('');
  return stripEmoji(raw) || '?';
}

/** Returns only anonymous counts; errors reject so cron monitoring can report failures. */
export async function runLessonLogAutomation(env) {
  if (!env.NOTION_TOKEN || !env.GAME_DB) fail('missing-binding');
  const budget = databaseBudget(env.GAME_DB);
  env = { ...env, GAME_DB: budget.database };
  const now = Date.now();
  const owner = crypto.randomUUID();
  const counts = { scanned: 0, created: 0, skipped: 0, existing: 0, deferred: 0, locked: false };
  if (await cooldown(env.GAME_DB)) return { ...counts, deferred: 1, cooldown: true };
  if (!await acquireLease(env.GAME_DB, owner, now)) return { ...counts, locked: true };
  const notion = notionClient(env, { automation: true });
  const names = new Map();
  try {
    let state = await loadCursor(env.GAME_DB);
    while (counts.scanned < MAX_SCANNED) {
      let candidates;
      if (state.pending.length) {
        // 중단한 페이지의 나머지 ID를 보관한다. 앞의 항목이 relation 필터에서 사라져도
        // offset 기반으로 건너뛰지 않으므로 뒤의 완료 수업을 놓치거나 굶기지 않는다.
        candidates = state.pending.map(id => ({ id }));
      } else {
        if (!notion.remaining() || budget.remaining() < 3) {
          counts.deferred++;
          await saveCursor(env.GAME_DB, owner, state);
          return counts;
        }
        const body = {
          page_size: Math.min(PAGE_SIZE, MAX_SCANNED - counts.scanned),
          filter: { and: [
            { property: '수업 일시', date: { is_not_empty: true } },
            { property: '수업 일시', date: { on_or_before: new Date(now).toISOString() } },
            { property: '수업 일시', date: { on_or_after: new Date(now - LOOKBACK_MS).toISOString() } },
            { property: '수업 일지', relation: { is_empty: true } },
            { or: [
              { property: '특이사항', select: { is_empty: true } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ] },
          ] },
          sorts: [{ property: '수업 일시', direction: 'ascending' }],
          ...(state.cursor ? { start_cursor: state.cursor } : {}),
        };
        let result;
        try { result = queryResult(await notion.request('POST', `/databases/${CLASS_DB_ID}/query`, body)); }
        catch (error) {
          // Notion cursor가 필터 변경 등으로 무효화되면 다음 실행은 처음부터 확인한다.
          if (state.cursor && error?.message === 'Lesson log automation failed: notion-http-400') {
            await saveCursor(env.GAME_DB, owner, { cursor: null, pending: [] });
          }
          throw error;
        }
        if (result.results.length > body.page_size || (result.has_more && result.next_cursor === state.cursor)) fail('invalid-pagination');
        candidates = result.results;
        state = { cursor: result.has_more ? result.next_cursor : null, pending: [] };
      }
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        counts.scanned++;
        if (candidate.properties && !eligible(candidate, now)) { counts.skipped++; continue; }
        if (counts.created >= MAX_CREATED || notion.remaining() < 4 || budget.remaining() < 10) {
          counts.deferred++;
          await saveCursor(env.GAME_DB, owner, { cursor: state.cursor, pending: candidates.slice(index).map(item => item.id) });
          return counts;
        }
        const outcome = await createForClass(env, notion, candidate.id, { now, names, globalOwner: owner, budget });
        if (outcome.kind === 'budget') {
          counts.deferred++;
          await saveCursor(env.GAME_DB, owner, { cursor: state.cursor, pending: candidates.slice(index).map(item => item.id) });
          return counts;
        }
        if (outcome.kind === 'created') counts.created++;
        else if (outcome.kind === 'existing') counts.existing++;
        else if (outcome.kind === 'busy' || outcome.kind === 'pending') counts.deferred++;
        else counts.skipped++;
      }
      state = { cursor: state.cursor, pending: [] };
      await saveCursor(env.GAME_DB, owner, state);
      if (!state.cursor) break;
    }
    if (counts.scanned >= MAX_SCANNED && state.cursor) counts.deferred++;
    return counts;
  } finally { await releaseLease(env.GAME_DB, owner); }
}

function responseError(status, message, retryAfter) {
  return {
    status,
    body: { object: 'error', status, code: 'lesson_log_request_failed', message },
    ...(retryAfter ? { headers: { 'Retry-After': String(retryAfter) } } : {}),
  };
}

function requestError(error) {
  let status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
  // Notion 통합 토큰 장애를 PWA 로그인 만료로 처리하지 않는다.
  if (status === 401) status = 502;
  if (error.code === 'student-relation-mismatch') return responseError(400, '수업의 학생 정보와 일지의 학생 정보가 일치하지 않습니다.');
  if (error.code === 'invalid-class-parent') return responseError(403, '수업 관리 DB에 있는 수업만 연결할 수 있습니다.');
  if (error.code === 'inactive-class') return responseError(400, '삭제된 수업에는 일지를 생성할 수 없습니다.');
  if (error.code?.startsWith('invalid-') || error.code?.startsWith('incomplete-')) {
    return responseError(status === 503 ? 400 : status, '수업일지 요청 또는 연결 정보가 올바르지 않습니다.');
  }
  return responseError(status, '수업일지 처리 결과를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.', error.retryAfter);
}

async function deleteLessonLog(env, notion, source, body) {
  page(source);
  if (source.properties['수업']?.has_more) fail('incomplete-log-classes', { status: 400 });
  const classes = relation(source.properties['수업']);
  if (!classes.length) return null;
  const ids = [...new Map(classes.map(item => [canonical(item.id), item.id])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  if (ids.length > PAGE_SIZE) fail('invalid-log-classes', { status: 400 });
  if (body.properties?.['수업'] || body.parent) fail('invalid-delete-relations', { status: 400 });
  const owner = crypto.randomUUID();
  let attempted = false;
  let renewedAt = 0;
  const renew = async (force = false) => {
    if (!force && Date.now() - renewedAt < 60_000) return;
    await renewClassLeases(env.GAME_DB, ids, owner);
    renewedAt = Date.now();
  };
  try {
    attempted = true;
    if (!await acquireClassLeases(env.GAME_DB, ids, owner)) {
      return responseError(423, '수업일지를 처리하고 있습니다. 잠시 후 다시 시도해주세요.', 3);
    }
    await renew(true);
    const current = page(await notion.request('GET', `/pages/${source.id}`));
    if (!sameId(current.id, source.id) || !inDatabase(current, LOG_DB_ID) || current.properties['수업']?.has_more) fail('invalid-delete-page');
    const latest = relation(current.properties['수업']).map(item => canonical(item.id)).sort();
    if (latest.length !== ids.length || latest.some((id, index) => id !== canonical(ids[index]))) {
      return responseError(409, '일지의 연결 수업이 변경되었습니다. 새로고침 후 다시 삭제해주세요.', 3);
    }
    for (const classId of ids) {
      await renew();
      // 삭제는 과거·보관된 수업에서도 가능하다. 생성에 필요한 학생·활성 검증과 분리한다.
      validateClassParent(await notion.request('GET', `/pages/${classId}`), classId);
    }
    // 삭제가 실패하거나 응답을 잃어도 억제를 유지한다. 명시적 수동 생성만 해제한다.
    await renew(true);
    await suppressClasses(env.GAME_DB, ids, owner, current.id);
    await renew(true);
    const removed = page(await notion.request('PATCH', `/pages/${current.id}`, body));
    if (!sameId(removed.id, current.id) || !inDatabase(removed, LOG_DB_ID) || !(removed.archived || removed.in_trash)) fail('invalid-deleted-log');
    return { status: 200, body: removed };
  } finally {
    // 일부 획득만 성공했어도 자신의 proof와 일치하는 잠금만 한 쿼리로 해제한다.
    if (attempted) await releaseClassLeases(env.GAME_DB, ids, owner);
  }
}

/** 인증과 페이지/DB 권한 검사를 통과한 프록시 요청에만 호출한다. */
export async function handleLessonLogRequest(env, { method, body, page: currentPage } = {}) {
  const create = method === 'POST' && inDatabase({ parent: body?.parent }, LOG_DB_ID) && body?.properties?.['수업'] !== undefined;
  const remove = method === 'PATCH' && (body?.archived === true || body?.in_trash === true) && inDatabase(currentPage, LOG_DB_ID);
  if (!create && !remove) return null;
  try {
    if (!env.NOTION_TOKEN || !env.GAME_DB) fail('missing-binding');
    const wait = await cooldown(env.GAME_DB);
    if (wait) return responseError(429, 'Notion 요청이 많아 잠시 대기하고 있습니다. 잠시 후 다시 시도해주세요.', wait);
    const notion = notionClient(env);
    if (remove) return await deleteLessonLog(env, notion, currentPage, body);
    if (body.archived || body.in_trash || body.properties['수업']?.has_more) fail('invalid-create-body', { status: 400 });
    const classes = relation(body.properties['수업']);
    if (classes.length !== 1) fail('invalid-create-class', { status: 400 });
    const outcome = await createForClass(env, notion, classes[0].id, { manualBody: body });
    if (outcome.kind === 'created' || outcome.kind === 'existing') return { status: 200, body: outcome.page };
    return responseError(423, outcome.kind === 'pending'
      ? '이전 일지 생성 결과를 확인하고 있습니다. 잠시 후 다시 시도해주세요.'
      : '수업일지를 처리하고 있습니다. 잠시 후 다시 시도해주세요.', outcome.retryAfter ?? 3);
  } catch (error) { return requestError(error); }
}
