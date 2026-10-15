import { describe, it, expect } from 'vitest';
import * as miniflare from 'miniflare';
import { migrationCatalog, replay, couponFixture } from '../../02_devtools/site-db-release-plan.mjs';

// The reviewed migration files put statement ends on their own final line.
// Preserve CREATE TRIGGER bodies instead of splitting their inner semicolons.
function statements(sql) {
  const result = []; let pending = '';
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line) || !line.trim()) continue;
    pending += line + '\n';
    if (/^\s*CREATE\s+TRIGGER\b/i.test(pending) ? /\bEND;\s*$/.test(pending) : /;\s*$/.test(line)) { result.push(pending.trim()); pending = ''; }
  }
  expect(pending.trim()).toBe(''); return result;
}
const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const identifier = name => { expect(name).toMatch(/^[a-z][a-z0-9_]*$/); return `"${name}"`; };
async function fixture() {
  const catalog = await migrationCatalog(), baseline = replay(catalog, 27); couponFixture(baseline);
  const at = '2026-10-01T00:00:00Z';
  baseline.prepare("INSERT INTO site_member_identities VALUES('google','synthetic-google','synthetic-member',NULL,?)").run(at);
  baseline.prepare("INSERT INTO site_sessions VALUES('synthetic-session','synthetic-token','synthetic-csrf','synthetic-member',9999999999,NULL,?)").run(at);
  baseline.prepare("INSERT INTO site_student_links VALUES('synthetic-member',?,'synthetic','teacher')").run('b'.repeat(32));
  baseline.prepare("INSERT INTO site_student_identity_claims VALUES(?,'synthetic-member',?)").run('b'.repeat(32), at);
  baseline.prepare(`INSERT INTO site_student_enrollments(member_id,idempotency_key,mode,target_student_id,student_id,member_snapshot,state,created_at,updated_at)
    VALUES('synthetic-member','synthetic-enrollment','existing',?,?,?,'granted',?,?)`).run('b'.repeat(32), 'b'.repeat(32), '{"name":"합성"}', at, at);
  baseline.prepare(`INSERT INTO reviews(id,member_id,latest_content,created_at,updated_at,idempotency_key_hash,request_hash,request_expires_at)
    VALUES('synthetic-review','synthetic-member',?,?,?,'synthetic-review-key','synthetic-review-request',9999999999)`).run('{"body":"합성 후기"}', at, at);
  const tables = baseline.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const inserts = tables.flatMap(table => baseline.prepare(`SELECT * FROM ${identifier(table)}`).all().map(row =>
    `INSERT OR IGNORE INTO ${identifier(table)}(${Object.keys(row).map(identifier).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`));
  baseline.close();
  const options = { modules: true, script: 'export default {fetch(){return new Response("isolated");}}', compatibilityDate: '2026-04-27', cf: false,
    log: new miniflare.Log(miniflare.LogLevel.NONE), d1Databases: { GAME_DB: 'isolated-site-phone-migration' },
    outboundService: async () => new Response('Real network forbidden', { status: 599 }) };
  const runtime = new miniflare.Miniflare(miniflare.convertV4MiniflareOptions ? miniflare.convertV4MiniflareOptions(options) : options);
  try {
    const db = await runtime.getD1Database('GAME_DB');
    for (const entry of catalog.slice(0, 27)) await db.batch(statements(entry.sql).map(sql => db.prepare(sql)));
    await db.batch(['PRAGMA defer_foreign_keys=ON', ...inserts, 'PRAGMA defer_foreign_keys=OFF'].map(sql => db.prepare(sql)));
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    return { runtime, db, tables, sql: catalog[27].sql };
  } catch (error) { await runtime.dispose(); throw error; }
}
const rows = async (db, table) => (await db.prepare(`SELECT * FROM ${identifier(table)} ORDER BY 1,2`).all()).results;
const schemas = async db => (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all()).results;

describe('0028 actual workerd D1 parent and identity migration', () => {
  it('preserves IDs, all child rows/FKs, existing indexes and the suspension trigger in one D1 batch', async () => {
    const { runtime, db, tables, sql } = await fixture();
    try {
      const beforeRows = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(db, table)])));
      const beforeFk = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all()).results])));
      const beforeSchema = await schemas(db);
      await db.batch(statements(sql).map(statement => db.prepare(statement)));
      for (const table of tables) {
        expect(await rows(db, table), table).toEqual(beforeRows[table]);
        expect((await db.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all()).results, table).toEqual(beforeFk[table]);
      }
      const after = await schemas(db);
      for (const row of beforeSchema.filter(row => row.type === 'index' || row.type === 'trigger')) {
        const next = after.find(item => item.name === row.name); expect(next, row.name).toBeDefined();
        expect(next.sql.replace(/\s+/g, ' '), row.name).toBe(row.sql.replace(/\s+/g, ' '));
      }
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
      await db.prepare("UPDATE site_members SET status='suspended' WHERE id='synthetic-member'").run();
      expect((await db.prepare("SELECT revoked_at FROM site_sessions WHERE id='synthetic-session'").first()).revoked_at).not.toBeNull();
      await db.prepare(`INSERT INTO site_members(id,status,name,phone,member_code,customer_key,provider,provider_subject,created_at,updated_at)
        VALUES('synthetic-phone','active','합성','01011112222','PHONE-CODE','PHONE-CUSTOMER','phone','+821011112222','synthetic','synthetic')`).run();
      await db.prepare("INSERT INTO site_member_identities VALUES('phone','+821011112222','synthetic-phone',NULL,'synthetic')").run();
    } finally { await runtime.dispose(); }
  }, 60000);
  it('fails the FK guard and rolls the entire D1 migration back if any child would be orphaned', async () => {
    const { runtime, db, tables, sql } = await fixture();
    try {
      const before = await schemas(db), beforeRows = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(db, table)])));
      const broken = sql.replace('CREATE TABLE site_phone_migration_fk_guard', "UPDATE site_shop_orders SET member_id='missing-synthetic-member';\nCREATE TABLE site_phone_migration_fk_guard");
      await expect(db.batch(statements(broken).map(statement => db.prepare(statement)))).rejects.toThrow();
      expect(await schemas(db)).toEqual(before);
      for (const table of tables) expect(await rows(db, table)).toEqual(beforeRows[table]);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await runtime.dispose(); }
  }, 60000);
});
