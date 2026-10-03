import { applyPandaAction, newPandaProfile, pandaAvailable, pandaError, parsePandaProfile } from './pandaRules.js';

const TRANSITION_VERSION = 1;

function parseRow(row) {
  if (!row) return null;
  let profile;
  try { profile = parsePandaProfile(JSON.parse(row.profile)); } catch { /* reject below */ }
  if (!profile || !Number.isSafeInteger(row.revision) || row.revision < 0
    || !Number.isSafeInteger(row.earned_total) || row.earned_total < 0
    || row.transition_version !== TRANSITION_VERSION
    || typeof row.transition_initialized_at !== 'string' || !Number.isFinite(Date.parse(row.transition_initialized_at))
    || !Number.isSafeInteger(row.transition_starting_food) || row.transition_starting_food < 0
    || row.transition_starting_food > row.earned_total || ![0, 1].includes(row.transition_notice_seen)) {
    throw pandaError('invalid_saved_profile', '저장된 판다 기록을 확인하지 못했습니다. 기존 기록은 유지됩니다.');
  }
  return { profile: { ...profile, revision: row.revision }, earnedTotal: row.earned_total,
    availableFood: pandaAvailable(profile, row.earned_total),
    transition: { version: row.transition_version, initializedAt: row.transition_initialized_at,
      startingFood: row.transition_starting_food, noticeSeen: !!row.transition_notice_seen } };
}

const readRow = (db, studentId) => db.prepare('SELECT * FROM student_panda_profiles WHERE student_id = ?').bind(studentId).first();
const readReceipt = (db, studentId, requestId) => db.prepare('SELECT * FROM student_panda_actions WHERE student_id = ? AND request_id = ?').bind(studentId, requestId).first();

export async function getPandaProfile(db, studentId, earnedTotal) {
  if (!Number.isSafeInteger(earnedTotal) || earnedTotal < 0) {
    throw pandaError('earnings_unavailable', '먹이 지급 내역을 모두 확인하지 못했어요. 기존 기록은 유지됩니다.', 502);
  }
  const now = new Date().toISOString();
  // One atomic statement owns both first initialization and the version-0 reset.
  // Concurrent devices cannot reset an initialized profile. Already awarded food
  // is never revoked when Notion returns a lower (but otherwise complete) total.
  await db.prepare(`INSERT INTO student_panda_profiles
    (student_id, profile, earned_total, legacy_migrated, created_at, updated_at,
      transition_version, transition_initialized_at, transition_starting_food, transition_notice_seen)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(student_id) DO UPDATE SET
      profile = CASE WHEN transition_version = 0 THEN excluded.profile ELSE profile END,
      revision = CASE WHEN transition_version = 0 THEN revision + 1 ELSE revision END,
      earned_total = MAX(earned_total, excluded.earned_total),
      legacy_migrated = 1,
      last_request_id = CASE WHEN transition_version = 0 THEN NULL ELSE last_request_id END,
      updated_at = CASE WHEN transition_version = 0 OR earned_total < excluded.earned_total THEN excluded.updated_at ELSE updated_at END,
      transition_initialized_at = CASE WHEN transition_version = 0 THEN excluded.transition_initialized_at ELSE transition_initialized_at END,
      transition_starting_food = CASE WHEN transition_version = 0 THEN MAX(earned_total, excluded.earned_total) ELSE transition_starting_food END,
      transition_notice_seen = CASE WHEN transition_version = 0 THEN 0 ELSE transition_notice_seen END,
      transition_version = excluded.transition_version
    WHERE transition_version IN (0, ?)`)
    .bind(studentId, JSON.stringify(newPandaProfile()), earnedTotal, now, now,
      TRANSITION_VERSION, now, earnedTotal, TRANSITION_VERSION).run();
  return parseRow(await readRow(db, studentId));
}

export async function performPandaAction(db, studentId, earnedTotal, action) {
  await getPandaProfile(db, studentId, earnedTotal);
  const actionJson = JSON.stringify(action);
  const replay = async receipt => {
    const snapshot = parseRow(await readRow(db, studentId));
    if (receipt.transition_version !== TRANSITION_VERSION) {
      throw Object.assign(pandaError('request_id_reused', '이전 업데이트의 요청입니다. 최신 기록을 확인한 뒤 다시 시도해 주세요.'), snapshot);
    }
    if (receipt.action_json !== actionJson) throw pandaError('request_id_reused', '같은 요청 번호로 다른 작업을 보낼 수 없습니다.');
    // The receipt proves this command committed once. Return current state so a
    // delayed retry cannot rewind a device after another action has already committed.
    return { ok: true, action: { requestId: action.requestId, type: action.type }, ...snapshot };
  };
  const previous = await readReceipt(db, studentId, action.requestId);
  if (previous) return replay(previous);
  const row = await readRow(db, studentId);
  const snapshot = parseRow(row);
  if (row.revision !== action.expectedRevision) {
    // Another copy can commit between the first receipt lookup and this row read.
    const committed = await readReceipt(db, studentId, action.requestId);
    if (committed) return replay(committed);
    throw Object.assign(pandaError('revision_conflict', '다른 기기의 최신 기록을 불러왔어요. 다시 확인해 주세요.'), snapshot);
  }
  const { revision, ...profile } = snapshot.profile;
  let next;
  try { next = applyPandaAction(profile, action, snapshot.earnedTotal); }
  catch (error) { throw Object.assign(error, snapshot); }
  const now = new Date().toISOString();
  // D1 batch is transactional: the CAS and its receipt either both commit or neither does.
  await db.batch([
    db.prepare(`UPDATE student_panda_profiles SET profile = ?, revision = revision + 1,
      transition_notice_seen = MAX(transition_notice_seen, ?), last_request_id = ?, updated_at = ?
      WHERE student_id = ? AND revision = ? AND transition_version = ?
      AND NOT EXISTS (SELECT 1 FROM student_panda_actions WHERE student_id = ? AND request_id = ?)`)
      .bind(JSON.stringify(next), action.type === 'dismiss-transition' ? 1 : 0, action.requestId, now,
        studentId, revision, TRANSITION_VERSION, studentId, action.requestId),
    db.prepare(`INSERT INTO student_panda_actions (student_id, request_id, action_json, profile, revision, earned_total, created_at, transition_version)
      SELECT student_id, ?, ?, profile, revision, earned_total, ?, transition_version FROM student_panda_profiles
      WHERE student_id = ? AND revision = ? AND last_request_id = ?
      ON CONFLICT(student_id, request_id) DO NOTHING`)
      .bind(action.requestId, actionJson, now, studentId, revision + 1, action.requestId),
  ]);
  const receipt = await readReceipt(db, studentId, action.requestId);
  if (receipt) return replay(receipt);
  throw Object.assign(pandaError('revision_conflict', '다른 기기의 최신 기록을 불러왔어요. 다시 확인해 주세요.'), parseRow(await readRow(db, studentId)));
}
