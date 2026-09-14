// Run from the repository root: node .tmp_qa/consult-site-release-20260914/contact-form-check.cjs
// Only injected responses are used. This harness never sends mail or contacts a live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const workspace = path.resolve(__dirname, '../..');
const sourcePath = path.join(workspace, 'site/src/components/ContactForm.jsx');
const outputPath = path.join(__dirname, 'contact-form-results.json');
const siteRequire = Module.createRequire(path.join(workspace, 'site/package.json'));
const pwaRequire = Module.createRequire(path.join(workspace, 'pwa/package.json'));
const { JSDOM } = pwaRequire('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://isolated.invalid/contact/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let blockedLiveRequests = 0;
globalThis.fetch = async () => { blockedLiveRequests++; throw new Error('Live network denied'); };
const React = siteRequire('react');
const { createRoot, hydrateRoot } = siteRequire('react-dom/client');
const { renderToString } = siteRequire('react-dom/server');
const { act } = React;
const bundle = pwaRequire('esbuild').buildSync({
  entryPoints: [sourcePath], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/*'], loader: { '.css': 'empty' }, logLevel: 'silent',
});
const compiled = new Module(path.join(workspace, 'site/contact-isolated-check.cjs'));
compiled.filename = compiled.id;
compiled.paths = Module._nodeModulePaths(path.join(workspace, 'site'));
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { default: ContactForm, submitContactInquiry } = compiled.exports;
const cases = [];
const activeViews = new Set();
const report = { checkedAt: new Date().toISOString(), source: path.relative(workspace, sourcePath), sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), runtime: process.version, react: React.version, checks: cases };
const writeReport = () => fs.writeFileSync(outputPath, JSON.stringify({ ...report, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length, blockedLiveRequests, liveRequests: 0, status: cases.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS' }, null, 2) + '\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mount(props = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const view = { container, async close() { await act(async () => root.unmount()); container.remove(); activeViews.delete(view); } };
  activeViews.add(view);
  await act(async () => root.render(React.createElement(ContactForm, props)));
  assert.equal(container.querySelector('fieldset').disabled, false);
  assert.equal(container.querySelector('button[type="submit"]').disabled, false);
  return view;
}
const find = name => document.querySelector(`[name="${name}"]`);
async function change(name, value) {
  const element = find(name);
  const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
    : element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
const fixtureFields = { type: 'lecture', company: '가상 기관', name: '가상 담당자', email: 'fixture@example.invalid', message: '가상 출강 제안 내용' };
async function valid(overrides = {}) { for (const [name, value] of Object.entries({ ...fixtureFields, ...overrides })) await change(name, value); }
const send = async (times = 1) => act(async () => {
  for (let i = 0; i < times; i++) document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
});
function assertPreserved() { for (const [name, value] of Object.entries(fixtureFields)) assert.equal(find(name).value, value); }
async function check(label, test) {
  const started = Date.now();
  try { await test(); cases.push({ name: label, status: 'PASS', durationMs: Date.now() - started }); console.log('PASS ' + label); }
  catch (error) { cases.push({ name: label, status: 'FAIL', error: error.stack }); console.error('FAIL ' + label + '\n' + error.stack); }
  finally { for (const view of [...activeViews]) await view.close(); writeReport(); }
}

(async () => {
  await check('SSR: POST, disabled inputs, no successful form fields, accessible no-JS email fallback', async () => {
    const ssr = new JSDOM(renderToString(React.createElement(ContactForm)), { url: 'https://isolated.invalid/contact/' });
    const form = ssr.window.document.querySelector('form');
    assert.equal(form.method, 'post');
    assert.equal(form.querySelector('fieldset').disabled, true);
    assert.equal(form.querySelector('button[type="submit"]').disabled, true);
    const fields = [...form.querySelectorAll('input, select, textarea')];
    assert.equal(fields.length, 6);
    assert.equal(fields.every(field => field.matches(':disabled')), true);
    form.querySelector('[name="name"]').value = fixtureFields.name;
    form.querySelector('[name="email"]').value = fixtureFields.email;
    assert.deepEqual([...new ssr.window.FormData(form)], []);
    assert.equal(form.querySelector('noscript a').href, 'mailto:tiantianchinese_@naver.com');
    assert.equal(form.querySelector('[name="website"]').tabIndex, -1);
    assert.equal(form.querySelector('[name="website"]').closest('[aria-hidden="true"]') !== null, true);
    ssr.window.close();
  });
  await check('Hydration: initial locks open only after React mounts, with no recoverable mismatch', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(React.createElement(ContactForm)); document.body.append(container);
    assert.equal(container.querySelector('fieldset').disabled, true);
    let root; const recoverable = [];
    await act(async () => { root = hydrateRoot(container, React.createElement(ContactForm), { onRecoverableError: error => recoverable.push(error.message) }); });
    try {
      assert.deepEqual(recoverable, []);
      assert.equal(container.querySelector('fieldset').disabled, false);
      assert.equal(container.querySelector('button[type="submit"]').disabled, false);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  await check('Required fields: first invalid control receives focus; typing does not jump to the next error', async () => {
    let calls = 0; await mount({ submit: async () => { calls++; return { ok: true }; } });
    await send(); assert.equal(calls, 0); assert.equal(document.activeElement, find('type'));
    for (const name of Object.keys(fixtureFields)) {
      assert.equal(find(name).getAttribute('aria-invalid'), 'true');
      assert.ok(document.getElementById(find(name).getAttribute('aria-describedby')));
    }
    await change('type', 'lecture'); assert.equal(document.activeElement, find('type'));
    await send(); assert.equal(document.activeElement, find('company')); assert.equal(calls, 0);
    await change('company', '가'); assert.equal(document.activeElement, find('company'));
  });
  await check('Email: malformed addresses stay in the form, focus email, and never submit', async () => {
    let calls = 0; await mount({ submit: async () => { calls++; return { ok: true }; } }); await valid();
    for (const email of ['bad-address', 'name@', 'a b@example.com', 'a@@example.com']) {
      await change('email', email); await send();
      assert.equal(calls, 0); assert.equal(document.activeElement, find('email'));
      assert.equal(find('email').value, email); assert.equal(find('email').getAttribute('aria-invalid'), 'true');
    }
  });
  await check('Duplicate submit: same-tick events send once; fields and button remain locked while pending', async () => {
    let calls = 0, resolve, payload;
    await mount({ submit: value => { payload = value; calls++; return new Promise(done => { resolve = done; }); } });
    await valid({ type: 'collaboration', company: '  가상 기관  ', name: ' 가상 담당자 ', email: ' fixture@example.invalid ', message: ' 가상 출강 제안 내용 ' });
    await send(2); assert.equal(calls, 1);
    assert.deepEqual(payload, { ...fixtureFields, type: 'collaboration', website: '' });
    assert.equal(document.querySelector('fieldset').disabled, true);
    assert.equal(document.querySelector('button[type="submit"]').disabled, true);
    assert.equal(document.querySelector('form').getAttribute('aria-busy'), 'true');
    await act(async () => resolve({ ok: true }));
    assert.equal(document.querySelector('form'), null);
    assert.equal(document.activeElement.textContent, '문의를 접수했어요.');
    assert.equal(document.activeElement.tagName, 'H2');
    assert.ok(document.body.textContent.includes('남겨 주신 이메일로 연락드릴게요.'));
  });
  await check('Provider failure: retain all five fields, focus error, no auto retry; explicit retry succeeds', async () => {
    const calls = []; let fail = true;
    await mount({ submit: async payload => { calls.push(payload); if (fail) throw new Error('모의 메일 제공자 실패'); return { ok: true }; } });
    await valid(); await send(); assert.equal(calls.length, 1); assertPreserved();
    assert.equal(document.activeElement.getAttribute('role'), 'alert');
    assert.ok(document.querySelector('[role="alert"]').textContent.includes('모의 메일 제공자 실패'));
    assert.equal(document.querySelector('fieldset').disabled, false); assert.equal(document.querySelector('button').disabled, false);
    await act(async () => delay(30)); assert.equal(calls.length, 1);
    fail = false; await send(); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(document.querySelector('form'), null);
  });
  await check('Timeout: abort once, preserve inputs, show uncertainty; late success does not replace the error', async () => {
    let calls = 0, resolve, signal;
    await mount({ timeoutMs: 20, submit: (_payload, options) => { calls++; signal = options.signal; return new Promise(done => { resolve = done; }); } });
    await valid(); await send(); await act(async () => delay(45));
    assert.equal(calls, 1); assert.equal(signal.aborted, true); assertPreserved();
    assert.ok(document.querySelector('[role="alert"]').textContent.includes('접수 결과를 확인하지 못했어요.'));
    assert.equal(document.activeElement.getAttribute('role'), 'alert');
    await act(async () => resolve({ ok: true })); assert.ok(document.querySelector('form')); assertPreserved();
    assert.equal(calls, 1);
  });
  await check('Acknowledgement: missing, false, or string ok cannot show success', async () => {
    for (const result of [{}, { ok: false }, { ok: 'true' }]) {
      const view = await mount({ submit: async () => result }); await valid(); await send();
      assert.ok(document.querySelector('[role="alert"]')); assert.ok(document.querySelector('form')); assertPreserved();
      await view.close();
    }
  });
  await check('Unmount: pending request aborts and its late resolution does not update the page', async () => {
    let signal, resolve;
    const view = await mount({ submit: (_payload, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
    await valid(); await send(); await view.close(); assert.equal(signal.aborted, true);
    await act(async () => resolve({ ok: true })); assert.equal(document.body.textContent, '');
  });
  await check('Transport: exactly one JSON POST, supplied signal, no auth or credential option, no cache or redirects', async () => {
    const calls = [], controller = new AbortController();
    const fetcher = async (url, options) => { calls.push([url, options]); return Response.json({ ok: true }); };
    const payload = { ...fixtureFields, website: '' };
    assert.deepEqual(await submitContactInquiry(payload, { signal: controller.signal, fetcher }), { ok: true });
    assert.equal(calls.length, 1); const [url, options] = calls[0];
    assert.equal(url, 'https://tutor-manager-proxy.hisyisnis.workers.dev/contact');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.signal, controller.signal); assert.equal('credentials' in options, false);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' }); assert.deepEqual(JSON.parse(options.body), payload);
  });
  await check('Transport failure: HTTP/provider failures, bad JSON and missing acknowledgement never retry or falsely succeed', async () => {
    for (const reply of [
      () => Response.json({ ok: true }, { status: 502 }), () => Response.json({}),
      () => new Response('not-json', { status: 200 }), () => { throw new Error('private network details'); },
    ]) {
      let calls = 0; const fetcher = async () => { calls++; return reply(); };
      await assert.rejects(submitContactInquiry(fixtureFields, { fetcher }), /접수 결과를 확인하지 못했어요/);
      assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(submitContactInquiry(fixtureFields, { fetcher: async () => { calls++; return Response.json({ error: '모의 입력 오류' }, { status: 400 }); } }), /모의 입력 오류/);
    assert.equal(calls, 1);
  });
  assert.equal(blockedLiveRequests, 0);
  writeReport(); console.log(JSON.stringify({ outputPath, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length, liveRequests: 0 }));
  dom.window.close(); if (cases.some(item => item.status === 'FAIL')) process.exitCode = 1;
})().catch(error => { report.harnessError = error.stack; writeReport(); console.error(error); process.exitCode = 1; });
