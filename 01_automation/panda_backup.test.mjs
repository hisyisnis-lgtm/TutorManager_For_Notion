import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePandaBundle, openPandaSnapshot, pandaExportArgs, readPandaBundle, restorePandaLocally, writePandaBundle } from './panda_backup.mjs';
import { exportPandaBackup, main as backupMain } from './backup_panda_to_r2.mjs';
import { main as restoreMain } from '../02_devtools/restore-panda-backup.mjs';
import { newPandaProfile, PANDA_ITEMS, PANDA_PRICES, PANDA_SLOTS } from '../worker/lib/pandaRules.js';
import catalog from '../03_data/panda/wardrobe.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [];
const profile = { ...newPandaProfile(), fedTotal: 112, nickname: "랴오'랴오", namingPromptSeen: true };
const quote = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;

function fixture({ transition = true, earned = 169, actionStudent = 'fixture-student', actionRevision = 1, actionEarned = earned,
  profileRow = profile, actionProfile = profileRow } = {}) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(path.join(ROOT, 'worker/migrations/0005_student_panda.sql'), 'utf8'));
    if (transition) db.exec(readFileSync(path.join(ROOT, 'worker/migrations/0006_panda_transition.sql'), 'utf8'));
    const schemas = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => `${row.sql};`).join('\n');
    const extra = transition ? ', transition_version, transition_initialized_at, transition_starting_food, transition_notice_seen' : '';
    const extraValues = transition ? ", 1, '2026-09-30T00:00:00Z', 169, 0" : '';
    const values = ['fixture-student', JSON.stringify(profileRow), 2, earned, 1, 'fixture-request', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z'].map(quote).join(', ');
    return `PRAGMA defer_foreign_keys=TRUE;\n${schemas}\n`
      + `INSERT INTO student_panda_profiles (student_id,profile,revision,earned_total,legacy_migrated,last_request_id,created_at,updated_at${extra}) VALUES (${values}${extraValues});\n`
      + `INSERT INTO student_panda_actions (student_id,request_id,action_json,profile,revision,earned_total,created_at${transition ? ',transition_version' : ''}) VALUES (${[actionStudent, 'fixture-request', '{"type":"feed"}', JSON.stringify(actionProfile), actionRevision, actionEarned, '2026-09-30T00:00:00Z'].map(quote).join(',')}${transition ? ',1' : ''});\n`;
  } finally { db.close(); }
}

async function files() {
  const root = await mkdtemp(path.join(tmpdir(), 'panda-backup-test-')); roots.push(root);
  return { root, output: path.join(root, 'backup.sql.gz'), receipt: path.join(root, 'backup.complete.json') };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('panda-backup-test-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('only both Panda tables are exported together, never the shared database', () => {
  const args = pandaExportArgs('snapshot.sql');
  assert.deepEqual(args, ['d1', 'export', 'tone-game-users', '--remote', '--table', 'student_panda_profiles', 'student_panda_actions', '--output', 'snapshot.sql', '--skip-confirmation']);
});

test('current and pre-transition tables validate without changing rows or personal text', async () => {
  for (const transition of [false, true]) {
    const f = await files();
    await writePandaBundle(fixture({ transition }), f.output, f.receipt);
    const checked = await readPandaBundle(f.output, f.receipt);
    assert.deepEqual(checked.counts, { student_panda_profiles: 1, student_panda_actions: 1 });
    assert.deepEqual(JSON.parse(checked.db.prepare('SELECT profile FROM student_panda_profiles').get().profile), profile);
    checked.db.close();
  }
});

test('missing/foreign tables, unsafe SQL and partial transitions cannot be completed backups', () => {
  for (const source of [
    '', 'CREATE TABLE student_panda_profiles (student_id TEXT);',
    `${fixture()} CREATE TABLE game_users (id TEXT);`,
    `${fixture()} ATTACH DATABASE ':memory:' AS extra;`,
    `${fixture()} CREATE TRIGGER extra AFTER INSERT ON student_panda_profiles BEGIN DELETE FROM student_panda_profiles; END;`,
    fixture().replace('transition_initialized_at TEXT', 'lost_column TEXT'),
  ]) assert.throws(() => makePandaBundle(source));
});

test('negative balances, missing parent, future revisions and malformed profiles fail closed', () => {
  for (const source of [
    fixture({ earned: 100 }), fixture({ actionStudent: 'missing-parent' }),
    fixture({ actionRevision: 3 }), fixture({ actionEarned: 170 }),
    fixture().replaceAll('"fedTotal":112', '"fedTotal":-1'),
    fixture().replaceAll('"owned":[]', '"owned":["same","same"]'),
    fixture().replace("1, '2026-09-30T00:00:00Z', 169, 0", "1, NULL, 169, 0"),
  ]) assert.throws(() => openPandaSnapshot(source), /판다 백업 검사 실패/);
});

