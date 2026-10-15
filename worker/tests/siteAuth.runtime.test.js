import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';
import { fileURLToPath } from 'node:url';

describe('site member password hashing in actual workerd', () => {
  it('runs native PBKDF2 and keeps the member password pepper separate', async () => {
    const output = await build({ stdin: { sourcefile: 'site-auth-runtime-fixture.js', resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `import { hashSitePassword } from './lib/siteAuth.js';
        export default { async fetch() {
          const first=await hashSitePassword('Synthetic-member-password42','fixture-member-pepper');
          const same=await hashSitePassword('Synthetic-member-password42','fixture-member-pepper',first.salt);
          const other=await hashSitePassword('Synthetic-member-password42','fixture-review-pepper',first.salt);
          return Response.json({ iterations:first.iterations, saltLength:first.salt.length, hashLength:first.hash.length,
            stable:first.hash===same.hash, isolated:first.hash!==other.hash });
        }};` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    const options = { cf: false, modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-04-27' };
    const runtime = new miniflare.Miniflare(typeof miniflare.convertV4MiniflareOptions === 'function'
      ? miniflare.convertV4MiniflareOptions(options) : options);
    try {
      const response = await runtime.dispatchFetch('http://site-auth-fixture.invalid/');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ iterations: 100000, saltLength: 22, hashLength: 43, stable: true, isolated: true });
    } finally { await runtime.dispose(); }
  }, 30000);
});
