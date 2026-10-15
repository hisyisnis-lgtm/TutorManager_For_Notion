import { StudentAppAccessError, normalizeStudentAppId, readStudentAppAccess, writeStudentAppAccess } from './studentAppAccess.js';
import { SITE_LEDGER_DATABASES, siteNotionOnce, verifySiteNotionPage } from './siteNotionSync.js';

const unix = () => Math.floor(Date.now() / 1000);
const stamp = () => new Date().toISOString();
const failure = (status, code, message) => new StudentAppAccessError(status, code, message);
const changed = () => failure(409, 'access_revision_changed', '학생앱 이용 상태가 변경되었습니다. 현재 상태를 확인해주세요.');
const unknown = () => failure(503, 'student_app_sync_unknown', '숙제 관리 설정 결과를 확인하지 못했습니다. 현재 제공 상태를 다시 확인해주세요.');
const unavailable = () => failure(503, 'student_app_sync_failed', '숙제 관리 설정을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.');
const syncRow = (db, id) => db.prepare('SELECT * FROM student_app_homework_sync WHERE student_id=?1').bind(id).first();
const sameRequest = (row, input) => row && row.requested_allowed === Number(input.allowed) && row.expected_revision === input.expectedRevision;
function vipValue(page) {
  const property = page?.properties?.VIP;
  if (property?.type !== 'checkbox' || typeof property.checkbox !== 'boolean') throw unavailable();
  return property.checkbox;
}
async function studentPage(env, id) {
  const page = await verifySiteNotionPage(env, id, SITE_LEDGER_DATABASES.student);
  if (normalizeStudentAppId(page.id) !== id) throw unavailable();
  vipValue(page);
  return page;
}
function view(access, row, vip) {
  let state = row?.state || 'synced';
  if (state === 'processing' && row.lease_until <= unix()) state = 'unknown';
  const ready = state === 'synced' && vip !== null && vip === access.allowed
    && (!row || row.result_revision === access.revision && row.verified_allowed === Number(vip));
  if (state === 'synced' && !ready) state = 'out_of_sync';
  const pending = ['processing', 'unknown', 'failed'].includes(state) && row;
  return { access, sync: { state, ready, homeworkEnabled: vip,
    pendingAllowed: pending ? row.requested_allowed === 1 : ready ? null : access.allowed,
    expectedRevision: pending ? row.expected_revision : ready ? null : access.revision } };
}
async function attachState(error, env, id, vip = null) {
  const result = error instanceof StudentAppAccessError ? error : unavailable();
  try { Object.assign(result, view(await readStudentAppAccess(env, id), await syncRow(env.GAME_DB, id), vip)); }
  catch { /* Missing storage cannot produce a misleading successful snapshot. */ }
  return result;
}
export async function readStudentAppProvision(env, rawId, { page } = {}) {
  const id = normalizeStudentAppId(rawId);
  try {
    const currentPage = page || await studentPage(env, id);
    return view(await readStudentAppAccess(env, id), await syncRow(env.GAME_DB, id), vipValue(currentPage));
  } catch (error) { throw await attachState(error, env, id); }
}

