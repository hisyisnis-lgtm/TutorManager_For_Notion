import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';
import { fileURLToPath } from 'node:url';

describe('review password hashing in the actual Worker runtime', () => {
  it('runs the production native KDF and isolated pepper within workerd limits', async () => {
    const output = await build({ stdin: { sourcefile: 'review-runtime-fixture.js', resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `import { hashReviewPassword } from './lib/reviews.js';
        export default { async fetch() {
          const first = await hashReviewPassword('synthetic-review-password', 'synthetic-pepper-a');
          const repeated = await hashReviewPassword('synthetic-review-password', 'synthetic-pepper-a', first.salt);
          const otherPepper = await hashReviewPassword('synthetic-review-password', 'synthetic-pepper-b', first.salt);
          return Response.json({ saltLength: first.salt.length, hashLength: first.hash.length,
            iterations: first.iterations, stable: first.hash === repeated.hash, isolated: first.hash !== otherPepper.hash });
        } };` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    const options = { cf: false, modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-04-27' };
    // Wrangler's installed simulator may be v4 or its v5 compatibility adapter.
    const runtime = new miniflare.Miniflare(typeof miniflare.convertV4MiniflareOptions === 'function'
      ? miniflare.convertV4MiniflareOptions(options) : options);
    try {
      const response = await runtime.dispatchFetch('http://review-runtime.invalid/');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ saltLength: 22, hashLength: 43, iterations: 100000, stable: true, isolated: true });
    } finally { await runtime.dispose(); }
  }, 30_000);
});
