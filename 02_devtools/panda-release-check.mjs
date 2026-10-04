// A local Panda preview must never accidentally become the student release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function pandaContractHash(root = ROOT) {
  const files = ['worker/migrations/0005_student_panda.sql', 'worker/migrations/0006_panda_transition.sql', 'worker/lib/pandaRules.js',
    'worker/lib/pandaDb.js', 'worker/lib/pandaRoutes.js', '03_data/panda/wardrobe.json'];
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
  return hash.digest('hex');
}

export async function checkPandaRelease({ root = ROOT, env = process.env, now = Date.now() } = {}) {
  assert.equal(env.VITE_PANDA_SERVER_PERSISTENCE, 'true',
    '학생 출시에는 VITE_PANDA_SERVER_PERSISTENCE=true가 필요합니다. 로컬 미리보기 저장 모드는 출시할 수 없습니다.');
  const record = JSON.parse(await readFile(path.join(root, '04_docs/releases/panda-readiness.json'), 'utf8'));
  assert.equal(record.schema, 1, '판다 출시 확인 기록 형식을 확인하세요.');
  assert.equal(record.status, 'verified', '판다 Worker·D1·인증 계정 확인이 아직 완료되지 않았습니다.');
  assert.equal(record.workerOrigin, new URL(env.VITE_WORKER_URL).origin, '판다 검증 대상과 출시 Worker가 다릅니다.');
  assert.match(record.workerVersion || '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, '검증한 Worker 버전 ID가 필요합니다.');
  assert.equal(record.contractHash, await pandaContractHash(root), '검증 후 판다 서버 규칙/마이그레이션/카탈로그가 변경되었습니다.');
  const age = now - Date.parse(record.verifiedAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 30 * 86400000, '최근 30일 이내의 출시 확인 기록이 필요합니다.');
  for (const check of ['d1Migration', 'authenticatedReadWrite', 'retryWithoutDoubleDebit', 'secondDeviceSync', 'transitionOnce', 'backupRestore']) {
    assert.equal(record.checks?.[check], true, `판다 출시 확인 누락: ${check}`);
  }
  assert.match(record.evidence || '', /^04_docs\/[\w./-]+\.md$/, '저장된 검수 근거 문서가 필요합니다.');
  assert.ok(!record.evidence.split('/').includes('..'), '근거 문서는 04_docs 안에 있어야 합니다.');
  assert.ok((await readFile(path.join(root, record.evidence), 'utf8')).trim().length > 0, '빈 검수 근거입니다.');
  return { workerVersion: record.workerVersion, contractHash: record.contractHash, verifiedAt: record.verifiedAt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (process.argv.includes('--hash') ? pandaContractHash().then(console.log) : checkPandaRelease().then(() => console.log('Panda release readiness: PASS')))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
