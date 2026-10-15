import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAdminContentRoutes } from '../lib/siteAdminContent.js';

const ORIGIN = 'http://localhost:4325';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cXuoAAAAASUVORK5CYII=', 'base64'));
const JPEG = new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
const WEBP = new Uint8Array(30);
for (const [offset, word] of [[0,'RIFF'],[8,'WEBP'],[12,'VP8 ']]) WEBP.set(new TextEncoder().encode(word), offset);
new DataView(WEBP.buffer).setUint32(4,22,true); new DataView(WEBP.buffer).setUint32(16,10,true);
WEBP.set([157,1,42],23); new DataView(WEBP.buffer).setUint16(26,1,true); new DataView(WEBP.buffer).setUint16(28,1,true);
let local, env, files, reads, writes, deleted;
const teacher = async request => request.headers.get('Authorization') === 'Bearer synthetic-content-image-admin'
  ? null : Response.json({error:'teacher_required'},{status:401});
function send(path,{method='GET',body,admin=false}={}) {
  const multipart = body instanceof FormData;
  return handleSiteAdminContentRoutes(new Request(`${ORIGIN}/api/site${path}`,{method,
    headers:{Origin:ORIGIN,'CF-Connecting-IP':'198.51.100.66',...(admin?{Authorization:'Bearer synthetic-content-image-admin'}:{}),
      ...(!multipart&&body?{'Content-Type':'application/json'}:{})},...(body?{body:multipart?body:JSON.stringify(body)}:{})}),env,{}, {authorizeTeacher:teacher});
}
const article = (overrides={}) => ({slug:'content-image-card',title:'중국어 회화 안내',summary:'발음부터 회화까지',body:'글 본문',category:'learn',
  status:'draft',sortOrder:0,displayCategory:'회화',tags:['#회화'],showOnHome:true,homeSortOrder:0,...overrides});
async function created(overrides={}) {
  const response = await send('/admin/content',{method:'POST',admin:true,body:article(overrides)});
  expect(response.status).toBe(201); return (await response.json()).content;
}
function upload(selected,bytes=PNG,{name='cover.png',type='image/png',admin=true,version=selected.version,extra}={}) {
  const form=new FormData(); form.set('file',new File([bytes],name,{type})); form.set('version',String(version));
  if(extra) form.append(...extra);
  return send(`/admin/content/${selected.slug}/thumbnail`,{method:'POST',body:form,admin});
}
const edit = (selected,overrides={}) => send(`/admin/content/${selected.slug}`,{method:'PUT',admin:true,
  body:article({version:selected.version,...overrides})});
