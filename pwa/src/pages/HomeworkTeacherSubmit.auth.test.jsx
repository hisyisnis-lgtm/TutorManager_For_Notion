import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import HomeworkFormPage from './HomeworkFormPage.jsx';
import HomeworkDetailPage from './HomeworkDetailPage.jsx';
import { createHomework, saveFeedback, uploadTeacherFile, notifyHomework } from '../api/homework.js';
import { getPage, queryAll } from '../api/notionClient.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ studentNameMap: { 'student-1': '검수 학생' } }) }));
vi.mock('../api/students.js', () => ({ parseStudent: (page) => page, STUDENTS_DB: 'fixture-students' }));
vi.mock('../utils/fileCompression.js', () => ({ compressExternalFile: vi.fn(async (file) => file) }));
vi.mock('../api/notionClient.js', async (original) => ({ ...await original(), getPage: vi.fn(), queryAll: vi.fn() }));
vi.mock('../api/homework.js', async (original) => ({
  ...await original(), parseHomework: (page) => page,
  createHomework: vi.fn(), saveFeedback: vi.fn(), uploadTeacherFile: vi.fn(), notifyHomework: vi.fn(),
}));

const homework = {
  id: 'homework-1', title: '발음 연습', studentIds: ['student-1'], status: '미제출',
  content: '', feedbackText: '', assignmentFiles: [], submitFiles: [], feedbackFiles: [],
  properties: { '피드백 파일': { files: [] } },
};
const result = { fileUploadId: 'upload-1', fileName: '과제.pdf' };
const pdf = () => new File(['%PDF-fixture'], '과제.pdf', { type: 'application/pdf' });
const cases = [
  { name: '강사 출제', route: '/homework/new?studentId=student-1', path: '/homework/new', Page: HomeworkFormPage, save: createHomework, submit: /등록하기/ },
  { name: '강사 피드백', route: '/homework/homework-1', path: '/homework/:id', Page: HomeworkDetailPage, save: saveFeedback, submit: /피드백 저장/ },
];

async function attach(testCase) {
  const { Page } = testCase;
  const router = createMemoryRouter([
    { path: '/', element: <p>목록</p> },
    { path: '/homework', element: <p>숙제 목록</p> },
    { path: testCase.path, element: <Page /> },
  ], { initialEntries: ['/', testCase.route] });
  render(<RouterProvider router={router} />);
  if (testCase.Page === HomeworkFormPage) {
    await screen.findByText('검수 학생');
    fireEvent.change(screen.getByLabelText('숙제 제목'), { target: { value: '발음 연습' } });
  } else {
    fireEvent.click(await screen.findByRole('button', { name: '피드백 작성하기' }));
  }
  fireEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  fireEvent.change(screen.getByLabelText('첨부할 파일 선택'), { target: { files: [pdf()] } });
  return screen.findByRole('button', { name: testCase.submit });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setAuth(fixtureSession('teacher', undefined, { jti: 'first-session' }));
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  queryAll.mockReset().mockResolvedValue([{ id: 'student-1', name: '검수 학생' }]);
  getPage.mockReset().mockResolvedValue(homework);
  createHomework.mockReset().mockResolvedValue({ id: 'created-homework' });
  saveFeedback.mockReset().mockResolvedValue({ ok: true });
  uploadTeacherFile.mockReset().mockResolvedValue(result);
  notifyHomework.mockReset().mockResolvedValue({ ok: true });
  compressExternalFile.mockReset().mockImplementation(async (file) => file);
});
afterEach(() => { cleanup(); clearAuth(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe.each(cases)('$name 인증 범위와 제출 준비', (testCase) => {
  it('준비 중 유효 인증이 교체되면 전송하지 않고 원본과 버튼을 보존한다', async () => {
    let finish;
    compressExternalFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(await attach(testCase));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    act(() => setAuth(fixtureSession('teacher', undefined, { jti: 'second-session' })));
    await act(async () => finish(pdf()));
    expect(uploadTeacherFile).not.toHaveBeenCalled();
    expect(testCase.save).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('과제.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: testCase.submit }).disabled).toBe(false);
  });

  it('전송 중 인증 교체 뒤 도착한 업로드를 저장하거나 새 인증의 캐시로 사용하지 않는다', async () => {
    let finish;
    uploadTeacherFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(await attach(testCase));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    act(() => setAuth(fixtureSession('teacher', undefined, { jti: 'second-session' })));
    await act(async () => finish(result));
    expect(testCase.save).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: testCase.submit }));
    await waitFor(() => expect(testCase.save).toHaveBeenCalledTimes(1));
    expect(uploadTeacherFile).toHaveBeenCalledTimes(2);
  });

  it('저장 실패 후 같은 인증에서는 재사용하고 인증 교체 뒤에는 다시 업로드한다', async () => {
    testCase.save.mockRejectedValueOnce(new Error('저장 실패')).mockRejectedValueOnce(new Error('다시 저장 실패'));
    fireEvent.click(await attach(testCase));
    await waitFor(() => expect(testCase.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: testCase.submit }));
    await waitFor(() => expect(testCase.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(uploadTeacherFile).toHaveBeenCalledTimes(1);
    act(() => setAuth(fixtureSession('teacher', undefined, { jti: 'second-session' })));
    fireEvent.click(screen.getByRole('button', { name: testCase.submit }));
    await waitFor(() => expect(testCase.save).toHaveBeenCalledTimes(3));
    expect(uploadTeacherFile).toHaveBeenCalledTimes(2);
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
  });
});
