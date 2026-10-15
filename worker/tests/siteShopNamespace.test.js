import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { siteD1 } from './helpers/siteD1.js';

const origin = 'https://tiantianchinese.com';
const env = { SITE_ORIGIN: origin, SITE_SHOP_SALES_MODE: 'direct', SITE_SESSION_SECRET: 'namespace-fixture-secret-32-characters' };
const request = (path, method = 'POST') => new Request(`https://fixture-worker.invalid${path}`, {
  method, headers: { Origin: 'https://external-provider.invalid', 'Content-Type': 'application/json' },
  ...(method === 'POST' ? { body: '{}' } : {}),
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('only the exact Payssam POST notification bypasses origin rejection and never grants browser CORS credentials', async () => {
  const fetcher = vi.fn(() => { throw new Error('external calls forbidden'); });
  vi.stubGlobal('fetch', fetcher);
  const callback = await worker.fetch(request('/api/site/webhooks/payssam'), env, { waitUntil() {} });
  expect(callback.status).toBe(503); // Unconfigured shop; route reached without a provider call.
  expect(callback.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(callback.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  for (const [path, method] of [
    ['/api/site/webhooks/payssam', 'GET'], ['/api/site/webhooks/payssam', 'OPTIONS'],
    ['/api/site/webhooks/payssam/extra', 'POST'], ['/api/site/shop-orders', 'POST'],
    ['/api/site/shop-orders/11111111-1111-4111-8111-111111111111/payment', 'POST'],
    ['/api/site/auth/logout', 'POST'], ['/api/site/me', 'PUT'], ['/api/site/shipping-quote', 'POST'],
  ]) {
    expect((await worker.fetch(request(path, method), env, { waitUntil() {} })).status).toBe(403);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

describe('administrator namespace through the actual Worker entry point', () => {
  let local, adminEnv, mail, r2;
  const password = 'Synthetic-namespace-admin42';
  const context = { waitUntil() {} };
  function send(path, { method = 'GET', body, session, headers = {}, stream } = {}) {
    return worker.fetch(new Request(`https://fixture-worker.invalid/api/site${path}`, { method,
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '198.51.100.62',
        ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(stream ? { body: stream, duplex: 'half' } : body !== undefined ? { body: JSON.stringify(body) } : {}) }), adminEnv, context);
  }
  const firstCookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
  async function admin() {
    let response = await send('/admin/session'); expect(response.status).toBe(200);
    const anonymous = { cookie: firstCookie(response), ...(await response.json()) };
    response = await send('/admin/auth/login', { method: 'POST', session: anonymous, body: { password } });
    expect(response.status).toBe(200);
    return { cookie: firstCookie(response), ...(await response.json()) };
  }
  async function member() {
    let response = await send('/session'); expect(response.status).toBe(200);
    const anonymous = { cookie: firstCookie(response), ...(await response.json()) }, memberPassword = 'Synthetic-member-password42';
    response = await send('/auth/email/request', { method: 'POST', session: anonymous, body: { email: 'namespace-member@fixture.invalid' } });
    expect(response.status).toBe(200); const challenge = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
    response = await send('/auth/email/verify', { method: 'POST', session: anonymous, body: { challengeId: challenge.challengeId, code } });
    expect(response.status).toBe(200); const verified = await response.json();
    response = await send('/auth/signup', { method: 'POST', session: anonymous, body: { registrationToken: verified.registrationToken,
      password: memberPassword, passwordConfirm: memberPassword, name: '합성 회원', nickname: '', termsAccepted: true, privacyAccepted: true } });
    expect(response.status).toBe(201); return { cookie: firstCookie(response), ...(await response.json()) };
  }
  function bodyProbe(onPull = () => {}) {
    const read = vi.fn(controller => { onPull(); controller.enqueue(new TextEncoder().encode('{}')); controller.close(); });
    return { stream: new ReadableStream({ pull: read }, { highWaterMark: 0 }), read };
  }
  beforeEach(() => {
    local = siteD1();
    for (const migration of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0014_site_admin_sessions.sql','0015_site_content.sql','0016_site_shop_smartstore.sql','0017_site_shop_thumbnails.sql','0018_site_existing_content.sql','0019_site_shop_preview_images.sql','0020_site_shop_coupons.sql','0021_site_shop_shipping_note.sql','0022_site_shop_regional_shipping.sql','0023_site_shop_free_shipping.sql','0024_site_shop_bundle_orders.sql','0029_site_shop_recovery.sql']) {
      local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
    }
    mail = []; r2 = { put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: vi.fn() };
    adminEnv = { ...env, GAME_DB: local.db, SITE_ADMIN_ENABLED: 'true', AUTH_PASSWORD: password,
      JWT_SECRET: 'synthetic-namespace-teacher-secret', SITE_PASSWORD_SECRET: 'synthetic-member-password-pepper-32-characters',
      SITE_EMAIL_FROM: 'sender@fixture.invalid', SITE_EMAIL: { send: async message => { mail.push(message); return { messageId: 'synthetic' }; } }, SITE_SHOP_FILES: r2 };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unmocked external API denied'); }));
  });
  afterEach(() => { local.close(); });

  it('denies a fully registered member cookie on all administrator read and mutation categories', async () => {
    const signedIn = await member(); expect(signedIn.member.profileComplete).toBe(true);
    for (const [path, method] of [
      ['/admin/products','GET'], ['/admin/content','GET'], ['/admin/audit','GET'], ['/admin/shop-settings','GET'],
      ['/admin/shop-orders','GET'], ['/admin/products','POST'], ['/admin/content','POST'], ['/admin/coupons','GET'], ['/admin/coupons','POST'],
      ['/admin/products/fixture-product','DELETE'], ['/admin/shop-orders/11111111-1111-4111-8111-111111111111/refund','POST'],
      ['/admin/products/fixture-product/images','POST'], ['/admin/products/fixture-product/images','PATCH'],
      ['/admin/products/fixture-product/images/11111111-1111-4111-8111-111111111111','GET'],
      ['/admin/products/fixture-product/images/11111111-1111-4111-8111-111111111111','DELETE'],
    ]) {
      const response = await send(path, { method, session: signedIn, ...(method === 'GET' ? {} : { body: {} }) });
      expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: 'admin_login_required' });
    }
    expect(r2.put).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not consume an anonymous or member upload stream before denying administrator authority', async () => {
    for (const session of [undefined, await member()]) {
      const probe = bodyProbe(), response = await send('/admin/products/fixture-product/file', { method: 'POST', session,
        stream: probe.stream, headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' } });
      expect(response.status).toBe(401); expect(probe.read).not.toHaveBeenCalled();
    }
    expect(r2.put).not.toHaveBeenCalled();
  });
  it.each([['game','fixture-player'],['student','personal:fixture'],['dashboard','dashboard']])
    ('rejects a signed %s Bearer even with a forged teacher role before buffering an upload', async (purpose, subject) => {
      const token = await signTypedToken(adminEnv.JWT_SECRET, purpose, subject, 600, { role: 'teacher' }), probe = bodyProbe();
      const response = await send('/admin/products/fixture-product/file', { method: 'POST', stream: probe.stream,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data; boundary=synthetic' } });
      expect(response.status).toBe(401); expect(probe.read).not.toHaveBeenCalled(); expect(r2.put).not.toHaveBeenCalled();
    });
  it('denies cross-origin, same-site metadata and wrong CSRF administrator uploads before reading bytes', async () => {
    const signedIn = await admin();
    for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-CSRF-Token': 'x'.repeat(43) }]) {
      const probe = bodyProbe(), response = await send('/admin/products/fixture-product/file', { method: 'POST', session: signedIn,
        stream: probe.stream, headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic', ...headers } });
      expect(response.status).toBe(403); expect(probe.read).not.toHaveBeenCalled();
    }
    expect(r2.put).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('reauthorizes after buffering so logout during body delivery blocks upload parsing and storage', async () => {
    const signedIn = await admin();
    const probe = bodyProbe(() => local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run());
    const response = await send('/admin/products/fixture-product/file', { method: 'POST', session: signedIn,
      stream: probe.stream, headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' } });
    expect(probe.read).toHaveBeenCalledTimes(1); expect(response.status).toBe(401); expect(r2.put).not.toHaveBeenCalled();
  });
  it('allows an opaque administrator read only for the exact website origin with credential CORS and no Bearer DTO', async () => {
    const signedIn = await admin(), response = await send('/admin/content', { session: signedIn });
    expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    const data = await response.json(); expect(data.contents).toHaveLength(8); expect(data.nextCursor).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/Bearer|csrfToken|teacherToken/);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await send('/admin/content', { session: signedIn, headers: { Origin: 'http://localhost:5173' } })).status).toBe(403);
  });
  it('authorizes thumbnail upload and preview through the actual administrator namespace before reading bytes', async () => {
    const anonymous = bodyProbe();
    expect((await send('/admin/products/fixture-product/thumbnail',{method:'POST',stream:anonymous.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
    expect(anonymous.read).not.toHaveBeenCalled(); expect((await send('/admin/products/fixture-product/thumbnail')).status).toBe(401);
    const signedIn = await admin(), wrongCsrf = bodyProbe();
    expect((await send('/admin/products/fixture-product/thumbnail',{method:'POST',session:signedIn,stream:wrongCsrf.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic','X-CSRF-Token':'x'.repeat(43)}})).status).toBe(403);
    expect(wrongCsrf.read).not.toHaveBeenCalled();
    const revoked = bodyProbe(()=>local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run());
    expect((await send('/admin/products/fixture-product/thumbnail',{method:'POST',session:signedIn,stream:revoked.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
    expect(revoked.read).toHaveBeenCalledOnce(); expect(r2.put).not.toHaveBeenCalled();
  });
  it('permits thumbnail multipart above the general 128KiB boundary and limits actual or declared bytes at 2MiB plus framing', async () => {
    const signedIn = await admin(), input = { slug:'thumbnail-boundary',name:'합성 썸네일 교재',productType:'physical',price:12000,
      shippingFee:0,stock:1,termsVersion:'fixture-v1',refundPolicy:'합성 환불 기준',deliveryPolicy:'합성 배송 안내',status:'active' };
    expect((await send('/admin/products',{method:'POST',session:signedIn,body:input})).status).toBe(201);
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=','base64'));
    const bytes = new Uint8Array(192*1024); bytes.set(png.slice(0,-12)); bytes.set(png.slice(-12),bytes.length-12);
    const objects = new Map(); r2.put.mockImplementation(async (key,value)=>{objects.set(key,value);return {key};}); r2.get.mockImplementation(async key=>objects.has(key)?{body:new Response(objects.get(key)).body}:null);
    const form = new FormData(); form.set('file',new File([bytes],'cover.png',{type:'image/png'})); form.set('version','1');
    const response = await send('/admin/products/thumbnail-boundary/thumbnail',{method:'POST',session:signedIn,stream:form});
    expect(response.status).toBe(200); expect((await response.json()).product.thumbnailUrl).toMatch(/thumbnail\?v=2$/); expect(r2.put).toHaveBeenCalledOnce();
    const publicImage = await send('/products/thumbnail-boundary/thumbnail?v=2'); expect(publicImage.status).toBe(200); expect(publicImage.headers.get('Content-Type')).toBe('image/png'); expect((await publicImage.arrayBuffer()).byteLength).toBe(bytes.length);
    const large = 2*1024*1024+65537;
    expect((await send('/admin/products/thumbnail-boundary/thumbnail',{method:'POST',session:signedIn,stream:new Uint8Array(large),headers:{'Content-Type':'multipart/form-data; boundary=fixture'}})).status).toBe(413);
    expect((await send('/admin/products/thumbnail-boundary/thumbnail',{method:'POST',session:signedIn,stream:new Uint8Array(1),headers:{'Content-Type':'multipart/form-data; boundary=fixture','Content-Length':String(large)}})).status).toBe(413);
    expect(r2.put).toHaveBeenCalledOnce();
  });
  it('retains direct teacher-PWA Bearer access with admin switch off and never gives that origin cookie CORS', async () => {
    adminEnv.SITE_ADMIN_ENABLED = 'false';
    const token = await signTypedToken(adminEnv.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
    const response = await send('/admin/content', { headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it('denies content-image authority and CSRF before consuming bytes and checks authority again after delivery', async () => {
    const path='/admin/content/blog-224100629127/thumbnail';
    for(const session of [undefined,await member()]) {
      const probe=bodyProbe();
      expect((await send(path,{method:'POST',session,stream:probe.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
      expect(probe.read).not.toHaveBeenCalled();
    }
    const signedIn=await admin();
    for(const headers of [{'X-CSRF-Token':'x'.repeat(43)},{Origin:'https://attacker.invalid'},{'Sec-Fetch-Site':'same-site'}]) {
      const probe=bodyProbe();
      expect((await send(path,{method:'POST',session:signedIn,stream:probe.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic',...headers}})).status).toBe(403);
      expect(probe.read).not.toHaveBeenCalled();
    }
    const revoked=bodyProbe(()=>local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run());
    expect((await send(path,{method:'POST',session:signedIn,stream:revoked.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
    expect(revoked.read).toHaveBeenCalledOnce();expect(r2.put).not.toHaveBeenCalled();
  });
  it('routes content-image multipart above 128KiB and restricts public access to published cards', async () => {
    const signedIn=await admin(),slug='blog-224100629127';
    const selected=local.sqlite.prepare('SELECT version FROM site_content WHERE slug=?').get(slug);
    const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=','base64'));
    const bytes=new Uint8Array(192*1024);bytes.set(png.slice(0,-12));bytes.set(png.slice(-12),bytes.length-12);
    const objects=new Map();r2.put.mockImplementation(async(key,value)=>{objects.set(key,value);return{key};});
    r2.get.mockImplementation(async key=>objects.has(key)?{body:new Response(objects.get(key)).body}:null);
    const form=new FormData();form.set('file',new File([bytes],'cover.png',{type:'image/png'}));form.set('version',String(selected.version));
    const uploaded=await send(`/admin/content/${slug}/thumbnail`,{method:'POST',session:signedIn,stream:form});
    expect(uploaded.status).toBe(200);const content=(await uploaded.json()).content;
    expect(content.thumbnailUrl).toBe(`/api/site/admin/content/${slug}/thumbnail?v=2`);expect(r2.put).toHaveBeenCalledOnce();
    const image=await send(`/content/${slug}/thumbnail?v=2`);expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');expect((await image.arrayBuffer()).byteLength).toBe(bytes.length);
    expect((await send(`/admin/content/${slug}/thumbnail`)).status).toBe(401);
    const large=2*1024*1024+65537;
    expect((await send(`/admin/content/${slug}/thumbnail`,{method:'POST',session:signedIn,stream:new Uint8Array(large),headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(413);
    expect((await send(`/admin/content/${slug}/thumbnail`,{method:'POST',session:signedIn,stream:new Uint8Array(1),headers:{'Content-Type':'multipart/form-data; boundary=synthetic','Content-Length':String(large)}})).status).toBe(413);
    local.sqlite.prepare("UPDATE site_content SET status='draft' WHERE slug=?").run(slug);
    expect((await send(`/content/${slug}/thumbnail`)).status).toBe(404);
    expect((await send(`/admin/content/${slug}/thumbnail`,{session:signedIn})).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires administrator CSRF for gallery order and removal before consuming their request bodies', async () => {
    const signedIn = await admin();
    for (const [path,method] of [['/admin/products/fixture-product/images','PATCH'],
      ['/admin/products/fixture-product/images/11111111-1111-4111-8111-111111111111','DELETE']]) {
      for (const headers of [{ 'X-CSRF-Token':'x'.repeat(43) }, {Origin:'https://external-provider.invalid'}, {'Sec-Fetch-Site':'same-site'}]) {
        const probe = bodyProbe(), response = await send(path,{method,session:signedIn,stream:probe.stream,headers:{'Content-Type':'application/json',...headers}});
        expect(response.status).toBe(403); expect(probe.read).not.toHaveBeenCalled();
      }
    }
    const anonymous = bodyProbe();
    expect((await send('/admin/products/fixture-product/images',{method:'POST',stream:anonymous.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
    expect(anonymous.read).not.toHaveBeenCalled();
    const revoked = bodyProbe(()=>local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run());
    expect((await send('/admin/products/fixture-product/images',{method:'POST',session:signedIn,stream:revoked.stream,headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}})).status).toBe(401);
    expect(revoked.read).toHaveBeenCalledOnce(); expect(r2.put).not.toHaveBeenCalled();
  });
  it('routes a gallery upload, PATCH, preview and deletion with real cookie authority and tight multipart boundaries', async () => {
    const signedIn = await admin(), input = {slug:'gallery-boundary',name:'합성 갤러리 교재',productType:'physical',price:12000,
      shippingFee:0,stock:1,termsVersion:'fixture-v1',refundPolicy:'합성 환불 기준',deliveryPolicy:'합성 배송 안내',status:'active'};
    expect((await send('/admin/products',{method:'POST',session:signedIn,body:input})).status).toBe(201);
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=','base64'));
    const bytes = new Uint8Array(192*1024); bytes.set(png.slice(0,-12)); bytes.set(png.slice(-12),bytes.length-12);
    const objects = new Map(); r2.put.mockImplementation(async(key,value)=>{objects.set(key,value);return {key};}); r2.get.mockImplementation(async key=>objects.has(key)?{body:new Response(objects.get(key)).body}:null);
    const form = new FormData(); form.set('file',new File([bytes],'page.png',{type:'image/png'})); form.set('version','1');
    const uploaded = await send('/admin/products/gallery-boundary/images',{method:'POST',session:signedIn,stream:form}); expect(uploaded.status).toBe(200);
    const product = (await uploaded.json()).product, imageId=product.previewImages[0].id;
    const preview = await send(`/products/gallery-boundary/images/${imageId}`); expect(preview.status).toBe(200); expect((await preview.arrayBuffer()).byteLength).toBe(bytes.length);
    const preflight = await send('/admin/products/gallery-boundary/images',{method:'OPTIONS'}); expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
    const reordered = await send('/admin/products/gallery-boundary/images',{method:'PATCH',session:signedIn,body:{version:product.version,imageIds:[imageId]}}); expect(reordered.status).toBe(200);
    const current = (await reordered.json()).product;
    expect((await send(`/admin/products/gallery-boundary/images/${imageId}`,{method:'DELETE',session:signedIn,body:{version:current.version}})).status).toBe(200);
    expect((await send(`/products/gallery-boundary/images/${imageId}`)).status).toBe(404);
    const large = 2*1024*1024+65537;
    for (const body of [new Uint8Array(large),new Uint8Array(1)]) {
      expect((await send('/admin/products/gallery-boundary/images',{method:'POST',session:signedIn,stream:body,
        headers:{'Content-Type':'multipart/form-data; boundary=fixture',...(body.length===1?{'Content-Length':String(large)}:{})}})).status).toBe(413);
    }
    expect(r2.put).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('reauthorizes a content edit after buffering so logout during delivery cannot change a public card', async () => {
    const signedIn = await admin();
    const slug = 'blog-224100629127', before = local.sqlite.prepare('SELECT title,version FROM site_content WHERE slug=?').get(slug);
    const payload = {slug,title:'취소될 편집',summary:'',body:'',category:'learn',externalUrl:'https://blog.naver.com/tiantian_chinese/224100629127',status:'published',sortOrder:0,version:before.version};
    const stream = new ReadableStream({pull(controller){
      local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run();
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload))); controller.close();
    }},{highWaterMark:0});
    const response = await send(`/admin/content/${slug}`,{method:'PUT',session:signedIn,stream,headers:{'Content-Type':'application/json'}});
    expect(response.status).toBe(401);
    expect(local.sqlite.prepare('SELECT title,version FROM site_content WHERE slug=?').get(slug)).toEqual(before);
  });
  it('confines credential preflight to the website and rejects provider-CORS bypass on administrator endpoints', async () => {
    const website = await send('/admin/products', { method: 'OPTIONS' }); expect(website.status).toBe(204);
    expect(website.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(website.headers.get('Access-Control-Allow-Headers')).toContain('X-CSRF-Token');
    for (const path of ['/admin/session','/admin/auth/login','/admin/products/fixture-product/file','/admin/webhooks/payssam']) {
      const response = await send(path, { method: 'POST', body: {}, headers: { Origin: 'https://external-provider.invalid' } });
      expect(response.status).toBe(403); expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
