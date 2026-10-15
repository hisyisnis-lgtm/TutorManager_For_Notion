import { z } from 'zod';
import { siteJson } from './siteAuth.js';
import { NotionPageIdSchema, StudentTokenSchema } from './schemas.js';
import { SITE_LEDGER_DATABASES, siteNotionOnce, verifySiteNotionPage } from './siteNotionSync.js';
import { normalizeStudentAppId, readStudentAppAccess, StudentAppAccessError } from './studentAppAccess.js';
import { readStudentAppProvision, changeStudentAppProvision } from './studentAppProvision.js';

const PREFIX = '/api/site/admin/student-members';
const UUID = z.string().uuid();
const approvalSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), idempotencyKey: UUID }).strict(),
  z.object({ mode: z.literal('existing'), studentId: NotionPageIdSchema, idempotencyKey: UUID }).strict(),
]);
const COMPLETE = "m.status='active' AND length(trim(m.name))>0 AND length(trim(COALESCE(m.terms_accepted_at,'')))>0 AND length(trim(COALESCE(m.privacy_accepted_at,'')))>0";
const now = () => new Date().toISOString();
const rich = value => [{ text: { content: value } }];
const propertyText = property => (property?.rich_text || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
class StudentMemberError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const conflict = (code, message) => new StudentMemberError(409, code, message);
const unavailable = () => new StudentMemberError(503, 'student_members_unavailable', '학생 등록을 처리하지 못했습니다. 잠시 후 다시 확인해주세요.');
function memberDto(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, provider: row.provider, createdAt: row.created_at };
}
function enrollmentDto(row) {
  return row?.enrollment_state ? { state: row.enrollment_state, studentId: row.enrollment_student_id,
    mode: row.enrollment_mode, idempotencyKey: row.enrollment_key } : null;
}
async function completeMember(db, id) {
  const row = await db.prepare(`SELECT m.* FROM site_members m WHERE m.id=?1 AND ${COMPLETE}`).bind(id).first();
  if (!row) throw new StudentMemberError(404, 'member_unavailable', '가입을 완료한 회원을 찾을 수 없습니다.');
  return row;
}

