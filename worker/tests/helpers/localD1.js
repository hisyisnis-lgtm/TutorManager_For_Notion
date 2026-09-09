// Execute production SQL against an isolated SQLite database; no network or real bindings.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0002_security_state.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0001_game_users.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0003_web_push.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (args = []) => ({
        bind: (...params) => bound(params),
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ success: true, meta: statement.run(...args) }),
      });
      return bound();
    },
    batch: async statements => Promise.all(statements.map(statement => statement.run())),
  };
  return { db, sqlite, close: () => sqlite.close() };
}
