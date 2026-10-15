import { NotionPageIdSchema } from './schemas.js';

export class StudentAppAccessError extends Error {
  constructor(status, code, message) {
    super(message); this.name = 'StudentAppAccessError'; this.status = status; this.code = code;
  }
}
const unavailable = () => new StudentAppAccessError(503, 'student_app_unavailable', '학생앱 이용 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.');
export function normalizeStudentAppId(value) {
  if (!NotionPageIdSchema.safeParse(value).success) throw new StudentAppAccessError(400, 'invalid_student', '학생을 확인해주세요.');
  return value.replaceAll('-', '').toLowerCase();
}
function accessDto(row, studentId) {
  if (!row) return { studentId, allowed: false, revision: 0, grantedAt: null, grantedBy: null, revokedAt: null, revokedBy: null, sourceBatch: null };
  if (row.student_id !== studentId || ![0, 1].includes(row.allowed) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw unavailable();
  return { studentId, allowed: row.allowed === 1, revision: row.revision, grantedAt: row.granted_at, grantedBy: row.granted_by,
    revokedAt: row.revoked_at, revokedBy: row.revoked_by, sourceBatch: row.source_batch };
}
export async function readStudentAppAccess(env, id) {
  const studentId = normalizeStudentAppId(id);
  if (!env.GAME_DB) throw unavailable();
  try {
    const row = await env.GAME_DB.prepare('SELECT * FROM student_app_access WHERE student_id=?1').bind(studentId).first();
    return accessDto(row, studentId);
  } catch (error) { if (error instanceof StudentAppAccessError) throw error; throw unavailable(); }
}
export async function requireStudentAppAccess(env, studentId) {
  const access = await readStudentAppAccess(env, studentId);
  if (!access.allowed) throw new StudentAppAccessError(403, 'student_app_not_provided', '학생앱 이용 대상이 아닙니다. 선생님에게 문의해주세요.');
  return access;
}

// Compare-and-swap and its audit are one D1 batch transaction. No link, payment,
// signup, or subsequent VIP change invokes this function automatically.
export async function writeStudentAppAccess(env, id, { allowed, expectedRevision, actor = 'teacher', sourceBatch = null, syncGuard = null }) {
  const studentId = normalizeStudentAppId(id);
  if (typeof allowed !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || typeof actor !== 'string' || !actor || actor.length > 100 || sourceBatch !== null && (typeof sourceBatch !== 'string' || sourceBatch.length > 100)) {
    throw new StudentAppAccessError(400, 'invalid_access_change', '이용 상태와 현재 버전을 확인해주세요.');
  }
  if (!env.GAME_DB) throw unavailable();
  if (syncGuard !== null && (typeof syncGuard.operationId !== 'string' || !syncGuard.operationId || syncGuard.operationId.length > 100
    || typeof syncGuard.leaseToken !== 'string' || !syncGuard.leaseToken || syncGuard.leaseToken.length > 100)) {
    throw new StudentAppAccessError(400, 'invalid_access_change', '이용 상태와 현재 버전을 확인해주세요.');
  }
  // This optional internal guard is evaluated in the entitlement mutation itself,
  // not in a preceding read that could lose the lease during an await.
  const guard = syncGuard ? ` AND EXISTS(SELECT 1 FROM student_app_homework_sync WHERE student_id=?1 AND operation_id=?8
    AND lease_token=?9 AND state='processing'${!allowed && syncGuard.allowExpiredRevoke === true ? '' : ' AND lease_until>unixepoch()'}${allowed ? ' AND verified_allowed=1' : ''})` : '';
  const operation = crypto.randomUUID(), at = new Date().toISOString(), value = allowed ? 1 : 0;
  try {
    const result = await env.GAME_DB.batch([
      env.GAME_DB.prepare(`INSERT INTO student_app_access(student_id,allowed,revision,granted_at,granted_by,revoked_at,revoked_by,source_batch,last_operation_id)
        SELECT ?1,?2,1,CASE WHEN ?2=1 THEN ?3 END,CASE WHEN ?2=1 THEN ?4 END,CASE WHEN ?2=0 THEN ?3 END,CASE WHEN ?2=0 THEN ?4 END,?5,?6
        WHERE (?7=0 OR EXISTS(SELECT 1 FROM student_app_access WHERE student_id=?1 AND revision=?7))${guard}
        ON CONFLICT(student_id) DO UPDATE SET allowed=excluded.allowed,revision=student_app_access.revision+1,
          granted_at=CASE WHEN excluded.allowed=1 THEN ?3 ELSE student_app_access.granted_at END,
          granted_by=CASE WHEN excluded.allowed=1 THEN ?4 ELSE student_app_access.granted_by END,
          revoked_at=CASE WHEN excluded.allowed=0 THEN ?3 ELSE NULL END,revoked_by=CASE WHEN excluded.allowed=0 THEN ?4 ELSE NULL END,
          source_batch=COALESCE(student_app_access.source_batch,excluded.source_batch),last_operation_id=excluded.last_operation_id
        WHERE student_app_access.revision=?7${guard} RETURNING *`)
        .bind(studentId, value, at, actor, sourceBatch, operation, expectedRevision,
          ...(syncGuard ? [syncGuard.operationId, syncGuard.leaseToken] : [])),
      env.GAME_DB.prepare(`INSERT INTO student_app_access_events(event_id,student_id,revision,allowed,actor,source_batch,created_at)
        SELECT ?1,student_id,revision,allowed,?2,source_batch,?3 FROM student_app_access WHERE student_id=?4 AND last_operation_id=?1`)
        .bind(operation, actor, at, studentId),
    ]);
    const row = result[0]?.results?.[0];
    if (!row) throw new StudentAppAccessError(409, 'access_revision_changed', '이용 상태가 변경되었습니다. 새로고침 후 다시 확인해주세요.');
    return accessDto(row, studentId);
  } catch (error) { if (error instanceof StudentAppAccessError) throw error; throw unavailable(); }
}