// Shared by the explicit approval API and the older manual link API. Both
// identities are claimed in the same transaction as the link. Never reassign.
export async function linkSiteStudentMember(env, memberId, id) {
  const db = env.GAME_DB, studentId = normalizeStudentAppId(id), at = now();
  const own = await db.prepare('SELECT student_id FROM site_student_links WHERE member_id=?1').bind(memberId).first();
  if (own && normalizeStudentAppId(own.student_id) !== studentId) {
    throw conflict('member_already_linked', '이미 다른 학생에게 연결된 계정입니다. 연결 정보를 확인해주세요.');
  }
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO site_student_identity_claims(student_id,member_id,created_at)
      SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM site_members m WHERE m.id=?2 AND ${COMPLETE})
      AND NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id=?2 AND lower(replace(student_id,'-',''))!=?1)
      AND NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id!=?2 AND lower(replace(student_id,'-',''))=?1)
      AND NOT EXISTS(SELECT 1 FROM site_student_enrollments WHERE member_id=?2 AND COALESCE(student_id,target_student_id,'')!=?1)`)
      .bind(studentId, memberId, at),
    db.prepare(`INSERT INTO site_student_links(member_id,student_id,verified_at,verified_by)
      SELECT ?1,?4,?3,'teacher' WHERE EXISTS(SELECT 1 FROM site_student_identity_claims WHERE member_id=?1 AND student_id=?2)
      AND EXISTS(SELECT 1 FROM site_members m WHERE m.id=?1 AND ${COMPLETE})
      AND NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id!=?1 AND lower(replace(student_id,'-',''))=?2)
      AND NOT EXISTS(SELECT 1 FROM site_student_enrollments WHERE member_id=?1 AND COALESCE(student_id,target_student_id,'')!=?2)
      ON CONFLICT(member_id) DO UPDATE SET verified_at=excluded.verified_at,verified_by='teacher'
      WHERE lower(replace(site_student_links.student_id,'-',''))=?2 AND site_student_links.verified_by!='teacher'`)
      .bind(memberId, studentId, at, id),
  ]);
  // Use the ordinary read API for the final authorization snapshot too: local
  // D1 adapters may omit result rows from SELECT statements inside batch().
  const link = await db.prepare(`SELECT l.* FROM site_student_links l
    JOIN site_student_identity_claims c ON c.member_id=l.member_id JOIN site_members m ON m.id=l.member_id
    WHERE l.member_id=?1 AND c.student_id=?2 AND lower(replace(l.student_id,'-',''))=?2
    AND l.verified_by='teacher' AND ${COMPLETE}
    AND NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id!=?1 AND lower(replace(student_id,'-',''))=?2)`)
    .bind(memberId, studentId).first();
  if (!link) {
    await completeMember(db, memberId);
    const current = await db.prepare('SELECT student_id FROM site_student_links WHERE member_id=?1').bind(memberId).first();
    if (current && normalizeStudentAppId(current.student_id) !== studentId) throw conflict('member_already_linked', '이미 다른 학생에게 연결된 계정입니다.');
    const enrollment = await operation(db, memberId);
    if (enrollment && (enrollment.student_id || enrollment.target_student_id) !== studentId) {
      throw conflict('enrollment_in_progress', '진행 중인 학생 등록이 있습니다. 기존 등록 결과를 먼저 확인해주세요.');
    }
    throw conflict('student_already_linked', '이미 다른 계정에 연결된 학생입니다. 기존 연결을 확인해주세요.');
  }
  return link;
}
export function siteStudentMemberErrorResponse(error, { canChangeSelection = false } = {}) {
  const selection = canChangeSelection ? { canChangeSelection: true } : {};
  if (error instanceof StudentMemberError || error instanceof StudentAppAccessError) {
    return siteJson({ error: error.message, code: error.code, ...selection,
      ...(error.access ? { access: error.access } : {}), ...(error.sync ? { sync: error.sync } : {}) }, { status: error.status });
  }
  const failure = unavailable();
  return siteJson({ error: failure.message, code: failure.code, ...selection }, { status: failure.status });
}
function reservationCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let value = '';
  while (value.length < 12) for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
    if (byte < 252) value += alphabet[byte % 36];
    if (value.length === 12) break;
  }
  return value;
}
function validStudent(page, expectedId, expectedCode) {
  if (!page || page.object !== 'page' || page.archived || page.in_trash
    || !NotionPageIdSchema.safeParse(page.id).success
    || !NotionPageIdSchema.safeParse(page.parent?.database_id).success
    || normalizeStudentAppId(page.parent.database_id) !== normalizeStudentAppId(SITE_LEDGER_DATABASES.student)
    || expectedId && normalizeStudentAppId(page.id) !== expectedId) throw conflict('student_invalid', '학생 DB 연결을 확인해주세요.');
  const code = propertyText(page.properties?.['예약 코드']);
  if (!StudentTokenSchema.safeParse(code).success || expectedCode && code !== expectedCode) {
    throw conflict('student_token_missing', '학생의 예약 코드가 올바르지 않습니다. 학생 정보에서 예약 코드를 확인해주세요.');
  }
  return normalizeStudentAppId(page.id);
}
async function operation(db, memberId) {
  return db.prepare('SELECT * FROM site_student_enrollments WHERE member_id=?1').bind(memberId).first();
}
async function recoverCreatedStudent(env, row) {
  // A request may have reached Notion even if its response was lost. A saved
  // random reservation code is the only recovery key; never repeat POST /pages.
  const result = await siteNotionOnce(env, 'POST', `/databases/${SITE_LEDGER_DATABASES.student}/query`, {
    filter: { property: '예약 코드', rich_text: { equals: row.reservation_code } }, page_size: 2,
  });
  if (!Array.isArray(result.results) || result.has_more || result.results.length !== 1) return null;
  return validStudent(result.results[0], null, row.reservation_code);
}
async function provisionStudent(env, member, row) {
  const db = env.GAME_DB;
  if (row.student_id) return row.student_id;
  if (row.mode === 'existing') {
    const page = await verifySiteNotionPage(env, row.target_student_id, SITE_LEDGER_DATABASES.student);
    const id = validStudent(page, row.target_student_id);
    await db.prepare("UPDATE site_student_enrollments SET student_id=?2,state='created',updated_at=?3 WHERE member_id=?1 AND student_id IS NULL")
      .bind(member.id, id, now()).run();
    return id;
  }
  const claimed = await db.prepare("UPDATE site_student_enrollments SET state='creating',updated_at=?2 WHERE member_id=?1 AND state='pending' RETURNING *")
    .bind(member.id, now()).first();
  if (!claimed) {
    const latest = await operation(db, member.id);
    if (latest.student_id) return latest.student_id;
    let id;
    try { id = await recoverCreatedStudent(env, latest); } catch { /* Uncertain stays closed to creation. */ }
    if (!id) {
      const inProgress = latest.state === 'creating' && Date.now() - Date.parse(latest.updated_at) < 30_000;
      if (latest.state === 'creating' && !inProgress) {
        await db.prepare("UPDATE site_student_enrollments SET state='unknown',updated_at=?2 WHERE member_id=?1 AND state='creating' AND student_id IS NULL")
          .bind(member.id, now()).run();
      }
      throw conflict(inProgress ? 'enrollment_in_progress' : 'enrollment_unknown',
        inProgress ? '학생 등록 결과를 확인 중입니다. 잠시 후 다시 확인해주세요.' : '학생 등록 결과를 확인하지 못했습니다. 다시 확인하면 기존 등록 결과만 조회합니다. 새 학생을 중복 등록하지 않습니다.');
    }
    await db.prepare("UPDATE site_student_enrollments SET student_id=?2,state='created',updated_at=?3 WHERE member_id=?1 AND student_id IS NULL")
      .bind(member.id, id, now()).run();
    return id;
  }
  const snapshot = JSON.parse(claimed.member_snapshot), properties = {
    이름: { title: rich(snapshot.name) }, 상태: { select: { name: '🟢 수강중' } }, VIP: { checkbox: false },
    '예약 코드': { rich_text: rich(claimed.reservation_code) },
    ...(snapshot.phone ? { 전화번호: { phone_number: snapshot.phone } } : {}),
    ...(snapshot.email ? { 이메일: { email: snapshot.email } } : {}),
  };
  try {
    const page = await siteNotionOnce(env, 'POST', '/pages', { parent: { database_id: SITE_LEDGER_DATABASES.student }, properties });
    const id = validStudent(page, null, claimed.reservation_code);
    await db.prepare("UPDATE site_student_enrollments SET student_id=?2,state='created',updated_at=?3 WHERE member_id=?1 AND student_id IS NULL")
      .bind(member.id, id, now()).run();
    return id;
  } catch (error) {
    // Explicit schema/auth rejection did not create a page. An operator may fix
    // that setup and retry. Transport errors or a malformed success stay unknown.
    if (error?.ambiguous === false && (error?.setup === true || error?.code === 'notion_rate_limited')) {
      await db.prepare("UPDATE site_student_enrollments SET state='pending',updated_at=?2 WHERE member_id=?1 AND student_id IS NULL AND state='creating'")
        .bind(member.id, now()).run();
      if (error.code === 'notion_rate_limited') throw new StudentMemberError(503, 'student_service_busy', '학생 DB 요청이 많습니다. 잠시 후 같은 등록을 다시 시도해주세요.');
      throw new StudentMemberError(503, 'student_setup_required', '학생 DB 설정을 확인해주세요. 설정을 수정한 후 같은 등록을 다시 시도할 수 있습니다.');
    }
    await db.prepare("UPDATE site_student_enrollments SET state='unknown',updated_at=?2 WHERE member_id=?1 AND student_id IS NULL AND state='creating'")
      .bind(member.id, now()).run();
    throw conflict('enrollment_unknown', '학생 등록 결과를 확인하지 못했습니다. 다시 확인하면 기존 등록 결과만 조회합니다. 새 학생을 중복 등록하지 않습니다.');
  }
}
async function approve(request, env, memberId) {
  const parsed = approvalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new StudentMemberError(400, 'invalid_enrollment', '학생 등록 방식과 연결할 학생을 확인해주세요.');
  const input = parsed.data, db = env.GAME_DB, member = await completeMember(db, memberId);
  const target = input.mode === 'existing' ? normalizeStudentAppId(input.studentId) : null;
  const previousOperation = await operation(db, memberId);
  const priorLink = await db.prepare('SELECT student_id FROM site_student_links WHERE member_id=?1').bind(memberId).first();
  if (priorLink && (!target || normalizeStudentAppId(priorLink.student_id) !== target) && !previousOperation) {
    throw conflict('member_already_linked', '이미 학생에게 연결된 계정입니다. 기존 학생의 이용 권한을 확인해주세요.');
  }
  if (!previousOperation && input.mode === 'existing') {
    // Ordinary selection mistakes must not freeze the member into a permanent
    // provisioning operation. The final atomic claim still handles races.
    validStudent(await verifySiteNotionPage(env, target, SITE_LEDGER_DATABASES.student), target);
    const owner = await db.prepare("SELECT member_id FROM site_student_links WHERE lower(replace(student_id,'-',''))=?1 AND member_id!=?2 LIMIT 1")
      .bind(target, memberId).first();
    const claim = await db.prepare('SELECT member_id FROM site_student_identity_claims WHERE student_id=?1 AND member_id!=?2').bind(target, memberId).first();
    if (owner || claim) throw conflict('student_already_linked', '이미 다른 계정에 연결된 학생입니다. 기존 연결을 확인해주세요.');
  }
  const at = now();
  await db.prepare(`INSERT OR IGNORE INTO site_student_enrollments(member_id,idempotency_key,mode,target_student_id,reservation_code,member_snapshot,state,created_at,updated_at)
    SELECT ?1,?2,?3,?4,?5,?6,'pending',?7,?7
    WHERE NOT EXISTS(SELECT 1 FROM site_student_links WHERE member_id=?1 AND (?4 IS NULL OR lower(replace(student_id,'-',''))!=?4))
      AND NOT EXISTS(SELECT 1 FROM site_student_identity_claims WHERE member_id=?1 AND (?4 IS NULL OR student_id!=?4))`)
    .bind(memberId, input.idempotencyKey, input.mode, target, input.mode === 'new' ? reservationCode() : null,
      JSON.stringify({ name: member.name, phone: member.phone, email: member.email }), at).run();
  let row = await operation(db, memberId);
  if (!row || row.idempotency_key !== input.idempotencyKey || row.mode !== input.mode || row.target_student_id !== target) {
    throw conflict('enrollment_conflict', '진행 중인 학생 등록이 있습니다. 목록을 새로고침해 기존 등록 결과를 확인해주세요.');
  }
  const studentId = await provisionStudent(env, member, row);
  // Re-read the actual page on every resumable approval too. Archived students
  // and a removed/invalid token must never produce a false successful grant.
  validStudent(await verifySiteNotionPage(env, studentId, SITE_LEDGER_DATABASES.student), studentId, row.mode === 'new' ? row.reservation_code : null);
  await linkSiteStudentMember(env, memberId, studentId);
  let access = await readStudentAppAccess(env, studentId);
  row = await operation(db, memberId);
  let provision;
  if (row.state === 'granted') {
    if (!access.allowed) throw conflict('access_revision_changed', '학생앱 이용 권한이 변경되었습니다. 학생 정보에서 현재 이용 권한을 확인해주세요.');
    provision = await readStudentAppProvision(env, studentId);
    if (!provision.sync.ready || !provision.sync.homeworkEnabled) provision = await changeStudentAppProvision(env, studentId, { allowed: true, expectedRevision: access.revision });
    return siteJson({ studentId, ...provision, member: memberDto(member) });
  }
  await completeMember(db, memberId);
  if (row.grant_base_revision === null) {
    // Persist the CAS baseline before granting. A later retry may recover a
    // completed grant, but can never undo a subsequent teacher revocation.
    await db.prepare("UPDATE site_student_enrollments SET state='linked',grant_base_revision=?2,updated_at=?3 WHERE member_id=?1 AND grant_base_revision IS NULL")
      .bind(memberId, access.revision, now()).run();
    row = await operation(db, memberId);
  }
  access = await readStudentAppAccess(env, studentId);
  if (!access.allowed) {
    provision = await changeStudentAppProvision(env, studentId, { allowed: true, expectedRevision: row.grant_base_revision, actor: 'teacher' });
    access = provision.access;
  }
  if (!access.allowed) throw conflict('access_revision_changed', '학생앱 이용 상태가 변경되었습니다. 학생 정보에서 현재 이용 권한을 확인해주세요.');
  if (!provision) {
    provision = await readStudentAppProvision(env, studentId);
    if (!provision.sync.ready || !provision.sync.homeworkEnabled) provision = await changeStudentAppProvision(env, studentId, { allowed: true, expectedRevision: access.revision });
  }
  await db.prepare("UPDATE site_student_enrollments SET state='granted',updated_at=?2 WHERE member_id=?1").bind(memberId, now()).run();
  return siteJson({ studentId, ...provision, member: memberDto(member) });
}
async function listMembers(url, env) {
  const query = (url.searchParams.get('query') || '').trim(), rawLimit = url.searchParams.get('limit'), rawCursor = url.searchParams.get('cursor');
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (query && (query.length < 2 || query.length > 120 || /[\x00-\x1f]/.test(query)) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new StudentMemberError(400, 'invalid_member_query', '검색어와 목록 범위를 확인해주세요.');
  }
  let cursor;
  if (rawCursor) {
    try { cursor = JSON.parse(atob(rawCursor)); } catch { /* Validate below. */ }
    if (rawCursor.length > 512 || !cursor || !UUID.safeParse(cursor.id).success || typeof cursor.at !== 'string'
      || cursor.at.length > 40 || !Number.isFinite(Date.parse(cursor.at))) throw new StudentMemberError(400, 'invalid_member_cursor', '회원 목록을 다시 불러와주세요.');
  }
  const escaped = query.replace(/[\\%_]/g, character => '\\' + character);
  const result = await env.GAME_DB.prepare(`SELECT m.id,m.name,m.email,m.phone,m.provider,m.created_at,
      e.state AS enrollment_state,COALESCE(e.student_id,e.target_student_id) AS enrollment_student_id,e.mode AS enrollment_mode,e.idempotency_key AS enrollment_key
    FROM site_members m LEFT JOIN site_student_links l ON l.member_id=m.id
    LEFT JOIN site_student_enrollments e ON e.member_id=m.id
    WHERE ${COMPLETE} AND (l.member_id IS NULL OR (e.member_id IS NOT NULL AND e.state!='granted'))
      AND (?1='' OR m.name LIKE ?2 ESCAPE '\\' OR m.phone LIKE ?2 ESCAPE '\\' OR lower(m.email)=lower(?1))
      AND (?3 IS NULL OR m.created_at<?3 OR (m.created_at=?3 AND m.id<?4))
    ORDER BY m.created_at DESC,m.id DESC LIMIT ?5`)
    .bind(query, `%${escaped}%`, cursor?.at ?? null, cursor?.id ?? null, limit + 1).all();
  const rows = result.results || [], visible = rows.slice(0, limit), last = visible.at(-1);
  return siteJson({ members: visible.map(row => ({ ...memberDto(row), enrollment: enrollmentDto(row) })),
    nextCursor: rows.length > limit ? btoa(JSON.stringify({ at: last.created_at, id: last.id })) : null });
}
export async function handleSiteStudentMemberRoutes(request, env, _ctx, { authorizeTeacher } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
  let teacherAuthorized = false;
  try {
    if (typeof authorizeTeacher !== 'function') throw unavailable();
    const denial = await authorizeTeacher(request, env, {}); if (denial) return denial;
    teacherAuthorized = true;
    if (!env.GAME_DB) throw unavailable();
    if (url.pathname === PREFIX) {
      if (request.method !== 'GET') return siteJson({ error: '지원하지 않는 요청입니다.' }, { status: 405, headers: { Allow: 'GET' } });
      return await listMembers(url, env);
    }
    const match = url.pathname.slice(PREFIX.length).match(/^\/([^/]+)\/approve$/);
    if (!match || !UUID.safeParse(match[1]).success) return siteJson({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });
    if (request.method !== 'POST') return siteJson({ error: '지원하지 않는 요청입니다.' }, { status: 405, headers: { Allow: 'POST' } });
    return await approve(request, env, match[1]);
  } catch (error) {
    let canChangeSelection = false;
    const match = url.pathname.slice(PREFIX.length).match(/^\/([^/]+)\/approve$/);
    if (teacherAuthorized && request.method === 'POST' && match && UUID.safeParse(match[1]).success) {
      try { canChangeSelection = !await operation(env.GAME_DB, match[1]); } catch { /* An unavailable schema stays closed. */ }
    }
    return siteStudentMemberErrorResponse(error, { canChangeSelection });
  }
}
