import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import NoticesPage from './NoticesPage.jsx';
import BottomNav from '../components/layout/BottomNav.jsx';
import { createNotice, fetchNotices, updateNotice } from '../api/notices.js';
import { toast } from 'sonner';
import { isOnFormPage } from '../utils/swUpdateGuard.js';

vi.mock('../api/notices.js', () => ({ fetchNotices: vi.fn(), createNotice: vi.fn(), updateNotice: vi.fn(), deleteNotice: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
let router;
function renderPage() {
  router = createMemoryRouter([{ path: '*', element: <>
    <Routes>
      <Route path="/notices" element={<NoticesPage />} />
      <Route path="/home" element={<p>강사 홈</p>} />
    </Routes>
    <BottomNav />
  </> }], { initialEntries: ['/home', '/notices'] });
  render(<RouterProvider router={router} />);
}
beforeEach(() => { vi.resetAllMocks(); fetchNotices.mockResolvedValue([]); });
afterEach(() => { cleanup(); router?.dispose(); });

describe('공지 작성 보호', () => {
  it('새 공지의 변경이 없으면 바로 목록으로 돌아간다', async () => {
    renderPage();
    await screen.findByText('아직 올린 공지가 없어요');
    fireEvent.click(screen.getByRole('button', { name: '공지 작성' }));
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(screen.getByText('아직 올린 공지가 없어요')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('제목·내용·공개 여부를 바꾼 공지는 내부 목록·BottomNav·브라우저 뒤로가기에 보호한다', async () => {
    renderPage();
    await screen.findByText('아직 올린 공지가 없어요');
    fireEvent.click(screen.getByRole('button', { name: '공지 작성' }));
    fireEvent.change(screen.getByPlaceholderText('예) 추석 연휴 휴강 안내'), { target: { value: '작성할 제목' } });
    fireEvent.change(screen.getByPlaceholderText('학생들에게 전할 내용을 적어주세요'), { target: { value: '작성할 본문' } });
    expect(isOnFormPage({ pathname: '/', hash: '#/notices' })).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    expect(screen.getByDisplayValue('작성할 제목')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '홈' }));
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    expect(screen.getByDisplayValue('작성할 본문')).toBeTruthy();
    await act(async () => router.navigate(-1));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByText('강사 홈')).toBeTruthy();
    expect(isOnFormPage({ pathname: '/', hash: '#/notices' })).toBe(false);
  });

  it('저장 실패 후 내용을 유지하며 재시도 성공 뒤 작성 보호를 해제한다', async () => {
    createNotice.mockRejectedValueOnce(new Error('서버 저장 실패')).mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('아직 올린 공지가 없어요');
    fireEvent.click(screen.getByRole('button', { name: '공지 작성' }));
    fireEvent.change(screen.getByPlaceholderText('예) 추석 연휴 휴강 안내'), { target: { value: '보존할 제목' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '공지 올리기' })));
    expect(toast.error).toHaveBeenCalledWith('서버 저장 실패');
    expect(screen.getByDisplayValue('보존할 제목')).toBeTruthy();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '공지 올리기' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('아직 올린 공지가 없어요')).toBeTruthy();
    expect(isOnFormPage({ pathname: '/', hash: '#/notices' })).toBe(false);
    expect(createNotice).toHaveBeenCalledTimes(2);
  });

  it('기존 공지에서 토글만 변경해도 보호하고 원상복구하면 경고 없이 종료한다', async () => {
    fetchNotices.mockResolvedValue([{ id: 'notice-1', title: '기존 공지', content: '기존 본문', visible: true, important: false }]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '수정' }));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    fireEvent.click(screen.getAllByRole('switch')[0]);
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('기존 공지')).toBeTruthy();
    expect(updateNotice).not.toHaveBeenCalled();
  });

  it('저장 도중 이동을 시도해도 저장 성공 후 이전 이동이 새 작성 화면을 막지 않는다', async () => {
    let finishSave;
    createNotice.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    renderPage();
    await screen.findByText('아직 올린 공지가 없어요');
    fireEvent.click(screen.getByRole('button', { name: '공지 작성' }));
    fireEvent.change(screen.getByPlaceholderText('예) 추석 연휴 휴강 안내'), { target: { value: '저장할 제목' } });
    fireEvent.click(screen.getByRole('button', { name: '공지 올리기' }));
    expect(screen.getByDisplayValue('저장할 제목').disabled).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: '홈' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: '나가기' }).disabled).toBe(true);
    await act(async () => finishSave({}));
    expect(screen.getByText('아직 올린 공지가 없어요')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/notices');
    fireEvent.click(screen.getByRole('button', { name: '공지 작성' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('예) 추석 연휴 휴강 안내'), { target: { value: '다음 작성' } });
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
