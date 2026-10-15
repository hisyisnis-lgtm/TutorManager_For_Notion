import { z } from 'zod';
import { siteJson } from './siteAuth.js';
import { rateLimitCheck } from './securityStore.js';
import { rasterImageInfo } from './siteImageValidation.js';

const stamp = () => new Date().toISOString();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(80);
const text = (max, min = 0) => z.string().trim().min(min).max(max);
const category = z.enum(['notice','learn','books']);
const status = z.enum(['draft','published','archived']);
const version = z.number().int().positive();
const externalUrl = text(2048).nullish().refine(value => !value || /^https:\/\/blog\.naver\.com\/tiantian_chinese\/\d{9,15}$/.test(value));
const thumbnailUrl = text(300).nullish().refine(value => !value || /^\/img\/posts\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:webp|png|jpe?g)$/.test(value));
const IMAGE_LIMIT = 2 * 1024 * 1024;
const uploadedThumbnailKey = /^content-thumbnails\/[a-z0-9]+(?:-[a-z0-9]+)*\/v[1-9]\d*-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(png|jpg|webp)$/;
const order = z.number().int().min(-100000).max(100000);
const label = max => text(max).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const contentShape = { slug, title: text(120, 1).refine(value => !/[\x00-\x1f\x7f]/.test(value)), summary: text(1000).optional().default(''),
  body: text(30000).optional().default(''), category, externalUrl, status: status.optional().default('draft'),
  sortOrder: order.optional().default(0), thumbnailUrl, displayCategory: label(40).optional().default(''),
  tags: z.array(label(24).refine(value => value.length > 0)).max(8).optional().default([]),
  showOnHome: z.boolean().optional().default(false), homeSortOrder: order.optional().default(0) };
const createSchema = z.object(contentShape).strict();
const updateSchema = z.object({ ...contentShape, version }).strict();
const archiveSchema = z.object({ version }).strict();
const reorderSchema = z.object({ placement: z.enum(['learn', 'home']),
  items: z.array(z.object({ slug, version }).strict()).min(1).max(1000)
    .refine(items => new Set(items.map(item => item.slug)).size === items.length) }).strict();
const fail = (code, message, identifier) => siteJson({ error: message, ...(identifier ? { code: identifier } : {}) }, { status: code });

