import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertRelease, checkRelease, deployWorker, inventory, publicOrigin, recordPath, releaseVersion, safeFile, sha256, smokeWorker, sourceHash } from './release-guard.mjs';
import { assertPages, checkContent, finishPages, pagesApi, preparePages, retainPreviousAssets } from './pages-release.mjs';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('tutor-release-'));
    await rm(root, { recursive: true, force: true });
  }
});
async function put(root, name, content) {
  const file = safeFile(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return file;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tutor-release-')); roots.push(root);
  for (const packageName of ['pwa', 'site', 'worker']) await put(root, `${packageName}/package.json`, '{"version":"1.2.3"}');
  await put(root, 'pwa/src/app.js', 'export default 1;');
  await put(root, 'worker/src/index.js', 'export default {};');
  await put(root, '02_devtools/release-asset-policy.json', '{"pwa":[],"site":[]}');
  return root;
}
function fakeRun(root, calls = [], fail = () => false) {
  return async (kind, args, cwd) => {
    calls.push({ kind, args, cwd });
    if (fail(kind, args)) throw new Error('fixture command failed');
    if (kind === 'git') return args[0] === 'rev-parse' ? 'a'.repeat(40) : '';
    if (kind === 'npm' && args[0] === 'run' && args[1] === 'build') {
      const target = path.basename(cwd);
      await put(root, `${target}/dist/index.html`, '<html><script src="/assets/new.js"></script></html>');
      await put(root, `${target}/dist/assets/new.js`, 'new code');
    }
    if (kind === 'wrangler' && args.includes('--dry-run')) await put(root, 'worker/dist-check/index.js', 'export default {};');
    return '';
  };
}
const oldDeployment = () => ({
  id: 'previous', url: 'https://previous.tiantian-chinese.pages.dev', environment: 'production', latest_stage: { status: 'success' },
  deployment_trigger: { metadata: { commit_hash: 'old-commit' } }, files: { '/index.html': 'cloudflare-hash', '/assets/old.js': 'cloudflare-hash' },
});
const fakeApi = deployment => async route => route.includes('/deployments/') ? deployment : { canonical_deployment: { id: deployment.id } };
const oldFetch = async (url, options) => {
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
  assert.equal(new URL(url).pathname, '/assets/old.js');
  assert.equal(options.headers.Authorization, undefined);
  return new Response('old code', { headers: { 'Content-Type': 'application/javascript' } });
};

test('검사 실패는 이전 성공 기록을 지우며 Worker 배포를 호출하지 않는다', async () => {
  const root = await fixture(), calls = [];
  await put(root, '.tmp_qa/release-gate/worker/release.json', '{"stale":true}');
  await assert.rejects(deployWorker({ root, run: fakeRun(root, calls, (kind, args) => kind === 'npm' && args[0] === 'test') }), /fixture command failed/);
  assert.equal(existsSync(recordPath(root, 'worker')), false);
  assert.equal(calls.some(call => call.kind === 'wrangler'), false);
});

test('dry-run 실패도 실제 Worker 업로드를 막는다', async () => {
  const root = await fixture(), calls = [];
  await assert.rejects(deployWorker({ root, run: fakeRun(root, calls, (_kind, args) => args.includes('--dry-run')) }), /fixture command failed/);
  assert.equal(calls.some(call => call.kind === 'wrangler' && call.args[0] === 'deploy' && !call.args.includes('--dry-run')), false);
});

test('PWA 시험·lint·감사·빌드 성공 후 manifest와 소스 지문이 일치한다', async () => {
  const root = await fixture(), calls = [];
  const record = await checkRelease('pwa', { root, run: fakeRun(root, calls) });
  assert.equal(record.version, '1.2.3'); assert.equal(record.checks.length, 5);
  assert.equal(record.source, await sourceHash(root, 'pwa'));
  assert.equal(record.files['/assets/new.js'], sha256('new code'));
  await assertRelease('pwa', { root });
  const commands = calls.map(call => [call.kind, ...call.args].join(' '));
  assert.ok(commands.indexOf('npm test') < commands.indexOf('npm run build'));
  assert.ok(commands.includes('node 02_devtools/design-audit.mjs --quiet'));
  assert.ok(commands.indexOf('npm run build') < commands.indexOf('node 02_devtools/public-price-check.mjs pwa'));
});

test('공개 가격 검사 실패는 배포 성공 기록을 남기지 않는다', async () => {
  const root = await fixture(), calls = [];
  await assert.rejects(checkRelease('pwa', { root, run: fakeRun(root, calls, (_kind, args) => args.includes('02_devtools/public-price-check.mjs')) }), /fixture command failed/);
  assert.equal(existsSync(recordPath(root, 'pwa')), false);
});

test('태그 오류를 숨기지 않으며 공개 origin에 비밀값/경로를 넣을 수 없다', () => {
  assert.equal(releaseVersion('v2.47.12'), '2.47.12');
  for (const tag of ['v2.3', 'v01.2.3', 'v1.2.3;echo bad', 'main']) assert.throws(() => releaseVersion(tag));
  assert.equal(publicOrigin('https://worker.example/'), 'https://worker.example');
  for (const url of ['https://secret@worker.example', 'https://worker.example/?token=secret', 'https://worker.example/path']) assert.throws(() => publicOrigin(url));
});

test('Worker 공유 analytics 소스도 검사 지문에 포함한다', async () => {
  const root = await fixture();
  await put(root, 'pwa/src/analytics/catalog.js', 'export const SERVICES=[];');
  await checkRelease('worker', { root, run: fakeRun(root) });
  await put(root, 'pwa/src/analytics/catalog.js', 'export const SERVICES=[1];');
  await assert.rejects(assertRelease('worker', { root }), /소스가 변경/);
});

test('검사 후 소스 또는 산출물 변경·추가는 배포를 막는다', async () => {
  const root = await fixture();
  await checkRelease('pwa', { root, run: fakeRun(root) });
  await put(root, 'pwa/src/app.js', 'changed');
  await assert.rejects(assertRelease('pwa', { root }), /소스가 변경/);
  await put(root, 'pwa/src/app.js', 'export default 1;');
  await put(root, 'pwa/dist/assets/unverified.js', 'extra');
  await assert.rejects(assertRelease('pwa', { root }), /산출물이 변경/);
});

test('시험 중 다른 작업자가 소스를 수정하면 성공 manifest를 만들지 않는다', async () => {
  const root = await fixture(); const base = fakeRun(root);
  await assert.rejects(checkRelease('pwa', { root, run: async (kind, args, cwd) => {
    const result = await base(kind, args, cwd);
    if (kind === 'npm' && args[0] === 'test') await put(root, 'pwa/src/app.js', 'mid-run change');
    return result;
  } }), /검사 중 소스/);
  assert.equal(existsSync(recordPath(root, 'pwa')), false);
});

test('첫 이전자산 보존은 고유 배포 URL에서 코드만 가져오며 HTML을 덮지 않는다', async () => {
  const root = await fixture(); await checkRelease('pwa', { root, run: fakeRun(root) });
  const record = await preparePages('pwa', { root, api: fakeApi(oldDeployment()), fetchImpl: oldFetch });
  assert.equal(record.previous.id, 'previous'); assert.equal(record.assetRetention.bootstrap, true);
  assert.equal(record.files['/assets/old.js'], sha256('old code'));
  assert.match(await readFile(path.join(root, 'pwa/dist/index.html'), 'utf8'), /new.js/);
  await assertPages('pwa', { root, api: fakeApi(oldDeployment()) });
  await assert.rejects(assertPages('pwa', { root, api: fakeApi({ ...oldDeployment(), id: 'concurrent' }) }), /운영 배포가 바뀌/);
});

test('이전자산 수급 실패는 prepared 성공 상태 없이 배포를 막는다', async () => {
  const root = await fixture(); await checkRelease('pwa', { root, run: fakeRun(root) });
  await assert.rejects(preparePages('pwa', { root, api: fakeApi(oldDeployment()), fetchImpl: async () => new Response('missing', { status: 404 }) }), /HTTP 404/);
  await assert.rejects(assertPages('pwa', { root, api: fakeApi(oldDeployment()) }), /이전 자산 보호/);
  const record = JSON.parse(await readFile(recordPath(root, 'pwa'), 'utf8'));
  assert.equal(record.prepareFailed, true); assert.equal(record.preparedAt, undefined);
});

test('Cloudflare 파일 목록이 없거나 비면 이전 자산 보호를 통과하지 않는다', async () => {
  const root = await fixture(); await checkRelease('pwa', { root, run: fakeRun(root) });
  for (const files of [undefined, {}]) await assert.rejects(retainPreviousAssets({ dist: path.join(root, 'pwa/dist'), previous: { ...oldDeployment(), files }, fetchImpl: oldFetch }), /파일 목록이 없습니다/);
});

test('다음 배포는 직전 빌드 자산 1세대만 보존하고 제외 정책을 기록한다', async () => {
  const root = await fixture(); await checkRelease('pwa', { root, run: fakeRun(root) });
  const previous = oldDeployment();
  previous.files['/release-assets.json'] = 'h'; previous.files['/assets/ancient.js'] = 'h'; previous.files['/assets/retired.js'] = 'h';
  const calls = [];
  const result = await retainPreviousAssets({
    dist: path.join(root, 'pwa/dist'), previous, exclusions: [{ prefix: '/assets/retired', reason: '공개 중단' }],
    fetchImpl: async url => {
      const name = new URL(url).pathname; calls.push(name);
      return name === '/release-assets.json'
        ? new Response(JSON.stringify({ schema: 1, builtAssets: { '/assets/old.js': sha256('old code'), '/assets/retired.js': sha256('retired') } }), { headers: { 'Content-Type': 'application/json' } })
        : new Response('old code', { headers: { 'Content-Type': 'application/javascript' } });
    },
  });
  assert.equal(result.bootstrap, false); assert.equal(result.excluded['/assets/retired.js'], '공개 중단');
  assert.deepEqual(calls, ['/release-assets.json', '/assets/old.js']);
  const published = JSON.parse(await readFile(path.join(root, 'pwa/dist/release-assets.json'), 'utf8'));
  assert.deepEqual(Object.keys(published.builtAssets), ['/assets/new.js']);
});

test('이전 같은 이름 자산의 내용 변경·위조 해시·경로 이탈을 거부한다', async () => {
  const root = await fixture(); const dist = path.join(root, 'pwa/dist'); await put(root, 'pwa/dist/assets/old.js', 'changed old code');
  await assert.rejects(retainPreviousAssets({ dist, previous: oldDeployment(), fetchImpl: oldFetch }), /내용이 바뀌/);
  assert.throws(() => safeFile(dist, '/assets/../../secret'), /잘못된/);
  assert.throws(() => checkContent('/assets/missing.js', 'text/html', Buffer.from('<html>fallback')), /JavaScript/);
});

test('인증 경계 smoke는 동의서 포함 GET 6회만 요청하며 401과 403을 구분한다', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    const blocked = options.headers.Origin === 'https://invalid.example';
    return new Response('{}', { status: blocked ? 403 : 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': blocked ? '' : options.headers.Origin } });
  };
  assert.equal((await smokeWorker('https://worker.example', { fetchImpl })).length, 6);
  assert.equal(calls.every(call => !call.headers.Authorization), true);
  await assert.rejects(smokeWorker('https://worker.example', { fetchImpl: async () => new Response('{}', { status: 503 }) }), /응답 불일치/);
});

test('Cloudflare 토큰은 API GET에만 쓰고 응답 본문은 기록하지 않는다', async () => {
  const api = pagesApi({ env: { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'fixture-only' }, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.cloudflare.com'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    return new Response('{"success":true,"result":{"id":"deployment"}}');
  } });
  assert.deepEqual(await api('pages/projects/fixture'), { id: 'deployment' });
});

