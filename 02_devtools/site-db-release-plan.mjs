#!/usr/bin/env node
// Run at the repository root. Remote access is a fixed metadata-only read path.
// This tool never applies migrations, exports business rows, or changes release gates.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executeFile = promisify(execFile);
export const DB_TARGET = Object.freeze({ binding: 'GAME_DB', name: 'tone-game-users', id: '1cb6265b-95e4-47cc-a0c8-5ac00266b9fa' });
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const INTERNAL = /^(?:sqlite_|_cf_|d1_migrations$)/;
const COUNTS = ['game_users', 'finder_users', 'student_panda_profiles', 'student_panda_actions', 'notification_followups',
  'push_subscriptions', 'push_notifications',
  'site_members', 'site_member_identities', 'site_shop_products', 'site_shop_orders', 'site_shop_order_items',
  'site_shop_coupon_redemptions', 'reviews', 'student_app_access', 'student_app_homework_sync'];
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = rows => rows.map(row => ({ ...row }));
const ident = value => { assert.match(value, /^[a-z][a-z0-9_]*$/); return `"${value}"`; };
const schema = db => plain(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all())
  .filter(row => !INTERNAL.test(row.name));
const ddlHash = sql => hash(sql.replaceAll('\r\n', '\n').trim());

export async function migrationCatalog(root = ROOT) {
  const directory = path.join(root, 'worker/migrations');
  const names = (await readdir(directory)).filter(name => NAME.test(name)).sort();
  assert.ok(names.length > 0, 'Migration catalog is empty');
  const result = [];
  for (const [index, name] of names.entries()) {
    assert.equal(Number(name.slice(0, 4)), index + 1, 'Migration numbers must be contiguous');
    const sql = await readFile(path.join(directory, name), 'utf8');
    result.push({ name, sha256: hash(sql), sql,
      rebuildsTable: /\bDROP\s+TABLE\b/i.test(sql), altersSchema: /\bALTER\s+TABLE\b/i.test(sql) });
  }
  // Historical 0003 was removed by the Web Push feature revert. Keep its applied
  // journal and tables; it must never re-enter worker/migrations or be reapplied.
  const legacySql = await readFile(path.join(root, '02_devtools/site-db-legacy-web-push.sql'), 'utf8');
  const legacyHash = '85a1df8d3d25fb08e16a930501e2310713c68590179623b397bf2658c971e149';
  assert.equal(hash(legacySql.replaceAll('\r\n', '\n')), legacyHash, 'Historical Web Push source changed');
  result.legacy = [{ name: '0003_web_push.sql', sql: legacySql, sha256: legacyHash,
    sourceCommit: 'ceedb05d436697af941f920f0b1a44cbdcc9a586', removedAtCommit: '1b434f1a17fb27ccbc6cc03b8bea3e3e2b2186bb',
    sourcePath: 'worker/migrations/0003_web_push.sql', preservedFrom: '02_devtools/site-db-legacy-web-push.sql' }];
  return result;
}

