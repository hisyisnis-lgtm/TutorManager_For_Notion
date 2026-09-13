import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Routes, Route } from 'react-router-dom';
import LessonLogFormPage from './LessonLogFormPage.jsx';
import { getPage, updatePage } from '../api/notionClient.js';
import BottomNav from '../components/layout/BottomNav.jsx';
import { hasUnsavedChanges } from '../utils/unsavedChanges.js';

vi.mock('../api/notionClient.js', () => ({ getPage: vi.fn(), updatePage: vi.fn(), deletePage: vi.fn(), queryAll: vi.fn(), createPage: vi.fn() }));
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ studentNameMap: {} }) }));

const lesson = (id, content) => ({ id, properties: {
  제목: { title: [{ plain_text: id }] },
  '오늘 내용': { rich_text: [{ plain_text: content }] },
  숙제: { rich_text: [{ plain_text: '기존 숙제' }] },
  '다음 수업 준비': { rich_text: [{ plain_text: '기존 준비' }] },
  메모: { rich_text: [{ plain_text: '기존 메모' }] },
} });
const renderPage = () => {
  const router = createMemoryRouter([{ path: '*', element: <>
    <Routes>
      <Route path="/logs/:id/edit" element={<LessonLogFormPage />} />
      <Route path="/logs" element={<p>일지 목록</p>} />
      <Route path="/home" element={<p>강사 홈</p>} />
    </Routes>
    <BottomNav />
  </> }], { initialEntries: ['/logs', '/logs/first/edit'] });
  render(<RouterProvider router={router} />);
  return router;
};
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); });

describe('수업 일지 원본 조회와 저장 보호', () => {
  it('조회 실패 후에는 빈 편집 폼과 저장·삭제를 제공하지 않고 재시도 성공 후 원본을 편집한다', async () => {
    getPage.mockRejectedValueOnce(new Error('조회 실패')).mockResolvedValueOnce(lesson('first', '기존 내용'));
    const router = renderPage();
    await screen.findByText('조회 실패');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: '저장하기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수업 일지 삭제' })).toBeNull();
    expect(updatePage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    const content = await screen.findByDisplayValue('기존 내용');
    expect(screen.queryByText('조회 실패')).toBeNull();
    fireEvent.submit(content.closest('form'));
    expect(updatePage).not.toHaveBeenCalled();
    updatePage.mockResolvedValue({});
    fireEvent.change(content, { target: { value: '수정 내용' } });
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    expect(updatePage).toHaveBeenCalledWith('first', expect.objectContaining({
      '오늘 내용': { rich_text: [{ text: { content: '수정 내용' } }] },
      숙제: { rich_text: [{ text: { content: '기존 숙제' } }] },
      메모: { rich_text: [{ text: { content: '기존 메모' } }] },
    }));
    await act(async () => {});
    router.dispose();
  });

  it.each(['resolve', 'reject'])('일지 id 변경 뒤 이전 요청의 늦은 %s가 새 일지 편집을 덮어쓰지 않는다', async (outcome) => {
    let resolveOld, rejectOld;
    getPage.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockResolvedValueOnce(lesson('second', '새 일지 내용'));
    const router = renderPage();
    await act(async () => { await router.navigate('/logs/second/edit'); });
    await screen.findByDisplayValue('새 일지 내용');
    await act(async () => {
      if (outcome === 'resolve') resolveOld(lesson('first', '늦은 이전 내용'));
      else rejectOld(new Error('늦은 이전 오류'));
    });
    expect(screen.getByDisplayValue('새 일지 내용')).toBeTruthy();
    expect(screen.queryByDisplayValue('늦은 이전 내용')).toBeNull();
    expect(screen.queryByText('늦은 이전 오류')).toBeNull();
    expect(updatePage).not.toHaveBeenCalled();
    router.dispose();
  });

  it('기존 일지를 편집하다 다른 id 조회가 실패하면 이전 폼으로 새 id를 저장할 수 없다', async () => {
    getPage.mockResolvedValueOnce(lesson('first', '첫 일지')).mockRejectedValueOnce(new Error('새 일지 조회 실패'));
    const router = renderPage();
    const content = await screen.findByDisplayValue('첫 일지');
    fireEvent.change(content, { target: { value: '수정 중 내용' } });
    await act(async () => { await router.navigate('/logs/second/edit'); });
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    await screen.findByText('새 일지 조회 실패');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(updatePage).not.toHaveBeenCalled();
    router.dispose();
  });

  it('변경이 없으면 뒤로가기를 허용한다', async () => {
    getPage.mockResolvedValue(lesson('first', '기존 내용'));
    const router = renderPage();
    await screen.findByDisplayValue('기존 내용');
    fireEvent.click(screen.getByRole('button', { name: '뒤로가기' }));
    expect(await screen.findByText('일지 목록')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hasUnsavedChanges()).toBe(false);
    router.dispose();
  });

  it('변경 후 뒤로가기를 취소하면 입력을 유지하고 BottomNav 이탈을 확인하면 이동한다', async () => {
    getPage.mockResolvedValue(lesson('first', '기존 내용'));
    const router = renderPage();
    fireEvent.change(await screen.findByDisplayValue('기존 내용'), { target: { value: '작성 중 내용' } });
    expect(hasUnsavedChanges()).toBe(true);
    await act(async () => router.navigate(-1));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '계속 작성' }));
    expect(screen.getByDisplayValue('작성 중 내용')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: '홈' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    expect(await screen.findByText('강사 홈')).toBeTruthy();
    expect(hasUnsavedChanges()).toBe(false);
    router.dispose();
  });

  it('저장 실패 시 입력과 종료 경고를 유지하고 재시도 성공 시 경고 없이 돌아간다', async () => {
    getPage.mockResolvedValue(lesson('first', '기존 내용'));
    updatePage.mockRejectedValueOnce(new Error('저장 실패')).mockResolvedValueOnce({});
    const router = renderPage();
    fireEvent.change(await screen.findByDisplayValue('기존 내용'), { target: { value: '보존할 내용' } });
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    await screen.findByText('저장 실패');
    expect(screen.getByDisplayValue('보존할 내용')).toBeTruthy();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    expect(await screen.findByText('일지 목록')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const afterSave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterSave);
    expect(afterSave.defaultPrevented).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
    router.dispose();
  });
});
