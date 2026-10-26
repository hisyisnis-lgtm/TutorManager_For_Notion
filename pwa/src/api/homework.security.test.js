import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHomeworkFileBlobUrlStudent, uploadStudentFile, submitHomework, notifyHomework, fetchHomeworkFileSizesTeacher, fetchHomeworkFileSizesStudent, parseHomework } from './homework.js';
import { getToken, setAuth } from './authUtils.js';
import { setStudentSession, clearStudentSession, getStudentSession } from './studentAuth.js';
import { notifyAuthChange } from './authState.js';
import { fixtureSession } from './authFixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setStudentSession('STUDENT_A', fixtureSession('student')); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.unstubAllGlobals(); });

describe('학생 파일 인증 수명·업로드 영수증', () => {
  it('숙제 파일 파싱에서 서버 크기 메타데이터를 보존하고 누락은 0으로 바꾸지 않는다', () => {
    const parsed = parseHomework({ properties: { '학생 제출 파일': { files: [
      { name: '녹음.mp3', fileSize: 123 }, { name: '기존.pdf', file: { url: 'https://example.test/existing' } },
    ] } } });
    expect(parsed.submitFiles).toEqual([
      { name: '녹음.mp3', size: 123, url: null }, { name: '기존.pdf', url: 'https://example.test/existing' },
    ]);
  });
  it('학생·강사 용량 조회에 기존 인증을 전달한다', async () => {
    setAuth(fixtureSession());
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ files: [{ name: '기존.pdf', size: 123 }] })));
    vi.stubGlobal('fetch', fetch);
    await fetchHomeworkFileSizesTeacher('homework-1', 'feedback');
    await fetchHomeworkFileSizesStudent('STUDENT_A', 'homework-1', 'submit');
    expect(fetch.mock.calls[0][0]).toContain('/homework/homework-1/file-sizes?kind=feedback');
    expect(fetch.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /);
    expect(fetch.mock.calls[1][0]).toContain('/homework/student/STUDENT_A/homework-1/file-sizes?kind=submit');
    expect(fetch.mock.calls[1][1].headers.Authorization).toMatch(/^Bearer /);
  });
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
