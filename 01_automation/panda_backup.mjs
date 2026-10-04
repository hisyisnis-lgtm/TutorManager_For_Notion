// Panda-only snapshots. Never export or restore the shared game/member tables.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup as backupSqlite, constants as sql } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile, open } from 'node:fs/promises';
import { parsePandaProfile, pandaAvailable } from '../worker/lib/pandaRules.js';

export const PANDA_TABLES = Object.freeze(['student_panda_profiles', 'student_panda_actions']);
export const PANDA_DATABASE = 'tone-game-users';
const MAX_SQL_BYTES = 128 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function pandaExportArgs(output) {
  return ['d1', 'export', PANDA_DATABASE, '--remote', '--table', ...PANDA_TABLES, '--output', output, '--skip-confirmation'];
}

function importAuthorizer(code, name, detail, database) {
  if (database && database !== 'main') return sql.SQLITE_DENY;
  if (code === sql.SQLITE_CREATE_TABLE) return PANDA_TABLES.includes(name) ? sql.SQLITE_OK : sql.SQLITE_DENY;
  if (code === sql.SQLITE_CREATE_INDEX) return PANDA_TABLES.includes(detail) ? sql.SQLITE_OK : sql.SQLITE_DENY;
  if (code === sql.SQLITE_INSERT || code === sql.SQLITE_READ) {
    return PANDA_TABLES.includes(name) || name === 'sqlite_master' ? sql.SQLITE_OK : sql.SQLITE_DENY;
  }
  if (code === sql.SQLITE_UPDATE) return name === 'sqlite_master' ? sql.SQLITE_OK : sql.SQLITE_DENY;
  if (code === sql.SQLITE_PRAGMA) return ['foreign_keys', 'defer_foreign_keys'].includes(name) ? sql.SQLITE_OK : sql.SQLITE_DENY;
  if ([sql.SQLITE_TRANSACTION, sql.SQLITE_SELECT].includes(code)) return sql.SQLITE_OK;
  // No ATTACH, triggers, views, virtual tables, extension functions or file writes.
  return sql.SQLITE_DENY;
}

function checkDatabase(db) {
  assert.equal(db.isTransaction, false, '완료되지 않은 SQL 트랜잭션입니다.');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, [...PANDA_TABLES].sort(), '판다 테이블 2개만 포함해야 합니다.');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'SQLite 무결성 검사에 실패했습니다.');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, '판다 참조 무결성 검사에 실패했습니다.');
  const required = {
    student_panda_profiles: ['student_id', 'profile', 'revision', 'earned_total', 'legacy_migrated', 'last_request_id', 'created_at', 'updated_at'],
    student_panda_actions: ['student_id', 'request_id', 'action_json', 'profile', 'revision', 'earned_total', 'created_at'],
  };
  const counts = {};
  const transitionColumns = ['transition_version', 'transition_initialized_at', 'transition_starting_food', 'transition_notice_seen'];
  const profileColumns = db.prepare('PRAGMA table_info(student_panda_profiles)').all().map(row => row.name);
  const hasTransition = transitionColumns.some(column => profileColumns.includes(column));
  if (hasTransition) {
    required.student_panda_profiles.push(...transitionColumns);
    required.student_panda_actions.push('transition_version');
  }
  for (const table of PANDA_TABLES) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    assert.ok(required[table].every(column => columns.includes(column)), '판다 필수 컬럼이 누락되었습니다.');
    counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    for (const row of db.prepare(`SELECT profile, revision, earned_total FROM ${table}`).iterate()) {
      assert.ok(Number.isSafeInteger(row.revision) && row.revision >= 0, '판다 수정 버전이 올바르지 않습니다.');
      assert.ok(Number.isSafeInteger(row.earned_total) && row.earned_total >= 0, '먹이 획득량이 올바르지 않습니다.');
      // Use the exact server validator, including the current wardrobe catalog.
      // Validation may normalize a copy; exported/archived row bytes stay untouched.
      const profile = parsePandaProfile(JSON.parse(row.profile));
      assert.ok(profile, '서버가 복원할 수 없는 판다 프로필입니다.');
      pandaAvailable(profile, row.earned_total);
    }
  }
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM student_panda_actions a
    LEFT JOIN student_panda_profiles p ON p.student_id = a.student_id
    WHERE p.student_id IS NULL OR a.revision > p.revision OR a.earned_total > p.earned_total
      OR NOT json_valid(a.action_json)`).get().count, 0, '판다 거래 이력이 현재 기록과 맞지 않습니다.');
  if (hasTransition) {
    for (const row of db.prepare('SELECT transition_version, transition_initialized_at, transition_starting_food, transition_notice_seen, earned_total FROM student_panda_profiles').iterate()) {
      assert.ok(Number.isSafeInteger(row.transition_version) && row.transition_version >= 0
        && Number.isSafeInteger(row.transition_starting_food) && row.transition_starting_food >= 0
        && row.transition_starting_food <= row.earned_total && [0, 1].includes(row.transition_notice_seen), '판다 전환 기록이 올바르지 않습니다.');
      if (row.transition_version > 0) assert.ok(Number.isFinite(Date.parse(row.transition_initialized_at)), '판다 전환 시각이 없습니다.');
    }
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM student_panda_actions a
      JOIN student_panda_profiles p ON p.student_id = a.student_id
      WHERE typeof(a.transition_version) <> 'integer' OR a.transition_version < 0
        OR a.transition_version > p.transition_version`).get().count, 0, '판다 전환 거래 이력이 올바르지 않습니다.');
  }
  return counts;
}

