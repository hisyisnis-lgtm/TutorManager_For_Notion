import { siteAdmin } from './siteCommerce.js';

const unavailable = () => new Error('학생앱 제공 상태를 확인하지 못했어요. 다시 시도해 주세요.');
const compact = value => String(value).replaceAll('-', '').toLowerCase();

function accessFrom(data, studentId) {
  const access = data?.access;
  const sync = data?.sync;
  if (!access || typeof access.studentId !== 'string' || compact(access.studentId) !== compact(studentId)
    || typeof access.allowed !== 'boolean' || !Number.isSafeInteger(access.revision) || access.revision < 0
    || !sync || !['synced', 'processing', 'unknown', 'out_of_sync', 'failed'].includes(sync.state)
    || typeof sync.ready !== 'boolean' || !(sync.homeworkEnabled === null || typeof sync.homeworkEnabled === 'boolean')
    || !(sync.pendingAllowed === null || typeof sync.pendingAllowed === 'boolean')
    || !(sync.expectedRevision === null || Number.isSafeInteger(sync.expectedRevision) && sync.expectedRevision >= 0)
    || (sync.ready && (sync.state !== 'synced' || sync.homeworkEnabled !== access.allowed || sync.pendingAllowed !== null))) {
    throw unavailable();
  }
  return { ...access, sync };
}

function checkedFailure(error, studentId) {
  if (error?.access && error?.sync) {
    try { error.currentAccess = accessFrom(error, studentId); } catch { /* 불명확한 응답으로 제공 여부를 추정하지 않는다. */ }
  }
  return error;
}

function pathFor(studentId) {
  if (typeof studentId !== 'string' || !studentId.trim()) throw unavailable();
  return `/student-app/access/${encodeURIComponent(studentId)}`;
}

export async function getStudentAppAccess(studentId, { signal } = {}) {
  try {
    return accessFrom(await siteAdmin(pathFor(studentId), { signal }), studentId);
  } catch (error) {
    // 이전 Worker가 새 API를 일반 Notion 프록시로 처리할 때의 응답이다.
    if (error.status === 403 && error.message === '허용되지 않은 경로입니다.') {
      error.message = '서버에 학생앱 제공 기능이 아직 반영되지 않았어요. 서버 업데이트 후 다시 확인해 주세요.';
    }
    throw checkedFailure(error, studentId);
  }
}

export async function updateStudentAppAccess(studentId, { allowed, expectedRevision }, { signal } = {}) {
  if (typeof allowed !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw unavailable();
  try {
    return accessFrom(await siteAdmin(pathFor(studentId), { method: 'PUT', body: { allowed, expectedRevision }, signal }), studentId);
  } catch (error) { throw checkedFailure(error, studentId); }
}
