import { rateLimitCheck } from './securityStore.js';
import { boundedRequest, RequestTooLarge } from './httpSecurity.js';

const RECIPIENT = 'tiantianchinese_@naver.com';
const TYPES = { lecture: '기업·기관 출강', collaboration: '콘텐츠·브랜드 협업' };
const OFFICIAL = new Set(['https://tiantianchinese.com', 'https://www.tiantianchinese.com', 'https://tiantianchinese.pages.dev']);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>,;:"\\\x00-\x1f\x7f]+@[^\s@<>,;:"\\\x00-\x1f\x7f]+\.[^\s@<>,;:"\\\x00-\x1f\x7f]+$/.test(value);
const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function contactOriginAllowed(origin, env) {
  if (OFFICIAL.has(origin)) return true;
  if (env.SITE_ENVIRONMENT !== 'development' || origin !== env.SITE_ORIGIN) return false;
  try { const url = new URL(origin); return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === origin; }
  catch { return false; }
}

export function buildContactEmail(env, fields) {
  if (!email(env.SITE_CONTACT_FROM)) throw new Error('contact_unavailable');
  const subject = `[하늘하늘중국어] ${TYPES[fields.type]} 문의`;
  const rows = [['문의 유형', TYPES[fields.type]], ['기업·기관명', fields.company], ['담당자 이름', fields.name], ['답변 이메일', fields.email], ['문의 내용', fields.message]];
  return { to: RECIPIENT, from: { email: env.SITE_CONTACT_FROM, name: '하늘하늘중국어' }, replyTo: fields.email, subject,
    text: rows.map(([label, value]) => `${label}\n${value}`).join('\n\n'),
    html: `<html lang="ko"><body>${rows.map(([label, value]) => `<h2>${label}</h2><p style="white-space:pre-wrap">${escape(value)}</p>`).join('')}</body></html>` };
}

// This public endpoint has no member authority. Only the fixed operator receives mail;
// input is never used as the sender or recipient, and no message content enters logs.
export async function handleSiteContactRoutes(request, env, { rateLimit = rateLimitCheck } = {}) {
  const url = new URL(request.url);
  if (!['/api/site/contact', '/contact'].includes(url.pathname)) return null;
  const origin = request.headers.get('Origin') || '';
  const allowed = contactOriginAllowed(origin, env) && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'Retry-After',
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}) };
  const reply = (status, data, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
  if (!allowed) return reply(403, { error: '홈페이지에서 다시 문의해 주세요.', code: 'contact_origin_rejected' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: '지원하지 않는 요청입니다.' }, { Allow: 'POST, OPTIONS' });
  if (url.search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return reply(400, { error: '문의 내용을 확인해 주세요.' });
  let body;
  try { request = await boundedRequest(request); body = await request.json(); }
  catch (error) { return reply(error instanceof RequestTooLarge ? 413 : 400, { error: '문의 내용을 확인해 주세요.' }); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['type', 'company', 'name', 'email', 'message', 'website'].includes(key))) return reply(400, { error: '문의 내용을 확인해 주세요.' });
  if (body.website !== undefined && (typeof body.website !== 'string' || body.website.length > 500)) return reply(400, { error: '문의 내용을 확인해 주세요.' });
  if (typeof body.website === 'string' && body.website.trim()) return reply(200, { ok: true });
  const fields = {};
  for (const key of ['type', 'company', 'name', 'email', 'message']) {
    if (typeof body[key] !== 'string' || body[key].includes('\0')) return reply(400, { error: '모든 문의 항목을 입력해 주세요.' });
    fields[key] = body[key].trim();
  }
  if (!Object.hasOwn(TYPES, fields.type) || !fields.company || fields.company.length > 100 || !fields.name || fields.name.length > 50
    || /[\r\n]/.test(fields.company + fields.name) || !email(fields.email) || !fields.message || fields.message.length > 2000) return reply(400, { error: '입력한 문의 항목과 길이를 확인해 주세요.' });
  if (typeof env.CONTACT_EMAIL?.send !== 'function' || !email(env.SITE_CONTACT_FROM)) return reply(503, { error: '문의 접수를 준비하고 있어요. 이메일로 문의해 주세요.', code: 'contact_unavailable' });
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if (!await rateLimit(env, `site-contact:ip:${ip}`, 3, 600) || !await rateLimit(env, 'site-contact:daily', 50, 86400)) return reply(429,
      { error: '문의가 잠시 많아요. 이메일로 문의해 주세요.', code: 'contact_rate_limited' });
  } catch {
    return reply(503, { error: '문의 접수를 준비하고 있어요. 이메일로 문의해 주세요.', code: 'contact_unavailable' });
  }
  try {
    const receipt = await env.CONTACT_EMAIL.send(buildContactEmail(env, fields));
    if (typeof receipt?.messageId !== 'string' || !receipt.messageId.trim()) throw new Error('unconfirmed');
  } catch {
    // A timeout can occur after acceptance; never retry the delivery automatically.
    return reply(503, { error: '접수 결과를 확인하지 못했어요. 이메일로 접수 여부를 확인해 주세요.', code: 'contact_unconfirmed' });
  }
  return reply(200, { ok: true });
}
