import { siteAdmin } from './siteCommerce.js';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const studentIdValid = value => typeof value === 'string' && /^[a-f\d]{32}$/i.test(value.replaceAll('-', ''));
const unavailable = () => new Error('가입한 학생 정보를 확인하지 못했어요. 다시 시도해 주세요.');

function enrollmentValid(enrollment) {
  if (enrollment == null) return true;
  if (!['pending', 'creating', 'created', 'unknown', 'linked', 'granted'].includes(enrollment.state)) return false;
  if (enrollment.studentId != null && !studentIdValid(enrollment.studentId)) return false;
  // pending도 서버에 저장된 승인 작업이다. 대상이나 key가 빠진 채 새 승인으로 바꾸지 않는다.
  return UUID.test(enrollment.idempotencyKey || '') && ['new', 'existing'].includes(enrollment.mode)
    && (enrollment.mode !== 'existing' || studentIdValid(enrollment.studentId))
    && (!['created', 'linked', 'granted'].includes(enrollment.state) || studentIdValid(enrollment.studentId));
}

export async function getSiteStudentMembers({ query = '', cursor = '', signal } = {}) {
  const params = new URLSearchParams();
  // 한 글자 검색은 서버 최소 검색 길이보다 짧아 현재 목록에서만 좁힌다.
  if (query.trim().length >= 2) params.set('query', query.trim());
  if (cursor) params.set('cursor', cursor);
  const data = await siteAdmin(`/student-members${params.size ? `?${params}` : ''}`, { signal });
  if (!Array.isArray(data?.members) || data.members.some(member => !UUID.test(member?.id || '')
    || typeof member.name !== 'string' || !member.name.trim() || !enrollmentValid(member.enrollment))
    || (data.nextCursor != null && typeof data.nextCursor !== 'string')) throw unavailable();
  return { members: data.members, nextCursor: data.nextCursor || '' };
}

export async function approveSiteStudentMember(memberId, approval, { signal } = {}) {
  if (!UUID.test(memberId || '') || !UUID.test(approval?.idempotencyKey || '')
    || !['new', 'existing'].includes(approval?.mode)
    || (approval.mode === 'existing' && !studentIdValid(approval.studentId))) throw unavailable();
  const body = { mode: approval.mode, idempotencyKey: approval.idempotencyKey,
    ...(approval.mode === 'existing' ? { studentId: approval.studentId } : {}) };
  const data = await siteAdmin(`/student-members/${encodeURIComponent(memberId)}/approve`, { method: 'POST', body, signal });
  if (!studentIdValid(data?.studentId) || data?.access?.allowed !== true
    || !Number.isSafeInteger(data.access.revision) || data.access.revision < 0
    || data?.sync?.ready !== true || data.sync.state !== 'synced' || data.sync.homeworkEnabled !== true
    || (data.access.studentId && data.access.studentId.replaceAll('-', '').toLowerCase() !== data.studentId.replaceAll('-', '').toLowerCase())) throw unavailable();
  return data;
}