async function ownLease(db, id, row, token) {
  const current = await db.prepare(`SELECT * FROM student_app_homework_sync WHERE student_id=?1 AND operation_id=?2
    AND lease_token=?3 AND state='processing' AND lease_until>?4`).bind(id, row.operation_id, token, unix()).first();
  if (!current) throw changed();
  return current;
}
async function acquire(env, id, input, current, previous) {
  const db = env.GAME_DB, token = crypto.randomUUID(), now = unix(), at = stamp();
  if (previous && (previous.state === 'unknown' || previous.state === 'processing' && previous.lease_until <= now)) {
    const row = await db.prepare(`UPDATE student_app_homework_sync SET state='processing',lease_token=?3,lease_until=?4,error_code=NULL,updated_at=?5
      WHERE student_id=?1 AND operation_id=?2 AND (state='unknown' OR (state='processing' AND lease_until<=?6)) RETURNING *`)
      .bind(id, previous.operation_id, token, now + 45, at, now).first();
    if (row) return { row, token, recovering: row.write_started_at !== null };
  } else if (!previous || ['synced', 'failed'].includes(previous.state)) {
    const row = await db.prepare(`INSERT INTO student_app_homework_sync(student_id,operation_id,requested_allowed,expected_revision,result_revision,
      state,lease_token,lease_until,updated_at)
      SELECT ?1,?2,?3,?4,?5,'processing',?6,?7,?8 WHERE COALESCE((SELECT revision FROM student_app_access WHERE student_id=?1),0)=?9
      ON CONFLICT(student_id) DO UPDATE SET operation_id=excluded.operation_id,requested_allowed=excluded.requested_allowed,
        expected_revision=excluded.expected_revision,result_revision=excluded.result_revision,state='processing',lease_token=excluded.lease_token,
        lease_until=excluded.lease_until,write_target=NULL,write_before=NULL,write_started_at=NULL,verified_allowed=NULL,error_code=NULL,updated_at=excluded.updated_at
      WHERE student_app_homework_sync.state IN ('synced','failed') RETURNING *`)
      .bind(id, crypto.randomUUID(), Number(input.allowed), input.expectedRevision,
        input.allowed ? sameRequest(previous, input) && previous?.result_revision === current.revision && !current.allowed ? current.revision : null : current.revision,
        token, now + 45, at, current.revision).first();
    if (row) return { row, token, recovering: false };
  }
  const latest = await readStudentAppAccess(env, id);
  if (latest.revision !== current.revision) throw changed();
  throw failure(409, 'student_app_sync_in_progress', '숙제 관리 설정을 반영 중입니다. 잠시 후 상태를 다시 확인해주세요.');
}

