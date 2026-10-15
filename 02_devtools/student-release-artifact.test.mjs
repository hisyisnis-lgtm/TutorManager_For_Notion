import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertStudentText, packageStudentArtifact, STUDENT_REPOSITORY, STUDENT_WORKFLOW } from './student-release-artifact.mjs';

const sourceCommit = 'a'.repeat(40), roots = [];
const context = { repository: STUDENT_REPOSITORY, sourceCommit, runId: '123', runAttempt: '2', workflowRef: `${STUDENT_REPOSITORY}/${STUDENT_WORKFLOW}@refs/heads/main` };
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('student-artifact-source-'));
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(extra = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'student-artifact-source-')); roots.push(root);
  const source = path.join(root, 'build'), output = path.join(root, 'artifact');
  const bodies = { 'index.html': '<html><meta http-equiv="content-security-policy" content="script-src self"><meta name="robots" content="noindex, nofollow"><script src="/personal/assets/main-123.js"></script><link rel="manifest" href="/personal/manifest.webmanifest"></html>',
    'assets/main-123.js': 'export const production = true;', 'sw.js': '/* network-only private pages */',
    'manifest.webmanifest': JSON.stringify({ start_url: '/personal/', scope: '/personal/', icons: [{ src: '/personal/pwa-192x192.png' }] }),
    'pwa-192x192.png': 'install icon', '_headers': 'not a student app file', ...extra };
  for (const [name, bytes] of Object.entries(bodies)) { const file = path.join(source, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); }
  return { source, output };
}

test('학생앱의 배포 파일만 출처와 SHA256을 붙여 독립 사이트용 artifact로 포장한다', async () => {
  const input = await fixture(); const result = await packageStudentArtifact({ ...input, ...context });
  assert.equal(result.artifactName, `student-app-${sourceCommit}`); assert.equal(result.files, 5);
  const provenance = JSON.parse(await readFile(path.join(input.output, 'provenance.json'), 'utf8'));
  assert.equal(provenance.repository, STUDENT_REPOSITORY); assert.equal(provenance.sourceCommit, sourceCommit);
  assert.equal(provenance.workflowRunId, '123'); assert.equal(provenance.workflowRunAttempt, '2');
  assert.equal(provenance.files._headers, undefined);
  assert.equal(provenance.files['assets/main-123.js'], createHash('sha256').update('export const production = true;').digest('hex'));
  assert.equal(await readFile(path.join(input.output, 'dist-student/assets/main-123.js'), 'utf8'), 'export const production = true;');
  await assert.rejects(packageStudentArtifact({ ...input, ...context }), { code: 'EEXIST' });
});

test('학생앱에서 로컬 API·미디어 주소를 발견하면 포장하지 않는다', async () => {
  for (const url of ['http://localhost:4330/api/site/session', 'http://127.0.0.1:4332/panda/image.png', 'https://qa.localhost/logo.png', 'http://[::1]:4330/api/site/session', 'http://0.0.0.0:5173/']) {
    assert.throws(() => assertStudentText('assets/main-123.js', Buffer.from(`fetch("${url}")`)), /loopback/);
  }
  const input = await fixture({ 'assets/qa.js': 'fetch("http://localhost:4332/api/site/session")' });
  await assert.rejects(packageStudentArtifact({ ...input, ...context }), /loopback/);
});

test('React Router vendor의 URL 파싱 기본값만 허용하며 vendor 안의 로컬 요청도 거부한다', () => {
  assert.doesNotThrow(() => assertStudentText('assets/vendor-Abc123.js', Buffer.from('new URL("http://localhost")')));
  assert.throws(() => assertStudentText('assets/vendor-Abc123.js', Buffer.from('fetch("http://localhost:4330")')), /loopback/);
  assert.throws(() => assertStudentText('assets/main-123.js', Buffer.from('fetch("http://localhost")')), /loopback/);
});

test('필수 학생앱 문서·설치 범위·실행 자산이 틀리면 출처 파일을 만들지 않는다', async () => {
  const input = await fixture({ 'manifest.webmanifest': JSON.stringify({ start_url: '/', scope: '/' }) });
  await assert.rejects(packageStudentArtifact({ ...input, ...context }), /personal/);
  const missing = await fixture({ 'index.html': '<html><meta http-equiv="content-security-policy" content="script-src self"><meta name="robots" content="noindex, nofollow"><script src="/personal/assets/missing.js"></script></html>' });
  await assert.rejects(packageStudentArtifact({ ...missing, ...context }), /참조한 자산 누락/);
});

test('출처가 다른 저장소·workflow이거나 정확한 SHA·run 정보가 없으면 거부한다', async () => {
  const input = await fixture();
  for (const change of [{ repository: 'other/repo' }, { sourceCommit: 'main' }, { runId: '' }, { runAttempt: '0' }, { workflowRef: `${STUDENT_REPOSITORY}/.github/workflows/other.yml@refs/heads/main` }]) {
    await assert.rejects(packageStudentArtifact({ ...input, ...context, ...change }));
  }
});
