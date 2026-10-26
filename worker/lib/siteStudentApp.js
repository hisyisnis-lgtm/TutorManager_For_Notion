import { z } from 'zod';
import { authorizeSiteMember, siteJson } from './siteAuth.js';
import { NotionPageIdSchema, StudentTokenSchema } from './schemas.js';
import { verifySiteNotionPage, SITE_LEDGER_DATABASES } from './siteNotionSync.js';
import { StudentAppAccessError, normalizeStudentAppId, readStudentAppAccess } from './studentAppAccess.js';
import { readStudentAppProvision, changeStudentAppProvision } from './studentAppProvision.js';

const PREFIX = '/api/site/student-app';
const ADMIN_PREFIX = '/api/site/admin/student-app/access/';
const changeSchema = z.object({ allowed: z.boolean(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const fail = (status, error, code) => siteJson({ error, ...(code ? { code } : {}) }, { status });
const unavailable = () => fail(503, '학생앱 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', 'student_app_unavailable');

function describeRoute(path, method) {
  const fixed = new Map([
    ['/context', ['GET', 'context']], ['/student', ['GET', 'student']], ['/classes', ['GET', 'classes']],
    ['/homework', ['GET', 'homework']], ['/homework/upload', ['POST', 'homework-upload']],
    ['/homework/feedback-seen', ['POST', 'feedback-seen']], ['/notices', ['GET', 'notices']],
    ['/consent', ['GET', 'consent']], ['/panda', ['GET', 'panda']], ['/panda/action', ['POST', 'panda-action']],
  ]);
  let match = fixed.get(path), resourceId;
  if (!match) {
    const resource = path.match(/^\/homework\/([^/]+)\/(submit|file|file-sizes)$/);
    if (resource && NotionPageIdSchema.safeParse(resource[1]).success) {
      resourceId = resource[1]; match = resource[2] === 'submit' ? ['POST', 'homework-submit']
        : ['GET', resource[2] === 'file-sizes' ? 'homework-file-sizes' : 'homework-file'];
    }
  }
  if (!match) return null;
  return { method: match[0], operation: match[1], ...(resourceId ? { resourceId } : {}), supported: method === match[0] };
}
const linkDenied = descriptor => descriptor?.operation === 'context' ? siteJson({ allowed: false, reason: 'not_linked' })
  : fail(403, '확인된 학생 연결이 필요합니다. 선생님에게 문의해주세요.', 'student_app_not_linked');
const grantDenied = descriptor => descriptor?.operation === 'context' ? siteJson({ allowed: false, reason: 'not_provided' })
  : fail(403, '학생앱 이용 대상이 아닙니다. 선생님에게 문의해주세요.', 'student_app_not_provided');

// One current D1 snapshot, after upstream awaits and immediately before writes.
// A revoked/reissued grant or a changed verified link never carries this request forward.
export async function revalidateSiteStudentAppAccess(env, context, descriptor) {
  try {
    const row = await env.GAME_DB.prepare(`SELECT s.member_id,s.revoked_at,s.expires_at,s.csrf_hash,
      m.status,m.name,m.terms_accepted_at,m.privacy_accepted_at,
      l.student_id,l.verified_at,l.verified_by,a.allowed,a.revision,
      n.state AS sync_state,n.result_revision AS sync_revision,n.verified_allowed AS sync_allowed
      FROM site_sessions s LEFT JOIN site_members m ON m.id=s.member_id
      LEFT JOIN site_student_links l ON l.member_id=s.member_id
      LEFT JOIN student_app_access a ON a.student_id=?2
      LEFT JOIN student_app_homework_sync n ON n.student_id=?2 WHERE s.id=?1`)
      .bind(context.sessionId, context.studentId).first();
    if (!row || row.revoked_at !== null || row.expires_at <= Math.floor(Date.now() / 1000)
      || row.member_id !== context.memberId || row.csrf_hash !== context.sessionCsrfHash) {
      return fail(401, '세션이 만료되었습니다. 화면을 새로고침해주세요.', 'session_expired');
    }
    if (!row.status || ['suspended', 'withdrawn'].includes(row.status)) return fail(403, '이용할 수 없는 계정입니다.', 'member_unavailable');
    if (row.status !== 'active' || !row.name || !row.terms_accepted_at || !row.privacy_accepted_at) {
      return fail(409, '회원 정보를 먼저 완성해주세요.', 'profile_incomplete');
    }
    if (!row.student_id || normalizeStudentAppId(row.student_id) !== context.studentId
      || row.verified_by !== 'teacher' || row.verified_at !== context.linkVerifiedAt) return linkDenied(descriptor);
    if (row.allowed === null) return grantDenied(descriptor);
    if (![0, 1].includes(row.allowed) || !Number.isSafeInteger(row.revision) || row.revision < 1) return unavailable();
    if (row.allowed !== 1) return grantDenied(descriptor);
    if (row.sync_state && (row.sync_state !== 'synced' || row.sync_allowed !== 1 || row.sync_revision !== row.revision)) return grantDenied(descriptor);
    if (row.revision !== context.revision) return fail(403, '학생앱 이용 상태가 변경되었습니다. 새로고침 후 다시 확인해주세요.', 'student_app_access_changed');
    return null;
  } catch { return unavailable(); }
}
async function linkedMember(request, env, descriptor) {
  const access = await authorizeSiteMember(request, env, { requireCsrf: request.method !== 'GET' });
  if (access instanceof Response) return access;
  const link = await env.GAME_DB.prepare('SELECT student_id,verified_at,verified_by FROM site_student_links WHERE member_id=?1').bind(access.member.id).first();
  if (!link || link.verified_by !== 'teacher' || typeof link.verified_at !== 'string' || !Number.isFinite(Date.parse(link.verified_at))) {
    return linkDenied(descriptor);
  }
  const studentId = normalizeStudentAppId(link.student_id);
  const entitlement = await readStudentAppAccess(env, studentId);
  if (!entitlement.allowed) return grantDenied(descriptor);
  const page = await verifySiteNotionPage(env, link.student_id, SITE_LEDGER_DATABASES.student);
  if (normalizeStudentAppId(page.id) !== studentId) throw new Error('invalid_student_page');
  const provision = await readStudentAppProvision(env, studentId, { page });
  if (!provision.access.allowed || !provision.sync.ready || !provision.sync.homeworkEnabled) return grantDenied(descriptor);
  const token = (page.properties?.['예약 코드']?.rich_text || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
  if (!StudentTokenSchema.safeParse(token).success) return unavailable();
  const context = { memberId: access.member.id, studentId, token, revision: entitlement.revision,
    sessionId: access.session.id, sessionCsrfHash: access.session.csrf_hash, linkVerifiedAt: link.verified_at,
    studentScope: `student-app:${access.member.id}:${studentId}:${entitlement.revision}` };
  return await revalidateSiteStudentAppAccess(env, context, descriptor) || context;
}

export async function handleSiteStudentAppRoutes(request, env, ctx, { authorizeTeacher, dispatch } = {}) {
  const url = new URL(request.url), admin = url.pathname.startsWith(ADMIN_PREFIX);
  if (!admin && !url.pathname.startsWith(`${PREFIX}/`)) return null;
  try {
    if (admin) {
      if (typeof authorizeTeacher !== 'function') return unavailable();
      const denial = await authorizeTeacher(request, env, {}); if (denial) return denial;
      const id = url.pathname.slice(ADMIN_PREFIX.length);
      if (!NotionPageIdSchema.safeParse(id).success) return fail(404, '학생을 찾을 수 없습니다.');
      if (!['GET', 'PUT'].includes(request.method)) return siteJson({ error: '지원하지 않는 요청입니다.' }, { status: 405, headers: { Allow: 'GET, PUT' } });
      if (request.method === 'GET') return siteJson(await readStudentAppProvision(env, id));
      const body = changeSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return fail(400, '이용 상태와 현재 버전을 확인해주세요.');
      // OFF closes D1 before waiting for Notion. ON grants only after confirmed VIP.
      return siteJson(await changeStudentAppProvision(env, id, { ...body.data, actor: 'teacher' }));
    }
    const descriptor = describeRoute(url.pathname.slice(PREFIX.length), request.method);
    if (!descriptor) return fail(404, '요청한 학생앱 항목을 찾을 수 없습니다.');
    if (!descriptor.supported) return siteJson({ error: '지원하지 않는 요청입니다.' }, { status: 405, headers: { Allow: descriptor.method } });
    const context = await linkedMember(request, env, descriptor);
    if (context instanceof Response) return context;
    if (descriptor.operation === 'context') {
      const { memberId, studentId, revision, studentScope } = context;
      return siteJson({ allowed: true, memberId, studentId, revision, studentScope });
    }
    if (typeof dispatch !== 'function') return unavailable();
    const response = await dispatch(request, context, descriptor, ctx);
    const denial = await revalidateSiteStudentAppAccess(env, context);
    if (denial) { await response.body?.cancel().catch(() => {}); return denial; }
    return response;
  } catch (error) {
    if (error instanceof StudentAppAccessError) return siteJson({ error: error.message, code: error.code,
      ...(error.access ? { access: error.access } : {}), ...(error.sync ? { sync: error.sync } : {}) }, { status: error.status });
    return unavailable();
  }
}