beforeEach(()=>{
  local=siteD1();
  for(const migration of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0015_site_content.sql','0018_site_existing_content.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
  }
  local.sqlite.exec('DELETE FROM site_content');
  files=new Map([['shop/private-purchase.pdf',new TextEncoder().encode('%PDF-private')]]); reads=[]; writes=[]; deleted=[];
  env={GAME_DB:local.db,JWT_SECRET:'synthetic-content-image-secret',SITE_SESSION_SECRET:'synthetic-content-session-secret-32',
    SITE_SHOP_FILES:{get:async key=>{reads.push(key);return files.has(key)?{body:new Response(files.get(key)).body}:null;},
      put:async(key,bytes,options)=>{writes.push({key,options}); files.set(key,new Uint8Array(bytes)); return {key};},
      delete:async key=>{deleted.push(key); files.delete(key);}}};
  vi.spyOn(console,'error').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_http_forbidden');}));
});
afterEach(()=>{local.close();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('content representative image storage and visibility',()=>{
  it.each([{bytes:PNG,name:'cover.png',type:'image/png'},{bytes:JPEG,name:'cover.jpeg',type:'image/jpeg'},
    {bytes:WEBP,name:'cover.webp',type:'image/webp'}])('uploads $type with CAS and exposes URLs without object keys',async({bytes,name,type})=>{
    const selected=await created({status:'published',thumbnailUrl:'/img/posts/conversation-start-teacher.webp'});
    const response=await upload(selected,bytes,{name,type}); expect(response.status).toBe(200);
    const current=(await response.json()).content;
    expect(current).toMatchObject({version:2,thumbnailUrl:'/api/site/admin/content/content-image-card/thumbnail?v=2'});
    expect(writes[0].key).toMatch(/^content-thumbnails\/content-image-card\/v2-[a-f0-9-]+\.(png|jpg|webp)$/);
    expect(writes[0].options.httpMetadata.contentType).toBe(type);
    const listed=(await(await send('/content?placement=home')).json()).contents[0];
    expect(listed.thumbnailUrl).toBe('/api/site/content/content-image-card/thumbnail?v=2');
    expect(JSON.stringify(listed)).not.toContain('content-thumbnails');
    expect((await(await send('/content/content-image-card')).json()).content.thumbnailUrl).toBe(listed.thumbnailUrl);
    const preview=await send(listed.thumbnailUrl.replace('/api/site',''));
    expect(preview.status).toBe(200); expect(preview.headers.get('Content-Type')).toBe(type);
    expect(preview.headers.get('Cache-Control')).toBe('no-store'); expect(preview.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(preview.headers.get('Content-Disposition')).toBe('inline');
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(bytes);
    expect(local.sqlite.prepare("SELECT COUNT(*) AS total FROM site_admin_audit WHERE action='content.thumbnail' AND outcome='success'").get().total).toBe(1);
    expect(files.has('shop/private-purchase.pdf')).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps legacy assets and preserves an uploaded pointer across metadata changes, deletion and restoration',async()=>{
    const initial=await created({thumbnailUrl:'/img/posts/conversation-start-teacher.webp'});
    expect(initial.thumbnailUrl).toBe('/img/posts/conversation-start-teacher.webp');
    const current=(await(await upload(initial)).json()).content, key=writes[0].key;
    const metadata=await edit(current,{title:'수정한 제목',status:'published'}); expect(metadata.status).toBe(200);
    const updated=(await metadata.json()).content;
    expect(updated.thumbnailUrl).toBe('/api/site/admin/content/content-image-card/thumbnail?v=3');
    expect(local.sqlite.prepare('SELECT thumbnail_url FROM site_content WHERE slug=?').get(initial.slug).thumbnail_url).toBe(key);
    const archived=await send(`/admin/content/${initial.slug}`,{method:'DELETE',admin:true,body:{version:updated.version}});
    expect(archived.status).toBe(200);
    expect((await send(`/content/${initial.slug}/thumbnail`)).status).toBe(404);
    const deletedContent=(await archived.json()).content;
    expect((await upload(deletedContent)).status).toBe(409);
    const restored=await edit(deletedContent,{status:'draft',title:'복원한 제목'}); expect(restored.status).toBe(200);
    const draft=(await restored.json()).content;
    expect((await send(`/admin/content/${initial.slug}/thumbnail`,{admin:true})).status).toBe(200);
    expect((await send(`/content/${initial.slug}/thumbnail`)).status).toBe(404);
    const published=await edit(draft,{status:'published'}); expect(published.status).toBe(200);
    expect((await send(`/content/${initial.slug}/thumbnail`)).status).toBe(200);
    expect(files.has(key)).toBe(true); expect(deleted).toEqual([]);
    const latest=(await published.json()).content;
    const legacy=await edit(latest,{thumbnailUrl:'/img/posts/daily-study-topic.webp'}); expect(legacy.status).toBe(200);
    const replaced=(await legacy.json()).content; expect(replaced.thumbnailUrl).toBe('/img/posts/daily-study-topic.webp');
    expect((await send(`/content/${initial.slug}/thumbnail`)).status).toBe(404);
    const cleared=await edit(replaced,{thumbnailUrl:null}); expect(cleared.status).toBe(200); expect((await cleared.json()).content.thumbnailUrl).toBeNull();
  });
  it('denies unauthorized uploads and reads; a draft image is visible only to the administrator',async()=>{
    const selected=await created();
    expect((await upload(selected,PNG,{admin:false})).status).toBe(401); expect(writes).toHaveLength(0);
    const updated=(await(await upload(selected)).json()).content;
    expect((await send(`/admin/content/${selected.slug}/thumbnail`)).status).toBe(401);
    expect((await send(`/admin/content/${selected.slug}/thumbnail`,{admin:true})).status).toBe(200);
    expect((await send(`/content/${selected.slug}/thumbnail`)).status).toBe(404);
    expect((await upload(selected)).status).toBe(409);
    expect((await send(`/content/${selected.slug}/thumbnail`,{method:'POST',body:{version:updated.version}})).status).toBe(405);
  });
  it('rejects spoofed formats, oversized dimensions and bytes, raw keys and duplicate fields without storage',async()=>{
    const selected=await created(), large=PNG.slice(); new DataView(large.buffer).setUint32(16,4097);
    for(const [bytes,options] of [[new TextEncoder().encode('<svg/>'),{name:'cover.svg',type:'image/svg+xml'}],
      [new TextEncoder().encode('<html/>'),{}],[PNG,{type:'image/jpeg'}],[PNG,{name:'cover.jpg'}],[large,{}],
      [PNG,{extra:['thumbnailKey','shop/private-purchase.pdf']}],[PNG,{extra:['version','1']}],[PNG,{version:'0'}]]) {
      expect((await upload(selected,bytes,options)).status).toBe(400);
    }
    expect((await upload(selected,new Uint8Array(2*1024*1024+1))).status).toBe(413);
    expect((await send(`/admin/content/${selected.slug}/thumbnail`,{method:'POST',admin:true,body:{version:1}})).status).toBe(400);
    for(const thumbnailUrl of ['content-thumbnails/content-image-card/v2-11111111-1111-4111-8111-111111111111.png',
      '/api/site/admin/content/content-image-card/thumbnail?v=2','/img/posts/../private.png','https://attacker.invalid/cover.png']) {
      expect((await edit(selected,{thumbnailUrl})).status).toBe(400);
    }
    expect(writes).toHaveLength(0);
  });
  it('cleans only the losing unique object when an image upload races with deletion',async()=>{
    const selected=await created(); let entered,release;
    const started=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;}),original=env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put=async(...args)=>{const result=await original(...args);entered();await hold;return result;};
    const uploading=upload(selected);await started;
    expect((await send(`/admin/content/${selected.slug}`,{method:'DELETE',admin:true,body:{version:selected.version}})).status).toBe(200);
    release();expect((await uploading).status).toBe(409);
    expect(deleted).toEqual([writes[0].key]);expect(files.size).toBe(1);expect(files.has('shop/private-purchase.pdf')).toBe(true);
  });
  it('rechecks publication after R2.get and cancels bytes if visibility changed in flight',async()=>{
    const initial=await created({status:'published'}),current=(await(await upload(initial)).json()).content;
    let entered,release;const started=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;}),cancelled=vi.fn();
    env.SITE_SHOP_FILES.get=async()=>{entered();await hold;return{body:new ReadableStream({start(controller){controller.enqueue(PNG);},cancel:cancelled})};};
    const reading=send(`/content/${initial.slug}/thumbnail?v=2`);await started;
    expect((await edit(current,{status:'draft'})).status).toBe(200);
    release();expect((await reading).status).toBe(404);expect(cancelled).toHaveBeenCalledOnce();
  });
  it('keeps committed data after a lost database reply, cleans a proven orphan and rolls back a failed audit',async()=>{
    const selected=await created(),original=env.GAME_DB.batch;
    env.GAME_DB.batch=async()=>{throw new Error('synthetic_database_failure');};
    expect((await upload(selected)).status).toBe(503);expect(deleted).toEqual([writes[0].key]);expect(files.size).toBe(1);
    env.GAME_DB.batch=async statements=>{await original(statements);throw new Error('synthetic_database_reply_lost');};
    expect((await upload(selected)).status).toBe(503);
    const current=(await(await send(`/admin/content/${selected.slug}`,{admin:true})).json()).content;
    expect(current.version).toBe(2);expect(files.has(writes[1].key)).toBe(true);expect(deleted).toHaveLength(1);
    env.GAME_DB.batch=original;local.sqlite.exec('DROP TABLE site_admin_audit');
    expect((await upload(current)).status).toBe(503);
    expect(local.sqlite.prepare('SELECT version,thumbnail_url FROM site_content WHERE slug=?').get(selected.slug)).toMatchObject({version:2,thumbnail_url:writes[1].key});
    expect(files.has(writes[2].key)).toBe(false);
  });
  it('fails a partial R2 write without changing the old image and serves only the current image during replacement',async()=>{
    const selected=await created({status:'published'}),original=env.SITE_SHOP_FILES.put;
    env.SITE_SHOP_FILES.put=async(...args)=>{await original(...args);throw new Error('synthetic_r2_reply_lost');};
    expect((await upload(selected)).status).toBe(503);expect(deleted).toEqual([writes[0].key]);
    env.SITE_SHOP_FILES.put=original;
    const first=(await(await upload(selected)).json()).content,key=writes[1].key;
    const second=(await(await upload(first,JPEG,{name:'cover.jpg',type:'image/jpeg'})).json()).content;
    expect(second.version).toBe(3);expect(files.has(key)).toBe(true);
    const image=await send(`/content/${selected.slug}/thumbnail?v=2`);expect(image.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG);
  });
  it('never exposes a paid file or another content image via a tampered pointer',async()=>{
    const selected=await created({status:'published'});
    for(const key of ['shop/private-purchase.pdf','content-thumbnails/another-card/v2-11111111-1111-4111-8111-111111111111.png']) {
      local.sqlite.prepare('UPDATE site_content SET thumbnail_url=? WHERE slug=?').run(key,selected.slug);
      expect((await send(`/content/${selected.slug}/thumbnail`)).status).toBe(404);
      expect((await(await send(`/content/${selected.slug}`)).json()).content.thumbnailUrl).toBeNull();
    }
    expect(reads).toEqual([]);
  });
});
