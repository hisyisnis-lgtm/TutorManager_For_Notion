import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { toast } from 'sonner';
import HomeworkDetailPage from './HomeworkDetailPage.jsx';
import { getPage } from '../api/notionClient.js';
import { saveFeedback, uploadTeacherFile, notifyHomework, fetchHomeworkFileSizesTeacher, downloadHomeworkFileTeacher } from '../api/homework.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ studentNameMap: { student: '검수 학생' } }) }));
vi.mock('../utils/fileCompression.js', () => ({ compressExternalFile: vi.fn(async file => file) }));
vi.mock('../api/notionClient.js', async original => ({ ...await original(), getPage: vi.fn(), deletePage: vi.fn() }));
vi.mock('../api/homework.js', async original => ({
  ...await original(), saveFeedback: vi.fn(), uploadTeacherFile: vi.fn(), notifyHomework: vi.fn(), fetchHomeworkFileSizesTeacher: vi.fn(), downloadHomeworkFileTeacher: vi.fn(),
}));

const id = 'feedback-fixture';
const stored = (name = '기존.pdf') => ({ name, type: 'external', external: { url: `https://fixture.invalid/${encodeURIComponent(name)}` }, size: 128 });
const page = ({ text = '', files = [], content = '문장을 세 번 읽고 녹음해주세요.', status = '제출완료' } = {}) => ({
  id,
  created_time: '2026-10-26T01:00:00Z',
  properties: {
    제목: { title: [{ plain_text: '발음 연습' }] },
    학생: { relation: [{ id: 'student' }] },
    '과제 내용': { rich_text: [{ plain_text: content }] },
    '제출 상태': { select: { name: status } },
    '피드백 텍스트': { rich_text: text ? [{ plain_text: text }] : [] },
    '피드백 파일': { files },
    '과제 파일': { files: [stored('숙제.pdf')] },
    '학생 제출 파일': { files: [stored('학생.pdf')] },
    ...(text || files.length ? { 피드백일: { date: { start: '2026-10-25T01:00:00Z' } } } : {}),
  },
});
const pdf = (name = '연습.pdf') => new File(['%PDF-1.7\nfixture'], name, { type: 'application/pdf' });
const uploaded = { fileUploadId: 'qa-upload', fileName: '연습.pdf' };

