import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import HomeworkFormPage from './HomeworkFormPage.jsx';
import { createHomework, uploadTeacherFile, notifyHomework } from '../api/homework.js';
import { queryAll } from '../api/notionClient.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';
import { markPendingHwDone } from '../hooks/usePendingClassState.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { hasUnsavedChanges } from '../utils/unsavedChanges.js';
import BottomNav from '../components/layout/BottomNav.jsx';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../api/students.js', () => ({ parseStudent: (page) => page, STUDENTS_DB: 'fixture-students' }));
vi.mock('../utils/fileCompression.js', () => ({ compressExternalFile: vi.fn(async (file) => file) }));
vi.mock('../api/notionClient.js', async (original) => ({ ...await original(), queryAll: vi.fn() }));
vi.mock('../hooks/usePendingClassState.js', () => ({ markPendingHwDone: vi.fn() }));
vi.mock('../hooks/useCachedResource.js', () => ({ invalidateCache: vi.fn() }));
vi.mock('../api/homework.js', async (original) => ({
  ...await original(), createHomework: vi.fn(), uploadTeacherFile: vi.fn(), notifyHomework: vi.fn(),
}));

const file = (name = '읽기 자료.pdf') => new File(['%PDF-fixture'], name, { type: 'application/pdf' });
const upload = { fileUploadId: 'fixture-upload', fileName: '읽기 자료.pdf', uploadReceipt: 'fixture-receipt' };

const renderPage = () => {
  const router = createMemoryRouter([{
    element: <><Outlet /><BottomNav /></>,
    children: [
      { path: '/homework/new', element: <HomeworkFormPage /> },
      { path: '/homework', element: <h1>숙제 목록</h1> },
      { path: '/students', element: <h1>학생 목록</h1> },
    ],
  }], { initialEntries: ['/homework', '/homework/new?studentId=student-1&fromClassId=class-1'] });
  return { ...render(<RouterProvider router={router} />), router };
};

async function fillForm() {
  const page = renderPage();
  await screen.findByText('검수 학생');
  fireEvent.change(screen.getByLabelText('숙제 제목'), { target: { value: '성조 연습' } });
  fireEvent.change(screen.getByLabelText('숙제 내용'), { target: { value: '본문을 읽어 주세요.' } });
  return page;
}

function selectFiles(files = [file()]) {
  fireEvent.click(screen.getByRole('button', { name: '파일 추가' }));
  fireEvent.change(document.querySelector('input[aria-label="첨부할 파일 선택"]'), { target: { files } });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setAuth(fixtureSession('teacher'));
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  queryAll.mockReset().mockResolvedValue([{ id: 'student-1', name: '검수 학생' }]);
  createHomework.mockReset().mockResolvedValue({ id: 'created-homework' });
  uploadTeacherFile.mockReset().mockResolvedValue(upload);
  notifyHomework.mockReset().mockResolvedValue({ ok: true });
  compressExternalFile.mockReset().mockImplementation(async (selected) => selected);
});

