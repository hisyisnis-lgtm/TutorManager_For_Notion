import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import PersonalHomeworkDetailPage from './PersonalHomeworkDetailPage.jsx';
import { fetchMyHomework, markFeedbackSeen, submitHomework, uploadStudentFile, fetchHomeworkFileSizesStudent, downloadHomeworkFileStudent } from '../api/homework.js';
import { compressExternalFile } from '../utils/fileCompression.js';
import { normalizeStudentAppContext, setStudentAppContext, getStudentAppContext } from '../api/studentAppState.js';
import { clearStudentAppMemory } from '../api/studentAppMemory.js';
import { setStudentSession } from '../api/studentAuth.js';
import { fixtureSession } from '../api/authFixtures.js';
import { StudentAppContext } from '../context/StudentAppContext.jsx';
import { captureAuthScope, notifyAuthChange } from '../api/authState.js';
import { peekCache, writeCacheValue } from '../hooks/useCachedResource.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/errorReporter.js', () => ({ reportHandledError: vi.fn() }));
vi.mock('../utils/fileCompression.js', () => ({ compressExternalFile: vi.fn(async (file) => file) }));
vi.mock('../api/homework.js', async (importOriginal) => ({
  ...await importOriginal(),
  fetchMyHomework: vi.fn(),
  parseHomework: (page) => page,
  markFeedbackSeen: vi.fn(),
  submitHomework: vi.fn(),
  uploadStudentFile: vi.fn(),
  fetchHomeworkFileSizesStudent: vi.fn(),
  downloadHomeworkFileStudent: vi.fn(),
}));

const studentContext = normalizeStudentAppContext({ allowed: true, memberId: 'qa-member', studentId: 'qa-student', revision: 1, studentScope: 'qa-scope' });
const token = studentContext.scope;
const homeworkId = 'fixture-homework';
const selectedName = '"정답".pdf';
const receivedName = '%22정답%22.pdf';
const uploaded = { fileUploadId: 'fixture-upload', fileName: receivedName, uploadReceipt: 'fixture-receipt' };
const pdf = () => new File(['%PDF-1.7\nfixture'], selectedName, { type: 'application/pdf' });
const stored = (name = '기존.pdf') => ({ name, url: null, size: 128 });
const homework = (extra = {}) => ({ id: homeworkId, title: 'PDF 숙제', status: '미제출', submitFiles: [], feedbackFiles: [], assignmentFiles: [], ...extra });

function StudentHomeProbe() {
  const location = useLocation();
  const items = peekCache(`student:homework:${token}`) || [];
  return <main>
    <h1>학생 홈</h1>
    <output data-testid="home-path">{location.pathname}</output>
    <output data-testid="home-tab">{location.state?.tab}</output>
    {items.map(item => <article key={item.id}>
      <h2>{item.title}</h2>
      <span data-testid="homework-status">{item.status}</span>
      {item.submitFiles.map(file => <span key={file.name}>{file.name}</span>)}
    </article>)}
  </main>;
}

const renderPage = () => render(<StudentAppContext.Provider value={studentContext}><MemoryRouter initialEntries={['/personal/', `/personal/homework/${homeworkId}`]}>
  <Routes>
    <Route path="/personal/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
    <Route path="/personal/" element={<StudentHomeProbe />} />
  </Routes>
</MemoryRouter></StudentAppContext.Provider>);

function expectStudentHome(saved) {
  expect(screen.getByRole('heading', { name: '학생 홈' })).toBeTruthy();
  expect(screen.getByTestId('home-path').textContent).toBe('/personal/');
  expect(screen.getByTestId('home-tab').textContent).toBe('홈');
  expect(screen.getByTestId('homework-status').textContent).toBe(saved.status);
  expect(peekCache(`student:homework:${token}`)).toEqual([saved]);
}

