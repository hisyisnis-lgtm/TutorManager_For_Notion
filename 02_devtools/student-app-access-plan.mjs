// Offline plans only: explicit local JSON input, SQL output, no bindings/network.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const idOf = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(value)) throw new Error('Invalid student ID');
  return value.replaceAll('-', '').toLowerCase();
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
};
function optionsOf({ batchId, actor = 'operator', at } = {}) {
  text(batchId, 'batch ID'); text(actor, 'actor');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('Explicit plan timestamp required');
  return { batchId, actor, at: new Date(at).toISOString() };
}
function currentMap(rows) {
  if (!Array.isArray(rows)) throw new Error('Current access rows must be an array');
  const map = new Map();
  for (const row of rows) {
    const id = idOf(row.student_id);
    if (map.has(id) || ![0, 1].includes(row.allowed) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid current access rows');
    map.set(id, row);
  }
  return map;
}
export function createStudentAppAccessPlan(snapshot, currentRows = [], options) {
  const config = optionsOf(options), current = currentMap(currentRows), seen = new Set(), changes = [], skipped = [];
  if (snapshot?.schema !== 1 || !Array.isArray(snapshot.students) || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error('Invalid explicit VIP snapshot');
  if (snapshot.source !== 'synthetic') throw new Error('Direct SQL seed is synthetic-only. Use student-app-transition-plan.mjs for reviewed production transitions through the provision API.');
  for (const row of snapshot.students) {
    const studentId = idOf(row.studentId);
    if (seen.has(studentId) || typeof row.vip !== 'boolean') throw new Error('Duplicate student or invalid VIP value');
    seen.add(studentId);
    if (current.has(studentId)) { skipped.push({ studentId, reason: 'existing_access_preserved' }); continue; }
    if (!row.vip) { skipped.push({ studentId, reason: 'non_vip_default_deny' }); continue; }
    changes.push({ studentId, allowed: true, expectedRevision: 0, revision: 1, sourceBatch: config.batchId,
      operationId: `${config.batchId}:${studentId}:seed` });
  }
  return { schema: 1, source: 'synthetic', mode: 'seed', ...config, capturedAt: new Date(snapshot.capturedAt).toISOString(), changes, skipped };
}
export function createStudentAppAccessRollback(seed, currentRows, options) {
  const config = optionsOf(options), current = currentMap(currentRows), changes = [], skipped = [];
  if (seed?.schema !== 1 || seed.source !== 'synthetic' || seed.mode !== 'seed' || !Array.isArray(seed.changes)) throw new Error('Original synthetic seed plan required');
  for (const original of seed.changes) {
    const studentId = idOf(original.studentId), row = current.get(studentId);
    if (!row || row.source_batch !== seed.batchId || row.last_operation_id !== original.operationId || row.revision !== original.revision || row.allowed !== 1) {
      skipped.push({ studentId, reason: 'later_or_unrelated_change_preserved' }); continue;
    }
    changes.push({ studentId, allowed: false, expectedRevision: row.revision, revision: row.revision + 1,
      sourceBatch: seed.batchId, previousOperationId: original.operationId, operationId: `${config.batchId}:${studentId}:rollback` });
  }
  return { schema: 1, source: 'synthetic', mode: 'rollback', ...config, changes, skipped };
}
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
export function studentAppAccessPlanSql(plan) {
  if (plan?.schema !== 1 || plan.source !== 'synthetic' || !['seed', 'rollback'].includes(plan.mode) || !Array.isArray(plan.changes)) throw new Error('Direct SQL access plans are synthetic-only; use the reviewed provision API package for production.');
  optionsOf(plan);
  const statements = ['-- SYNTHETIC FIXTURE ONLY. Never apply to a remote/production database.', '-- Offline review artifact. No command here calls or applies a remote database.', 'BEGIN TRANSACTION;'];
  for (const change of plan.changes) {
    const id = sqlText(idOf(change.studentId)), op = sqlText(text(change.operationId, 'operation ID'));
    const batch = sqlText(text(change.sourceBatch, 'source batch')), actor = sqlText(plan.actor), at = sqlText(plan.at);
    if (plan.mode === 'seed') {
      if (change.allowed !== true || change.expectedRevision !== 0 || change.revision !== 1) throw new Error('Invalid seed change');
      statements.push(`INSERT INTO student_app_access(student_id,allowed,revision,granted_at,granted_by,revoked_at,revoked_by,source_batch,last_operation_id) VALUES(${id},1,1,${at},${actor},NULL,NULL,${batch},${op}) ON CONFLICT(student_id) DO NOTHING;`);
    } else {
      if (change.allowed !== false || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 1 || change.revision !== change.expectedRevision + 1) throw new Error('Invalid rollback change');
      const previous = sqlText(text(change.previousOperationId, 'previous operation ID'));
      statements.push(`UPDATE student_app_access SET allowed=0,revision=revision+1,revoked_at=${at},revoked_by=${actor},last_operation_id=${op} WHERE student_id=${id} AND allowed=1 AND revision=${change.expectedRevision} AND source_batch=${batch} AND last_operation_id=${previous};`);
    }
    statements.push(`INSERT OR IGNORE INTO student_app_access_events(event_id,student_id,revision,allowed,actor,source_batch,created_at) SELECT ${op},student_id,revision,allowed,${actor},source_batch,${at} FROM student_app_access WHERE student_id=${id} AND last_operation_id=${op};`);
  }
  statements.push('COMMIT;');
  return statements.join('\n') + '\n';
}
export function syntheticStudentAppSnapshot() {
  return { schema: 1, source: 'synthetic', capturedAt: '2026-10-07T00:00:00.000Z', students: [
    { studentId: '11111111-1111-4111-8111-111111111111', vip: true },
    { studentId: '22222222-2222-4222-8222-222222222222', vip: false },
  ] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), values = new Map();
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (['--demo', '--sql'].includes(key)) { values.set(key, true); continue; }
      if (!['--snapshot', '--current', '--rollback', '--batch', '--actor', '--at', '--output'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid offline plan arguments');
      values.set(key, args[++index]);
    }
    const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
    const current = values.has('--current') ? readJson(values.get('--current')) : [];
    const options = { batchId: values.get('--batch'), actor: values.get('--actor') || 'operator', at: values.get('--at') };
    const plan = values.has('--rollback') ? createStudentAppAccessRollback(readJson(values.get('--rollback')), current, options)
      : createStudentAppAccessPlan(values.has('--demo') ? syntheticStudentAppSnapshot() : readJson(values.get('--snapshot')), current, options);
    const output = values.has('--sql') ? studentAppAccessPlanSql(plan) : JSON.stringify(plan, null, 2) + '\n';
    if (values.has('--output')) writeFileSync(values.get('--output'), output, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(output);
  } catch (error) { process.stderr.write(`Offline plan rejected: ${error.message}\n`); process.exitCode = 1; }
}