let router;
function renderPage() {
  router = createMemoryRouter([
    { path: '/homework/:id', element: <><HomeworkDetailPage /><Link to="/homework">하단 숙제 메뉴</Link></> },
    { path: '/homework', element: <h1>숙제 목록</h1> },
  ], { initialEntries: ['/homework', `/homework/${id}`] });
  return render(<RouterProvider router={router} />);
}
async function edit() { fireEvent.click(await screen.findByRole('button', { name: /^피드백 (작성|수정)하기$/ })); }
async function add(file = pdf()) {
  fireEvent.click(screen.getByRole('button', { name: '파일 추가' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.change(document.querySelector('input[aria-label="첨부할 파일 선택"]'), { target: { files: [file] } });
  await screen.findByRole('button', { name: `${file.name} 삭제` });
}
const saveButton = () => screen.getByRole('button', { name: /^(피드백 저장하기|수정 내용 저장하기)$/ });

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setAuth(fixtureSession('teacher'));
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  getPage.mockReset().mockResolvedValue(page());
  saveFeedback.mockReset().mockResolvedValue({ ok: true });
  uploadTeacherFile.mockReset().mockResolvedValue(uploaded);
  notifyHomework.mockReset().mockResolvedValue({ ok: true });
  fetchHomeworkFileSizesTeacher.mockReset().mockResolvedValue({ files: [] });
  compressExternalFile.mockReset().mockImplementation(async file => file);
});
afterEach(() => { cleanup(); router?.dispose(); clearAuth(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('강사 피드백의 전용 편집 화면', () => {
  it('상세에서 숙제와 제출 파일을 읽고 별도 편집 화면에서 피드백과 파일만 작성한다', async () => {
    renderPage();
    await screen.findByText('문장을 세 번 읽고 녹음해주세요.');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
    const download = screen.getAllByRole('button', { name: '다운로드' });
    fireEvent.click(download[0]);
    expect(downloadHomeworkFileTeacher).toHaveBeenCalledWith(id, '숙제.pdf', 'assignment');
    await edit();
    expect(screen.getByRole('heading', { name: '피드백 작성' })).toBeTruthy();
    expect(screen.queryByText('문장을 세 번 읽고 녹음해주세요.')).toBeNull();
    expect(screen.queryByText('학생.pdf')).toBeNull();
    expect(screen.getByRole('textbox', { name: '피드백 내용' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '녹음하기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '파일 추가' })).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('직접 파일 선택은 초안만 추가하고 저장을 눌러야 준비·전송·저장한다', async () => {
    renderPage(); await edit(); await add();
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(uploadTeacherFile).not.toHaveBeenCalled();
    expect(saveFeedback).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    expect(await screen.findByRole('heading', { name: '피드백을 저장했어요' })).toBeTruthy();
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
    expect(uploadTeacherFile).toHaveBeenCalledWith(expect.any(File), '연습.pdf');
    expect(saveFeedback).toHaveBeenCalledWith(id, expect.objectContaining({ files: [expect.objectContaining(uploaded)], existingFiles: [] }));
    expect(notifyHomework).toHaveBeenCalledWith('feedback', id);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
  });

  it('헤더 뒤로가기는 초안을 유지하며 상세에서 실제 떠날 때만 확인한다', async () => {
    renderPage(); await edit();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '작성 중인 피드백' } });
    await add();
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(screen.getByText('문장을 세 번 읽고 녹음해주세요.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await edit();
    expect(screen.getByRole('textbox').value).toBe('작성 중인 피드백');
    expect(screen.getByText('연습.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    await edit();
    expect(screen.getByRole('textbox').value).toBe('작성 중인 피드백');
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it('브라우저 뒤로가기도 편집에서 상세로 이동하며 초안을 보존한다', async () => {
    renderPage(); await edit(); await add();
    await act(async () => {
      window.dispatchEvent(new window.PopStateEvent('popstate', { state: { key: 'previous-entry' } }));
      await router.navigate(-1);
    });
    expect(screen.getByText('문장을 세 번 읽고 녹음해주세요.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await edit();
    expect(screen.getByText('연습.pdf')).toBeTruthy();
    // 실제 브라우저가 차단된 이동을 복원하는 POP 뒤의 메뉴 클릭은 별도로 보호한다.
    act(() => window.dispatchEvent(new window.PopStateEvent('popstate', { state: { key: router.state.location.key } })));
    fireEvent.click(screen.getByRole('link', { name: '하단 숙제 메뉴' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    expect(screen.getByText('연습.pdf')).toBeTruthy();
  });

  it('다른 숙제로 이탈을 확인하면 이전 저장 실패의 파일·삭제·텍스트 초안을 버리고 이탈 보호를 다시 적용한다', async () => {
    const nextId = 'feedback-next';
    const original = page({ text: 'A 저장된 피드백', files: [stored()], status: '피드백완료' });
    const next = page({ text: 'B 저장된 피드백', files: [stored()], status: '피드백완료' });
    next.id = nextId;
    next.properties.제목 = { title: [{ plain_text: 'B 숙제' }] };
    getPage.mockImplementation(async requestedId => requestedId === id ? original : next);
    saveFeedback.mockRejectedValueOnce(new Error('A 저장 실패')).mockResolvedValueOnce({ ok: true });
    renderPage(); await edit();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A 작성 중인 피드백' } });
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    await add(pdf('A 초안.pdf'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('저장 실패: A 저장 실패'));
    expect(uploadTeacherFile).toHaveBeenCalledTimes(1);

    await act(async () => { await router.navigate(`/homework/${nextId}`); });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByRole('heading', { name: 'B 숙제' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('A 초안.pdf')).toBeNull();
    expect(screen.queryByText('A 작성 중인 피드백')).toBeNull();

    await edit();
    expect(screen.getByRole('textbox').value).toBe('B 저장된 피드백');
    expect(screen.getByText('기존.pdf')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('1/10');
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: '하단 숙제 메뉴' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B 수정한 피드백' } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('heading', { name: '피드백을 수정했어요' })).toBeTruthy();
    expect(saveFeedback).toHaveBeenLastCalledWith(nextId, { feedbackText: 'B 수정한 피드백', files: undefined, existingFiles: undefined });
    expect(uploadTeacherFile).toHaveBeenCalledTimes(1);
  });

  it('파일 삭제는 초안이고 되돌리며, 삭제만 저장할 때 최신 파일과 피드백 상태를 보존한다', async () => {
    const existing = stored();
    const concurrent = stored('다른 작업자가 추가.pdf');
    getPage.mockResolvedValueOnce(page({ files: [existing], text: '기존 피드백', status: '피드백완료' }))
      .mockResolvedValue(page({ files: [existing, concurrent], text: '기존 피드백', status: '피드백완료' }));
    renderPage(); await edit();
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(saveFeedback).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(saveButton());
    expect(await screen.findByRole('heading', { name: '피드백을 수정했어요' })).toBeTruthy();
    expect(saveFeedback).toHaveBeenCalledWith(id, { feedbackText: '기존 피드백', files: [], existingFiles: [concurrent], filesOnly: true });
    expect(uploadTeacherFile).not.toHaveBeenCalled();
    expect(notifyHomework).not.toHaveBeenCalled();
  });

  it('저장 실패 시 초안·업로드를 유지하고 같은 인증의 재시도는 전송을 재사용한다', async () => {
    getPage.mockResolvedValue(page({ files: [stored('연습.pdf')], text: '기존 피드백', status: '피드백완료' }));
    uploadTeacherFile.mockResolvedValue({ ...uploaded, fileName: '연습 (2).pdf' });
    saveFeedback.mockRejectedValueOnce(new Error('시험 저장 실패')).mockResolvedValueOnce({ ok: true });
    renderPage(); await edit(); await add();
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('저장 실패: 시험 저장 실패'));
    expect(screen.queryByRole('heading', { name: '피드백을 수정했어요' })).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(screen.getAllByText('연습.pdf').length).toBe(2);
    fireEvent.click(saveButton());
    expect(await screen.findByRole('heading', { name: '피드백을 수정했어요' })).toBeTruthy();
    expect(uploadTeacherFile).toHaveBeenCalledTimes(1);
    expect(uploadTeacherFile).toHaveBeenCalledWith(expect.any(File), '연습 (2).pdf');
    expect(notifyHomework).toHaveBeenCalledTimes(1);
  });

  it('텍스트만 저장할 때 기존 파일 속성을 덮어쓰지 않는다', async () => {
    getPage.mockResolvedValue(page({ text: '이전 피드백', files: [stored()], status: '피드백완료' }));
    renderPage(); await edit();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '수정한 피드백' } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('heading', { name: '피드백을 수정했어요' })).toBeTruthy();
    expect(saveFeedback).toHaveBeenCalledWith(id, { feedbackText: '수정한 피드백', files: undefined, existingFiles: undefined });
    expect(getPage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(await screen.findByRole('heading', { name: '숙제 목록' })).toBeTruthy();
  });

  it('저장 중 인증이 교체된 뒤 도착한 응답은 완료·알림으로 처리하지 않는다', async () => {
    let finish;
    saveFeedback.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage(); await edit();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '새 피드백' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    act(() => setAuth(fixtureSession('teacher', undefined, { jti: 'replacement' })));
    await act(async () => finish({ ok: true }));
    expect(screen.queryByRole('heading', { name: '피드백을 저장했어요' })).toBeNull();
    expect(notifyHomework).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox').value).toBe('새 피드백');
    expect(saveButton().disabled).toBe(false);
  });
});