test('Pages 배포 완료는 고유주소·운영주소·파일 해시·인증 경계를 모두 확인한다', async () => {
  const root = await fixture(); await checkRelease('pwa', { root, run: fakeRun(root), backendUrl: 'https://worker.example' });
  await preparePages('pwa', { root, api: fakeApi(oldDeployment()), fetchImpl: oldFetch });
  const deployed = { ...oldDeployment(), id: 'new', url: 'https://new.tiantian-chinese.pages.dev', deployment_trigger: { metadata: { commit_hash: 'a'.repeat(40) } } };
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'GET'); const u = new URL(url);
    if (u.hostname === 'worker.example') return new Response('{}', { status: options.headers.Origin === 'https://invalid.example' ? 403 : 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': options.headers.Origin } });
    const name = ['/', '/personal'].includes(u.pathname) ? '/index.html' : u.pathname;
    const bytes = await readFile(safeFile(path.join(root, 'pwa/dist'), name));
    return new Response(bytes, { headers: { 'Content-Type': name.endsWith('.js') ? 'application/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html' } });
  };
  const record = await finishPages('pwa', { root, api: fakeApi(deployed), fetchImpl, deploymentUrl: deployed.url, workerUrl: 'https://worker.example' });
  assert.ok(record.verifiedAt); assert.equal(Object.keys(record.smoke).length, 2);
  await assert.rejects(finishPages('pwa', { root, api: fakeApi(deployed), fetchImpl: async () => new Response('<html>wrong</html>', { headers: { 'Content-Type': 'text/html' } }), deploymentUrl: deployed.url, workerUrl: 'https://worker.example' }), /다른 진입 스크립트/);
  assert.equal(JSON.parse(await readFile(recordPath(root, 'pwa'), 'utf8')).postdeployFailed, true);
});

