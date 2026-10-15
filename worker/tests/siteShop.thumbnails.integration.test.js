import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteShopRoutes } from '../lib/siteShop.js';

const ORIGIN = 'http://localhost:4325';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=', 'base64'));
const JPEG = new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
function webp(chunk = 'VP8 ') {
  const bytes = new Uint8Array(chunk === 'VP8L' ? 26 : 30), view = new DataView(bytes.buffer);
  for (const [offset, word] of [[0,'RIFF'],[8,'WEBP'],[12,chunk]]) bytes.set(new TextEncoder().encode(word), offset);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, chunk === 'VP8L' ? 5 : 10, true);
  if (chunk === 'VP8 ') { bytes.set([157,1,42], 23); view.setUint16(26,1,true); view.setUint16(28,1,true); }
  if (chunk === 'VP8L') bytes[20] = 47;
  return bytes;
}
let local, env, files, reads, writes, deleted;
const teacher = async request => request.headers.get('Authorization') === 'Bearer synthetic-thumbnail-admin' ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
function send(path, { method = 'GET', body, admin = false } = {}) {
  const multipart = body instanceof FormData;
  return handleSiteShopRoutes(new Request(`${ORIGIN}/api/site${path}`, { method,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.65', ...(admin ? { Authorization: 'Bearer synthetic-thumbnail-admin' } : {}), ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) }), env, {}, { authorizeTeacher: teacher });
}
async function product(overrides = {}) {
  const response = await send('/admin/products', { method: 'POST', admin: true, body: { slug: 'thumbnail-book', name: '합성 이미지 교재',
    productType: 'physical', regionalShipping: { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] }, price: 12000, stock: 1, shippingFee: 0, termsVersion: 'fixture-v1', refundPolicy: '합성 환불 기준', deliveryPolicy: '합성 배송 안내', status: 'active', ...overrides } });
  expect(response.status).toBe(201); return (await response.json()).product;
}
function upload(selected, bytes = PNG, { name = 'cover.png', type = 'image/png', admin = true, extra, version = selected.version } = {}) {
  const form = new FormData(); form.set('file', new File([bytes], name, { type })); form.set('version', String(version)); if (extra) form.set(...extra);
  return send(`/admin/products/${selected.id}/thumbnail`, { method: 'POST', body: form, admin });
}
beforeEach(() => {
  local = siteD1();
  for (const migration of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0015_site_content.sql','0016_site_shop_smartstore.sql','0017_site_shop_thumbnails.sql','0020_site_shop_coupons.sql','0021_site_shop_shipping_note.sql','0022_site_shop_regional_shipping.sql','0023_site_shop_free_shipping.sql','0024_site_shop_bundle_orders.sql','0029_site_shop_recovery.sql']) local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  files = new Map([['shop/private-purchase.pdf', new TextEncoder().encode('%PDF-private')]]); reads = []; writes = []; deleted = [];
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-thumbnail-security-secret', SITE_SESSION_SECRET: 'synthetic-thumbnail-session-secret-32', SITE_SHOP_SALES_MODE: 'direct',
    SITE_SHOP_FILES: { head: async key => files.has(key) ? { key } : null,
      get: async key => { reads.push(key); return files.has(key) ? { body: new Response(files.get(key)).body } : null; },
      put: async (key, value, options) => { writes.push({ key, options }); files.set(key, new Uint8Array(value)); return { key }; },
      delete: async key => { deleted.push(key); files.delete(key); } } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.restoreAllMocks(); });

describe('product thumbnails are separate from paid downloads', () => {
  it.each([{ bytes:PNG,name:'cover.png',type:'image/png' },{ bytes:JPEG,name:'cover.jpeg',type:'image/jpeg' },
    { bytes:webp(),name:'cover.webp',type:'image/webp' },{ bytes:webp('VP8L'),name:'cover.webp',type:'image/webp' },{ bytes:webp('VP8X'),name:'cover.webp',type:'image/webp' }])('uploads $type with CAS and sanitized public/admin URLs', async ({ bytes, name, type }) => {
    const selected = await product(); expect(selected.thumbnailUrl).toBeNull();
    const response = await upload(selected, bytes, { name, type }); expect(response.status).toBe(200);
    const updated = (await response.json()).product; expect(updated.version).toBe(2); expect(updated.thumbnailUrl).toBe('/api/site/admin/products/thumbnail-book/thumbnail?v=2');
    const publicProduct = (await (await send('/products/thumbnail-book')).json()).product;
    expect(publicProduct.thumbnailUrl).toBe('/api/site/products/thumbnail-book/thumbnail?v=2'); expect(publicProduct).not.toHaveProperty('thumbnailKey');
    expect(writes[0].key).toMatch(/^shop-thumbnails\/thumbnail-book\/v2-[a-f0-9-]+\.(png|jpg|webp)$/);
    expect(writes[0].options.httpMetadata.contentType).toBe(type);
    const image = await send(publicProduct.thumbnailUrl.replace('/api/site', ''));
    expect(image.status).toBe(200); expect(image.headers.get('Content-Type')).toBe(type); expect(image.headers.get('Cache-Control')).toBe('no-store');
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff'); expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
    expect(local.sqlite.prepare("SELECT count(*) AS count FROM site_admin_audit WHERE action='product.thumbnail' AND outcome='success'").get().count).toBe(1);
    expect(files.has('shop/private-purchase.pdf')).toBe(true);
  });
  it('allows authenticated draft previews but hides drafts and archived assets from public GET', async () => {
    const selected = await product({ status: 'draft' });
    const uploaded = (await (await upload(selected)).json()).product;
    expect((await send('/admin/products/thumbnail-book/thumbnail', { admin: true })).status).toBe(200);
    expect((await send('/admin/products/thumbnail-book/thumbnail')).status).toBe(401);
    expect((await send('/products/thumbnail-book/thumbnail')).status).toBe(404);
    const archived = await send('/admin/products/thumbnail-book', { method: 'DELETE', admin: true, body: { version: uploaded.version } }); expect(archived.status).toBe(200);
    const current = (await archived.json()).product;
    expect((await upload(current)).status).toBe(409); expect((await send('/admin/products/thumbnail-book/thumbnail', { admin: true })).status).toBe(404);
  });
  it('rejects SVG, fake magic, MIME mismatch, oversized dimensions, extra raw keys and bytes before R2 writes', async () => {
    const selected = await product(), largeDimensions = PNG.slice(); new DataView(largeDimensions.buffer).setUint32(16,4097);
    for (const [bytes, options] of [[new TextEncoder().encode('<svg/>'),{ name:'cover.svg',type:'image/svg+xml' }],
      [new TextEncoder().encode('<html/>'),{}],[PNG,{ type:'image/jpeg' }],[PNG,{ name:'cover.jpg' }],[largeDimensions,{}],
      [PNG,{ extra:['thumbnailKey','shop/private-purchase.pdf'] }],[PNG,{ version:'0' }]]) expect((await upload(selected,bytes,options)).status).toBe(400);
    expect((await upload(selected,new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(selected,PNG,{ admin:false })).status).toBe(401); expect(writes).toHaveLength(0);
    expect((await send('/admin/products', { method:'POST',admin:true,body:{ slug:'unsafe',name:'합성',productType:'physical',price:1,thumbnailKey:'shop/private-purchase.pdf' } })).status).toBe(400);
  });
  it('removes only the losing unique upload after a concurrent archive CAS', async () => {
    const selected = await product(); let entered, release;
    const started = new Promise(resolve => { entered=resolve; }), hold = new Promise(resolve => { release=resolve; });
    const original = env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put = async (...args) => { const result = await original(...args); entered(); await hold; return result; };
    const uploading = upload(selected); await started;
    await send('/admin/products/thumbnail-book', { method:'DELETE',admin:true,body:{ version:selected.version } });
    release(); expect((await uploading).status).toBe(409); expect(deleted).toEqual([writes[0].key]);
    expect(files.size).toBe(1); expect(files.has('shop/private-purchase.pdf')).toBe(true);
  });
  it('checks publication again after R2.get and cancels bytes if a product is archived in flight', async () => {
    const selected = await product(), current = (await (await upload(selected)).json()).product;
    let entered, release; const started = new Promise(resolve => { entered=resolve; }), hold = new Promise(resolve => { release=resolve; }), cancelled=vi.fn();
    env.SITE_SHOP_FILES.get = async () => { entered(); await hold; return { body:new ReadableStream({ start(controller) { controller.enqueue(PNG); }, cancel:cancelled }) }; };
    const reading = send('/products/thumbnail-book/thumbnail?v=2'); await started;
    await send('/admin/products/thumbnail-book', { method:'DELETE',admin:true,body:{ version:current.version } });
    release(); expect((await reading).status).toBe(404); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('keeps previously published objects during replacement and serves only the latest pointer without immutable cache', async () => {
    const selected = await product(), first = (await (await upload(selected)).json()).product, firstKey = writes[0].key;
    const second = (await (await upload(first,JPEG,{name:'cover.jpg',type:'image/jpeg'})).json()).product;
    expect(second.version).toBe(3); expect(second.thumbnailUrl).toMatch(/\?v=3$/); expect(files.has(firstKey)).toBe(true); expect(deleted).toHaveLength(0);
    const latest = await send('/products/thumbnail-book/thumbnail?v=2'); expect(latest.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(JPEG);
  });
  it('cleans an unpublished upload on database failure but retains a committed pointer after a lost database reply', async () => {
    const selected = await product(), original = env.GAME_DB.batch;
    env.GAME_DB.batch = async () => { throw new Error('synthetic_database_failure'); };
    expect((await upload(selected)).status).toBe(503); expect(deleted).toEqual([writes[0].key]); expect(files.size).toBe(1);
    env.GAME_DB.batch = async statements => { await original(statements); throw new Error('synthetic_database_reply_lost'); };
    expect((await upload(selected)).status).toBe(503);
    const current = (await (await send('/admin/products/thumbnail-book',{admin:true})).json()).product;
    expect(current.version).toBe(2); expect(current.thumbnailUrl).toMatch(/thumbnail\?v=2$/); expect(files.has(writes[1].key)).toBe(true); expect(deleted).toHaveLength(1);
  });
  it('cleans a failed R2 write without ever changing the product pointer', async () => {
    const selected = await product(), original = env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put = async (...args) => { await original(...args); throw new Error('synthetic_r2_reply_lost'); };
    expect((await upload(selected)).status).toBe(503); expect(deleted).toEqual([writes[0].key]);
    expect((await (await send('/admin/products/thumbnail-book',{admin:true})).json()).product.thumbnailUrl).toBeNull();
  });
  it('cannot expose a paid download through a tampered thumbnail pointer', async () => {
    await product();
    local.sqlite.exec("PRAGMA ignore_check_constraints=ON; UPDATE site_shop_products SET thumbnail_key='shop/private-purchase.pdf',thumbnail_content_type='image/png';");
    expect((await send('/products/thumbnail-book/thumbnail')).status).toBe(404); expect(reads).toHaveLength(0);
    expect((await (await send('/products/thumbnail-book')).json()).product.thumbnailUrl).toBeNull();
  });
});
