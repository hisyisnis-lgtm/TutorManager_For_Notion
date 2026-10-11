import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import PersonalHomeworkDetailPage from './PersonalHomeworkDetailPage.jsx';
import { fetchMyHomework, markFeedbackSeen, submitHomework, uploadStudentFile } from '../api/homework.js';
import { fixtureSession } from '../api/authFixtures.js';
import { setStudentSession } from '../api/studentAuth.js';
import { captureAuthScope, notifyAuthChange } from '../api/authState.js';
import { peekCache, writeCacheValue } from '../hooks/useCachedResource.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/errorReporter.js', () => ({ reportHandledError: vi.fn() }));
vi.mock('../api/homework.js', async (importOriginal) => ({
  ...await importOriginal(),
  fetchMyHomework: vi.fn(),
  parseHomework: (page) => page,
  markFeedbackSeen: vi.fn(),
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
  markFeedbackSeen.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  notifyAuthChange();
});

describe('학생 숙제 상세의 목록 캐시 재사용', () => {
  const cached = { id: homeworkId, title: '바로 표시할 숙제', status: '미제출', submitFiles: [], feedbackFiles: [], assignmentFiles: [] };
  const write = item => writeCacheValue(`student:homework:${token}`, [item], captureAuthScope(`student:${token}`));

  it('캐시 내용을 즉시 표시하고 최신 조회가 끝나면 갱신한다', async () => {
    let finish;
    write(cached);
    fetchMyHomework.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    expect(screen.getByRole('heading', { name: cached.title })).toBeTruthy();
    await act(async () => finish([{ ...cached, title: '최신 숙제 제목' }]));
    expect(screen.getByRole('heading', { name: '최신 숙제 제목' })).toBeTruthy();
  });

  it('백그라운드 조회 실패 시 이전 내용을 유지하고 오류와 재시도를 보여준다', async () => {
    write(cached);
    fetchMyHomework.mockRejectedValueOnce(new Error('최신 숙제 조회 실패')).mockResolvedValueOnce([{ ...cached, title: '복구된 숙제' }]);
    renderPage();
    expect(await screen.findByText('최신 숙제 조회 실패')).toBeTruthy();
    expect(screen.getByRole('heading', { name: cached.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { name: '복구된 숙제' })).toBeTruthy();
    expect(screen.queryByText('최신 숙제 조회 실패')).toBeNull();
  });

  it('캐시의 피드백 완료만으로 확인 기록을 보내지 않는다', async () => {
    let finish;
    write({ ...cached, status: '피드백완료' });
    fetchMyHomework.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    expect(screen.getByRole('heading', { name: cached.title })).toBeTruthy();
    expect(markFeedbackSeen).not.toHaveBeenCalled();
    await act(async () => finish([cached]));
    expect(markFeedbackSeen).not.toHaveBeenCalled();
  });

  it('최신 목록에서 삭제된 숙제는 캐시 내용을 제거하고 오류를 표시한다', async () => {
    write(cached);
    fetchMyHomework.mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByText('숙제를 찾을 수 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: cached.title })).toBeNull();
    expect(peekCache(`student:homework:${token}`)).toEqual([]);
  });

  it('화면을 떠난 뒤 도착한 응답은 목록 캐시를 덮어쓰지 않는다', async () => {
    let finish;
    write(cached);
    fetchMyHomework.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const page = renderPage();
    page.unmount();
    await act(async () => finish([{ ...cached, title: '늦게 도착한 숙제' }]));
    expect(peekCache(`student:homework:${token}`)).toEqual([cached]);
  });
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