async function readBody(request, schema) {
  const reader = request.body?.getReader(); if (!reader) return { response: fail(400, '입력값을 확인해주세요.') };
  const parts = []; let length = 0;
  try { for (;;) { const piece = await reader.read(); if (piece.done) break;
    length += piece.value.byteLength; if (length > 128 * 1024) { await reader.cancel(); return { response: fail(413, '글이 너무 깁니다.') }; } parts.push(piece.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { data = null; }
  const parsed = schema.safeParse(data); return parsed.success ? { value: parsed.data } : { response: fail(400, '입력값을 확인해주세요.') };
}

export function siteAdminAuditStatement(db, action, target, outcome, { conditional = false, at = stamp() } = {}) {
  return db.prepare(`INSERT INTO site_admin_audit(id,actor,action,target,outcome,created_at)
    SELECT ?1,'teacher',?2,?3,?4,?5${conditional ? ' WHERE changes()>0' : ''}`)
    .bind(crypto.randomUUID(), action, target, outcome, at);
}
export async function recordSiteAdminAction(env, action, target, outcome) {
  await siteAdminAuditStatement(env.GAME_DB, action, target, outcome).run();
}
export function siteListParams(url, kind, allowed = {}) {
  const limitText = url.searchParams.get('limit') || '30', q = (url.searchParams.get('q') || '').trim();
  if (!/^\d{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 100 || q.length > 120 || /[\x00-\x1f\x7f]/.test(q)) throw new Error('invalid_list_query');
  const filters = {};
  for (const [key, values] of Object.entries(allowed)) {
    const value = url.searchParams.get(key); if (value && !values.includes(value)) throw new Error('invalid_list_filter'); filters[key] = value || null;
  }
  const signature = JSON.stringify([kind, q, filters]);
  let cursor = null;
  const raw = url.searchParams.get('cursor');
  if (raw) {
    if (raw.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('invalid_cursor');
    try {
      const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), value => value.charCodeAt(0));
      cursor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (cursor.signature !== signature || !Number.isFinite(Date.parse(cursor.time)) || typeof cursor.id !== 'string'
        || cursor.id.length < 1 || cursor.id.length > 100 || (kind === 'public-content' && !Number.isInteger(cursor.sort))) throw new Error();
    } catch { throw new Error('invalid_cursor'); }
  }
  return { limit: Number(limitText), q, filters, cursor, signature };
}
export function siteNextCursor(params, row, { id = row.id || row.slug, time = row.created_at, sort } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ signature: params.signature, time, id, ...(sort == null ? {} : { sort }) }));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function siteLike(value) { return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`; }
function contentThumbnailInfo(row) {
  const key = row?.thumbnail_url;
  if (typeof key !== 'string' || !key.startsWith(`content-thumbnails/${row.slug}/`)) return null;
  const match = key.match(uploadedThumbnailKey);
  return match ? { key, type: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[match[1]] } : null;
}
function contentThumbnailUrl(row, admin) {
  if (contentThumbnailInfo(row)) return `/api/site/${admin ? 'admin/' : ''}content/${row.slug}/thumbnail?v=${row.version}`;
  return thumbnailUrl.safeParse(row.thumbnail_url).success ? row.thumbnail_url || null : null;
}
function contentDto(row, { admin = false, detail = false } = {}) {
  const value = { slug: row.slug, title: row.title, summary: row.summary, category: row.category, externalUrl: row.external_url,
    thumbnailUrl: contentThumbnailUrl(row, admin), displayCategory: row.display_category, tags: JSON.parse(row.tags_json),
    showOnHome: row.show_on_home === 1, homeSortOrder: row.home_sort_order,
    sortOrder: row.sort_order, version: row.version, publishedAt: row.published_at, updatedAt: row.updated_at };
  return { ...value, ...(detail || admin ? { body: row.body, bodyFormat: 'plain' } : {}),
    ...(admin ? { status: row.status, createdAt: row.created_at, archivedAt: row.archived_at } : {}) };
}
async function listContent(env, url, admin) {
  let params; try { params = siteListParams(url, admin ? 'admin-content' : 'public-content', { category: ['notice','learn','books'], ...(admin ? { status: ['draft','published','archived'] } : { placement: ['home','learn'] }) }); }
  catch { return fail(400, '목록 조건을 확인해주세요.'); }
  const conditions = [], values = [], bind = value => { values.push(value); return `?${values.length}`; };
  if (!admin) conditions.push("status='published'");
  else if (params.filters.status) conditions.push(`status=${bind(params.filters.status)}`);
  if (params.filters.category) conditions.push(`category=${bind(params.filters.category)}`);
  if (!admin && params.filters.placement) conditions.push("category='learn'");
  if (!admin && params.filters.placement === 'home') conditions.push('show_on_home=1');
  const sortColumn = !admin && params.filters.placement === 'home' ? 'home_sort_order' : 'sort_order';
  if (params.q) { const parameter = bind(siteLike(params.q)); conditions.push(`(title LIKE ${parameter} ESCAPE '\\' OR summary LIKE ${parameter} ESCAPE '\\')`); }
  if (params.cursor) {
    if (admin) { const time = bind(params.cursor.time), id = bind(params.cursor.id); conditions.push(`(created_at<${time} OR (created_at=${time} AND slug<${id}))`); }
    else { const sort = bind(params.cursor.sort), id = bind(params.cursor.id); conditions.push(`(${sortColumn}>${sort} OR (${sortColumn}=${sort} AND slug>${id}))`); }
  }
  const rows = (await env.GAME_DB.prepare(`SELECT * FROM site_content ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ${admin ? 'created_at DESC,slug DESC' : `${sortColumn} ASC,slug ASC`} LIMIT ${bind(params.limit + 1)}`).bind(...values).all()).results;
  const page = rows.slice(0, params.limit), last = page.at(-1);
  return siteJson({ contents: page.map(row => contentDto(row, { admin })), nextCursor: rows.length > params.limit
    ? siteNextCursor(params, last, { id: last.slug, sort: admin ? undefined : last[sortColumn] }) : null });
}
async function writeContent(request, env, pathSlug, authorizeTeacher) {
  const parsed = await readBody(request, request.method === 'POST' ? createSchema : updateSchema); if (parsed.response) return parsed.response;
  const denied = await authorizeTeacher(request, env, {}); if (denied) return denied;
  const value = parsed.value, db = env.GAME_DB, at = stamp();
  if (pathSlug && pathSlug !== value.slug) return fail(400, '글 경로와 식별자를 확인해주세요.');
  if (value.status === 'published' && !value.body && !value.externalUrl) return fail(400, '공개할 글 본문이나 외부 링크를 입력해주세요.');
  const fields = [value.slug, value.title, value.summary, value.body, value.category, value.status, value.externalUrl || null, value.sortOrder, at,
    value.thumbnailUrl || null, value.displayCategory, JSON.stringify(value.tags), value.showOnHome ? 1 : 0, value.homeSortOrder];
  const action = request.method === 'POST' ? 'content.create' : 'content.update';
  const mutation = request.method === 'POST' ? db.prepare(`INSERT INTO site_content(slug,title,summary,body,category,status,external_url,sort_order,
    published_at,archived_at,created_at,updated_at,thumbnail_url,display_category,tags_json,show_on_home,home_sort_order)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,CASE WHEN ?6='published' THEN ?9 ELSE NULL END,
    CASE WHEN ?6='archived' THEN ?9 ELSE NULL END,?9,?9,?10,?11,?12,?13,?14) ON CONFLICT(slug) DO NOTHING RETURNING *`).bind(...fields)
    : db.prepare(`UPDATE site_content SET title=?2,summary=?3,body=?4,category=?5,status=?6,external_url=?7,sort_order=?8,
      published_at=CASE WHEN ?6='published' THEN COALESCE(published_at,?9) ELSE published_at END,
      archived_at=CASE WHEN ?6='archived' THEN COALESCE(archived_at,?9) ELSE NULL END,version=version+1,updated_at=?9
      ,thumbnail_url=CASE WHEN ?16=1 THEN ?10 ELSE thumbnail_url END,display_category=?11,tags_json=?12,show_on_home=?13,home_sort_order=?14
      WHERE slug=?1 AND version=?15 RETURNING *`).bind(...fields, value.version, Object.hasOwn(value, 'thumbnailUrl') ? 1 : 0);
  const results = await db.batch([mutation, siteAdminAuditStatement(db, action, `content:${value.slug}`, 'success', { conditional: true, at })]);
  const row = results[0].results[0];
  if (!row) {
    await recordSiteAdminAction(env, action, `content:${value.slug}`, 'conflict');
    const current = await db.prepare('SELECT * FROM site_content WHERE slug=?1').bind(value.slug).first();
    return current ? fail(409, '글이 다른 화면에서 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict') : fail(404, '글을 찾을 수 없습니다.');
  }
  return siteJson({ content: contentDto(row, { admin: true }) }, { status: request.method === 'POST' ? 201 : 200 });
}
async function archiveContent(request, env, pathSlug, authorizeTeacher) {
  const parsed = await readBody(request, archiveSchema); if (parsed.response) return parsed.response;
  const denied = await authorizeTeacher(request, env, {}); if (denied) return denied;
  const db = env.GAME_DB, at = stamp();
  const results = await db.batch([db.prepare(`UPDATE site_content SET status='archived',archived_at=COALESCE(archived_at,?3),
    version=version+1,updated_at=?3 WHERE slug=?1 AND version=?2 RETURNING *`).bind(pathSlug, parsed.value.version, at),
    siteAdminAuditStatement(db, 'content.archive', `content:${pathSlug}`, 'success', { conditional: true, at })]);
  const row = results[0].results[0];
  if (!row) { await recordSiteAdminAction(env, 'content.archive', `content:${pathSlug}`, 'conflict'); return fail(409, '글이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
  return siteJson({ content: contentDto(row, { admin: true }) });
}
async function reorderContent(request, env, authorizeTeacher) {
  const parsed = await readBody(request, reorderSchema); if (parsed.response) return parsed.response;
  const denied = await authorizeTeacher(request, env, {}); if (denied) return denied;
  const { placement, items } = parsed.value, db = env.GAME_DB, at = stamp();
  const scope = `category='learn' AND status<>'archived'${placement === 'home' ? ' AND show_on_home=1' : ''}`;
  const column = placement === 'home' ? 'home_sort_order' : 'sort_order';
  // Materialize the complete membership/version check before the first row changes.
  // Otherwise a correlated version check can observe earlier rows of this UPDATE.
  const mutation = db.prepare(`WITH incoming AS MATERIALIZED (
      SELECT json_extract(value,'$.slug') AS slug,json_extract(value,'$.version') AS version,CAST(key AS INTEGER) AS position
      FROM json_each(?1)
    ), permitted AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM site_content WHERE ${scope})=(SELECT COUNT(*) FROM incoming)
        AND NOT EXISTS(SELECT 1 FROM incoming i LEFT JOIN site_content c ON c.slug=i.slug
          WHERE c.slug IS NULL OR c.category<>'learn' OR c.status='archived'${placement === 'home' ? ' OR c.show_on_home<>1' : ''} OR c.version<>i.version) AS ok
    ) UPDATE site_content SET ${column}=(SELECT position FROM incoming WHERE incoming.slug=site_content.slug),
      version=version+1,updated_at=?2
    WHERE ${scope} AND (SELECT ok FROM permitted)=1 RETURNING *`).bind(JSON.stringify(items), at);
  const results = await db.batch([mutation,
    siteAdminAuditStatement(db, 'content.reorder', `content:${placement}`, 'success', { conditional: true, at })]);
  const rows = results[0].results;
  if (!rows.length) {
    await recordSiteAdminAction(env, 'content.reorder', `content:${placement}`, 'conflict');
    return fail(409, '콘텐츠 목록이 변경됐어요. 최신 목록을 확인한 뒤 순서를 바꿔 주세요.', 'version_conflict');
  }
  rows.sort((first, second) => first[column] - second[column]);
  return siteJson({ contents: rows.map(row => contentDto(row, { admin: true })), placement });
}
async function readContentImageUpload(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.startsWith('multipart/form-data')) return { response: fail(400, '이미지 업로드 형식을 확인해주세요.') };
  const reader = request.body?.getReader();
  if (!reader) return { response: fail(400, '이미지 업로드 형식을 확인해주세요.') };
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const piece = await reader.read(); if (piece.done) break;
      size += piece.value.byteLength;
      if (size > IMAGE_LIMIT + 64 * 1024) { await reader.cancel(); return { response: fail(413, '대표 이미지는 2MiB 이하로 등록해주세요.') }; }
      chunks.push(piece.value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  let form;
  try { form = await new Response(raw, { headers: { 'Content-Type': type } }).formData(); }
  catch { return { response: fail(400, '이미지 업로드 형식을 확인해주세요.') }; }
  if ([...form.keys()].some(key => !['file', 'version'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('version').length !== 1) {
    return { response: fail(400, '업로드 필드를 확인해주세요.') };
  }
  const file = form.get('file'), rawVersion = form.get('version');
  if (!(file instanceof File) || typeof rawVersion !== 'string' || !/^[1-9]\d{0,9}$/.test(rawVersion)
    || file.size < 1 || file.name.length > 160 || /[\x00-\x1f\x7f/\\]/.test(file.name)) {
    return { response: fail(400, '이미지와 콘텐츠 버전을 확인해주세요.') };
  }
  if (file.size > IMAGE_LIMIT) return { response: fail(413, '대표 이미지는 2MiB 이하로 등록해주세요.') };
  const bytes = new Uint8Array(await file.arrayBuffer()), image = rasterImageInfo(bytes);
  const extension = file.name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  if (!image || !extension || (extension === 'jpeg' ? 'jpg' : extension) !== image.extension || file.type && file.type !== image.type) {
    return { response: fail(400, '4096px 이하의 PNG, JPEG 또는 WebP 이미지를 등록해주세요.') };
  }
  return { bytes, image, version: Number(rawVersion) };
}
async function removeUnpublishedContentImage(env, key) {
  if (typeof env.SITE_SHOP_FILES?.delete === 'function') {
    try { await env.SITE_SHOP_FILES.delete(key); } catch { /* Unreferenced objects are never exposed by the content route. */ }
  }
}
async function uploadContentThumbnail(request, env, contentSlug, authorizeTeacher) {
  if (typeof env.SITE_SHOP_FILES?.put !== 'function' || typeof env.SITE_SHOP_FILES?.get !== 'function') return fail(503, '이미지 서비스를 준비 중입니다.');
  const parsed = await readContentImageUpload(request); if (parsed.response) return parsed.response;
  const denied = await authorizeTeacher(request, env, {}); if (denied) return denied;
  const { bytes, image, version } = parsed, db = env.GAME_DB;
  const row = await db.prepare('SELECT * FROM site_content WHERE slug=?1').bind(contentSlug).first();
  if (!row) return fail(404, '글을 찾을 수 없습니다.');
  if (row.version !== version) return fail(409, '글이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict');
  if (row.status === 'archived') return fail(409, '삭제한 콘텐츠에는 이미지를 등록할 수 없어요.');
  const key = `content-thumbnails/${contentSlug}/v${version + 1}-${crypto.randomUUID()}.${image.extension}`, at = stamp();
  try { await env.SITE_SHOP_FILES.put(key, bytes, { httpMetadata: { contentType: image.type }, customMetadata: { contentSlug, version: String(version + 1) } }); }
  catch { await removeUnpublishedContentImage(env, key); return fail(503, '이미지를 저장하지 못했어요. 다시 확인해주세요.'); }
  let results;
  try {
    results = await db.batch([db.prepare(`UPDATE site_content SET thumbnail_url=?2,version=version+1,updated_at=?3
      WHERE slug=?1 AND version=?4 AND status!='archived' RETURNING *`).bind(contentSlug, key, at, version),
    siteAdminAuditStatement(db, 'content.thumbnail', `content:${contentSlug}`, 'success', { conditional: true, at })]);
  } catch {
    // A failed reply may follow a successful commit. Delete only a proven orphan.
    try { const current = await db.prepare('SELECT thumbnail_url FROM site_content WHERE slug=?1').bind(contentSlug).first();
      if (current?.thumbnail_url !== key) await removeUnpublishedContentImage(env, key); }
    catch { /* Preserve ambiguous objects until the saved content can be checked. */ }
    return fail(503, '이미지 등록 결과를 확인하지 못했어요. 콘텐츠를 다시 확인해주세요.');
  }
  const saved = results[0].results[0];
  if (!saved) { await removeUnpublishedContentImage(env, key); return fail(409, '글이 변경됐어요. 최신 내용을 확인해주세요.', 'version_conflict'); }
  return siteJson({ content: contentDto(saved, { admin: true }) });
}
async function contentThumbnail(env, contentSlug, admin = false) {
  const db = env.GAME_DB, row = await db.prepare('SELECT * FROM site_content WHERE slug=?1').bind(contentSlug).first();
  const visible = value => value && contentThumbnailInfo(value) && value.status !== 'archived' && (admin || value.status === 'published');
  if (!visible(row)) return fail(404, '공개된 콘텐츠 이미지를 찾을 수 없습니다.');
  if (typeof env.SITE_SHOP_FILES?.get !== 'function') return fail(503, '이미지 서비스를 준비 중입니다.');
  const image = contentThumbnailInfo(row), object = await env.SITE_SHOP_FILES.get(image.key);
  if (!object?.body) return fail(404, '콘텐츠 이미지를 찾을 수 없습니다.');
  const current = await db.prepare('SELECT * FROM site_content WHERE slug=?1').bind(contentSlug).first();
  if (!visible(current) || current.thumbnail_url !== row.thumbnail_url) {
    await object.body.cancel().catch(() => {}); return fail(404, '공개된 콘텐츠 이미지를 찾을 수 없습니다.');
  }
  return new Response(object.body, { headers: { 'Content-Type': image.type, 'Cache-Control': 'no-store',
    'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Robots-Tag': 'noindex, nofollow' } });
}
async function listAudit(env, url) {
  let params; try { params = siteListParams(url, 'admin-audit'); } catch { return fail(400, '목록 조건을 확인해주세요.'); }
  const values = [], conditions = [], bind = value => { values.push(value); return `?${values.length}`; };
  if (params.q) { const q = bind(siteLike(params.q)); conditions.push(`(action LIKE ${q} ESCAPE '\\' OR target LIKE ${q} ESCAPE '\\')`); }
  if (params.cursor) { const time = bind(params.cursor.time), id = bind(params.cursor.id); conditions.push(`(created_at<${time} OR (created_at=${time} AND id<${id}))`); }
  const rows = (await env.GAME_DB.prepare(`SELECT id,actor,action,target,outcome,created_at FROM site_admin_audit
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT ${bind(params.limit + 1)}`).bind(...values).all()).results;
  const page = rows.slice(0, params.limit);
  return siteJson({ events: page.map(row => ({ id: row.id, actor: row.actor, action: row.action, target: row.target, outcome: row.outcome, createdAt: row.created_at })),
    nextCursor: rows.length > params.limit ? siteNextCursor(params, page.at(-1)) : null });
}
export async function handleSiteAdminContentRoutes(request, env, ctx, { authorizeTeacher } = {}) {
  const url = new URL(request.url), method = request.method;
  const admin = url.pathname.match(/^\/api\/site\/admin\/content(?:\/([^/]+)(?:\/(thumbnail))?)?$/), publicPath = url.pathname.match(/^\/api\/site\/content(?:\/([^/]+)(?:\/(thumbnail))?)?$/);
  const audit = url.pathname === '/api/site/admin/audit';
  if (!admin && !publicPath && !audit) return null;
  if (!env.GAME_DB) return fail(503, '콘텐츠 서비스를 준비 중입니다.');
  try {
    if (!await rateLimitCheck(env, `site-content:${request.headers.get('CF-Connecting-IP') || '0.0.0.0'}`, 120, 60)) return fail(429, '요청이 너무 많습니다.');
    if (admin || audit) {
      if (!authorizeTeacher) return fail(403, '관리자 권한이 필요합니다.');
      const denied = await authorizeTeacher(request, env, {}); if (denied) return denied;
      if (audit) return method === 'GET' ? await listAudit(env, url) : fail(405, '지원하지 않는 요청 방식입니다.');
      if (admin[1] === 'reorder' && !admin[2] && method === 'POST') return await reorderContent(request, env, authorizeTeacher);
      if (admin[1] && !slug.safeParse(admin[1]).success) return fail(400, '글 식별자를 확인해주세요.');
      if (admin[2]) {
        if (method === 'GET') return await contentThumbnail(env, admin[1], true);
        if (method === 'POST') {
          const response = await uploadContentThumbnail(request, env, admin[1], authorizeTeacher);
          if (response.status >= 400) await recordSiteAdminAction(env, 'content.thumbnail', `content:${admin[1]}`, response.status === 409 ? 'conflict' : 'failed');
          return response;
        }
        return fail(405, '지원하지 않는 요청 방식입니다.');
      }
      if (method === 'GET') {
        if (!admin[1]) return await listContent(env, url, true);
        const row = await env.GAME_DB.prepare('SELECT * FROM site_content WHERE slug=?1').bind(admin[1]).first();
        return row ? siteJson({ content: contentDto(row, { admin: true }) }) : fail(404, '글을 찾을 수 없습니다.');
      }
      if (method === 'POST' && !admin[1] || method === 'PUT') return await writeContent(request, env, admin[1], authorizeTeacher);
      if (method === 'DELETE' && admin[1]) return await archiveContent(request, env, admin[1], authorizeTeacher);
      return fail(405, '지원하지 않는 요청 방식입니다.');
    }
    if (method !== 'GET') return fail(405, '지원하지 않는 요청 방식입니다.');
    if (!publicPath[1]) return await listContent(env, url, false);
    if (!slug.safeParse(publicPath[1]).success) return fail(400, '글 식별자를 확인해주세요.');
    if (publicPath[2]) return await contentThumbnail(env, publicPath[1]);
    const row = await env.GAME_DB.prepare("SELECT * FROM site_content WHERE slug=?1 AND status='published'").bind(publicPath[1]).first();
    return row ? siteJson({ content: contentDto(row, { detail: true }) }) : fail(404, '공개된 글을 찾을 수 없습니다.');
  } catch { console.error('[site-content] service unavailable'); return fail(503, '콘텐츠를 잠시 사용할 수 없습니다.'); }
}
