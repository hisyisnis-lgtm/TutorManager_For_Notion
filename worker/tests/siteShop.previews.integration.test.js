import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteShopRoutes } from '../lib/siteShop.js';

const ORIGIN = 'http://localhost:4325';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=', 'base64'));
const JPEG = new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
let local, env, files, reads, writes, deleted;
const teacher = async request => request.headers.get('Authorization') === 'Bearer synthetic-preview-admin'
  ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
function send(path, { method = 'GET', body, admin = false } = {}) {
  const multipart = body instanceof FormData;
  return handleSiteShopRoutes(new Request(`${ORIGIN}/api/site${path}`, { method,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.66', ...(admin ? { Authorization: 'Bearer synthetic-preview-admin' } : {}),
      ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) }), env, {}, { authorizeTeacher: teacher });
}
async function product(overrides = {}) {
  const response = await send('/admin/products', { method: 'POST', admin: true, body: { slug: 'preview-book', name: '합성 미리보기 교재',
    productType: 'physical', regionalShipping: { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] }, price: 12000, stock: 3, shippingFee: 0, termsVersion: 'fixture-v1', refundPolicy: '합성 환불 기준', deliveryPolicy: '합성 배송 안내', status: 'active', ...overrides } });
  expect(response.status).toBe(201); return (await response.json()).product;
}
function upload(selected, bytes = PNG, { name = 'page.png', type = 'image/png', admin = true, extra, version = selected.version, kind = 'images' } = {}) {
  const form = new FormData(); form.set('file', new File([bytes], name, { type })); form.set('version', String(version)); if (extra) form.set(...extra);
  return send(`/admin/products/${selected.id}/${kind}`, { method: 'POST', body: form, admin });
}
async function added(selected, bytes, options) {
  const response = await upload(selected, bytes, options); expect(response.status).toBe(200); return (await response.json()).product;
}
const imagePath = (selected, index = 0, admin = false) => `/api/site/${admin ? 'admin/' : ''}products/${selected.id}/images/${selected.previewImages[index].id}`;
const image = (selected, index = 0, admin = false) => send(imagePath(selected, index, admin).replace('/api/site', ''), { admin });
const stored = () => JSON.parse(local.sqlite.prepare('SELECT preview_images_json FROM site_shop_products WHERE slug=?').get('preview-book').preview_images_json);
beforeEach(() => {
  local = siteD1();
  for (const migration of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0015_site_content.sql','0016_site_shop_smartstore.sql','0017_site_shop_thumbnails.sql','0019_site_shop_preview_images.sql','0020_site_shop_coupons.sql','0021_site_shop_shipping_note.sql','0022_site_shop_regional_shipping.sql','0023_site_shop_free_shipping.sql','0024_site_shop_bundle_orders.sql','0029_site_shop_recovery.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  files = new Map([['shop/private-purchase.pdf', new TextEncoder().encode('%PDF-private')]]); reads = []; writes = []; deleted = [];
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-preview-security-secret', SITE_SESSION_SECRET: 'synthetic-preview-session-secret-32', SITE_SHOP_SALES_MODE: 'direct',
    SITE_SHOP_FILES: { head: async key => files.has(key) ? { key } : null,
      get: async key => { reads.push(key); return files.has(key) ? { body: new Response(files.get(key)).body } : null; },
      put: async (key, value, options) => { writes.push({ key, options }); files.set(key, new Uint8Array(value)); return { key }; },
      delete: async key => { deleted.push(key); files.delete(key); } } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.restoreAllMocks(); });

describe('product gallery previews', () => {
  it('keeps the representative cover, paid download and additional previews independent', async () => {
    const selected = await product(); expect(selected.previewImages).toEqual([]);
    const cover = await added(selected, PNG, { kind: 'thumbnail' });
    const first = await added(cover), updated = await added(first, JPEG, { name: 'page.jpeg', type: 'image/jpeg' });
    expect(updated.version).toBe(4); expect(updated.thumbnailUrl).toMatch(/thumbnail\?v=4$/); expect(updated.previewImages).toHaveLength(2);
    const descriptors = stored(); expect(descriptors.map(entry => entry.mime)).toEqual(['image/png','image/jpeg']);
    expect(descriptors[0].key).toBe(`shop-previews/preview-book/${descriptors[0].id}.png`);
    const publicProduct = (await (await send('/products/preview-book')).json()).product;
    expect(publicProduct.previewImages).toEqual(updated.previewImages.map(entry => ({ id: entry.id, url: entry.url.replace('/admin/', '/') })));
    expect(Object.keys(publicProduct.previewImages[0])).toEqual(['id','url']);
    const response = await image(publicProduct, 1); expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff'); expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(files.has('shop/private-purchase.pdf')).toBe(true); expect(deleted).toEqual([]);
    expect(local.sqlite.prepare("SELECT count(*) AS count FROM site_admin_audit WHERE action='product.preview.add' AND outcome='success'").get().count).toBe(2);
  });
  it('limits extra previews to nine before storing a tenth object', async () => {
    let selected = await product();
    for (let index = 0; index < 9; index++) selected = await added(selected);
    const response = await upload(selected); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'preview_limit' });
    expect(writes).toHaveLength(9); expect(stored()).toHaveLength(9);
  });
  it('reorders exactly the current UUID set and deletes only a selected descriptor while retaining the cover and private file', async () => {
    const first = await added(await product()), second = await added(first, JPEG, { name: 'page.jpg', type: 'image/jpeg' }), before = stored();
    const response = await send('/admin/products/preview-book/images', { method: 'PATCH', admin: true, body: { version: second.version, imageIds: second.previewImages.map(entry => entry.id).reverse() } });
    expect(response.status).toBe(200); const reordered = (await response.json()).product;
    expect(stored()).toEqual(before.slice().reverse()); expect(reordered.version).toBe(second.version + 1);
    expect(new Uint8Array(await (await image(reordered, 0)).arrayBuffer())).toEqual(JPEG);
    const removing = reordered.previewImages[0], result = await send(imagePath(reordered, 0, true).replace('/api/site',''), { method: 'DELETE', admin: true, body: { version: reordered.version } });
    expect(result.status).toBe(200); const after = (await result.json()).product;
    expect(after.previewImages.map(entry => entry.id)).toEqual([first.previewImages[0].id]); expect(stored()).toEqual([before[0]]);
    for (const prefix of ['', '/admin']) expect((await send(`${prefix}/products/preview-book/images/${removing.id}`, { admin: !!prefix })).status).toBe(404);
    expect((await send('/admin/products/preview-book/images', { method: 'PATCH', admin: true, body: { version: after.version, imageIds: reordered.previewImages.map(entry => entry.id) } })).status).toBe(400);
    expect(files.has(before[1].key)).toBe(true); expect(files.has('shop/private-purchase.pdf')).toBe(true); expect(deleted).toEqual([]);
    expect(local.sqlite.prepare("SELECT action FROM site_admin_audit WHERE action LIKE 'product.preview.%' AND outcome='success' ORDER BY rowid").all().map(row => row.action))
      .toEqual(['product.preview.add','product.preview.add','product.preview.reorder','product.preview.delete']);
  });
  it('rejects incomplete, duplicate, foreign image order sets and raw asset descriptors', async () => {
    const first = await added(await product()), current = await added(first), ids = current.previewImages.map(entry => entry.id);
    for (const imageIds of [[], [ids[0]], [ids[0],ids[0]], [ids[0],OTHER_ID], [...ids,OTHER_ID]]) {
      expect((await send('/admin/products/preview-book/images', { method: 'PATCH', admin: true, body: { version: current.version, imageIds } })).status).toBe(400);
    }
    expect((await send('/admin/products/preview-book/images', { method: 'PATCH', admin: true, body: { version: current.version, imageIds: ids, key: 'shop/private-purchase.pdf' } })).status).toBe(400);
    expect((await send(`/admin/products/preview-book/images/${OTHER_ID}`, { method: 'DELETE', admin: true, body: { version: current.version } })).status).toBe(404);
    expect((await send('/admin/products', { method: 'POST', admin: true, body: { slug: 'raw-images', name: '합성', productType: 'physical', price: 100, previewImages: ids } })).status).toBe(400);
    expect(stored().map(entry => entry.id)).toEqual(ids); expect(writes).toHaveLength(2);
  });
  it('allows authenticated draft reads and rejects public, cross-product and archived reads without fetching private bytes', async () => {
    const current = await added(await product({ status: 'draft' }));
    expect((await image(current, 0, true)).status).toBe(200); expect((await image(current)).status).toBe(404);
    expect((await send(`/admin/products/preview-book/images/${current.previewImages[0].id}`)).status).toBe(401);
    const other = await product({ slug: 'other-product' });
    expect((await send(`/products/${other.id}/images/${current.previewImages[0].id}`)).status).toBe(404);
    const response = await send('/admin/products/preview-book', { method: 'DELETE', admin: true, body: { version: current.version } });
    const archived = (await response.json()).product; expect(response.status).toBe(200);
    expect((await image(archived, 0, true)).status).toBe(404); expect((await upload(archived)).status).toBe(409);
    expect((await send('/admin/products/preview-book/images', { method: 'PATCH', admin: true, body: { version: archived.version, imageIds: archived.previewImages.map(entry => entry.id) } })).status).toBe(409);
    expect(reads).toHaveLength(1);
  });
  it('shares image signature, extension, MIME, dimension and multipart validation before R2 writes', async () => {
    const current = await product(), dimensions = PNG.slice(); new DataView(dimensions.buffer).setUint32(16,4097);
    for (const [bytes, options] of [[new TextEncoder().encode('<svg/>'), { name: 'page.svg', type: 'image/svg+xml' }], [new TextEncoder().encode('<html/>'), {}],
      [PNG, { type: 'image/jpeg' }], [PNG, { name: 'page.jpg' }], [dimensions, {}], [PNG, { extra: ['key','shop/private-purchase.pdf'] }]]) {
      expect((await upload(current, bytes, options)).status).toBe(400);
    }
    expect((await upload(current, new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(current, PNG, { admin: false })).status).toBe(401); expect(writes).toEqual([]);
    expect((await send('/admin/products/preview-book/images', { method: 'POST', admin: true, body: { version: current.version } })).status).toBe(400);
    expect((await send('/products/preview-book/images/not-a-uuid')).status).toBe(400); expect(reads).toEqual([]);
  });
  it('retains exactly one winner from concurrent uploads and cleans only the losing never-published object', async () => {
    const selected = await product(); let entered, release, count = 0;
    const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    const put = env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put = async (...args) => { const result = await put(...args); if (++count === 2) entered(); await hold; return result; };
    const first = upload(selected), second = upload(selected); await started; release();
    const responses = await Promise.all([first,second]); expect(responses.map(response => response.status).sort()).toEqual([200,409]);
    expect(stored()).toHaveLength(1); const saved = stored()[0]; expect(files.has(saved.key)).toBe(true);
    expect(deleted).toHaveLength(1); expect(deleted[0]).not.toBe(saved.key); expect(files.has('shop/private-purchase.pdf')).toBe(true);
    expect(local.sqlite.prepare("SELECT count(*) AS count FROM site_admin_audit WHERE action='product.preview.add' AND outcome='success'").get().count).toBe(1);
  });
  it('checks removal again after R2.get and cancels bytes deleted in flight', async () => {
    const current = await added(await product()); let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; }), cancelled = vi.fn();
    env.SITE_SHOP_FILES.get = async () => { entered(); await hold; return { body: new ReadableStream({ start(controller) { controller.enqueue(PNG); }, cancel: cancelled }) }; };
    const reading = image(current); await started;
    expect((await send(imagePath(current,0,true).replace('/api/site',''), { method: 'DELETE', admin: true, body: { version: current.version } })).status).toBe(200);
    release(); expect((await reading).status).toBe(404); expect(cancelled).toHaveBeenCalledOnce();
  });
  it('does not overwrite current previews or remove old assets after stale reorder or deletion', async () => {
    const first = await added(await product()), current = await added(first);
    for (const [path, method, body] of [['/admin/products/preview-book/images','PATCH',{ version: first.version, imageIds: first.previewImages.map(entry => entry.id) }],
      [imagePath(first,0,true).replace('/api/site',''),'DELETE',{ version: first.version }]]) {
      const response = await send(path,{method,admin:true,body}); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({code:'version_conflict'});
    }
    expect(stored()).toHaveLength(2); expect(deleted).toEqual([]); expect(current.version).toBe(3);
  });
  it('cleans only proven orphan uploads after failed or lost database replies', async () => {
    const selected = await product(), batch = env.GAME_DB.batch;
    env.GAME_DB.batch = async () => { throw new Error('synthetic_database_failure'); };
    expect((await upload(selected)).status).toBe(503); expect(deleted).toEqual([writes[0].key]); expect(stored()).toEqual([]);
    env.GAME_DB.batch = async statements => { await batch(statements); throw new Error('synthetic_reply_lost'); };
    expect((await upload(selected)).status).toBe(503); expect(stored()).toHaveLength(1); expect(files.has(writes[1].key)).toBe(true); expect(deleted).toHaveLength(1);
  });
  it('preserves an ambiguous new object if both database write and confirmation fail', async () => {
    const selected = await product(), prepare = env.GAME_DB.prepare; let failed = false;
    env.GAME_DB.batch = async () => { failed = true; throw new Error('synthetic_write_unknown'); };
    env.GAME_DB.prepare = sql => { if (failed && sql.includes('SELECT * FROM site_shop_products')) throw new Error('synthetic_read_unknown'); return prepare(sql); };
    expect((await upload(selected)).status).toBe(503); expect(deleted).toEqual([]); expect(files.has(writes[0].key)).toBe(true);
  });
  it('cleans failed R2 writes without changing the saved descriptors', async () => {
    const selected = await product(), put = env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put = async (...args) => { await put(...args); throw new Error('synthetic_r2_reply_lost'); };
    expect((await upload(selected)).status).toBe(503); expect(stored()).toEqual([]); expect(deleted).toEqual([writes[0].key]);
  });
  it('hides tampered paid-file, cross-product and duplicate descriptors and refuses destructive edits', async () => {
    const selected = await product();
    const invalid = [
      [{ id: OTHER_ID, key: 'shop/private-purchase.pdf', mime: 'image/png', size: PNG.length }],
      [{ id: OTHER_ID, key: `shop-previews/other-product/${OTHER_ID}.png`, mime: 'image/png', size: PNG.length }],
      [{ id: OTHER_ID, key: `shop-previews/preview-book/${OTHER_ID}.png`, mime: 'image/png', size: PNG.length, rawKey: 'unexpected' }],
      Array(2).fill({ id: OTHER_ID, key: `shop-previews/preview-book/${OTHER_ID}.png`, mime: 'image/png', size: PNG.length }),
    ];
    for (const descriptors of invalid) {
      local.sqlite.prepare('UPDATE site_shop_products SET preview_images_json=? WHERE slug=?').run(JSON.stringify(descriptors), selected.id);
      expect((await (await send('/products/preview-book')).json()).product.previewImages).toEqual([]);
      expect((await send(`/products/preview-book/images/${OTHER_ID}`)).status).toBe(404);
      expect((await upload(selected)).status).toBe(409);
      expect((await send('/admin/products/preview-book/images',{method:'PATCH',admin:true,body:{version:selected.version,imageIds:[]}})).status).toBe(409);
    }
    expect(reads).toEqual([]); expect(writes).toEqual([]); expect(files.has('shop/private-purchase.pdf')).toBe(true);
  });
  it('bounds and checks the persistent JSON column without affecting legacy products', async () => {
    const selected = await product(); expect(stored()).toEqual([]);
    for (const raw of ['{', '{}', JSON.stringify(Array(10).fill({})), JSON.stringify(['a'.repeat(4096)])]) {
      expect(() => local.sqlite.prepare('UPDATE site_shop_products SET preview_images_json=? WHERE slug=?').run(raw, selected.id)).toThrow();
    }
    expect((await (await send('/products/preview-book')).json()).product.previewImages).toEqual([]);
  });
});
