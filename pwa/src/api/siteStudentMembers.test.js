import { beforeEach, describe, expect, it, vi } from 'vitest';
import { siteAdmin } from './siteCommerce.js';
import { approveSiteStudentMember, getSiteStudentMembers } from './siteStudentMembers.js';

vi.mock('./siteCommerce.js', () => ({ siteAdmin: vi.fn() }));
const MEMBER = '10000000-0000-4000-8000-000000000001';
const STUDENT = '20000000-0000-4000-8000-000000000002';
const KEY = '30000000-0000-4000-8000-000000000003';
beforeEach(() => vi.resetAllMocks());

describe('가입 학생 승인 API', () => {
  it('가입 완료 학생을 별도 ID 목록으로 조회하고 cursor와 검색어를 인코딩한다', async () => {
    const response = { members: [{ id: MEMBER, name: '김학생' }], nextCursor: 'next/page' };
    siteAdmin.mockResolvedValue(response);
    const signal = new AbortController().signal;
    expect(await getSiteStudentMembers({ query: ' 김학생 ', cursor: 'after/page', signal })).toEqual(response);
    expect(siteAdmin).toHaveBeenCalledWith('/student-members?query=%EA%B9%80%ED%95%99%EC%83%9D&cursor=after%2Fpage', { signal });
  });
  it('서버 최소 길이보다 짧은 검색어를 전송하지 않는다', async () => {
    siteAdmin.mockResolvedValue({ members: [], nextCursor: null });
    expect(await getSiteStudentMembers({ query: '김' })).toEqual({ members: [], nextCursor: '' });
    expect(siteAdmin).toHaveBeenCalledWith('/student-members', { signal: undefined });
  });
  it.each([{}, { members: [{}] }, { members: [{ id: MEMBER, name: '' }] }, { members: [], nextCursor: 3 }])('불명확한 회원 응답을 빈 목록으로 바꾸지 않는다', async response => {
    siteAdmin.mockResolvedValue(response);
    await expect(getSiteStudentMembers()).rejects.toThrow('가입한 학생 정보를 확인하지 못했어요');
  });
  it('동일한 key와 명시적인 기존 학생 ID로 승인한다', async () => {
    const response = { studentId: STUDENT, access: { studentId: STUDENT.replaceAll('-', ''), allowed: true, revision: 1 }, sync: { state: 'synced', ready: true, homeworkEnabled: true } };
    siteAdmin.mockResolvedValue(response);
    expect(await approveSiteStudentMember(MEMBER, { mode: 'existing', studentId: STUDENT, idempotencyKey: KEY })).toEqual(response);
    expect(siteAdmin).toHaveBeenCalledWith(`/student-members/${MEMBER}/approve`, {
      method: 'POST', body: { mode: 'existing', studentId: STUDENT, idempotencyKey: KEY }, signal: undefined,
    });
  });
  it.each([{ mode: 'existing', idempotencyKey: KEY }, { mode: 'new' }, { mode: 'automatic', idempotencyKey: KEY }])('승인 정보가 부족하면 요청하지 않는다', async approval => {
    await expect(approveSiteStudentMember(MEMBER, approval)).rejects.toThrow();
    expect(siteAdmin).not.toHaveBeenCalled();
  });
  it('학생앱 미허용 또는 다른 학생의 응답을 성공 처리하지 않는다', async () => {
    siteAdmin.mockResolvedValue({ studentId: STUDENT, access: { allowed: false, revision: 0 } });
    await expect(approveSiteStudentMember(MEMBER, { mode: 'new', idempotencyKey: KEY })).rejects.toThrow();
    siteAdmin.mockResolvedValue({ studentId: STUDENT, access: { studentId: MEMBER, allowed: true, revision: 1 } });
    await expect(approveSiteStudentMember(MEMBER, { mode: 'new', idempotencyKey: KEY })).rejects.toThrow();
  });
  it('생성 결과 불명확 회원의 복구 key가 없으면 새 승인으로 이어가지 않는다', async () => {
    siteAdmin.mockResolvedValue({ members: [{ id: MEMBER, name: '학생', enrollment: { state: 'unknown', mode: 'new', studentId: null } }], nextCursor: null });
    await expect(getSiteStudentMembers()).rejects.toThrow('가입한 학생 정보를 확인하지 못했어요');
  });
  it.each([
    { state: 'pending', mode: 'existing', studentId: null, idempotencyKey: KEY },
    { state: 'pending', mode: 'existing', studentId: STUDENT },
    { state: 'linked', mode: 'existing', studentId: STUDENT },
  ])('진행 중인 기존 학생 승인의 대상과 key가 빠진 응답은 거부한다', async enrollment => {
    siteAdmin.mockResolvedValue({ members: [{ id: MEMBER, name: '학생', enrollment }], nextCursor: null });
    await expect(getSiteStudentMembers()).rejects.toThrow('가입한 학생 정보를 확인하지 못했어요');
  });
  it('새로 고침 뒤 받은 기존 학생 대상과 key로 같은 승인을 이어간다', async () => {
    const enrollment = { state: 'pending', mode: 'existing', studentId: STUDENT, idempotencyKey: KEY };
    siteAdmin.mockResolvedValueOnce({ members: [{ id: MEMBER, name: '학생', enrollment }], nextCursor: null });
    const queued = await getSiteStudentMembers();
    siteAdmin.mockResolvedValueOnce({ studentId: STUDENT, access: { allowed: true, revision: 1 },
      sync: { state: 'synced', ready: true, homeworkEnabled: true } });
    const saved = queued.members[0].enrollment;
    await approveSiteStudentMember(MEMBER, { mode: saved.mode, studentId: saved.studentId, idempotencyKey: saved.idempotencyKey });
    expect(siteAdmin).toHaveBeenLastCalledWith(`/student-members/${MEMBER}/approve`, {
      method: 'POST', body: { mode: 'existing', studentId: STUDENT, idempotencyKey: KEY }, signal: undefined,
    });
  });
  it('학생 연결 후 숙제 설정이 미확정인 응답은 승인 성공으로 바꾸지 않는다', async () => {
    siteAdmin.mockResolvedValue({ studentId: STUDENT, access: { studentId: STUDENT, allowed: true, revision: 1 }, sync: { state: 'unknown', ready: false, homeworkEnabled: null } });
    await expect(approveSiteStudentMember(MEMBER, { mode: 'new', idempotencyKey: KEY })).rejects.toThrow();
  });
});
