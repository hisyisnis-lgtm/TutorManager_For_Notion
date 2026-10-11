import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';
import { fileURLToPath } from 'node:url';

describe('production Notion proxy in isolated workerd', () => {
  it('forwards a large synthetic stream without waiting for or copying the whole body', async () => {
    const output = await build({ stdin: { sourcefile: 'notion-stream-runtime-fixture.js',
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      contents: `import worker from './src/index.js';
        import { signTypedToken } from './lib/auth.js';
        export default { async fetch() {
          const secret='synthetic-stream-runtime-jwt-secret';
          const token=await signTypedToken(secret,'teacher','teacher',600,{role:'teacher'});
          const expected=JSON.stringify({results:[{text:'x'.repeat(512*1024)}],has_more:false});
          const bytes=new TextEncoder().encode(expected);
          let ended=false,wholeBodyReads=0,calls=0;
          const originalFetch=globalThis.fetch;
          globalThis.fetch=async(raw,init)=>{
            const url=new URL(raw);
            if(url.origin!=='https://api.notion.com'||url.pathname!=='/v1/databases/314838fa-f2a6-8154-935b-edd3d2fbea83/query'||init.method!=='POST') {
              throw new Error('Non-synthetic outbound request denied');
            }
            calls++;
            const upstream=new Response(new ReadableStream({start(controller){
              controller.enqueue(bytes.subarray(0,128));
              setTimeout(()=>{controller.enqueue(bytes.subarray(128));ended=true;controller.close();},50);
            }}));
            const text=upstream.text.bind(upstream);
            upstream.text=()=>{wholeBodyReads++;return text();};
            return upstream;
          };
          try {
            const response=await worker.fetch(new Request('https://fixture.invalid/v1/databases/314838fa-f2a6-8154-935b-edd3d2fbea83/query',{
              method:'POST',headers:{Origin:'http://localhost:5173',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'
            }),{JWT_SECRET:secret,NOTION_TOKEN:'synthetic-only'},{waitUntil:promise=>promise.catch(()=>{})});
            const returnedBeforeUpstreamEnd=!ended;
            const status=response.status,noStore=response.headers.get('Cache-Control')==='private, no-store';
            const bodyMatches=await response.text()===expected;
            return Response.json({returnedBeforeUpstreamEnd,wholeBodyReads,calls,status,noStore,bodyMatches,payloadBytes:bytes.byteLength});
          } finally {globalThis.fetch=originalFetch;}
        }};` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
    const options = { cf: false, modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-04-27' };
    const runtime = new miniflare.Miniflare(typeof miniflare.convertV4MiniflareOptions === 'function'
      ? miniflare.convertV4MiniflareOptions(options) : options);
    try {
      const response = await runtime.dispatchFetch('http://notion-stream-runtime.invalid/');
      expect(response.status).toBe(200);
      const measured = await response.json();
      expect(measured).toMatchObject({ returnedBeforeUpstreamEnd: true, wholeBodyReads: 0, calls: 1,
        status: 200, noStore: true, bodyMatches: true });
      expect(measured.payloadBytes).toBeGreaterThan(512 * 1024);
    } finally { await runtime.dispose(); }
  }, 30000);
});
