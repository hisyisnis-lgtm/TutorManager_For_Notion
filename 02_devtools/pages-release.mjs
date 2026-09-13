#!/usr/bin/env node
// Pages API는 읽기 전용 GET만 사용한다. 실제 업로드는 기존 Wrangler Action이 담당한다.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TARGETS, assertRelease, inventory, publicOrigin, recordPath, safeFile, sha256, smokeWorker, writeJson } from './release-guard.mjs';
import { assertNoPublicPriceText, checkPublicPrice } from './public-price-check.mjs';

const ASSET_INDEX = '/release-assets.json';
const assetPath = name => /^\/(?:assets|_astro|game\/tone\/assets)\//.test(name);
export async function getBytes(url, { fetchImpl = fetch, headers = {}, limit = 30 * 1024 * 1024 } = {}) {
  const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `GET ${new URL(url).pathname}: HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= limit, '배포 확인 응답 크기 초과');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
}
export function checkContent(name, type, bytes) {
  if (/\.m?js$/.test(name)) assert.match(type, /(?:java|ecma)script/i, `${name}: JavaScript 대신 다른 응답`);
  else if (name.endsWith('.css')) assert.match(type, /text\/css/i, `${name}: CSS 응답 필요`);
  else if (name.endsWith('.json')) assert.match(type, /application\/json/i, `${name}: JSON 응답 필요`);
  else if (name.endsWith('.html') || name.endsWith('/')) assert.match(type, /text\/html/i, `${name}: HTML 응답 필요`);
  else assert.ok(!type.includes('text/html'), `${name}: 누락 자산에 HTML fallback이 반환됐습니다.`);
  if (!name.endsWith('.html') && !name.endsWith('/')) assert.ok(!/^\s*<(?:!doctype\s+html|html)/i.test(bytes.toString('utf8', 0, 120)), `${name}: HTML fallback`);
}
export function pagesApi({ env = process.env, fetchImpl = fetch } = {}) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = env;
  assert.ok(account && token, 'Pages 배포 확인에는 기존 Cloudflare 계정 ID와 API 토큰이 필요합니다.');
  return async route => {
    const { bytes } = await getBytes(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/${route}`, { fetchImpl, headers: { Authorization: `Bearer ${token}` } });
    const data = JSON.parse(bytes);
    assert.equal(data.success, true, 'Cloudflare 배포 정보 조회 실패');
    return data.result;
  };
}
export async function currentDeployment(project, api) {
  const info = await api(`pages/projects/${project}`);
  assert.ok(info.canonical_deployment?.id, '직전 운영 배포를 확인할 수 없습니다. 첫 배포는 별도 초기화가 필요합니다.');
  const deployment = await api(`pages/projects/${project}/deployments/${info.canonical_deployment.id}`);
  assert.equal(deployment.id, info.canonical_deployment.id);
  assert.equal(deployment.environment, 'production', '운영 배포가 아닙니다.');
  assert.equal(deployment.latest_stage?.status, 'success', '성공한 직전 운영 배포가 아닙니다.');
  const url = new URL(deployment.url);
  assert.ok(url.protocol === 'https:' && url.hostname.endsWith(`.${project}.pages.dev`) && !url.username && !url.password, '배포 고유 URL 확인 실패');
  return deployment;
}
function summarize(deployment) {
  return { id: deployment.id, url: deployment.url, commit: deployment.deployment_trigger?.metadata?.commit_hash || null };
}
export async function retainPreviousAssets({ dist, previous, exclusions = [], fetchImpl = fetch }) {
  assert.ok(previous.files && typeof previous.files === 'object' && Object.keys(previous.files).length, '직전 배포의 파일 목록이 없습니다.');
  const own = await inventory(dist);
  const builtAssets = Object.fromEntries(Object.entries(own).filter(([name]) => assetPath(name)));
  assert.ok(Object.keys(builtAssets).length, '새 코드 자산이 없습니다.');
  // 첫 전환은 API의 전체 코드 자산 목록을 보존한다. 이후부터는 직전 빌드가 생성한
  // 자산만 가져와 과거 모든 버전이 무한히 누적되지 않게 한다.
  let expected = Object.fromEntries(Object.keys(previous.files).filter(assetPath).map(name => [name, null]));
  assert.ok(Object.keys(expected).length, '직전 코드 자산 목록이 비어 있습니다.');
  const bootstrap = !(ASSET_INDEX in previous.files);
  if (!bootstrap) {
    const item = await getBytes(new URL(ASSET_INDEX, previous.url), { fetchImpl });
    checkContent(ASSET_INDEX, item.type, item.bytes);
    const index = JSON.parse(item.bytes);
    assert.equal(index.schema, 1); assert.ok(index.builtAssets && typeof index.builtAssets === 'object');
    expected = index.builtAssets;
    assert.ok(Object.keys(expected).length, '직전 코드 자산 목록이 비어 있습니다.');
  }
  assert.ok(Array.isArray(exclusions), '자산 제외 정책은 배열이어야 합니다.');
  for (const rule of exclusions) assert.ok(assetPath(rule.prefix || '') && rule.reason?.trim(), '자산 제외 prefix와 사유가 필요합니다.');
  const retained = {}, excluded = {};
  for (const [name, hash] of Object.entries(expected)) {
    assert.ok(assetPath(name) && Object.hasOwn(previous.files, name), '직전 자산 경로/목록 불일치');
    const file = safeFile(dist, name);
    const exclusion = exclusions.find(rule => name.startsWith(rule.prefix));
    if (exclusion) {
      assert.ok(!own[name], `${name}: 제외한 자산이 새 빌드에도 존재합니다.`);
      excluded[name] = exclusion.reason;
      continue;
    }
    if (hash && own[name] === hash) continue;
    const item = await getBytes(new URL(name, previous.url), { fetchImpl });
    checkContent(name, item.type, item.bytes);
    if (/\.m?js$/.test(name)) assertNoPublicPriceText(item.bytes.toString('utf8'), name);
    const actual = sha256(item.bytes);
    if (hash !== null) assert.equal(actual, hash, `${name}: 직전 자산 해시 불일치`);
    if (own[name]) {
      assert.equal(own[name], actual, `${name}: 같은 자산 주소의 내용이 바뀌었습니다.`);
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, item.bytes);
      retained[name] = actual;
    }
  }
  await writeJson(path.join(dist, ASSET_INDEX.slice(1)), { schema: 1, builtAssets });
  return { retained, excluded, bootstrap, generations: 1 };
}
export async function preparePages(target, { root = ROOT, api = pagesApi(), fetchImpl = fetch } = {}) {
  const config = TARGETS[target]; assert.ok(config?.project, 'Pages 대상 필요');
  const record = await assertRelease(target, { root });
  const previous = await currentDeployment(config.project, api);
  record.previous = summarize(previous);
  await writeJson(recordPath(root, target), record);
  try {
    const policy = JSON.parse(await readFile(path.join(root, '02_devtools/release-asset-policy.json'), 'utf8'));
    record.assetRetention = await retainPreviousAssets({ dist: path.join(root, config.dist), previous, exclusions: policy[target], fetchImpl });
    record.publicPriceCheck = await checkPublicPrice(target, { root });
    record.files = await inventory(path.join(root, config.dist));
    record.preparedAt = new Date().toISOString();
  } catch (error) {
    record.prepareFailed = true;
    throw error;
  } finally { await writeJson(recordPath(root, target), record); }
  return record;
}
export async function assertPages(target, { root = ROOT, api = pagesApi() } = {}) {
  const record = await assertRelease(target, { root });
  assert.ok(record.preparedAt && !record.prepareFailed, '이전 자산 보호를 먼저 완료해 주세요.');
  const current = await currentDeployment(TARGETS[target].project, api);
  assert.equal(current.id, record.previous?.id, '검사 중 운영 배포가 바뀌었습니다. 새 운영 기준으로 다시 준비해 주세요.');
  return record;
}
export async function smokePages(target, base, files, { root = ROOT, fetchImpl = fetch } = {}) {
  const config = TARGETS[target];
  const results = [];
  for (const route of config.routes) {
    const item = await getBytes(new URL(route, base), { fetchImpl });
    checkContent(`${route.replace(/\/$/, '')}/`, item.type, item.bytes);
    const localName = target === 'pwa' ? '/index.html' : route === '/' ? '/index.html' : `${route}index.html`;
    const local = await readFile(safeFile(path.join(root, config.dist), localName), 'utf8');
    const scripts = [...local.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]).filter(src => src.startsWith('/'));
    assert.ok(item.bytes.toString().includes('<html'), `${route}: HTML 진입 실패`);
    for (const script of scripts) assert.ok(item.bytes.toString().includes(script), `${route}: 배포 후보와 다른 진입 스크립트`);
    results.push({ route, status: 200 });
  }
  // 과거 탭이 불러올 코드도 검사한다. 대표 정적 미디어는 하나씩 읽어 경로 조립을 확인한다.
  const names = Object.keys(files).filter(assetPath);
  for (const regex of [/\/favicon[^/]*\.(?:png|svg)$/, /\/game\/tts\/.*\.mp3$/]) {
    const name = Object.keys(files).find(file => regex.test(file));
    if (name) names.push(name);
  }
  names.push(ASSET_INDEX);
  for (const name of [...new Set(names)]) {
    const item = await getBytes(new URL(name, base), { fetchImpl });
    checkContent(name, item.type, item.bytes);
    assert.equal(sha256(item.bytes), files[name], `${name}: 배포 파일 해시 불일치`);
  }
  return { routes: results, assets: names.length };
}
export async function finishPages(target, { root = ROOT, api = pagesApi(), fetchImpl = fetch, deploymentUrl = process.env.DEPLOYMENT_URL, workerUrl = process.env.VITE_WORKER_URL } = {}) {
  const record = await assertRelease(target, { root });
  assert.ok(record.preparedAt && !record.prepareFailed, '준비된 배포 기록 없음');
  try {
    const current = await currentDeployment(TARGETS[target].project, api);
    record.deployed = summarize(current);
    assert.equal(new URL(deploymentUrl).origin, new URL(current.url).origin, '방금 배포한 버전이 현재 운영과 다릅니다.');
    assert.notEqual(current.id, record.previous.id, '새 Pages 배포 확인 실패');
    assert.equal(current.deployment_trigger?.metadata?.commit_hash, record.commit, '배포 소스 SHA 불일치');
    record.smoke = {};
    for (const base of [current.url, TARGETS[target].url]) record.smoke[base] = await smokePages(target, base, record.files, { root, fetchImpl });
    if (workerUrl) assert.equal(publicOrigin(workerUrl), record.workerOrigin, '빌드와 확인 대상 Worker가 다릅니다.');
    record.workerSmoke = await smokeWorker(record.workerOrigin, { fetchImpl });
    record.verifiedAt = new Date().toISOString();
  } catch (error) {
    record.postdeployFailed = true;
    throw error;
  } finally { await writeJson(recordPath(root, target), record); }
  return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, target] = process.argv.slice(2);
  const actions = { prepare: preparePages, assert: assertPages, finish: finishPages };
  Promise.resolve().then(() => {
    assert.ok(actions[action], '사용법: pages-release.mjs prepare|assert|finish pwa|site');
    return actions[action](target);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