function apply(db, entry) {
  // Only the local reviewed migration catalog is executed, never snapshot SQL.
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(entry.sql); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw new Error(`Local migration failed: ${entry.name}`, { cause: error }); }
}
export function replay(catalog, count = catalog.length) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  try { for (const entry of catalog.slice(0, count)) apply(db, entry); return db; }
  catch (error) { db.close(); throw error; }
}
export function localInventory(db, applied, capturedAt = new Date().toISOString()) {
  const objects = schema(db), tables = new Set(objects.filter(row => row.type === 'table').map(row => row.name));
  return { schema: 1, kind: 'site-db-schema-inventory', capturedAt, readOnly: true, target: { ...DB_TARGET },
    journal: [...applied], objects, counts: Object.fromEntries(COUNTS.filter(name => tables.has(name))
      .map(name => [name, db.prepare(`SELECT COUNT(*) count FROM ${ident(name)}`).get().count])) };
}
function checkSnapshot(snapshot, catalog) {
  assert.equal(snapshot?.schema, 1); assert.equal(snapshot.kind, 'site-db-schema-inventory'); assert.equal(snapshot.readOnly, true);
  assert.deepEqual(snapshot.target, DB_TARGET, 'Wrong database target');
  assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)), 'Capture time missing');
  assert.ok(Array.isArray(snapshot.journal) && Array.isArray(snapshot.objects), 'Schema and journal required');
  assert.equal(new Set(snapshot.journal).size, snapshot.journal.length, 'Journal contains duplicate names');
  const knownJournal = snapshot.journal.filter(name => !catalog.legacy.some(entry => entry.name === name));
  assert.deepEqual(knownJournal, catalog.slice(0, knownJournal.length).map(entry => entry.name), 'Journal is not a reviewed migration prefix');
  for (const entry of catalog.legacy.filter(entry => snapshot.journal.includes(entry.name))) {
    assert.ok(snapshot.journal.indexOf(entry.name) > snapshot.journal.indexOf('0002_security_state.sql')
      && snapshot.journal.indexOf(entry.name) < snapshot.journal.indexOf('0003_notification_followups.sql'), 'Historical migration order changed');
  }
  assert.equal(new Set(snapshot.objects.map(row => row.name)).size, snapshot.objects.length, 'Duplicate schema object');
  for (const row of snapshot.objects) {
    assert.ok(['table', 'index', 'trigger', 'view'].includes(row.type)); assert.match(row.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.equal(typeof row.sql, 'string'); assert.ok(row.sql.length < 100_000);
  }
  for (const [name, count] of Object.entries(snapshot.counts || {})) { assert.ok(COUNTS.includes(name)); assert.ok(Number.isSafeInteger(count) && count >= 0); }
  return knownJournal;
}

