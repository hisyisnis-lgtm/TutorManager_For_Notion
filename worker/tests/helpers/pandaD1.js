import { readFileSync } from 'node:fs';
import { localD1 } from './localD1.js';

// Real SQLite transactions are essential here: profile and idempotency receipt must
// roll back together. The generic helper's independent Promise.all writes cannot prove it.
export function pandaD1() {
  const local = localD1();
  local.sqlite.exec(readFileSync(new URL('../../migrations/0005_student_panda.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../../migrations/0006_panda_transition.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = local.sqlite.prepare(sql);
      const bound = (args = []) => ({
        bind: (...params) => bound(params),
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ success: true, meta: statement.run(...args) }),
        runSync: () => ({ success: true, meta: statement.run(...args) }),
      });
      return bound();
    },
    async batch(statements) {
      local.sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.runSync());
        local.sqlite.exec('COMMIT');
        return results;
      } catch (error) { local.sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { ...local, db };
}