export function openPandaSnapshot(source) {
  assert.ok(Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= MAX_SQL_BYTES, '백업 SQL 크기를 확인하세요.');
  const db = new DatabaseSync(':memory:', { allowExtension: false, defensive: true });
  try {
    // D1 can export child rows before parents. Validate references after the full import.
    db.exec('PRAGMA foreign_keys=OFF');
    db.setAuthorizer(importAuthorizer);
    try { db.exec(source.toString('utf8')); } finally { db.setAuthorizer(null); }
    const counts = checkDatabase(db);
    return { db, counts };
  } catch {
    db.close();
    // SQLite errors can contain raw SQL/profile data. Only this fixed message is logged.
    throw new Error('판다 백업 검사 실패: SQL 범위·필수 테이블·먹이·거래 무결성을 확인하세요.');
  }
}

export function makePandaBundle(source, createdAt = new Date().toISOString()) {
  const { db, counts } = openPandaSnapshot(source);
  db.close();
  const compressed = gzipSync(source);
  return { compressed, receipt: { schema: 1, status: 'complete', database: PANDA_DATABASE,
    createdAt, tables: [...PANDA_TABLES], counts, sql: { bytes: Buffer.byteLength(source), sha256: digest(source) },
    gzip: { bytes: compressed.length, sha256: digest(compressed) } } };
}

export async function readPandaBundle(input, receiptPath) {
  const [compressed, receiptText] = await Promise.all([readFile(input), readFile(receiptPath, 'utf8')]);
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.schema, 1, '지원하지 않는 백업 형식입니다.');
  assert.equal(receipt.status, 'complete', '완료된 백업 표식이 필요합니다.');
  assert.equal(receipt.database, PANDA_DATABASE, '판다 DB 백업이 아닙니다.');
  assert.deepEqual(receipt.tables, [...PANDA_TABLES], '판다 이외의 테이블 복구는 허용하지 않습니다.');
  assert.equal(compressed.length, receipt.gzip?.bytes, '압축 파일 크기가 다릅니다.');
  assert.equal(digest(compressed), receipt.gzip?.sha256, '압축 파일 해시가 다릅니다.');
  const source = gunzipSync(compressed, { maxOutputLength: MAX_SQL_BYTES });
  assert.equal(source.length, receipt.sql?.bytes, 'SQL 파일 크기가 다릅니다.');
  assert.equal(digest(source), receipt.sql?.sha256, 'SQL 파일 해시가 다릅니다.');
  const checked = openPandaSnapshot(source);
  try { assert.deepEqual(checked.counts, receipt.counts, '백업 행 수가 다릅니다.'); }
  catch (error) { checked.db.close(); throw error; }
  return { ...checked, receipt };
}

export async function writePandaBundle(source, output, receiptPath) {
  const { compressed, receipt } = makePandaBundle(source);
  await writeFile(output, compressed, { mode: 0o600, flag: 'wx' });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return receipt;
}

export async function restorePandaLocally(input, receiptPath, localOutput) {
  const checked = await readPandaBundle(input, receiptPath);
  try {
    if (localOutput) {
      assert.match(localOutput, /\.sqlite$/, '격리 복구 파일은 .sqlite 확장자여야 합니다.');
      // Reserve a new file exclusively: never overwrite an existing database.
      const file = await open(localOutput, 'wx', 0o600);
      await file.close();
      await backupSqlite(checked.db, localOutput);
    }
    return { createdAt: checked.receipt.createdAt, counts: checked.counts, restoredLocally: !!localOutput };
  } finally { checked.db.close(); }
}