test('both current and receipt profiles must meet every server wardrobe and nickname rule', () => {
  const item = PANDA_ITEMS[0];
  const slot = item.split(':')[1];
  const otherSlot = PANDA_SLOTS.find(key => key !== slot);
  const dressed = { ...structuredClone(profile), spentFood: PANDA_PRICES[slot], owned: [item],
    equipped: { ...profile.equipped, [slot]: item }, purchasePrices: { [item]: PANDA_PRICES[slot] } };
  const invalid = [
    { ...profile, equipped: {} },
    { ...profile, equipped: { ...profile.equipped, extra: null } },
    { ...profile, owned: ['unknown:hat'] },
    { ...profile, equipped: { ...profile.equipped, [slot]: 'unknown:hat' } },
    { ...profile, equipped: { ...profile.equipped, [slot]: item } },
    { ...dressed, equipped: { ...profile.equipped, [otherSlot]: item } },
    { ...dressed, fedTotal: 0 },
    { ...dressed, purchasePrices: {} },
    { ...dressed, purchasePrices: { ...dressed.purchasePrices, [PANDA_ITEMS[1]]: 1 } },
    { ...dressed, purchasePrices: { [item]: -1 } },
    { ...profile, nickname: '잘못된\n이름' },
    { ...profile, nickname: '🐼'.repeat(catalog.nameMaxLength + 1) },
    { ...profile, namingPromptSeen: 'true' },
    { ...profile, unknown: true },
  ];
  for (const broken of invalid) {
    assert.throws(() => makePandaBundle(fixture({ profileRow: broken, actionProfile: profile })), /판다 백업 검사 실패/);
    assert.throws(() => makePandaBundle(fixture({ profileRow: profile, actionProfile: broken })), /판다 백업 검사 실패/);
  }
  const { purchasePrices: _oldPrices, ...legacyDressed } = dressed;
  for (const accepted of [dressed, legacyDressed, { ...profile, nickname: ' 랴오랴오 ' }]) {
    const checked = openPandaSnapshot(fixture({ profileRow: accepted }));
    assert.deepEqual(JSON.parse(checked.db.prepare('SELECT profile FROM student_panda_profiles').get().profile), accepted);
    checked.db.close();
  }
});

test('adult wardrobe backups require the new 40-food level thresholds and preserve earned balance', () => {
  for (const [set, threshold, previousThreshold] of [['strawberry', 152, 144], ['reader', 192, 176]]) {
    const item = `${set}:hat`;
    const dressed = { ...structuredClone(profile), fedTotal: threshold, spentFood: PANDA_PRICES.hat,
      owned: [item], equipped: { ...profile.equipped, hat: item }, purchasePrices: { [item]: PANDA_PRICES.hat } };
    const checked = openPandaSnapshot(fixture({ earned: 200, profileRow: dressed }));
    const restored = checked.db.prepare('SELECT profile, earned_total FROM student_panda_profiles').get();
    assert.deepEqual(JSON.parse(restored.profile), dressed);
    assert.equal(restored.earned_total - dressed.fedTotal - dressed.spentFood, 200 - threshold - PANDA_PRICES.hat);
    checked.db.close();
    for (const fedTotal of [previousThreshold, threshold - 1]) {
      const locked = { ...dressed, fedTotal };
      assert.throws(() => makePandaBundle(fixture({ earned: 200, profileRow: locked, actionProfile: dressed })), /판다 백업 검사 실패/);
      assert.throws(() => makePandaBundle(fixture({ earned: 200, profileRow: dressed, actionProfile: locked })), /판다 백업 검사 실패/);
    }
  }
});

test('backups preserve historical 8-food hats separately from newly purchased 6-food hats', () => {
  assert.equal(PANDA_PRICES.hat, 6);
  for (const purchasePrice of [8, 6]) {
    const dressed = { ...structuredClone(profile), spentFood: purchasePrice, owned: ['gardener:hat'],
      equipped: { ...profile.equipped, hat: 'gardener:hat' }, purchasePrices: { 'gardener:hat': purchasePrice } };
    const checked = openPandaSnapshot(fixture({ profileRow: dressed }));
    for (const table of ['student_panda_profiles', 'student_panda_actions']) {
      const restored = JSON.parse(checked.db.prepare(`SELECT profile FROM ${table}`).get().profile);
      assert.deepEqual(restored, dressed);
      assert.equal(Math.floor(restored.purchasePrices['gardener:hat'] / catalog.economy.saleRefundDivisor), purchasePrice === 8 ? 4 : 3);
    }
    checked.db.close();
  }
});

