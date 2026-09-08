import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHomeworkFileBlobUrlStudent, uploadStudentFile, submitHomework, notifyHomework } from './homework.js';
import { getToken, setAuth } from './authUtils.js';
import { setStudentSession, clearStudentSession, getStudentSession } from './studentAuth.js';
import { notifyAuthChange } from './authState.js';
import { fixtureSession } from './authFixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setStudentSession('STUDENT_A', fixtureSession('student')); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.unstubAllGlobals(); });

describe('학생 파일 인증 수명·업로드 영수증', () => {
  it('강사 숙제 알림의 401도 강사 세션을 지운다', async () => {
    setAuth(fixtureSession());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await notifyHomework('feedback', 'fixture-homework');
    expect(getToken()).toBe('');
  });
  it('업로드 영수증을 보존해 제출 요청에 전달한다', async () => {
    const uploaded = { fileUploadId: 'fixture-upload', fileName: '녹음.m4a', uploadReceipt: 'fixture-receipt' };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(uploaded)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    const result = await uploadStudentFile('STUDENT_A', new File(['fake'], '녹음.m4a'));
    await submitHomework('STUDENT_A', 'fixture-homework', [result]);
    expect(JSON.parse(fetch.mock.calls[1][1].body).files).toEqual([uploaded]);
  });

  it('파일 업로드 401도 학생 세션을 지운다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '만료' }), { status: 401 })));
    await expect(uploadStudentFile('STUDENT_A', new File(['fake'], '녹음.m4a'))).rejects.toMatchObject({ status: 401 });
    expect(getStudentSession('STUDENT_A')).toBe('');
  });

  it('로그아웃 뒤 완료된 파일 응답으로 blob URL을 만들지 않는다', async () => {
    let respond;
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(); });
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve; })));
    const result = fetchHomeworkFileBlobUrlStudent('STUDENT_A', 'fixture-homework', '녹음.m4a', 'feedback');
    clearStudentSession('STUDENT_A');
    respond(new Response('fake audio'));
    await expect(result).rejects.toThrow('인증 상태가 바뀌었습니다');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
