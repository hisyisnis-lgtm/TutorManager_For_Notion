import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkPandaRelease, pandaContractHash } from './panda-release-check.mjs';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('panda-release-'));
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'panda-release-')); roots.push(root);
  const put = async (file, text) => { const name = path.join(root, file); await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, text); };
  for (const file of ['worker/migrations/0005_student_panda.sql', 'worker/migrations/0006_panda_transition.sql', 'worker/lib/pandaRules.js', 'worker/lib/pandaDb.js', 'worker/lib/pandaRoutes.js', '03_data/panda/wardrobe.json']) await put(file, file);
  await put('04_docs/qa/panda-rollout.md', 'Isolated rollout evidence');
  const now = Date.parse('2026-09-29T00:00:00Z');
  const env = { VITE_PANDA_SERVER_PERSISTENCE: 'true', VITE_WORKER_URL: 'https://worker.example' };
  const record = { schema: 1, status: 'verified', workerOrigin: env.VITE_WORKER_URL,
    workerVersion: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', contractHash: await pandaContractHash(root), verifiedAt: new Date(now).toISOString(),
    checks: { d1Migration: true, authenticatedReadWrite: true, retryWithoutDoubleDebit: true, secondDeviceSync: true, transitionOnce: true, backupRestore: true }, evidence: '04_docs/qa/panda-rollout.md' };
  const save = () => put('04_docs/releases/panda-readiness.json', JSON.stringify(record));
  await save(); return { root, env, record, now, put, save };
}
test('local mode, unverified rollout, wrong origin, and changed rules cannot release', async () => {
  const f = await fixture();
  await assert.rejects(checkPandaRelease({ ...f, env: { ...f.env, VITE_PANDA_SERVER_PERSISTENCE: 'false' } }), /로컬/);
  f.record.status = 'pending'; await f.save(); await assert.rejects(checkPandaRelease(f), /아직/);
  f.record.status = 'verified'; await f.save();
  await assert.rejects(checkPandaRelease({ ...f, env: { ...f.env, VITE_WORKER_URL: 'https://other.example' } }), /다릅니다/);
  await f.put('worker/lib/pandaRules.js', 'changed'); await assert.rejects(checkPandaRelease(f), /변경/);
});
test('every rollout check, recent evidence, and valid paths are required', async () => {
  const f = await fixture();
  assert.equal((await checkPandaRelease(f)).contractHash, f.record.contractHash);
  f.record.checks.secondDeviceSync = false; await f.save(); await assert.rejects(checkPandaRelease(f), /secondDeviceSync/);
  f.record.checks.secondDeviceSync = true; f.record.evidence = '04_docs/../secret.md'; await f.save(); await assert.rejects(checkPandaRelease(f), /04_docs/);
  f.record.evidence = '04_docs/qa/panda-rollout.md'; await f.save();
  await assert.rejects(checkPandaRelease({ ...f, now: f.now + 31 * 86400000 }), /30일/);
});

test('transition migration and rollout/backup evidence cannot be skipped', async () => {
  const f = await fixture();
  for (const key of ['transitionOnce', 'backupRestore']) {
    delete f.record.checks[key]; await f.save();
    await assert.rejects(checkPandaRelease(f), new RegExp(key));
    f.record.checks[key] = true;
  }
  await f.save();
  await f.put('worker/migrations/0006_panda_transition.sql', 'changed transition');
  await assert.rejects(checkPandaRelease(f), /변경/);
});

test('contract fingerprint is stable across Git LF and CRLF checkouts', async () => {
  const f = await fixture();
  const file = 'worker/lib/pandaRules.js';
  await f.put(file, 'const first = 1;\nconst second = 2;\n');
  const lf = await pandaContractHash(f.root);
  await f.put(file, 'const first = 1;\r\nconst second = 2;\r\n');
  assert.equal(await pandaContractHash(f.root), lf);
  await f.put(file, 'const first = 3;\r\nconst second = 2;\r\n');
  assert.notEqual(await pandaContractHash(f.root), lf);
});
