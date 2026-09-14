import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import PersonalHomeworkDetailPage from './PersonalHomeworkDetailPage.jsx';
import { fetchMyHomework, submitHomework, uploadStudentFile } from '../api/homework.js';
import { fixtureSession } from '../api/authFixtures.js';
import { setStudentSession } from '../api/studentAuth.js';
import { notifyAuthChange } from '../api/authState.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/errorReporter.js', () => ({ reportHandledError: vi.fn() }));
vi.mock('../api/homework.js', async (importOriginal) => ({
  ...await importOriginal(),
  fetchMyHomework: vi.fn(),
  parseHomework: (page) => page,
  submitHomework: vi.fn(),
  uploadStudentFile: vi.fn(),
}));

const token = 'HOMEWORK12345';
const homeworkId = 'fixture-homework';
const selectedName = '"정답".pdf';
const receivedName = '%22정답%22.pdf';
const uploaded = { fileUploadId: 'fixture-upload', fileName: receivedName, uploadReceipt: 'fixture-receipt' };
const pdf = () => new File(['%PDF-1.7\nfixture'], selectedName, { type: 'application/pdf' });

const renderPage = () => render(<MemoryRouter initialEntries={[`/personal/${token}/homework/${homeworkId}`]}>
  <Routes><Route path="/personal/:studentToken/homework/:hwId" element={<PersonalHomeworkDetailPage />} /></Routes>
</MemoryRouter>);

async function attachDocuments(files) {
  fireEvent.click(await screen.findByRole('button', { name: '사진·문서 올리기' }));
  const picker = document.querySelector('input[type="file"][accept^="application/pdf"]');
  fireEvent.change(picker, { target: { files } });
  fireEvent.click(await screen.findByRole('button', { name: `확인 (${files.length}개 추가)` }));
  return screen.findByRole('button', { name: /숙제 제출하기/ });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  notifyAuthChange();
  setStudentSession(token, fixtureSession('student', `personal:${token}`));
  vi.clearAllMocks();
  fetchMyHomework.mockReset().mockResolvedValue([{
    id: homeworkId,
    title: 'PDF 숙제',
    status: '미제출',
    submitFiles: [],
    feedbackFiles: [],
    assignmentFiles: [],
  }]);
  uploadStudentFile.mockReset().mockResolvedValue(uploaded);
  submitHomework.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  notifyAuthChange();
});

describe('학생 PDF 제출의 업로드 파일명과 영수증', () => {
  it('선택한 이름과 서버가 돌려준 이름이 다르면 서버 이름과 영수증으로 제출한다', async () => {
    const file = pdf();
    renderPage();
    fireEvent.click(await attachDocuments([file]));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('숙제 제출 완료 · 먹이 +1'));
    expect(uploadStudentFile).toHaveBeenCalledWith(token, file, expect.objectContaining({ fileName: selectedName }));
    expect(submitHomework).toHaveBeenCalledWith(token, homeworkId, [uploaded]);
    expect(screen.queryByRole('button', { name: /숙제 제출하기/ })).toBeNull();
  });

  it('제출 실패 후 다시 누르면 업로드한 PDF의 서버 이름과 영수증을 재사용한다', async () => {
    submitHomework.mockRejectedValueOnce(new Error('제출 응답 실패'));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 제출 응답 실패'));

    fireEvent.click(screen.getByRole('button', { name: /숙제 제출하기/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    expect(uploadStudentFile).toHaveBeenCalledTimes(1);
    expect(submitHomework).toHaveBeenNthCalledWith(1, token, homeworkId, [uploaded]);
    expect(submitHomework).toHaveBeenNthCalledWith(2, token, homeworkId, [uploaded]);
  });

  it('중복 파일을 제거해 남은 PDF의 요청 이름이 바뀌면 새 이름으로 다시 업로드한다', async () => {
    const first = pdf();
    const second = pdf();
    const secondUpload = { fileUploadId: 'second-upload', fileName: '%22정답%22 (2).pdf', uploadReceipt: 'second-receipt' };
    const renamedUpload = { fileUploadId: 'renamed-upload', fileName: receivedName, uploadReceipt: 'renamed-receipt' };
    uploadStudentFile.mockResolvedValueOnce(uploaded).mockResolvedValueOnce(secondUpload).mockResolvedValueOnce(renamedUpload);
    submitHomework.mockRejectedValueOnce(new Error('제출 응답 실패'));
    renderPage();
    fireEvent.click(await attachDocuments([first, second]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 제출 응답 실패'));

    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /숙제 제출하기/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    expect(uploadStudentFile).toHaveBeenCalledTimes(3);
    expect(uploadStudentFile).toHaveBeenNthCalledWith(2, token, second, expect.objectContaining({ fileName: '"정답" (2).pdf' }));
    expect(uploadStudentFile).toHaveBeenNthCalledWith(3, token, second, expect.objectContaining({ fileName: selectedName }));
    expect(submitHomework).toHaveBeenLastCalledWith(token, homeworkId, [renamedUpload]);
  });
});
