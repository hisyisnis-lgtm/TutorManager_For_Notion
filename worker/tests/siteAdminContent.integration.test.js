import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAdminContentRoutes } from '../lib/siteAdminContent.js';

const ORIGIN = 'http://localhost:4325';
let local, env;
const authorizeTeacher = async request => request.headers.get('Authorization') === 'Bearer synthetic-teacher'
  ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
async function send(path, { method = 'GET', body, admin = false, headers = {} } = {}) {
  return handleSiteAdminContentRoutes(new Request(`${ORIGIN}/api/site${path}`, { method,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.49', ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(admin ? { Authorization: 'Bearer synthetic-teacher' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {}, { authorizeTeacher });
}
const article = (overrides = {}) => ({ slug: 'synthetic-article', title: '합성 중국어 학습 글', summary: '합성 요약', body: '첫 문단입니다.\n\n둘째 문단입니다.',
  category: 'learn', status: 'draft', sortOrder: 0, ...overrides });
async function created(input = article()) {
  const response = await send('/admin/content', { method: 'POST', admin: true, body: input }); expect(response.status).toBe(201); return (await response.json()).content;
}
beforeEach(() => {
  local = siteD1();
  for (const migration of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0015_site_content.sql','0018_site_existing_content.sql']) local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  local.sqlite.exec('DELETE FROM site_content');
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-content-security-secret', SITE_SESSION_SECRET: 'synthetic-content-session-secret-32-characters' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('external_http_blocked'); }));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('administrator public content lifecycle', () => {
  it('seeds the existing eight cards once and keeps edited or hidden cards hidden when the seed is reapplied', async () => {
    const migration = readFileSync(new URL('../migrations/0018_site_existing_content.sql', import.meta.url), 'utf8');
    const seed = migration.slice(migration.indexOf('-- EXISTING_CARD_SEED'));
    local.sqlite.exec(seed);
    const home = await (await send('/content?category=learn&placement=home&limit=3')).json();
    expect(home.contents.map(item => item.slug)).toEqual(['blog-224100629127','blog-224100640037','blog-224112142712']);
    const learn = await (await send('/content?category=learn&placement=learn&limit=100')).json(); expect(learn.contents).toHaveLength(8);
    expect(learn.contents[0]).toMatchObject({ displayCategory:'회화', thumbnailUrl:'/img/posts/conversation-start-teacher.webp',
      externalUrl:'https://blog.naver.com/tiantian_chinese/224100629127', tags:['#회화','#발음','#억양'] });
    expect(learn.contents.every(item => !item.title.includes('\n'))).toBe(true);
    local.sqlite.exec("UPDATE site_content SET status='draft',title='관리자가 숨긴 기존 글',show_on_home=0");
    local.sqlite.exec(seed);
    expect((await (await send('/content?placement=home')).json()).contents).toEqual([]);
    expect((await (await send('/content?placement=learn')).json()).contents).toEqual([]);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_content').get().total).toBe(8);
    expect(local.sqlite.prepare('SELECT DISTINCT title FROM site_content').all()).toEqual([{ title:'관리자가 숨긴 기존 글' }]);
  });
  it('edits existing card presentation and orders the home separately while retaining compare-and-swap conflicts', async () => {
    const saved = await created(article({ status:'published', displayCategory:'발음', tags:['#성조'],
      thumbnailUrl:'/img/posts/pronunciation-tones-teacher.webp', externalUrl:'https://blog.naver.com/tiantian_chinese/224100640037',
      showOnHome:true, homeSortOrder:4, sortOrder:1 }));
    const input = article({ status:'published', version:saved.version, title:'수정한 제목', displayCategory:'공부 습관',tags:['#습관'],
      thumbnailUrl:'/img/posts/daily-study-topic.webp', externalUrl:saved.externalUrl,showOnHome:true,homeSortOrder:2,sortOrder:8 });
    expect((await send(`/admin/content/${saved.slug}`, { method:'PUT',admin:true,body:input })).status).toBe(200);
    expect((await send(`/admin/content/${saved.slug}`, { method:'PUT',admin:true,body:input })).status).toBe(409);
    await created(article({ slug:'first-on-home',status:'published',showOnHome:true,homeSortOrder:1,sortOrder:10 }));
    const home = await (await send('/content?placement=home&limit=1')).json(); expect(home.contents[0].slug).toBe('first-on-home');
    const next = await (await send(`/content?placement=home&limit=1&cursor=${home.nextCursor}`)).json();
    expect(next.contents[0]).toMatchObject({title:'수정한 제목',displayCategory:'공부 습관',tags:['#습관'],homeSortOrder:2,sortOrder:8});
    expect((await send(`/content?placement=learn&limit=1&cursor=${home.nextCursor}`)).status).toBe(400);
    const learn = await (await send('/content?placement=learn')).json(); expect(learn.contents.map(item => item.slug)).toEqual([saved.slug,'first-on-home']);
  });
  it('rejects unsafe image paths, nonofficial blog links, unbounded tags and invalid presentation flags without fetching assets', async () => {
    for (const override of [
      {thumbnailUrl:'https://attacker.invalid/image.png'}, {thumbnailUrl:'/img/posts/../secret.png'}, {thumbnailUrl:'/img/posts/card.svg'},
      {thumbnailUrl:'/img/posts/card.webp?token=secret'}, {externalUrl:'https://blog.naver.com/another/224100629127'},
      {externalUrl:'https://blog.naver.com/tiantian_chinese/224100629127?track=1'}, {tags:Array(9).fill('tag')},
      {tags:['x'.repeat(25)]}, {tags:['unsafe\nlabel']}, {showOnHome:1}, {homeSortOrder:100001},
    ]) expect((await send('/admin/content',{method:'POST',admin:true,body:article(override)})).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('denies unauthorized management and exposes no drafts or archived articles publicly', async () => {
    expect((await send('/admin/content')).status).toBe(401);
    expect((await send('/admin/content', { method: 'POST', body: article() })).status).toBe(401);
    expect((await send('/admin/audit')).status).toBe(401);
    const draft = await created(); expect((await send(`/content/${draft.slug}`)).status).toBe(404);
    const archived = await created(article({ slug: 'archived-article', status: 'archived' })); expect((await send(`/content/${archived.slug}`)).status).toBe(404);
    expect((await (await send('/content')).json()).contents).toEqual([]);
    expect((await send('/content', { method: 'POST', body: article() })).status).toBe(405); expect(fetch).not.toHaveBeenCalled();
  });
  it('stores plain text and safe HTTPS links without interpreting HTML or revealing list bodies', async () => {
    const body = '<script>alert("literal text")</script>\n<img src=x onerror=alert(1)>', input = article({ body, status: 'published', externalUrl: 'https://blog.naver.com/tiantian_chinese/224100629127' });
    const saved = await created(input), detail = await (await send(`/content/${saved.slug}`)).json();
    expect(detail.content.body).toBe(body); expect(detail.content.bodyFormat).toBe('plain'); expect(detail.content).not.toHaveProperty('status');
    const listed = await (await send('/content?category=learn')).json(); expect(listed.contents[0]).not.toHaveProperty('body'); expect(listed.contents[0]).not.toHaveProperty('archivedAt');
    for (const externalUrl of ['javascript:alert(1)', 'http://example.invalid', 'https://user:password@example.invalid']) {
      expect((await send('/admin/content', { method: 'POST', admin: true, body: article({ slug: 'unsafe-url', externalUrl }) })).status).toBe(400);
    }
  });
  it('publishes only a nonempty body or external URL and archives without deleting the saved article', async () => {
    expect((await send('/admin/content', { method: 'POST', admin: true, body: article({ body: '', status: 'published' }) })).status).toBe(400);
    const saved = await created(article({ status: 'published' }));
    expect((await send(`/admin/content/${saved.slug}`, { method: 'DELETE', admin: true, body: { version: saved.version } })).status).toBe(200);
    expect((await send(`/content/${saved.slug}`)).status).toBe(404);
    const row = local.sqlite.prepare('SELECT status,body,version FROM site_content WHERE slug=?').get(saved.slug);
    expect(row).toMatchObject({ status: 'archived', version: 2, body: article().body });
    const detail = await (await send(`/admin/content/${saved.slug}`, { admin: true })).json(); expect(detail.content.archivedAt).toBeTruthy();
  });
  it('restores an archived own article from the latest version without losing its home and learning presentation', async () => {
    const input = article({ status: 'published', externalUrl: null, showOnHome: true, homeSortOrder: 3, sortOrder: 7,
      displayCategory: '회화', tags: ['#중국어', '#회화'], thumbnailUrl: '/img/posts/conversation-start-teacher.webp' });
    const saved = await created(input);
    const publicPlacements = ['/content?placement=home', '/content?placement=learn'];
    const expectPublicVisibility = async visible => {
      for (const path of publicPlacements) {
        const response = await send(path); expect(response.status).toBe(200);
        expect((await response.json()).contents.map(item => item.slug)).toEqual(visible ? [saved.slug] : []);
      }
      const detail = await send(`/content/${saved.slug}`); expect(detail.status).toBe(visible ? 200 : 404);
      if (visible) expect((await detail.json()).content).toMatchObject(inputFields);
    };
    const inputFields = { slug: input.slug, title: input.title, summary: input.summary, body: input.body,
      category: input.category, externalUrl: input.externalUrl, sortOrder: input.sortOrder, thumbnailUrl: input.thumbnailUrl,
      displayCategory: input.displayCategory, tags: input.tags, showOnHome: input.showOnHome, homeSortOrder: input.homeSortOrder };
    const writableInput = latest => ({ ...Object.fromEntries(Object.keys(inputFields).map(key => [key, latest[key]])),
      version: latest.version, status: 'draft' });
    await expectPublicVisibility(true);
    const removed = await send(`/admin/content/${saved.slug}`, { method: 'DELETE', admin: true, body: { version: saved.version } });
    expect(removed.status).toBe(200);
    await expectPublicVisibility(false);
    const staleRestore = await send(`/admin/content/${saved.slug}`, { method: 'PUT', admin: true, body: writableInput(saved) });
    expect(staleRestore.status).toBe(409); expect((await staleRestore.json()).code).toBe('version_conflict');
    const archived = (await (await send(`/admin/content/${saved.slug}`, { admin: true })).json()).content;
    expect(archived).toMatchObject({ ...inputFields, status: 'archived', version: saved.version + 1 });
    expect(archived.archivedAt).toBeTruthy();
    const restored = await send(`/admin/content/${saved.slug}`, { method: 'PUT', admin: true, body: writableInput(archived) });
    expect(restored.status).toBe(200);
    const draft = (await restored.json()).content;
    expect(draft).toMatchObject({ ...inputFields, status: 'draft', version: archived.version + 1, archivedAt: null });
    await expectPublicVisibility(false);
    const published = await send(`/admin/content/${saved.slug}`, { method: 'PUT', admin: true,
      body: { ...writableInput(draft), status: 'published' } });
    expect(published.status).toBe(200);
    expect((await published.json()).content).toMatchObject({ ...inputFields, status: 'published', version: draft.version + 1, archivedAt: null });
    await expectPublicVisibility(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects stale concurrent edits and keeps one successful audit for the winning edit', async () => {
    const saved = await created(), input = { ...article(), version: saved.version };
    const results = await Promise.all([send(`/admin/content/${saved.slug}`, { method: 'PUT', admin: true, body: { ...input, title: '첫 편집' } }),
      send(`/admin/content/${saved.slug}`, { method: 'PUT', admin: true, body: { ...input, title: '다른 편집' } })]);
    expect(results.map(response => response.status).sort()).toEqual([200,409]);
    expect(local.sqlite.prepare('SELECT version FROM site_content').get().version).toBe(2);
    expect(local.sqlite.prepare("SELECT COUNT(*) AS total FROM site_admin_audit WHERE action='content.update' AND outcome='success'").get().total).toBe(1);
    expect(local.sqlite.prepare("SELECT COUNT(*) AS total FROM site_admin_audit WHERE action='content.update' AND outcome='conflict'").get().total).toBe(1);
    expect((await send(`/admin/content/${saved.slug}`, { method: 'DELETE', admin: true, body: { version: 1 } })).status).toBe(409);
  });
  it('accepts a large bounded Korean plain-text body and rejects bodies past its byte limit', async () => {
    const input = article({ body: '내용'.repeat(10000) }); expect((await send('/admin/content', { method: 'POST', admin: true, body: input })).status).toBe(201);
    expect((await send('/admin/content', { method: 'POST', admin: true, body: article({ slug: 'too-long', body: 'a'.repeat(140000) }) })).status).toBe(413);
  });
  it('paginates ordered public notices and applies literal search and bound cursor filters', async () => {
    for (const [slug, order] of [['third',2],['first',1],['second',1]]) await created(article({ slug, category: 'notice', status: 'published', sortOrder: order }));
    await created(article({ slug: 'other-category', category: 'books', status: 'published' }));
    const first = await (await send('/content?category=notice&limit=2')).json(); expect(first.contents.map(item => item.slug)).toEqual(['first','second']); expect(first.nextCursor).toBeTruthy();
    const next = await (await send(`/content?category=notice&limit=2&cursor=${first.nextCursor}`)).json(); expect(next.contents.map(item => item.slug)).toEqual(['third']); expect(next.nextCursor).toBeNull();
    expect((await send(`/content?category=books&limit=2&cursor=${first.nextCursor}`)).status).toBe(400);
    const named = await created(article({ slug: 'literal-search', title: '100%_ 중국어', status: 'published' }));
    const found = await (await send(`/content?q=${encodeURIComponent('%_')}`)).json(); expect(found.contents.map(item => item.slug)).toEqual([named.slug]);
    expect((await send('/content?cursor=broken')).status).toBe(400);
  });
  it('paginates audit metadata and records only the fixed authenticated actor without body or private fields', async () => {
    const input = article({ body: '합성 전화 010-1234-5678, 합성 주소 검수로 1', summary: '비공개 입력 확인용 요약' });
    await send('/admin/content', { method: 'POST', admin: true, headers: { 'X-Admin-Actor': 'impersonated' }, body: input });
    const saved = await (await send(`/admin/content/${input.slug}`, { admin: true })).json();
    await send(`/admin/content/${input.slug}`, { method: 'PUT', admin: true, body: { ...input, version: saved.content.version, title: '두 번째 제목' } });
    const audit = await (await send('/admin/audit?limit=1', { admin: true })).json(); expect(audit.events).toHaveLength(1); expect(audit.nextCursor).toBeTruthy();
    expect(audit.events[0].actor).toBe('teacher'); expect(Object.keys(audit.events[0]).sort()).toEqual(['action','actor','createdAt','id','outcome','target']);
    const text = JSON.stringify(audit); expect(text).not.toContain('010-'); expect(text).not.toContain('검수로'); expect(text).not.toContain('impersonated'); expect(text).not.toContain(input.summary);
    const next = await (await send(`/admin/audit?limit=1&cursor=${audit.nextCursor}`, { admin: true })).json(); expect(next.events[0].id).not.toBe(audit.events[0].id);
  });
  it('rolls back content creation if the atomic audit write cannot persist and leaves unrelated routes alone', async () => {
    local.sqlite.exec('DROP TABLE site_admin_audit');
    expect((await send('/admin/content', { method: 'POST', admin: true, body: article() })).status).toBe(503);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_content').get().total).toBe(0);
    expect(await handleSiteAdminContentRoutes(new Request(`${ORIGIN}/api/site/shop-orders`), env, {})).toBeNull();
  });
});
