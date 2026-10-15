// HttpOnly 회원 쿠키는 읽거나 저장하지 않는다. 서버가 확인한 학생 범위만 현재 탭에 둔다.
const listeners = new Set();
let context = null;
export const getStudentAppContext = () => context;
export const getStudentAppScope = () => context?.allowed === true ? context.scope : '';
export const isStudentAppScope = scope => typeof scope === 'string' && scope.startsWith('app-');
export const studentAppCredential = scope => getStudentAppScope() === scope ? context.scope : '';
export function normalizeStudentAppContext(data) {
  if (!data || typeof data.allowed !== 'boolean') throw new Error('학생 앱 이용 상태를 확인하지 못했어요.');
  if (!data.allowed) return { allowed: false, reason: typeof data.reason === 'string' ? data.reason : 'not_allowed', memberId: data.memberId || null };
  if (typeof data.memberId !== 'string' || !data.memberId || typeof data.studentId !== 'string' || !data.studentId
    || typeof data.studentScope !== 'string' || !data.studentScope
    || !((typeof data.revision === 'number' && Number.isSafeInteger(data.revision) && data.revision >= 0)
      || (typeof data.revision === 'string' && data.revision.length > 0 && data.revision.length <= 100))) {
    throw new Error('학생 앱 이용 상태를 확인하지 못했어요.');
  }
  const scope = `app-${encodeURIComponent(JSON.stringify([data.memberId, data.studentId, data.revision, data.studentScope]))}`;
  return { allowed: true, memberId: data.memberId, studentId: data.studentId, revision: data.revision, studentScope: data.studentScope, scope };
}
export function setStudentAppContext(next) {
  if (JSON.stringify(context) === JSON.stringify(next)) return false;
  context = next;
  listeners.forEach(listener => listener());
  return true;
}
export function subscribeStudentAppContext(listener) { listeners.add(listener); return () => listeners.delete(listener); }
