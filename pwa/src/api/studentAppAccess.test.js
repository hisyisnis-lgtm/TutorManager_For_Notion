import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteAdmin } from './siteCommerce.js';
import { getStudentAppAccess, updateStudentAppAccess } from './studentAppAccess.js';

vi.mock('./siteCommerce.js', () => ({ siteAdmin: vi.fn() }));
const ID = '10000000-0000-4000-8000-000000000001';
const synced = allowed => ({ state: 'synced', ready: true, homeworkEnabled: allowed, pendingAllowed: null, expectedRevision: null });
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('학생앱 제공 권한의 강사 API 계약', () => {
  it('기존 권한이 없을 때 서버의 미제공·revision 0을 그대로 사용한다', async () => {
    const access = { studentId: ID.replaceAll('-', ''), allowed: false, revision: 0 };
    siteAdmin.mockResolvedValue({ access, sync: synced(false) });
    const controller = new AbortController();
    expect(await getStudentAppAccess(ID, { signal: controller.signal })).toEqual({ ...access, sync: synced(false) });
    expect(siteAdmin).toHaveBeenCalledWith(`/student-app/access/${ID}`, { signal: controller.signal });
  });

  it('제공·중지는 확인한 revision을 포함한 PUT으로만 변경한다', async () => {
    siteAdmin.mockResolvedValue({ access: { studentId: ID, allowed: true, revision: 3 }, sync: synced(true) });
    await updateStudentAppAccess(ID, { allowed: true, expectedRevision: 2 });
    expect(siteAdmin).toHaveBeenCalledWith(`/student-app/access/${ID}`, {
      method: 'PUT', body: { allowed: true, expectedRevision: 2 }, signal: undefined,
    });
  });

  it.each([{}, { access: { studentId: ID, allowed: true } }, { access: { studentId: ID, allowed: 'true', revision: 1 } },
    { access: { studentId: ID, allowed: true, revision: -1 } }, { access: { studentId: 'another-student', allowed: true, revision: 1 } }])('불명확하거나 다른 학생의 응답은 제공 권한으로 사용하지 않는다', async response => {
    siteAdmin.mockResolvedValue(response);
    await expect(getStudentAppAccess(ID)).rejects.toThrow('학생앱 제공 상태를 확인하지 못했어요');
  });

  it('미지원 서버의 일반 프록시 거부는 서버 업데이트가 필요한 오류로 안내한다', async () => {
    siteAdmin.mockRejectedValue(Object.assign(new Error('허용되지 않은 경로입니다.'), { status: 403 }));
    await expect(getStudentAppAccess(ID)).rejects.toMatchObject({ status: 403, message: '서버에 학생앱 제공 기능이 아직 반영되지 않았어요. 서버 업데이트 후 다시 확인해 주세요.' });
    expect(siteAdmin).toHaveBeenCalledTimes(1);
  });

  it('실제 권한 거부를 서버 미지원이나 제공 권한으로 바꾸지 않는다', async () => {
    const denied = Object.assign(new Error('권한이 없습니다.'), { status: 403 });
    siteAdmin.mockRejectedValue(denied);
    await expect(getStudentAppAccess(ID)).rejects.toBe(denied);
  });

  it('동시 변경 오류를 숨기거나 자동 재시도하지 않는다', async () => {
    const conflict = Object.assign(new Error('revision conflict'), { status: 409 });
    siteAdmin.mockRejectedValue(conflict);
    await expect(updateStudentAppAccess(ID, { allowed: false, expectedRevision: 1 })).rejects.toBe(conflict);
    expect(siteAdmin).toHaveBeenCalledTimes(1);
  });

  it.each([{ allowed: true, expectedRevision: -1 }, { allowed: true }, { allowed: 1, expectedRevision: 0 }])('잘못된 권한 변경은 서버에 보내지 않는다', async update => {
    await expect(updateStudentAppAccess(ID, update)).rejects.toThrow();
    expect(siteAdmin).not.toHaveBeenCalled();
  });

  it('숙제 동기화 계약이 없는 구 서버를 제공 성공으로 사용하지 않는다', async () => {
    siteAdmin.mockResolvedValue({ access: { studentId: ID, allowed: true, revision: 1 } });
    await expect(getStudentAppAccess(ID)).rejects.toThrow('학생앱 제공 상태를 확인하지 못했어요');
    await expect(updateStudentAppAccess(ID, { allowed: true, expectedRevision: 0 })).rejects.toThrow('학생앱 제공 상태를 확인하지 못했어요');
  });
  it('제공 권한과 숙제 대상이 다른 응답을 동기화 완료로 인정하지 않는다', async () => {
    siteAdmin.mockResolvedValue({ access: { studentId: ID, allowed: true, revision: 1 }, sync: synced(false) });
    await expect(getStudentAppAccess(ID)).rejects.toThrow();
  });
  it('생성 결과 불명확 상태를 보존하고 쓰기를 자동 재시도하지 않는다', async () => {
    const access = { studentId: ID, allowed: false, revision: 1 };
    const sync = { state: 'unknown', ready: false, homeworkEnabled: null, pendingAllowed: true, expectedRevision: 0 };
    siteAdmin.mockResolvedValue({ access, sync });
    expect(await getStudentAppAccess(ID)).toEqual({ ...access, sync });
    expect(siteAdmin).toHaveBeenCalledTimes(1);
  });
  it('회수 중 오류가 났어도 서버에서 확정된 false를 true로 되돌리지 않는다', async () => {
    const error = Object.assign(new Error('동기화 결과 확인 필요'), { status: 503,
      access: { studentId: ID, allowed: false, revision: 4 },
      sync: { state: 'unknown', ready: false, homeworkEnabled: null, pendingAllowed: false, expectedRevision: 3 } });
    siteAdmin.mockRejectedValue(error);
    await expect(updateStudentAppAccess(ID, { allowed: false, expectedRevision: 3 })).rejects.toMatchObject({
      currentAccess: { allowed: false, revision: 4, sync: { state: 'unknown', ready: false } },
    });
    expect(siteAdmin).toHaveBeenCalledTimes(1);
  });
});
