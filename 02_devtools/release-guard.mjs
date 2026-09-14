#!/usr/bin/env node
// 같은 작업 디렉터리의 검사·산출물·배포를 연결한다. 비밀값/소스 본문은 기록하지 않는다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = {
  pwa: { dist: 'pwa/dist', project: 'tiantian-chinese', url: 'https://tiantian-chinese.pages.dev', routes: ['/', '/personal'] },
  site: { dist: 'site/dist', project: 'tiantianchinese', url: 'https://tiantianchinese.com', routes: ['/', '/lessons/', '/game/', '/game/tone/'] },
  worker: { dist: 'worker/dist-check', url: 'https://tutor-manager-proxy.hisyisnis.workers.dev' },
};
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const recordPath = (root, target) => path.join(root, '.tmp_qa/release-gate', target, 'release.json');
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function safeFile(dir, name) {
  assert.ok(name && !name.includes('\\') && !name.split('/').some(part => part === '..' || part === '.'), '잘못된 산출물 경로');
  const file = path.resolve(dir, name.replace(/^\//, ''));
  assert.ok(file.startsWith(path.resolve(dir) + path.sep), '산출물 경로 이탈');
  return file;
}
export async function inventory(dir) {
  const result = {};
  async function walk(current, prefix = '') {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), '배포 입력에 심볼릭 링크를 사용할 수 없습니다.');
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), name);
      else if (entry.isFile()) result[name] = sha256(await readFile(path.join(current, entry.name)));
    }
  }
  await walk(dir);
  return result;
}
export function sourcePaths(target) {
  const common = ['03_data/consent', '02_devtools/release-guard.mjs', '02_devtools/pages-release.mjs', '02_devtools/release-guard.test.mjs', '02_devtools/release-asset-policy.json', '02_devtools/public-price-check.mjs', '02_devtools/public-price-check.test.mjs'];
  const pwa = ['pwa/src', 'pwa/public', 'pwa/package.json', 'pwa/package-lock.json', 'pwa/index.html', 'pwa/game.html', 'pwa/vite.config.js', 'pwa/vitest.config.js', 'pwa/eslint.config.js', 'pwa/tailwind.config.js', 'pwa/postcss.config.js', '03_data/tone-words', '02_devtools/tone-words-build.mjs', '02_devtools/tone-tts-build.mjs', '02_devtools/gen-game-og-route.mjs', '02_devtools/design-audit.mjs'];
  if (target === 'worker') return [...common, 'worker/src', 'worker/lib', 'worker/tests', 'worker/migrations', 'worker/wrangler.toml', 'worker/package.json', 'worker/package-lock.json', '01_automation', 'pwa/src/game', 'pwa/src/api', 'pwa/src/constants', 'pwa/src/analytics'];
  return [...common, ...pwa, 'site/src', 'site/scripts', ...(target === 'site' ? ['site/public', 'site/package.json', 'site/package-lock.json', 'site/astro.config.mjs', 'site/tsconfig.json'] : []), `.github/workflows/deploy-${target}.yml`];
}
export async function sourceHash(root, target) {
  const result = {};
  for (const name of sourcePaths(target)) {
    if (!existsSync(path.join(root, name))) continue;
    try { result[name] = sha256(await readFile(path.join(root, name))); }
    catch (error) {
      if (error.code !== 'EISDIR' && error.code !== 'EPERM') throw error;
      for (const [file, hash] of Object.entries(await inventory(path.join(root, name)))) result[name + file] = hash;
    }
  }
  assert.ok(Object.keys(result).length, '검사할 소스가 없습니다.');
  return sha256(JSON.stringify(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))));
}
function npmPath() {
  const bin = path.dirname(process.execPath);
  const options = [process.env.npm_execpath, path.join(bin, 'node_modules/npm/bin/npm-cli.js'), path.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js'), '/usr/share/nodejs/npm/bin/npm-cli.js'];
  const found = options.find(file => file && existsSync(file));
  assert.ok(found, '설치된 npm CLI 경로를 찾을 수 없습니다. npm run을 통해 실행해 주세요.');
  return found;
}
export function runCommand(kind, args, cwd, { capture = false, env = {} } = {}) {
  const bin = kind === 'git' ? 'git' : process.execPath;
  const commandArgs = kind === 'npm' ? [npmPath(), ...args] : kind === 'wrangler' ? [path.join(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args] : args;
  const result = spawnSync(bin, commandArgs, {
    cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true,
    env: { ...process.env, ...env, ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(ROOT, '.tmp_qa/release-gate/wrangler.log') },
  });
  if (result.error || result.status !== 0) throw new Error(`${kind} ${args[0]} 검사/실행 실패 (exit ${result.status ?? 'unknown'})`);
  return result.stdout?.trim() || '';
}
export function checkSteps(target) {
  if (target === 'worker') return [
    ['npm', ['test'], 'worker'],
    ['wrangler', ['deploy', '--dry-run', '--outdir=dist-check'], 'worker'],
  ];
  return [
    ['npm', target === 'site' ? ['test', '--', 'src/game', 'src/pages/ToneGamePage.test.jsx', 'src/api/gameApi.test.js', 'src/analytics/tracker.test.js'] : ['test'], 'pwa'],
    ['node', ['node_modules/eslint/bin/eslint.js', 'src/', '--quiet'], 'pwa'],
    ['node', ['02_devtools/design-audit.mjs', '--quiet'], ''],
    ['npm', ['run', 'build'], target],
    ['node', ['02_devtools/public-price-check.mjs', target], ''],
  ];
}
export function publicOrigin(value) {
  const url = new URL(value);
  assert.ok((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', '공개 Worker origin만 사용할 수 있습니다.');
  return url.origin;
}
export async function checkRelease(target, { root = ROOT, run = runCommand, backendUrl = process.env.VITE_WORKER_URL || TARGETS.worker.url } = {}) {
  assert.ok(TARGETS[target], '알 수 없는 배포 대상');
  const workerOrigin = publicOrigin(target === 'worker' ? TARGETS.worker.url : backendUrl);
  const buildOptions = { env: { VITE_WORKER_URL: workerOrigin } };
  await rm(recordPath(root, target), { force: true });
  // 생성 소스를 먼저 갱신하여 실제 빌드에 쓰일 데이터로 시험한다.
  if (target !== 'worker') await run('npm', ['run', 'prebuild'], path.join(root, 'pwa'), buildOptions);
  if (target === 'site') await run('npm', ['run', 'gen:tokens'], path.join(root, 'site'), buildOptions);
  const source = await sourceHash(root, target);
  const checks = [];
  for (const [kind, args, dir] of checkSteps(target)) {
    await run(kind, args, path.join(root, dir), buildOptions);
    checks.push({ command: [kind, ...args], directory: dir || '.', passed: true });
  }
  assert.equal(await sourceHash(root, target), source, '검사 중 소스가 변경되었습니다. 변경을 확인한 뒤 다시 검사해 주세요.');
  const files = await inventory(path.join(root, TARGETS[target].dist));
  assert.ok(Object.keys(files).length, '배포 산출물이 없습니다.');
  const record = {
    schema: 1, target, checkedAt: new Date().toISOString(), source, workerOrigin,
    commit: await run('git', ['rev-parse', 'HEAD'], root, { capture: true }),
    dirty: Boolean(await run('git', ['status', '--porcelain', '--untracked-files=normal'], root, { capture: true })),
    version: JSON.parse(await readFile(path.join(root, target === 'worker' ? 'worker/package.json' : 'pwa/package.json'), 'utf8')).version || null,
    files, checks,
  };
  await writeJson(recordPath(root, target), record);
  return record;
}
export async function assertRelease(target, { root = ROOT } = {}) {
  const record = JSON.parse(await readFile(recordPath(root, target), 'utf8'));
  assert.equal(record.schema, 1); assert.equal(record.target, target);
  assert.equal(record.checks?.length, checkSteps(target).length, '검사 기록 누락');
  assert.ok(record.checks.every(check => check.passed), '실패한 검사');
  assert.equal(await sourceHash(root, target), record.source, '검사 이후 소스가 변경되었습니다.');
  assert.deepEqual(await inventory(path.join(root, TARGETS[target].dist)), record.files, '검사 이후 산출물이 변경되었습니다.');
  return record;
}

// 공개 경계만 확인한다. 인증값·실제 학생 코드·쓰기 API는 사용하지 않는다.
export async function smokeWorker(url, { fetchImpl = fetch } = {}) {
  const base = new URL(url);
  assert.ok(base.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(base.hostname));
  assert.ok(!base.username && !base.password && !base.search && !base.hash);
  const checks = [
    ['/notifications', 'https://tiantian-chinese.pages.dev', 401],
    ['/booking/student/ZZZZ00000000', 'https://tiantian-chinese.pages.dev', 401],
    ['/booking/consent', 'https://tiantian-chinese.pages.dev', 401],
    ['/booking/consent/ZZZZ00000000', 'https://tiantian-chinese.pages.dev', 401],
    ['/game/me', 'https://tiantianchinese.com', 401],
    ['/game/me', 'https://invalid.example', 403],
  ];
  const results = [];
  for (const [route, origin, expected] of checks) {
    const response = await fetchImpl(new URL(route, base), { method: 'GET', headers: { Origin: origin }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, expected, `${route}: 인증 경계 응답 불일치`);
    assert.ok(response.headers.get('content-type')?.includes('application/json'), `${route}: JSON 응답 필요`);
    if (expected === 401) assert.equal(response.headers.get('access-control-allow-origin'), origin, 'CORS 응답 불일치');
    await response.body?.cancel();
    results.push({ route, origin, status: response.status });
  }
  return results;
}
function workerDeployment(text) {
  const data = JSON.parse(text);
  assert.ok(data.id && Array.isArray(data.versions) && data.versions.length, 'Worker 운영 버전 확인 실패');
  return { id: data.id, versions: data.versions.map(({ version_id, percentage }) => ({ version_id, percentage })) };
}
export async function deployWorker({ root = ROOT, run = runCommand, fetchImpl = fetch } = {}) {
  const record = await checkRelease('worker', { root, run });
  const cwd = path.join(root, 'worker');
  record.previous = workerDeployment(await run('wrangler', ['deployments', 'status', '--json'], cwd, { capture: true }));
  await writeJson(recordPath(root, 'worker'), record);
  await assertRelease('worker', { root });
  // 기존 대시보드 vars를 보존한다. 시크릿 변경이나 D1 migration은 이 도구의 범위가 아니다.
  assert.ok(record.files['/index.js'], '검증한 Worker 번들이 없습니다.');
  record.versionTag = `${record.commit.slice(0, 12)}-${record.source.slice(0, 12)}`;
  record.deploymentStartedAt = new Date().toISOString();
  await writeJson(recordPath(root, 'worker'), record);
  try {
    await run('wrangler', ['deploy', 'dist-check/index.js', '--no-bundle', '--keep-vars', '--tag', record.versionTag], cwd);
    record.uploadReturned = true;
    record.deployed = workerDeployment(await run('wrangler', ['deployments', 'status', '--json'], cwd, { capture: true }));
    assert.notEqual(record.deployed.id, record.previous.id, '새 Worker 배포를 확인하지 못했습니다.');
    assert.equal(record.deployed.versions.length, 1, '예상 밖 Worker 분할 배포');
    const version = JSON.parse(await run('wrangler', ['versions', 'view', record.deployed.versions[0].version_id, '--json'], cwd, { capture: true }));
    assert.equal(version.annotations?.['workers/tag'], record.versionTag, '검증한 Worker 소스와 운영 버전이 다릅니다.');
    record.smoke = await smokeWorker(TARGETS.worker.url, { fetchImpl });
    record.verifiedAt = new Date().toISOString();
  } catch (error) {
    if (record.uploadReturned) record.postdeployFailed = true;
    else record.uploadResultUnknown = true;
    throw error;
  } finally { await writeJson(recordPath(root, 'worker'), record); }
  return record;
}

export function releaseVersion(tag) {
  const version = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag || '')?.[1];
  assert.ok(version, 'PWA 배포 태그는 v숫자.숫자.숫자 형식이어야 합니다.');
  return version;
}

async function main() {
  const [action, target] = process.argv.slice(2);
  if (action === 'check') await checkRelease(target);
  else if (action === 'assert') await assertRelease(target);
  else if (action === 'deploy-worker') {
    assert.equal(process.argv.length, 3, 'Worker 배포의 추가 플래그는 지원하지 않습니다. 설정 변경은 별도 검토해 주세요.');
    await deployWorker();
  } else if (action === 'sync-version') {
    const version = releaseVersion(process.env.GITHUB_REF_NAME);
    runCommand('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], path.join(ROOT, 'pwa'));
  } else throw new Error('사용법: release-guard.mjs check|assert pwa|site|worker / sync-version / deploy-worker');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