function insert(db, table, values) {
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO ${ident(table)}(${keys.map(ident)}) VALUES(${keys.map(() => '?')})`).run(...Object.values(values));
}
function existingFixture(db) {
  const at = '2026-10-01T00:00:00Z';
  insert(db, 'game_users', { id: 'synthetic-game', provider: 'google', social_id: 'synthetic-subject', nickname: '합성', game_data: '{"score":7}', created_at: at, last_seen_at: at });
  insert(db, 'finder_users', { id: 'synthetic-finder', provider: 'kakao', social_id: 'synthetic-finder-subject', profile: '{"revision":3}', revision: 3, created_at: at, last_seen_at: at });
  insert(db, 'student_panda_profiles', { student_id: 'a'.repeat(32), profile: '{"food":5}', revision: 2, earned_total: 9, created_at: at, updated_at: at });
  insert(db, 'student_panda_actions', { student_id: 'a'.repeat(32), request_id: 'synthetic-action', action_json: '{"type":"feed"}', profile: '{"food":5}', revision: 2, earned_total: 9, created_at: at });
  insert(db, 'notification_followups', { id: 'synthetic-followup', kind: 'reminder', delivery_state: 'unknown', reason_code: 'synthetic', created_at: 1, updated_at: 1 });
  insert(db, 'security_rate_limits', { key_hash: 'synthetic-rate', count: 1, expires_at: 1 });
  insert(db, 'push_subscriptions', { endpoint_hash: 'synthetic-endpoint', endpoint: 'https://push.invalid/synthetic', p256dh: 'synthetic-p256dh', auth: 'synthetic-auth', created_at: 1, updated_at: 1 });
  insert(db, 'push_notifications', { id: 'synthetic-push', created_at: 1, title: '합성 알림', message: '합성 내용', priority: 1 });
}
function rowHashes(db, tables) {
  return Object.fromEntries(tables.map(table => [table, hash(JSON.stringify(plain(db.prepare(`SELECT * FROM ${ident(table)} ORDER BY 1,2`).all())))]));
}
export function couponFixture(db) {
  const at = '2026-10-01T00:00:00Z', member = 'synthetic-member', product = 'synthetic-product';
  insert(db, 'site_members', { id: member, status: 'active', name: '합성 회원', member_code: 'SYNTHETIC1', customer_key: 'synthetic-customer', provider: 'google', provider_subject: 'synthetic-google', created_at: at, updated_at: at });
  insert(db, 'site_shop_products', { slug: product, name: '합성 상품', product_type: 'digital', price: 10000, created_at: at, updated_at: at });
  for (const [index, state] of ['reserved', 'used', 'released'].entries()) {
    const order = `synthetic-order-${index}`, coupon = `synthetic-coupon-${index}`;
    insert(db, 'site_shop_orders', { id: order, member_id: member, product_slug: product, product_type: 'digital', idempotency_hash: `synthetic-key-${index}`,
      payload_hash: `synthetic-body-${index}`, snapshot: '{"name":"합성 상품","amount":10000}', amount: 10000, shipping_fee: 0, pg_order_id: `synthetic-pg-${index}`,
      pg_environment: 'test', pg_client_id: 'synthetic-client', callback_nonce: `synthetic-nonce-${index}`, approval_key: `synthetic-approval-${index}`,
      stock_state: 'none', shipping_status: 'not_applicable', expires_at: at, created_at: at, updated_at: at });
    insert(db, 'site_shop_coupons', { id: coupon, code: `SYNTHETIC${index}`, name: '합성 쿠폰', create_hash: `synthetic-coupon-hash-${index}`,
      discount_type: 'fixed', discount_value: 1000, created_at: at, updated_at: at });
    insert(db, 'site_shop_coupon_redemptions', { order_id: order, coupon_id: coupon, member_id: member, per_member_once: 1, state, created_at: at, updated_at: at });
  }
}

export function offlineChecks(catalog) {
  assert.ok(catalog.length >= 28 && catalog[27].name === '0028_site_phone_auth.sql', 'Phone-first release requires migrations through 0028');
  const existing = replay(catalog, 6);
  for (const entry of catalog.legacy) apply(existing, entry);
  const beforeSchema = schema(existing), protectedTables = beforeSchema.filter(row => row.type === 'table').map(row => row.name);
  try {
    existingFixture(existing); const beforeData = rowHashes(existing, protectedTables);
    for (const entry of catalog.slice(6)) apply(existing, entry);
    assert.deepEqual(schema(existing).filter(row => beforeSchema.some(old => old.name === row.name)), beforeSchema, 'Existing schema changed');
    assert.deepEqual(rowHashes(existing, protectedTables), beforeData, 'Existing game/panda/notification rows changed');
    assert.equal(existing.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(existing.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { existing.close(); }
  const coupon = replay(catalog, 23);
  try {
    couponFixture(coupon);
    const protectedRows = ['site_members', 'site_shop_products', 'site_shop_orders', 'site_shop_coupons', 'site_shop_coupon_redemptions'];
    const before = rowHashes(coupon, protectedRows), oldRead = plain(coupon.prepare('SELECT * FROM site_shop_coupon_redemptions ORDER BY order_id').all());
    apply(coupon, catalog[23]);
    assert.deepEqual(rowHashes(coupon, protectedRows), before, '0024 changed existing commerce rows');
    assert.deepEqual(plain(coupon.prepare('SELECT * FROM site_shop_coupon_redemptions ORDER BY order_id').all()), oldRead, 'Legacy order lookup changed');
    assert.deepEqual(coupon.prepare('PRAGMA table_info(site_shop_coupon_redemptions)').all().filter(row => row.pk).map(row => row.name), ['order_id', 'coupon_id']);
    assert.equal(coupon.prepare("SELECT 1 FROM sqlite_schema WHERE name='site_shop_coupon_redemptions_previous'").get(), undefined);
    assert.throws(() => coupon.prepare(`INSERT INTO site_shop_coupon_redemptions VALUES('synthetic-order-2','synthetic-coupon-0','synthetic-member',1,'reserved','x','x')`).run(), /UNIQUE/);
    for (const entry of catalog.slice(24)) apply(coupon, entry);
    assert.deepEqual(plain(coupon.prepare('SELECT member_id,provider,provider_subject FROM site_member_identities').all()), [{ member_id: 'synthetic-member', provider: 'google', provider_subject: 'synthetic-google' }]);
    assert.deepEqual(rowHashes(coupon, protectedRows), before, 'Identity backfill changed existing canonical commerce data');
    assert.equal(coupon.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(coupon.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { coupon.close(); }
  return { passed: true, existingSchemaAndRowsPreserved: true, coupon0024: { states: ['reserved', 'used', 'released'], rowsPreserved: 3,
    compositeKey: true, memberOnceConstraint: true, oldOrderLookup: true }, identity0026: { canonicalOwnerPreserved: true }, integrity: 'ok', foreignKeyViolations: 0,
    phone0028: { existingMemberAndCommerceRowsPreserved: true, runtimeTest: 'worker/tests/sitePhoneMigration.runtime.test.js' },
    note: 'Local SQLite with synthetic rows; not a restored production backup or Cloudflare runtime migration rehearsal.' };
}

export function buildPlan(snapshot, catalog) {
  const knownJournal = checkSnapshot(snapshot, catalog);
  const current = replay(catalog, knownJournal.length);
  let expected;
  try {
    for (const entry of catalog.legacy.filter(entry => snapshot.journal.includes(entry.name))) apply(current, entry);
    expected = schema(current);
  } finally { current.close(); }
  const actual = new Map(snapshot.objects.filter(row => !INTERNAL.test(row.name)).map(row => [row.name, row]));
  const drift = expected.flatMap(row => {
    const found = actual.get(row.name);
    return found && found.type === row.type && ddlHash(found.sql) === ddlHash(row.sql) ? []
      : [{ name: row.name, expectedSha256: ddlHash(row.sql), actualSha256: found ? ddlHash(found.sql) : null }];
  });
  const extras = [...actual.keys()].filter(name => !expected.some(row => row.name === name));
  const pending = catalog.slice(knownJournal.length).map(({ sql, ...entry }) => ({ ...entry, file: `worker/migrations/${entry.name}` }));
  const checks = offlineChecks(catalog);
  return { schema: 1, kind: 'site-db-migration-plan', generatedAt: new Date().toISOString(), sourceInventoryAt: snapshot.capturedAt,
    target: { ...DB_TARGET }, remoteMutationPerformed: false, productionReady: false,
    gates: { schemaMatchesJournal: drift.length === 0 && extras.length === 0, syntheticMigrationReplay: true, privateBackupVerified: false,
      restoreDrillCompleted: false, exactCurrentWorkerSourceReviewed: false, memberAuthenticationConfigured: false, existingStudentTransitionApproved: false, deployAuthorized: false },
    applied: snapshot.journal, legacyPreserved: catalog.legacy.filter(entry => snapshot.journal.includes(entry.name)).map(({ sql, ...entry }) => entry),
    pending, schemaDrift: drift, extraSchemaObjects: extras, counts: snapshot.counts, checks,
    risk: ['0024 rebuilds the coupon redemption table; keep backup/bookmark and compare row counts before and after.',
      '0028 rebuilds site_members and identities with deferred FK validation and a zero-violation guard. Apply it as one D1 migration transaction.',
      'No automatic student app grants or member/student links are seeded; existing access needs a separately reviewed transition.',
      'Do not replay individual ALTER files or hand-edit d1_migrations to bypass a discrepancy.',
      'Old Worker exact source is not established here; unchanged existing schema/data is only database compatibility evidence.'],
    reviewedCommands: [
      { phase: 'before', kind: 'read', cwd: 'worker', argv: ['wrangler', 'd1', 'time-travel', 'info', DB_TARGET.binding, '--json'] },
      { phase: 'before', kind: 'private-backup-read', cwd: 'worker', argv: ['wrangler', 'd1', 'export', DB_TARGET.binding, '--remote', '--output', '<PRIVATE_BACKUP_OUTSIDE_REPOSITORY>'], executed: false },
      { phase: 'before', kind: 'read', cwd: 'worker', argv: ['wrangler', 'd1', 'migrations', 'list', DB_TARGET.binding, '--remote'] },
      { phase: 'approved-maintenance-only', kind: 'mutation-not-executed', cwd: 'worker', argv: ['wrangler', 'd1', 'migrations', 'apply', DB_TARGET.binding, '--remote'], executed: false },
      { phase: 'after', kind: 'read', cwd: 'worker', argv: ['wrangler', 'd1', 'migrations', 'list', DB_TARGET.binding, '--remote'] },
    ],
    rollbackCommands: [
      { phase: 'before-any-restore', kind: 'read', cwd: 'worker', argv: ['wrangler', 'd1', 'time-travel', 'info', DB_TARGET.binding, '--json'] },
      { phase: 'before-any-restore', kind: 'private-backup-read', cwd: 'worker', argv: ['wrangler', 'd1', 'export', DB_TARGET.binding, '--remote', '--output', '<PRIVATE_CURRENT_BACKUP_OUTSIDE_REPOSITORY>'], executed: false },
      { phase: 'separately-approved-restoration-only', kind: 'destructive-mutation-not-executed', cwd: 'worker',
        argv: ['wrangler', 'd1', 'time-travel', 'restore', DB_TARGET.binding, '--bookmark', '<VERIFIED_PRE_MIGRATION_BOOKMARK>'], executed: false,
        warning: 'Restores the whole shared DB, including game/panda data and migration history. Preserve/reconcile all writes after the recovery point first.' },
    ] };
}

export function verificationSql(snapshot, plan, phase) {
  assert.ok(['before', 'after'].includes(phase));
  const beforeTables = new Set(snapshot.objects.filter(row => row.type === 'table').map(row => row.name));
  const names = COUNTS.filter(name => phase === 'after' || beforeTables.has(name));
  return `-- Read-only ${phase} verification. No member IDs, email addresses, bodies, tokens or payment details.\n`
    + `SELECT name FROM d1_migrations ORDER BY id;\nSELECT type,name,tbl_name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;\n`
    + names.map(name => `SELECT '${name}' AS table_name,COUNT(*) AS row_count FROM ${ident(name)};`).join('\n')
    + (phase === 'after' ? `\nSELECT state,COUNT(*) AS row_count FROM site_shop_coupon_redemptions GROUP BY state ORDER BY state;\nPRAGMA foreign_key_check;\nPRAGMA table_info(site_shop_coupon_redemptions);\nPRAGMA index_list(site_shop_coupon_redemptions);\n` : '\n');
}

export async function captureInventory({ root = ROOT, run = executeFile } = {}) {
  const config = await readFile(path.join(root, 'worker/wrangler.toml'), 'utf8');
  assert.ok(config.includes(`binding = "${DB_TARGET.binding}"`) && config.includes(`database_name = "${DB_TARGET.name}"`)
    && config.includes(`database_id = "${DB_TARGET.id}"`), 'Worker database binding differs from the reviewed target');
  const read = async sql => {
    assert.ok(/^(?:SELECT\b|PRAGMA\s+foreign_key_check\s*;?$)/i.test(sql), 'Only fixed metadata queries are allowed');
    let text;
    try { const result = await run(process.execPath, [path.join(root, 'worker/node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', DB_TARGET.binding,
      '--remote', '--command', sql, '--json'], { cwd: path.join(root, 'worker'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        maxBuffer: 4 * 1024 * 1024, timeout: 30_000, env: { ...process.env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false' } });
      text = typeof result === 'string' ? result : result.stdout; }
    catch { throw new Error('Read-only D1 metadata command failed; inventory was not overwritten.'); }
    const result = JSON.parse(text); assert.equal(result.length, 1); assert.equal(result[0].success, true);
    assert.equal(result[0].meta?.rows_written, 0); assert.equal(result[0].meta?.changed_db, false);
    return result[0].results;
  };
  const objects = (await read("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name")).filter(row => !INTERNAL.test(row.name));
  const journal = (await read('SELECT name FROM d1_migrations ORDER BY id')).map(row => row.name);
  const tables = new Set(objects.filter(row => row.type === 'table').map(row => row.name));
  const names = COUNTS.filter(name => tables.has(name));
  const counts = names.length ? (await read(`SELECT ${names.map(name => `(SELECT COUNT(*) FROM ${ident(name)}) AS ${ident(name)}`).join(',')}`))[0] : {};
  const endJournal = (await read('SELECT name FROM d1_migrations ORDER BY id')).map(row => row.name);
  assert.deepEqual(endJournal, journal, 'Migration journal changed during capture');
  const endObjects = (await read("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name")).filter(row => !INTERNAL.test(row.name));
  assert.deepEqual(endObjects, objects, 'Schema changed during capture');
  return { schema: 1, kind: 'site-db-schema-inventory', capturedAt: new Date().toISOString(), readOnly: true, target: { ...DB_TARGET }, journal, objects, counts,
    schemaAndJournalStableDuringCapture: true, aggregateCountsAreLiveObservations: true };
}

function workspaceOutput(root, value) {
  const output = path.resolve(root, value), allowed = path.join(root, '04_docs/qa') + path.sep;
  assert.ok(output.startsWith(allowed), 'Output must remain inside 04_docs/qa'); return output;
}
async function main(args) {
  const [action, ...rest] = args, options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    assert.ok(['--snapshot', '--output'].includes(rest[index]) && rest[index + 1] && !options.has(rest[index]), 'Unknown or duplicate argument'); options.set(rest[index], rest[index + 1]);
  }
  if (action === 'capture') {
    assert.deepEqual([...options.keys()], ['--output']);
    const destination = workspaceOutput(ROOT, options.get('--output')), inventory = await captureInventory();
    await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(inventory, null, 2) + '\n');
    console.log(JSON.stringify({ file: path.relative(ROOT, destination), readOnly: true, applied: inventory.journal.length, objects: inventory.objects.length, noBusinessRowsRecorded: true })); return;
  }
  assert.equal(action, 'plan', 'Use capture --output <qa.json> or plan --snapshot <inventory.json> --output <qa-directory>');
  assert.equal(options.size, 2); assert.ok(options.has('--snapshot') && options.has('--output'));
  const destination = workspaceOutput(ROOT, options.get('--output')), snapshot = JSON.parse(await readFile(options.get('--snapshot'), 'utf8'));
  const catalog = await migrationCatalog(), plan = buildPlan(snapshot, catalog);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'db-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  await writeFile(path.join(destination, 'db-verify-before.sql'), verificationSql(snapshot, plan, 'before'));
  await writeFile(path.join(destination, 'db-verify-after.sql'), verificationSql(snapshot, plan, 'after'));
  await writeFile(path.join(destination, 'db-migration-order.txt'), plan.pending.map((entry, index) => `${index + 1}. ${entry.file} SHA256=${entry.sha256}${entry.rebuildsTable ? ' [TABLE REBUILD: BACKUP REQUIRED]' : ''}`).join('\n') + '\n');
  console.log(JSON.stringify({ output: path.relative(ROOT, destination), pending: plan.pending.length, schemaMatchesJournal: plan.gates.schemaMatchesJournal, offlineChecksPassed: plan.checks.passed, productionReady: false, remoteMutationPerformed: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`DB preparation stopped: ${error.message}`); process.exitCode = 1; }
}