test('Worker는 검사한 번들만 업로드하고 버전 tag·직전 버전·실패 상태를 보존한다', async () => {
  const root = await fixture(), calls = []; const base = fakeRun(root, calls); let deployed = false, tag;
  const run = async (kind, args, cwd) => {
    if (kind === 'wrangler' && args[0] === 'deploy' && !args.includes('--dry-run')) {
      calls.push({ kind, args }); assert.ok(args.includes('--no-bundle')); assert.ok(args.includes('dist-check/index.js'));
      deployed = true; tag = args.at(-1); return '';
    }
    if (kind === 'wrangler' && args[0] === 'deployments') return JSON.stringify({ id: deployed ? 'new' : 'old', versions: [{ version_id: deployed ? 'v2' : 'v1', percentage: 100 }] });
    if (kind === 'wrangler' && args[0] === 'versions') return JSON.stringify({ annotations: { 'workers/tag': tag } });
    return base(kind, args, cwd);
  };
  await assert.rejects(deployWorker({ root, run, fetchImpl: async () => new Response('{}', { status: 503 }) }), /응답 불일치/);
  const record = JSON.parse(await readFile(recordPath(root, 'worker'), 'utf8'));
  assert.equal(record.previous.versions[0].version_id, 'v1'); assert.equal(record.deployed.versions[0].version_id, 'v2');
  assert.equal(record.postdeployFailed, true); assert.equal(calls.some(call => call.args[0] === 'rollback'), false);
});