// Every external write is sent once while this operation owns the student lease.
// An unknown response keeps the operation closed to PATCH retries. Only a manual
// repeat may observe the requested change in Notion and continue from that proof.
export async function changeStudentAppProvision(env, rawId, input) {
  const id = normalizeStudentAppId(rawId), db = env.GAME_DB;
  if (typeof input.allowed !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw failure(400, 'invalid_access_change', '이용 상태와 현재 버전을 확인해주세요.');
  }
  let lease, observed = null, uncertain = false, ownedRevision = null;
  try {
    let current = await readStudentAppAccess(env, id), previous, storageError;
    try { previous = await syncRow(db, id); } catch (error) { storageError = error; }
    const matching = sameRequest(previous, input);
    if (matching && previous.state === 'synced' && previous.result_revision === current.revision && current.allowed === input.allowed) {
      const page = await studentPage(env, id), freshAccess = await readStudentAppAccess(env, id), freshRow = await syncRow(db, id);
      if (freshAccess.revision !== current.revision || freshAccess.allowed !== current.allowed) throw changed();
      current = freshAccess; previous = freshRow;
      const result = view(current, previous, vipValue(page));
      if (result.sync.ready) return result;
    } else if (!input.allowed) {
      const retry = matching && ['processing', 'unknown'].includes(previous.state) && !current.allowed && previous.result_revision === current.revision;
      // A fresh OFF always increments the revision, including false -> false,
      // so an already running ON cannot later grant the old revision.
      if (!retry) current = await writeStudentAppAccess(env, id, { allowed: false, expectedRevision: input.expectedRevision, actor: input.actor || 'teacher' });
    } else if (current.revision !== input.expectedRevision
      && !(matching && (['processing', 'unknown'].includes(previous.state)
        || previous.state === 'failed' && previous.result_revision === current.revision && !current.allowed))) throw changed();
    if (storageError) throw storageError;
    previous = await syncRow(db, id);
    lease = await acquire(env, id, input, current, previous);
    ownedRevision = current.revision;
    uncertain = lease.recovering;
    let page = await studentPage(env, id); observed = vipValue(page);
    if (lease.recovering) {
      uncertain = true;
      if (observed !== (lease.row.write_target === 1)) throw unknown();
      // The old write changed the known before-value to its intended target.
      // Its effect is now observed; do not send that PATCH again.
      uncertain = false;
    }
    const recordEvidence = async () => {
      const row = await db.prepare(`UPDATE student_app_homework_sync SET verified_allowed=?4,updated_at=?5
        WHERE student_id=?1 AND operation_id=?2 AND lease_token=?3 AND state='processing' AND lease_until>?6 RETURNING *`)
        .bind(id, lease.row.operation_id, lease.token, Number(observed), stamp(), unix()).first();
      if (!row) throw changed();
      lease.row = row;
    };
    await recordEvidence();
    const writeVip = async desired => {
      await ownLease(db, id, lease.row, lease.token);
      const marked = await db.prepare(`UPDATE student_app_homework_sync SET write_target=?4,write_before=?5,write_started_at=?6,updated_at=?6,verified_allowed=NULL
        WHERE student_id=?1 AND operation_id=?2 AND lease_token=?3 AND state='processing' AND lease_until>?7 RETURNING *`)
        .bind(id, lease.row.operation_id, lease.token, Number(desired), Number(observed), stamp(), unix()).first();
      if (!marked) throw changed();
      lease.row = marked; uncertain = true;
      try { await siteNotionOnce(env, 'PATCH', `/pages/${id}`, { properties: { VIP: { checkbox: desired } } }); }
      catch (error) {
        if (error?.ambiguous === false && (error?.setup === true || error?.code === 'notion_rate_limited')) uncertain = false;
        throw uncertain ? unknown() : unavailable();
      }
      page = await studentPage(env, id); observed = vipValue(page);
      if (observed !== desired) throw unknown();
      uncertain = false;
      await ownLease(db, id, lease.row, lease.token);
      await recordEvidence();
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      await ownLease(db, id, lease.row, lease.token);
      current = await readStudentAppAccess(env, id);
      const mayGrant = input.allowed && sameRequest(lease.row, input) && lease.row.requested_allowed === 1
        && (current.revision === lease.row.expected_revision || current.revision === lease.row.result_revision) && !current.allowed;
      const desired = mayGrant ? true : current.allowed;
      if (observed !== desired) await writeVip(desired);
      if (mayGrant) {
        try {
          current = await writeStudentAppAccess(env, id, { allowed: true, expectedRevision: current.revision, actor: input.actor || 'teacher',
            syncGuard: { operationId: lease.row.operation_id, leaseToken: lease.token } });
          ownedRevision = current.revision;
        }
        catch (error) {
          if (!(error instanceof StudentAppAccessError) || error.code !== 'access_revision_changed') throw error;
          continue; // A concurrent OFF wins; reconcile its false VIP under this lease.
        }
      }
      current = await readStudentAppAccess(env, id);
      if (current.allowed !== observed) continue;
      const settled = await db.prepare(`UPDATE student_app_homework_sync SET state='synced',result_revision=?4,verified_allowed=?5,
        lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=?6
        WHERE student_id=?1 AND operation_id=?2 AND lease_token=?3 AND state='processing' AND lease_until>unixepoch()
        AND COALESCE((SELECT revision FROM student_app_access WHERE student_id=?1),0)=?4
        AND COALESCE((SELECT allowed FROM student_app_access WHERE student_id=?1),0)=?5 RETURNING *`)
        .bind(id, lease.row.operation_id, lease.token, current.revision, Number(observed), stamp()).first();
      if (!settled) continue;
      const result = view(await readStudentAppAccess(env, id), await syncRow(db, id), observed);
      if (!result.sync.ready || result.access.allowed !== input.allowed) throw changed();
      return result;
    }
    throw changed();
  } catch (error) {
    if (lease) {
      // A synchronization failure cannot leave an old true entitlement open.
      // Only this operation's unchanged revision and live lease may close it;
      // a superseding teacher operation is never overwritten by this cleanup.
      try {
        const current = await readStudentAppAccess(env, id);
        if (current.allowed && current.revision === ownedRevision) {
          const closed = await writeStudentAppAccess(env, id, { allowed: false, expectedRevision: current.revision, actor: input.actor || 'teacher',
            syncGuard: { operationId: lease.row.operation_id, leaseToken: lease.token, allowExpiredRevoke: true } });
          await db.prepare(`UPDATE student_app_homework_sync SET result_revision=?4 WHERE student_id=?1 AND operation_id=?2
            AND lease_token=?3 AND state='processing'`).bind(id, lease.row.operation_id, lease.token, closed.revision).run();
        }
      } catch { /* A lost lease or changed revision belongs to the newer request. */ }
      await db.prepare(`UPDATE student_app_homework_sync SET state=?4,lease_token=NULL,lease_until=NULL,error_code=?5,updated_at=?6
        WHERE student_id=?1 AND operation_id=?2 AND lease_token=?3 AND state='processing'`)
        .bind(id, lease.row.operation_id, lease.token, uncertain ? 'unknown' : 'failed',
          error instanceof StudentAppAccessError ? error.code : 'student_app_sync_failed', stamp()).run().catch(() => {});
    }
    throw await attachState(error, env, id, observed);
  }
}