async function attachDocuments(files) {
  if (!screen.queryByRole('button', { name: '파일 추가' })) {
    fireEvent.click(await screen.findByRole('button', { name: /^숙제 (제출|수정)하기$/ }));
  }
  fireEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const picker = document.querySelector('input[aria-label="첨부할 파일 선택"]');
  fireEvent.change(picker, { target: { files } });
  return screen.findByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  notifyAuthChange();
  clearStudentAppMemory(); setStudentAppContext(studentContext); notifyAuthChange();
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom의 비동기 네이티브 history 이동 대신, 더미 정리 완료 popstate를 전달한다.
  vi.spyOn(window.history, 'go').mockImplementation(() => {
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  });
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
  fetchHomeworkFileSizesStudent.mockReset().mockResolvedValue({ files: [] });
  compressExternalFile.mockReset().mockImplementation(async (file) => file);
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

  it('인증 범위가 사라진 뒤 도착한 목록은 화면과 캐시에 쓰지 않는다', async () => {
    let finish;
    fetchMyHomework.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    act(() => { setStudentAppContext(null); notifyAuthChange(); });
    await act(async () => finish([{ ...cached, title: '이전 인증의 늦은 숙제' }]));
    expect(peekCache(`student:homework:${token}`)).toBeUndefined();
    expect(screen.queryByRole('heading', { name: '이전 인증의 늦은 숙제' })).toBeNull();
    expect(markFeedbackSeen).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  clearStudentAppMemory(); setStudentAppContext(null); notifyAuthChange();
  vi.restoreAllMocks();
});

describe('학생 PDF 제출의 업로드 파일명과 영수증', () => {
  it('하나의 파일 선택에서 녹음·PDF·이미지를 함께 담고 최종 제출 전에는 처리하지 않는다', async () => {
    renderPage();
    const audio = new File([new Uint8Array(128)], '읽기 녹음.wav', { type: 'audio/wav' });
    const image = new File([new Uint8Array(128)], '필기.png', { type: 'image/png' });
    await attachDocuments([audio, pdf(), image]);
    for (const name of [audio.name, selectedName, image.name]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByRole('button', { name: '녹음하기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '파일 추가' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '녹음 파일 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이미지·PDF 추가' })).toBeNull();
    expect(screen.getByRole('status', { name: '제출할 파일 3개, 최대 10개' }).textContent).toBe('3/10');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(submitHomework).not.toHaveBeenCalled();
  });

  it('선택은 원본만 담고 최종 제출에서 기존 용량 확인·압축·전송·저장을 연속 진행한다', async () => {
    const original = new File([new Uint8Array(6 * 1024 * 1024)], selectedName, { type: 'application/pdf' });
    const compressed = new File([new Uint8Array(100)], selectedName, { type: 'application/pdf' });
    fetchMyHomework.mockResolvedValue([{
      id: homeworkId, title: 'PDF 숙제', status: '미제출', submitFiles: [{ name: '기존.pdf', url: null }],
      feedbackFiles: [], assignmentFiles: [],
    }]);
    let finishSizes;
    let finishCompression;
    let finishUpload;
    let failSubmit;
    fetchHomeworkFileSizesStudent.mockImplementationOnce(() => new Promise((resolve) => { finishSizes = resolve; }));
    compressExternalFile.mockImplementationOnce((_file, { onStage }) => {
      onStage?.('compressing');
      return new Promise((resolve) => { finishCompression = resolve; });
    });
    uploadStudentFile.mockImplementationOnce((_scope, file, { onProgress }) => {
      onProgress(file.size / 2);
      return new Promise((resolve) => { finishUpload = resolve; });
    });
    submitHomework.mockImplementationOnce(() => new Promise((_resolve, reject) => { failSubmit = reject; }));
    renderPage();
    const submit = await attachDocuments([original]);
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(fetchHomeworkFileSizesStudent).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(submit);
    await waitFor(() => expect(fetchHomeworkFileSizesStudent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain('확인');
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
    await act(async () => finishSizes({ files: [{ name: '기존.pdf', size: 128 }] }));
    expect(await screen.findByText('파일 용량을 줄이고 있어요')).toBeTruthy();
    const progressDialog = screen.getByRole('dialog');
    expect(uploadStudentFile).not.toHaveBeenCalled();
    await act(async () => finishCompression(compressed));
    expect(await screen.findByText('숙제 파일을 올리고 있어요')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(progressDialog);
    expect(screen.getByText('1/1개 파일 · 전송 50%')).toBeTruthy();
    expect(uploadStudentFile).toHaveBeenCalledWith(token, compressed, expect.any(Object));
    await act(async () => finishUpload(uploaded));
    expect(await screen.findByText('제출을 마무리하고 있어요')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(progressDialog);
    await act(async () => failSubmit(new Error('최종 저장 실패')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }).disabled).toBe(false);
    expect(screen.getByText(selectedName)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
    expect(uploadStudentFile).toHaveBeenCalledTimes(1);
    expect(submitHomework).toHaveBeenLastCalledWith(token, homeworkId, [uploaded], []);
  });

  it('최종 용량 확인 실패 시 전송하지 않고 원본 첨부를 보존한다', async () => {
    fetchMyHomework.mockResolvedValue([{
      id: homeworkId, title: 'PDF 숙제', status: '미제출', submitFiles: [{ name: '기존.pdf', url: null }],
      feedbackFiles: [], assignmentFiles: [],
    }]);
    fetchHomeworkFileSizesStudent.mockRejectedValueOnce(new Error('기존 용량 조회 실패'));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('기존 용량 조회 실패'));
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(submitHomework).not.toHaveBeenCalled();
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(selectedName)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }).disabled).toBe(false);
    expect(screen.queryByRole('heading', { name: /^숙제를 (제출|수정)했어요$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '확인' })).toBeNull();
  });

  it('준비 중 인증 범위가 바뀌면 압축 결과를 업로드하지 않는다', async () => {
    const original = new File([new Uint8Array(6 * 1024 * 1024)], selectedName, { type: 'application/pdf' });
    let finishCompression;
    compressExternalFile.mockImplementationOnce(() => new Promise((resolve) => { finishCompression = resolve; }));
    renderPage();
    fireEvent.click(await attachDocuments([original]));
    await waitFor(() => expect(finishCompression).toBeTypeOf('function'));
    act(() => notifyAuthChange());
    await act(async () => finishCompression(original));
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(submitHomework).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('외부 녹음 압축 뒤 최종 확장자를 사용하고 실패 재시도에서도 업로드 영수증을 재사용한다', async () => {
    const original = new File([new Uint8Array(6 * 1024 * 1024)], '외부.wav', { type: 'audio/wav' });
    const compressed = new File(['converted-audio'], '외부.mp3', { type: 'audio/mpeg' });
    const audioUploaded = { ...uploaded, fileName: '외부.mp3' };
    compressExternalFile.mockResolvedValue(compressed);
    uploadStudentFile.mockResolvedValue(audioUploaded);
    submitHomework.mockRejectedValueOnce(new Error('첫 저장 실패'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 제출하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '파일 추가' }));
    fireEvent.change(document.querySelector('input[aria-label="첨부할 파일 선택"]'), { target: { files: [original] } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('외부.wav')).toBeTruthy();
    expect(compressExternalFile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 첫 저장 실패'));
    expect(uploadStudentFile).toHaveBeenCalledWith(token, compressed, expect.objectContaining({ fileName: '외부.mp3' }));
    expect(screen.getByText('외부.wav')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(uploadStudentFile).toHaveBeenCalledTimes(1);
    expect(compressExternalFile).toHaveBeenCalledTimes(1);
    expect(submitHomework).toHaveBeenLastCalledWith(token, homeworkId, [audioUploaded], []);
  });

  it('실제 전송 진행과 제출 저장을 구분하고 실패하면 로딩을 닫아 재시도할 수 있다', async () => {
    let finishUpload;
    let failSubmit;
    uploadStudentFile.mockImplementationOnce((_scope, file, { onProgress }) => {
      onProgress(file.size / 2);
      return new Promise(resolve => { finishUpload = resolve; });
    });
    submitHomework.mockImplementationOnce(() => new Promise((_resolve, reject) => { failSubmit = reject; }));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));

    expect(await screen.findByText('숙제 파일을 올리고 있어요')).toBeTruthy();
    expect(screen.getByText('1/1개 파일 · 전송 50%')).toBeTruthy();
    expect(submitHomework).not.toHaveBeenCalled();

    await act(async () => finishUpload(uploaded));
    expect(await screen.findByText('제출을 마무리하고 있어요')).toBeTruthy();
    expect(screen.queryByText(/전송 100%/)).toBeNull();
    await act(async () => failSubmit(new Error('저장 응답 실패')));
    await waitFor(() => expect(screen.queryByText('제출을 마무리하고 있어요')).toBeNull());
    expect(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ })).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('제출 실패: 저장 응답 실패');
    expect(screen.queryByRole('heading', { name: /^숙제를 (제출|수정)했어요$/ })).toBeNull();
  });

  it('선택한 이름과 서버가 돌려준 이름이 다르면 서버 이름과 영수증으로 제출한다', async () => {
    const file = pdf();
    renderPage();
    fireEvent.click(await attachDocuments([file]));

    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('먹이 +1');
    expect(uploadStudentFile).toHaveBeenCalledWith(token, file, expect.objectContaining({ fileName: selectedName }));
    expect(submitHomework).toHaveBeenCalledWith(token, homeworkId, [uploaded], []);
    expect(screen.queryByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ })).toBeNull();
  });

  it('제출 실패 후 다시 누르면 업로드한 PDF의 서버 이름과 영수증을 재사용한다', async () => {
    submitHomework.mockRejectedValueOnce(new Error('제출 응답 실패'));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 제출 응답 실패'));

    fireEvent.click(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();

    expect(uploadStudentFile).toHaveBeenCalledTimes(1);
    expect(submitHomework).toHaveBeenNthCalledWith(1, token, homeworkId, [uploaded], []);
    expect(submitHomework).toHaveBeenNthCalledWith(2, token, homeworkId, [uploaded], []);
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
    fireEvent.click(screen.getByRole('button', { name: /^(파일 제출하기 · \d+개|수정 내용 저장하기)$/ }));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();

    expect(uploadStudentFile).toHaveBeenCalledTimes(3);
    expect(uploadStudentFile).toHaveBeenNthCalledWith(2, token, second, expect.objectContaining({ fileName: '"정답" (2).pdf' }));
    expect(uploadStudentFile).toHaveBeenNthCalledWith(3, token, second, expect.objectContaining({ fileName: selectedName }));
    expect(submitHomework).toHaveBeenLastCalledWith(token, homeworkId, [renamedUpload], []);
  });
});

describe('학생 숙제 전용 제출·수정 화면과 삭제 초안', () => {
  it('선생님 첨부 자료는 읽기 전용으로 보이고 학생 제출 개수와 목록에 섞이지 않는다', async () => {
    const assignmentFiles = [stored('선생님_문제.pdf'), stored('선생님_참고.pdf')];
    fetchMyHomework.mockResolvedValue([homework({ assignmentFiles })]);
    renderPage();
    expect(await screen.findByRole('heading', { name: '선생님이 보낸 파일' })).toBeTruthy();
    expect(screen.getByText(assignmentFiles[0].name)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '숙제 제출하기' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '숙제 제출', exact: true }));
    expect(screen.queryByRole('heading', { name: '선생님이 보낸 파일' })).toBeNull();
    expect(screen.getByRole('status', { name: '제출할 파일 0개, 최대 10개' }).textContent).toBe('0/10');
    expect(screen.getByRole('button', { name: '파일 제출하기 · 0개' }).disabled).toBe(true);
    expect(screen.queryByRole('list', { name: '제출할 파일 목록' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { name: 'PDF 숙제', exact: true })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '제출할 파일', exact: true })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '다운로드' })[0]);
    await waitFor(() => expect(downloadHomeworkFileStudent).toHaveBeenCalledWith(token, homeworkId, assignmentFiles[0].name, 'assignment'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '다운로드' })[0].disabled).toBe(false));

    await attachDocuments([pdf()]);
    expect(screen.getByRole('status', { name: '제출할 파일 1개, 최대 10개' }).textContent).toBe('1/10');
    const list = screen.getByRole('list', { name: '제출할 파일 목록' });
    expect(list.textContent).toContain(selectedName);
    for (const file of assignmentFiles) expect(list.textContent).not.toContain(file.name);
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(1);
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(submitHomework).not.toHaveBeenCalled();
  });

  it.each([
    ['미제출', '숙제 제출하기', '숙제 제출', '파일 제출하기 · 0개'],
    ['제출완료', '숙제 수정하기', '숙제 수정', '수정 내용 저장하기'],
  ])('%s 상세에는 하단 CTA만 있고 전용 화면에서만 파일을 편집한다', async (status, cta, heading, saveLabel) => {
    fetchMyHomework.mockResolvedValue([homework({ status, content: '선생님의 숙제 안내', createdTime: '2026-10-25T10:00:00Z', assignmentFiles: [stored('문제.pdf')], submitFiles: status === '제출완료' ? [stored()] : [] })]);
    renderPage();
    expect(await screen.findByRole('button', { name: cta })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '녹음하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.getByText('선생님의 숙제 안내')).toBeTruthy();
    expect(screen.getByText(/등록일:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: cta }));
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: heading }));
    expect(screen.queryByText('선생님의 숙제 안내')).toBeNull();
    expect(screen.queryByText(/등록일:/)).toBeNull();
    expect(screen.queryByText('문제.pdf')).toBeNull();
    expect(screen.queryByRole('button', { name: '숙제 내용 보기' })).toBeNull();
    expect(screen.getByRole('button', { name: '녹음하기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '파일 추가' })).toBeTruthy();
    expect(screen.getByRole('button', { name: saveLabel }).disabled).toBe(true);
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(submitHomework).not.toHaveBeenCalled();
  });

  it.each([
    ['미제출', '상단'], ['미제출', '브라우저'],
    ['제출완료', '상단'], ['제출완료', '브라우저'],
  ])('%s 제출 화면의 %s 뒤로가기로 내용을 확인하고 재진입해도 초안을 보존한다', async (status, backKind) => {
    const isEdit = status === '제출완료';
    const entryLabel = isEdit ? '숙제 수정하기' : '숙제 제출하기';
    const heading = isEdit ? '숙제 수정' : '숙제 제출';
    const count = isEdit ? 2 : 1;
    fetchMyHomework.mockResolvedValue([homework({ status, content: '선생님의 숙제 안내', assignmentFiles: [stored('문제.pdf')], submitFiles: isEdit ? [stored(), stored('유지.pdf')] : [] })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: entryLabel }));
    if (isEdit) fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    await attachDocuments([pdf()]);
    expect(screen.getByRole('status', { name: `제출할 파일 ${count}개, 최대 10개` })).toBeTruthy();

    if (backKind === '브라우저') fireEvent(window, new window.PopStateEvent('popstate'));
    else fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'PDF 숙제', exact: true }));
    expect(screen.getByText('선생님의 숙제 안내')).toBeTruthy();
    expect(screen.getByText('문제.pdf')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '제출할 파일 목록' })).toBeNull();
    expect(screen.queryByText(selectedName)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: entryLabel }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: heading, exact: true }));
    if (isEdit) expect(screen.getByRole('button', { name: '기존.pdf 삭제 취소' })).toBeTruthy();
    expect(screen.getByText(selectedName)).toBeTruthy();
    if (isEdit) expect(screen.getByText('유지.pdf')).toBeTruthy();
    expect(screen.getByRole('status', { name: `제출할 파일 ${count}개, 최대 10개` })).toBeTruthy();
    expect(screen.getByRole('button', { name: isEdit ? '수정 내용 저장하기' : `파일 제출하기 · ${count}개` }).disabled).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitHomework).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(fetchHomeworkFileSizesStudent).not.toHaveBeenCalled();
  });

  it('피드백 완료 상세는 읽기 전용이며 제출·수정 CTA와 삭제·추가 버튼이 없다', async () => {
    fetchMyHomework.mockResolvedValue([homework({ status: '피드백완료', submitFiles: [stored()], feedbackText: '잘했어요', feedbackSeenDate: '2026-10-25T10:00:00Z' })]);
    renderPage();
    expect(await screen.findByText('잘했어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^숙제 (제출|수정)하기$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '녹음하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
  });

  it('기존 파일 삭제와 되돌리기는 저장 요청 없이 초안만 바꾸고 변경 없음 상태로 돌아온다', async () => {
    fetchMyHomework.mockResolvedValue([homework({ status: '제출완료', submitFiles: [stored(), stored('유지.pdf')] })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    expect(screen.getByRole('button', { name: '기존.pdf 삭제 취소' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '수정 내용 저장하기' }).disabled).toBe(false);
    expect(submitHomework).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(fetchHomeworkFileSizesStudent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '기존.pdf 삭제 취소' }));
    expect(screen.queryByRole('button', { name: '기존.pdf 삭제 취소' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '수정 내용 저장하기' }).disabled).toBe(true);
  });

  it('기존 10개에서 하나를 삭제하고 새 파일을 추가한 뒤 되돌려도 11개가 되지 않는다', async () => {
    fetchMyHomework.mockResolvedValue([homework({ status: '제출완료', submitFiles: Array.from({ length: 10 }, (_, index) => stored(`기존${index}.pdf`)) })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    await attachDocuments([pdf()]);
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: '기존0.pdf 삭제 취소' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('10개'));
    expect(screen.getByRole('button', { name: '기존0.pdf 삭제 취소' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(10);
    expect(submitHomework).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
  });

  it.each(['상단', '브라우저'])('상세의 %s 뒤로가기로 숙제를 떠날 때만 초안 폐기를 확인한다', async backKind => {
    fetchMyHomework.mockResolvedValue([homework({ status: '제출완료', submitFiles: [stored()] })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    await attachDocuments([pdf()]);
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { name: 'PDF 숙제', exact: true })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const leaveDetail = () => backKind === '브라우저'
      ? fireEvent(window, new window.PopStateEvent('popstate'))
      : fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    leaveDetail();
    expect(await screen.findByRole('dialog', { name: '변경 내용을 버릴까요?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    expect(screen.getByRole('heading', { name: 'PDF 숙제', exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '숙제 수정하기' }));
    expect(screen.getByRole('button', { name: '기존.pdf 삭제 취소' })).toBeTruthy();
    expect(screen.getByText(selectedName)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    leaveDetail();
    fireEvent.click(await screen.findByRole('button', { name: '변경 버리기' }));
    expect(await screen.findByRole('heading', { name: '학생 홈', exact: true })).toBeTruthy();
    expect(screen.getByText('기존.pdf')).toBeTruthy();
    expect(screen.queryByText(selectedName)).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '기존.pdf 삭제 취소' })).toBeNull();
    expect(submitHomework).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
  });

  it('변경 없는 편집 화면은 확인창 없이 상세로 돌아간다', async () => {
    fetchMyHomework.mockResolvedValue([homework({ status: '제출완료', submitFiles: [stored()] })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { name: 'PDF 숙제' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitHomework).not.toHaveBeenCalled();
  });

  it('기존 삭제와 신규 추가를 최종 버튼에서 한 번의 저장 요청으로 전달한다', async () => {
    const initial = homework({ status: '제출완료', submitFiles: [stored(), stored('유지.pdf')] });
    const saved = { ...initial, properties: {}, submitFiles: [stored('유지.pdf'), stored(receivedName)] };
    fetchMyHomework.mockResolvedValue([initial]);
    submitHomework.mockResolvedValueOnce(saved);
    const original = pdf();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    const save = await attachDocuments([original]);
    expect(submitHomework).not.toHaveBeenCalled();
    expect(uploadStudentFile).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(submitHomework).toHaveBeenCalledTimes(1));
    expect(submitHomework).toHaveBeenCalledWith(token, homeworkId, [uploaded], ['기존.pdf']);
    expect(await screen.findByRole('heading', { name: '숙제를 수정했어요' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expectStudentHome(saved);
    expect(screen.queryByText('기존.pdf')).toBeNull();
    expect(screen.getByText('유지.pdf')).toBeTruthy();
    expect(uploadStudentFile).toHaveBeenCalledWith(token, original, expect.any(Object));
  });

  it.each([false, true])('삭제만 저장할 때 업로드를 생략하고 홈 목록에 전체 삭제 여부에 맞는 상태를 표시한다: %s', async deleteAll => {
    const initial = homework({ status: '제출완료', submitFiles: deleteAll ? [stored()] : [stored(), stored('유지.pdf')] });
    const saved = { ...initial, properties: {}, status: deleteAll ? '미제출' : '제출완료', submitFiles: deleteAll ? [] : [stored('유지.pdf')] };
    fetchMyHomework.mockResolvedValue([initial]);
    submitHomework.mockResolvedValueOnce(saved);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    await waitFor(() => expect(submitHomework).toHaveBeenCalledWith(token, homeworkId, [], ['기존.pdf']));
    expect(uploadStudentFile).not.toHaveBeenCalled();
    expect(compressExternalFile).not.toHaveBeenCalled();
    expect(fetchHomeworkFileSizesStudent).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: '숙제를 수정했어요' })).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expectStudentHome(saved);
    expect(screen.queryByText('기존.pdf')).toBeNull();
    if (deleteAll) expect(saved.submitFiles).toEqual([]);
    else expect(screen.getByText('유지.pdf')).toBeTruthy();
  });

  it('저장 실패는 삭제·추가 초안과 원본을 유지하고 재시도에는 기존 영수증을 재사용한다', async () => {
    const initial = homework({ status: '제출완료', submitFiles: [stored()] });
    const saved = { ...initial, properties: {}, submitFiles: [stored(receivedName)] };
    fetchMyHomework.mockResolvedValue([initial]);
    submitHomework.mockRejectedValueOnce(new Error('수정 저장 실패')).mockResolvedValueOnce(saved);
    const original = pdf();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(await attachDocuments([original]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 수정 저장 실패'));
    expect(screen.getByRole('button', { name: '기존.pdf 삭제 취소' })).toBeTruthy();
    expect(screen.getByText(selectedName)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    expect(await screen.findByRole('heading', { name: '숙제를 수정했어요' })).toBeTruthy();
    expect(submitHomework).toHaveBeenNthCalledWith(1, token, homeworkId, [uploaded], ['기존.pdf']);
    expect(submitHomework).toHaveBeenNthCalledWith(2, token, homeworkId, [uploaded], ['기존.pdf']);
    expect(uploadStudentFile).toHaveBeenCalledOnce();
    expect(uploadStudentFile.mock.calls[0][1]).toBe(original);
    expect(compressExternalFile).toHaveBeenCalledOnce();
  });

  it('편집 중 피드백 완료 409를 받으면 최신 상세로 돌아가고 회원 권한은 유지한다', async () => {
    const initial = homework({ status: '제출완료', submitFiles: [stored()] });
    const latest = { ...initial, status: '피드백완료', feedbackText: '최신 피드백', feedbackSeenDate: '2026-10-25T10:00:00Z' };
    fetchMyHomework.mockResolvedValueOnce([initial]).mockResolvedValue([latest]);
    submitHomework.mockRejectedValueOnce(Object.assign(new Error('강사 피드백이 완료되어 더 이상 수정할 수 없습니다.'), { status: 409, code: 'homework_feedback_locked' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '숙제 수정하기' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '수정 내용 저장하기' }));
    expect(await screen.findByText('최신 피드백')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^숙제 (제출|수정)하기$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '기존.pdf 삭제 취소' })).toBeNull();
    expect(screen.getByText('기존.pdf')).toBeTruthy();
    expect(getStudentAppContext()).toBe(studentContext);
    expect(getStudentAppContext().allowed).toBe(true);
    expect(toast.error).toHaveBeenCalledWith('피드백이 완료되어 제출을 수정할 수 없어요.');
    expect(uploadStudentFile).not.toHaveBeenCalled();
  });

  it('서버가 저장한 숙제 응답은 재조회 없이 상세와 목록 캐시에 바로 반영한다', async () => {
    const saved = homework({ properties: {}, status: '제출완료', submitFiles: [stored(receivedName)], submitDate: '2026-10-25T10:00:00Z' });
    submitHomework.mockResolvedValueOnce(saved);
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(peekCache(`student:homework:${token}`)).toEqual([saved]);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expectStudentHome(saved);
    expect(fetchMyHomework).toHaveBeenCalledOnce();
    expect(screen.getByText(receivedName)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^파일 제출하기/ })).toBeNull();
  });

  it('인증 범위가 변경되면 이전 영수증을 재사용하지 않고 같은 파일을 새로 업로드한다', async () => {
    submitHomework.mockRejectedValueOnce(new Error('첫 저장 실패'));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('제출 실패: 첫 저장 실패'));
    expect(uploadStudentFile).toHaveBeenCalledOnce();
    act(() => notifyAuthChange());
    fireEvent.click(screen.getByRole('button', { name: /^파일 제출하기/ }));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(uploadStudentFile).toHaveBeenCalledTimes(2);
    expect(submitHomework).toHaveBeenCalledTimes(2);
  });
});

describe('숙제 저장 성공 후 완료 화면', () => {
  it('기존 토큰 경로에서 제출한 뒤 확인하면 원래 학생 토큰 홈으로 돌아간다', async () => {
    const legacyToken = 'HOMEWORK12345';
    const saved = homework({ properties: {}, status: '제출완료', submitFiles: [stored(receivedName)] });
    setStudentAppContext(null);
    setStudentSession(legacyToken, fixtureSession('student', `personal:${legacyToken}`));
    submitHomework.mockResolvedValueOnce(saved);
    function LegacyStudentHomeProbe() {
      const location = useLocation();
      return <main>
        <h1>레거시 학생 홈</h1>
        <output data-testid="legacy-home-path">{location.pathname}</output>
        <output data-testid="legacy-home-tab">{location.state?.tab}</output>
      </main>;
    }
    render(<MemoryRouter initialEntries={[
      `/personal/${legacyToken}`, `/personal/${legacyToken}/homework/${homeworkId}`,
    ]}>
      <Routes>
        <Route path="/personal/:studentToken/homework/:hwId" element={<PersonalHomeworkDetailPage />} />
        <Route path="/personal/:studentToken" element={<LegacyStudentHomeProbe />} />
      </Routes>
    </MemoryRouter>);
    fireEvent.click(await attachDocuments([pdf()]));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    expect(fetchMyHomework).toHaveBeenCalledWith(legacyToken);
    expect(uploadStudentFile.mock.calls[0][0]).toBe(legacyToken);
    expect(submitHomework).toHaveBeenCalledWith(legacyToken, homeworkId, [uploaded], []);
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByRole('heading', { name: '레거시 학생 홈' })).toBeTruthy();
    expect(screen.getByTestId('legacy-home-path').textContent).toBe(`/personal/${legacyToken}`);
    expect(screen.getByTestId('legacy-home-tab').textContent).toBe('홈');
    expect(peekCache(`student:homework:${legacyToken}`)).toEqual([saved]);
    expect(uploadStudentFile).toHaveBeenCalledOnce();
    expect(submitHomework).toHaveBeenCalledOnce();
  });

  it('완료 제목에 포커스를 두고 자동으로 닫거나 다시 전송하지 않으며 확인 후 갱신된 홈 목록으로 이동한다', async () => {
    let finishSave;
    const saved = homework({ properties: {}, status: '제출완료', submitFiles: [stored(receivedName)] });
    submitHomework.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    expect(await screen.findByText('제출을 마무리하고 있어요')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '숙제를 제출했어요' })).toBeNull();
    vi.useFakeTimers();
    await act(async () => { finishSave(saved); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const completed = screen.getByRole('heading', { name: '숙제를 제출했어요' });
    expect(completed.tagName).toBe('H1');
    expect(document.activeElement).toBe(completed);
    expect(screen.queryByRole('button', { name: '녹음하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '파일 추가' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^숙제 (제출|수정)하기$/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitHomework).toHaveBeenCalledOnce();
    expect(uploadStudentFile).toHaveBeenCalledOnce();
    expect(fetchMyHomework).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('먹이 +1');
    expect(toast.success).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expectStudentHome(saved);
    expect(screen.getByText(receivedName)).toBeTruthy();
    act(() => window.dispatchEvent(new window.PopStateEvent('popstate')));
    expectStudentHome(saved);
    expect(submitHomework).toHaveBeenCalledOnce();
    expect(uploadStudentFile).toHaveBeenCalledOnce();
  });

  it.each(['상단', '브라우저'])('완료 화면의 %s 뒤로가기는 재전송 없이 갱신된 홈 목록으로 이동한다', async backKind => {
    const saved = homework({ properties: {}, status: '제출완료', submitFiles: [stored(receivedName)] });
    submitHomework.mockResolvedValueOnce(saved);
    renderPage();
    fireEvent.click(await attachDocuments([pdf()]));
    expect(await screen.findByRole('heading', { name: '숙제를 제출했어요' })).toBeTruthy();
    if (backKind === '상단') fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    else act(() => window.dispatchEvent(new window.PopStateEvent('popstate')));
    expectStudentHome(saved);
    expect(screen.getByText(receivedName)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => window.dispatchEvent(new window.PopStateEvent('popstate')));
    expectStudentHome(saved);
    expect(submitHomework).toHaveBeenCalledOnce();
    expect(uploadStudentFile).toHaveBeenCalledOnce();
  });
});
