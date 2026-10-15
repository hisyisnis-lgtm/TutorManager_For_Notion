#!/usr/bin/env node
// Package a CI-built student app for the independent website; never upload or deploy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDENT_REPOSITORY = 'hisyisnis-lgtm/TutorManager_For_Notion';
export const STUDENT_WORKFLOW = '.github/workflows/build-student-artifact.yml';
export const STUDENT_WORKER = 'https://tutor-manager-proxy.hisyisnis.workers.dev';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const publicFile = /^(?:index\.html|(?:assets|panda|logo|fonts)\/.+\.(?:js|mjs|css|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|mp3|ogg|wav|m4a|mp4|webm|json)|(?:pwa-[\w-]+|maskable-icon[\w-]*|apple-touch-icon(?:-[\w-]+)?|favicon|symbol-red)\.png|icon\.svg|manifest\.webmanifest|registerSW\.js|sw\.js|workbox-[\w-]+\.js)$/i;
const loopback = /https?:\/\/(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`<>\\]*)?/gi;

export function assertStudentText(name, bytes) {
  if (!/\.(?:html|m?js|css|json|webmanifest|svg)$/.test(name)) return;
  const text = bytes.toString('utf8').replaceAll('\\/', '/');
  for (const [url] of text.matchAll(loopback)) {
    // React Router's URL parser has a bare fallback origin; it is not a fetch endpoint.
    assert.ok(/^assets\/vendor-[\w-]+\.js$/.test(name) && url === 'http://localhost', `${name}: loopback 주소가 포함된 학생앱은 출시할 수 없습니다.`);
  }
}

async function selectedFiles(root, prefix = '') {
  const files = [];
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    assert.ok(!entry.isSymbolicLink(), '학생앱 산출물의 외부 링크 금지');
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!/[\\%?#:\u0000-\u0020]/.test(name) && !name.split('/').some(part => part === '.' || part === '..'), '학생앱 산출물 경로 오류');
    if (entry.isDirectory()) files.push(...await selectedFiles(root, name));
    else if (entry.isFile() && publicFile.test(name)) {
      assert.ok((await stat(path.join(root, name))).size <= 30 * 1024 * 1024, `${name}: 학생앱 파일 크기 제한 초과`);
      const bytes = await readFile(path.join(root, name)); assertStudentText(name, bytes);
      files.push({ name, bytes });
    }
  }
  return files;
}

function assertEntry(files) {
  const entries = new Map(files.map(file => [file.name, file.bytes]));
  const html = entries.get('index.html')?.toString('utf8');
  assert.ok(html?.includes('/personal/assets/') && /http-equiv=["']content-security-policy["']/i.test(html), '학생앱 index/base/CSP 누락');
  assert.match(html, /name=["']robots["'][^>]+content=["']noindex,\s*nofollow["']/i, '학생앱 검색 제외 누락');
  assert.ok(entries.has('sw.js'), '학생앱 서비스워커 누락');
  const manifest = JSON.parse(entries.get('manifest.webmanifest')?.toString('utf8') || 'null');
  assert.equal(manifest?.start_url, '/personal/'); assert.equal(manifest?.scope, '/personal/');
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1])
    .filter(value => /\.(?:m?js|css|webmanifest)(?:[?#]|$)/i.test(value));
  assert.ok(references.some(value => /\.m?js(?:[?#]|$)/i.test(value)), '학생앱 실행 스크립트 누락');
  for (const value of [...references, ...(manifest.icons || []).map(icon => icon.src)]) {
    const url = new URL(value, 'https://tiantianchinese.com/personal/');
    assert.ok(value.startsWith('/personal/') && url.origin === 'https://tiantianchinese.com' && !url.search && !url.hash, '학생앱 실행 자산은 같은 /personal/ 경로여야 합니다.');
    assert.ok(entries.has(url.pathname.slice('/personal/'.length)), '학생앱에서 참조한 자산 누락');
  }
}

export async function packageStudentArtifact({ source, output, repository, sourceCommit, runId, runAttempt, workflowRef }) {
  assert.equal(repository, STUDENT_REPOSITORY, '학생앱 저장소 불일치');
  assert.match(sourceCommit || '', /^[a-f0-9]{40}$/, '정확한 학생앱 소스 SHA 필요');
  assert.match(String(runId || ''), /^[1-9]\d*$/, '학생앱 workflow run ID 필요');
  assert.match(String(runAttempt || ''), /^[1-9]\d*$/, '학생앱 workflow attempt 필요');
  assert.ok(workflowRef?.startsWith(`${STUDENT_REPOSITORY}/${STUDENT_WORKFLOW}@`), '학생앱 공급 workflow 출처 불일치');
  const sourceRoot = path.resolve(source), outputRoot = path.resolve(output);
  assert.ok(outputRoot !== sourceRoot && !outputRoot.startsWith(sourceRoot + path.sep) && !sourceRoot.startsWith(outputRoot + path.sep), '학생앱 원본과 포장 위치가 겹칩니다.');
  const files = await selectedFiles(sourceRoot); assertEntry(files);
  assert.ok(files.length > 0 && files.length <= 10_000 && files.reduce((total, file) => total + file.bytes.length, 0) <= 500 * 1024 * 1024, '학생앱 산출물 범위 초과');
  // A fresh destination avoids mixing files from a previous workflow attempt.
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot);
  for (const { name, bytes } of files) {
    const target = path.join(outputRoot, 'dist-student', name);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  const provenance = { schema: 1, kind: 'hanul-student-app', repository, workflowPath: STUDENT_WORKFLOW,
    sourceCommit, workflowRunId: String(runId), workflowRunAttempt: String(runAttempt),
    base: '/personal/', workerOrigin: STUDENT_WORKER, pandaServerPersistence: false,
    files: Object.fromEntries(files.map(({ name, bytes }) => [name, sha(bytes)])) };
  await writeFile(path.join(outputRoot, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return { artifactName: `student-app-${sourceCommit}`, files: files.length, output: outputRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, output, ...extra] = process.argv.slice(2);
  Promise.resolve().then(() => {
    assert.ok(source && output && !extra.length, '사용법: student-release-artifact.mjs <dist-student> <새 포장 폴더>');
    return packageStudentArtifact({ source, output, repository: process.env.GITHUB_REPOSITORY,
      sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      workflowRef: process.env.GITHUB_WORKFLOW_REF });
  }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