test('receipt tampering and compressed-file corruption cannot pass verification', async () => {
  const f = await files();
  await writePandaBundle(fixture(), f.output, f.receipt);
  const receipt = JSON.parse(await readFile(f.receipt, 'utf8'));
  await writeFile(f.receipt, JSON.stringify({ ...receipt, counts: { student_panda_profiles: 0, student_panda_actions: 1 } }));
  await assert.rejects(readPandaBundle(f.output, f.receipt), /행 수/);
  await writeFile(f.receipt, JSON.stringify(receipt));
  const bytes = await readFile(f.output); bytes[bytes.length - 1] ^= 1;
  await writeFile(f.output, bytes);
  await assert.rejects(readPandaBundle(f.output, f.receipt), /해시/);
});

test('restore defaults to inspection, creates only a new local DB, and refuses existing DB and remote flags', async () => {
  const f = await files();
  await writePandaBundle(fixture(), f.output, f.receipt);
  assert.equal((await restorePandaLocally(f.output, f.receipt)).restoredLocally, false);
  const local = path.join(f.root, 'isolated.sqlite');
  assert.equal((await restorePandaLocally(f.output, f.receipt, local)).restoredLocally, true);
  const db = new DatabaseSync(local, { readOnly: true });
  assert.equal(db.prepare('SELECT earned_total FROM student_panda_profiles').get().earned_total, 169);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  await assert.rejects(restorePandaLocally(f.output, f.receipt, local), { code: 'EEXIST' });
  await assert.rejects(restoreMain(['--remote', '--input', f.output, '--receipt', f.receipt]), /Unknown option/);
});

test('export orchestration suppresses provider output and writes a completion marker only after inspection', async () => {
  const f = await files();
  let calls = 0;
  const run = (command, args, options) => {
    calls += 1;
    assert.equal(command, process.execPath);
    assert.equal(options.stdio, 'pipe');
    assert.equal(options.windowsHide, true);
    assert.deepEqual(args.slice(1, 8), ['d1', 'export', 'tone-game-users', '--remote', '--table', 'student_panda_profiles', 'student_panda_actions']);
    writeFileSync(args[args.indexOf('--output') + 1], fixture());
  };
  await exportPandaBackup({ ...f, run });
  assert.equal(calls, 1);
  await access(f.receipt);
  const bad = await files();
  await assert.rejects(exportPandaBackup({ ...bad, run: (_command, args) => writeFileSync(args[args.indexOf('--output') + 1], 'CREATE TABLE game_users (id TEXT);') }), /판다 백업 검사 실패/);
  await assert.rejects(access(bad.receipt), { code: 'ENOENT' });
  const failed = await files();
  await assert.rejects(exportPandaBackup({ ...failed, run: () => { throw new Error('secret-output'); } }), error => !error.message.includes('secret-output'));
  await assert.rejects(exportPandaBackup({ ...failed, run: () => { throw Object.assign(new Error('secret-output'), { stderr: 'private-token student-name [code: 7403]' }); } }), error => {
    assert.deepEqual(error.providerCodes, ['7403']);
    assert.ok(!JSON.stringify(error).includes('private-token') && !error.message.includes('student-name'));
    return true;
  });
  await assert.rejects(backupMain([]), /명시적인/);
});

test('installed Wrangler exports only Panda tables from a fresh local D1 database', async () => {
  const f = await files();
  const config = path.join(f.root, 'wrangler.json');
  const input = path.join(f.root, 'fixture.sql');
  const output = path.join(f.root, 'export.sql');
  await writeFile(config, JSON.stringify({ name: 'panda-backup-local-test', compatibility_date: '2026-09-01',
    d1_databases: [{ binding: 'GAME_DB', database_name: 'tone-game-users', database_id: '00000000-0000-0000-0000-000000000001' }] }));
  await writeFile(input, `${fixture()}\nCREATE TABLE game_users (id TEXT); INSERT INTO game_users VALUES ('member-must-not-be-exported');`);
  const wrangler = path.join(ROOT, 'worker/node_modules/wrangler/bin/wrangler.js');
  const options = { cwd: f.root, stdio: 'pipe', windowsHide: true, timeout: 60000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(f.root, 'wrangler.log') } };
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'tone-game-users', '--local', '--config', config, '--file', input], options);
  execFileSync(process.execPath, [wrangler, ...pandaExportArgs(output).map(arg => arg === '--remote' ? '--local' : arg), '--config', config], options);
  const source = await readFile(output, 'utf8');
  assert.ok(!source.includes('game_users'));
  assert.ok(!source.includes('member-must-not-be-exported'));
  const bundle = makePandaBundle(source);
  assert.deepEqual(bundle.receipt.counts, { student_panda_profiles: 1, student_panda_actions: 1 });
});