afterEach(() => { cleanup(); clearAuth(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('강사 숙제 등록의 직접 첨부와 완료 흐름', () => {
  it('파일은 팝업 없이 선택하고 최종 등록에서 준비·전송·저장한 뒤 확인하면 목록으로 간다', async () => {
    await fillForm();
    const buttons = ['녹음하기', '파일 추가'].map((name) => screen.getByRole('button', { name }));
    expect(buttons[0].compareDocumentPosition(buttons[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    selectFiles();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('읽기 자료.pdf')).toBeTruthy();
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(uploadTeacherFile).not.toHaveBeenCalled();
    expect(createHomework).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    expect(await screen.findByRole('heading', { name: '숙제를 등록했어요' })).toBeTruthy();
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
    expect(uploadTeacherFile).toHaveBeenCalledTimes(1);
    expect(createHomework).toHaveBeenCalledWith({
      studentPageId: 'student-1', title: '성조 연습', content: '본문을 읽어 주세요.', files: [upload], classId: 'class-1',
    });
    expect(notifyHomework).toHaveBeenCalledWith('assign', 'created-homework');
    expect(markPendingHwDone).toHaveBeenCalledWith('class-1');
    expect(invalidateCache).toHaveBeenCalledWith('homework');
    expect(hasUnsavedChanges()).toBe(false);
    expect(screen.queryByRole('heading', { name: '숙제 목록' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
  });

  it('파일 없는 등록도 완료 화면을 거치며 완료 화면의 뒤로가기는 목록으로 간다', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    await screen.findByRole('heading', { name: '숙제를 등록했어요' });
    expect(uploadTeacherFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
    expect(createHomework).toHaveBeenCalledTimes(1);
  });

  it('같은 이름의 두 파일을 구분하고 등록 재시도에도 각 업로드를 재사용한다', async () => {
    uploadTeacherFile.mockImplementation(async (_selected, fileName) => ({
      fileUploadId: `upload-${fileName}`, fileName,
    }));
    createHomework.mockRejectedValueOnce(new Error('등록 실패'));
    await fillForm();
    selectFiles([file('읽기 자료.pdf'), file('읽기 자료.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    await screen.findByText('등록 실패');
    const names = uploadTeacherFile.mock.calls.map(([, name]) => name);
    expect(names).toEqual(['읽기 자료.pdf', '읽기 자료 (2).pdf']);
    expect(createHomework.mock.calls[0][0].files.map((item) => item.fileName)).toEqual(names);
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    await screen.findByRole('heading', { name: '숙제를 등록했어요' });
    expect(uploadTeacherFile).toHaveBeenCalledTimes(2);
    expect(createHomework.mock.calls[1][0].files).toEqual(createHomework.mock.calls[0][0].files);
  });

  it('실패하면 작성 내용과 파일을 유지하고 완료 처리나 알림을 보내지 않는다', async () => {
    createHomework.mockRejectedValueOnce(new Error('등록 실패'));
    await fillForm(); selectFiles();
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    expect(await screen.findByText('등록 실패')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '숙제를 등록했어요' })).toBeNull();
    expect(screen.getByLabelText('숙제 제목').value).toBe('성조 연습');
    expect(screen.getByText('읽기 자료.pdf')).toBeTruthy();
    expect(markPendingHwDone).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
  });

  it('10개에 도달하면 추가 버튼을 유지한 채 비활성하고 파일 삭제 후 다시 활성한다', async () => {
    await fillForm();
    selectFiles(Array.from({ length: 10 }, (_, index) => file(`자료${index}.pdf`)));
    for (const name of ['녹음하기', '파일 추가']) expect(screen.getByRole('button', { name }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '자료0.pdf 삭제' }));
    expect(screen.getByRole('button', { name: '파일 추가' }).disabled).toBe(false);
    expect(screen.queryByText('자료0.pdf')).toBeNull();
  });

  it('이탈을 취소하면 작성 내용을 유지하고 확인하면 이전 목록으로 간다', async () => {
    await fillForm(); selectFiles();
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByLabelText('숙제 제목').value).toBe('성조 연습');
    expect(screen.getByText('읽기 자료.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
    expect(createHomework).not.toHaveBeenCalled();
  });

  it('전송 중 화면을 떠나면 늦은 업로드 응답으로 숙제를 등록하지 않는다', async () => {
    let finish;
    uploadTeacherFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const page = await fillForm(); selectFiles();
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    page.unmount();
    await act(async () => finish(upload));
    expect(createHomework).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
  });

  it('브라우저 뒤로가기를 취소하면 입력을 유지하고 확인하면 목록으로 간다', async () => {
    const page = await fillForm(); selectFiles();
    expect(hasUnsavedChanges()).toBe(true);
    await act(async () => page.router.navigate(-1));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByLabelText('숙제 제목').value).toBe('성조 연습');
    expect(screen.getByText('읽기 자료.pdf')).toBeTruthy();
    await act(async () => page.router.navigate(-1));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('하단 탭 이동도 확인하며 취소하면 작성과 첨부 파일을 유지한다', async () => {
    await fillForm(); selectFiles();
    fireEvent.click(screen.getByRole('link', { name: '학생' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByText('읽기 자료.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '학생' }));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('heading', { name: '학생 목록' })).toBeTruthy();
    expect(createHomework).not.toHaveBeenCalled();
  });

  it('전송 중 뒤로가기에서는 기다리거나 명시적으로 이탈하며 늦은 응답을 저장하지 않는다', async () => {
    let finish;
    uploadTeacherFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const page = await fillForm(); selectFiles();
    fireEvent.click(screen.getByRole('button', { name: '숙제 등록하기' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => page.router.navigate(-1));
    expect(await screen.findByRole('heading', { name: '등록 중이에요' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '기다리기' }));
    expect(screen.queryByRole('heading', { name: '등록 중이에요' })).toBeNull();
    await act(async () => page.router.navigate(-1));
    fireEvent.click(await screen.findByRole('button', { name: '그래도 나가기' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
    await act(async () => finish(upload));
    expect(createHomework).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('저장 버튼을 연달아 눌러도 등록 요청은 한 번만 전송한다', async () => {
    let finish;
    createHomework.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await fillForm();
    const submit = screen.getByRole('button', { name: '숙제 등록하기' });
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(createHomework).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('숙제 제목').disabled).toBe(true);
    await act(async () => finish({ id: 'created-homework' }));
    expect(await screen.findByRole('heading', { name: '숙제를 등록했어요' })).toBeTruthy();
    expect(createHomework).toHaveBeenCalledTimes(1);
  });
});
