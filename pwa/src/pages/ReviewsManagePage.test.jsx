import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import ReviewsManagePage from './ReviewsManagePage.jsx';
import { editReviewPhotos, fetchReviewPhoto, fetchReviewQueue, moderateReview } from '../api/reviews.js';
import { prepareReviewPhoto } from '../utils/reviewPhoto.js';
import { toast } from 'sonner';

vi.mock('../api/reviews.js', () => ({ editReviewPhotos: vi.fn(), fetchReviewPhoto: vi.fn(), fetchReviewQueue: vi.fn(), moderateReview: vi.fn() }));
vi.mock('../utils/reviewPhoto.js', () => ({ MAX_REVIEW_PHOTOS: 5, prepareReviewPhoto: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const pendingReview = {
  id: 'review-one', nickname: '특강 참여자', experienceType: 'external', activityName: '발음 특강',
  title: '외부활동 후기', body: '설명이 자세해서 중국어 발음을 이해하는 데 도움이 되었어요.',
  status: 'pending', version: 3, pendingVersion: 3, publishedVersion: null,
};
let router;
function renderPage() {
  router = createMemoryRouter([{ path: '/reviews-manage', element: <ReviewsManagePage /> }], { initialEntries: ['/reviews-manage'] });
  render(<RouterProvider router={router} />);
}
beforeEach(() => {
  vi.resetAllMocks();
  fetchReviewQueue.mockResolvedValue({ reviews: [pendingReview], counts: { pending: 1 }, nextCursor: null });
  moderateReview.mockResolvedValue({ review: { ...pendingReview, status: 'published' } });
  editReviewPhotos.mockResolvedValue({ review: pendingReview });
});
afterEach(() => { cleanup(); router?.dispose(); });

describe('후기 검수', () => {
  it('승인본을 둔 채 사진을 추가·삭제한 수정본을 검수 대기로 저장한다', async () => {
    const published = { ...pendingReview, status: 'published', pendingVersion: null, publishedVersion: 3, photoIds: ['existing'],
      publishedContent: { title: pendingReview.title, body: pendingReview.body, photoIds: ['existing'] } };
    fetchReviewQueue.mockImplementation(async status => ({ reviews: status === 'published' ? [published] : [pendingReview], counts: {}, nextCursor: null }));
    fetchReviewPhoto.mockResolvedValue(new Blob([], { type: 'image/jpeg' }));
    const jpeg = new File(['jpeg'], 'review-photo-unique.jpg', { type: 'image/jpeg' });
    prepareReviewPhoto.mockResolvedValue(jpeg);
    renderPage();
    await screen.findByText(pendingReview.title);
    const filter = within(screen.getByLabelText('후기 상태'));
    fireEvent.click(filter.getByRole('button', { name: '공개' }));
    await screen.findByText('공개본 사진 1장 보기');
    fireEvent.click(screen.getByRole('button', { name: '사진 수정' }));
    const editor = within(screen.getByRole('dialog', { name: '후기 사진 수정' }));
    expect(editor.getByRole('button', { name: '사진 저장' }).disabled).toBe(true);
    const source = new File(['test'], 'sample.webp', { type: 'image/webp' });
    fireEvent.change(editor.getByLabelText('후기 사진 파일 선택'), { target: { files: [source] } });
    await editor.findByText('2 / 5장');
    expect(prepareReviewPhoto).toHaveBeenCalledWith(source);
    fireEvent.click(editor.getByRole('button', { name: '사진 1 삭제' }));
    fireEvent.click(editor.getByRole('button', { name: '사진 저장' }));
    await waitFor(() => expect(editReviewPhotos).toHaveBeenCalledWith(published.id, published.version, [jpeg]));
    await waitFor(() => expect(filter.getByRole('button', { name: '검수 대기' }).getAttribute('aria-pressed')).toBe('true'));
    expect(moderateReview).not.toHaveBeenCalled();
  });

  it('사진 장수 초과를 막고, 변경을 취소하거나 모든 사진을 삭제할 수 있다', async () => {
    const pendingWithPhoto = { ...pendingReview, photoIds: ['existing'] };
    fetchReviewQueue.mockResolvedValue({ reviews: [pendingWithPhoto], counts: {}, nextCursor: null });
    fetchReviewPhoto.mockResolvedValue(new Blob([], { type: 'image/jpeg' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '사진 수정' }));
    const editor = within(screen.getByRole('dialog', { name: '후기 사진 수정' }));
    const source = new File(['test'], 'sample.png', { type: 'image/png' });
    fireEvent.change(editor.getByLabelText('후기 사진 파일 선택'), { target: { files: Array(5).fill(source) } });
    expect((await editor.findByRole('alert')).textContent).toContain('최대 5장');
    expect(prepareReviewPhoto).not.toHaveBeenCalled();
    fireEvent.click(editor.getByRole('button', { name: '사진 1 삭제' }));
    fireEvent.click(editor.getByRole('button', { name: '취소' }));
    const confirm = within(screen.getByRole('dialog', { name: '사진 수정을 취소할까요?' }));
    fireEvent.click(confirm.getByRole('button', { name: '계속 수정' }));
    expect(editor.getByText('0 / 5장')).toBeTruthy();
    fireEvent.click(editor.getByRole('button', { name: '사진 저장' }));
    await waitFor(() => expect(editReviewPhotos).toHaveBeenCalledWith(pendingWithPhoto.id, pendingWithPhoto.version, []));
  });

  it('사진 저장 중 버전이 바뀌면 변경을 유지하며 취소 후 최신 후기를 조회한다', async () => {
    const newPhoto = new File(['jpeg'], 'review-photo-unique.jpg', { type: 'image/jpeg' });
    prepareReviewPhoto.mockResolvedValue(newPhoto);
    editReviewPhotos.mockRejectedValue(Object.assign(new Error('버전 충돌'), { status: 409 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '사진 수정' }));
    const editor = within(screen.getByRole('dialog', { name: '후기 사진 수정' }));
    fireEvent.change(editor.getByLabelText('후기 사진 파일 선택'), { target: { files: [newPhoto] } });
    await editor.findByText('1 / 5장');
    fireEvent.click(editor.getByRole('button', { name: '사진 저장' }));
    expect((await editor.findByRole('alert')).textContent).toContain('후기가 변경됐어요');
    expect(editor.getByText('1 / 5장')).toBeTruthy();
    expect(editor.getByRole('button', { name: '사진 저장' }).disabled).toBe(true);
    fireEvent.click(editor.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '나가기' }));
    await waitFor(() => expect(fetchReviewQueue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: '후기 사진 수정' })).toBeNull();
  });

  it('첨부 사진 다섯 장을 펼칠 때 불러오고 닫을 때 미리보기 URL을 정리한다', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-photo');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const photoIds = ['one', 'two', 'three', 'four', 'five'];
    fetchReviewPhoto.mockResolvedValue(new Blob([], { type: 'image/jpeg' }));
    fetchReviewQueue.mockResolvedValue({ reviews: [{ ...pendingReview, photoIds }], counts: {}, nextCursor: null });
    try {
      renderPage();
      const details = (await screen.findByText('첨부 사진 5장 보기')).parentElement;
      expect(fetchReviewPhoto).not.toHaveBeenCalled();
      details.open = true;
      fireEvent(details, new Event('toggle'));
      await screen.findByAltText('후기 사진 5.jpg');
      expect(fetchReviewPhoto.mock.calls).toEqual(photoIds.map(id => [pendingReview.id, id]));
      expect(createUrl).toHaveBeenCalledTimes(5);
      details.open = false;
      fireEvent(details, new Event('toggle'));
      expect(revokeUrl).toHaveBeenCalledTimes(5);
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    }
  });

  it('수정본과 현재 공개본의 구매 확인·별점을 구분해 검수한다', async () => {
    fetchReviewQueue.mockResolvedValue({ reviews: [{ ...pendingReview, rating: 2, purchaseConfirmed: false,
      targetName: '특강', publishedContent: { title: '승인된 제목', body: '기존 공개본', rating: 5, purchaseConfirmed: true, targetName: '정규 수업' } }], counts: {}, nextCursor: null });
    renderPage();
    expect(await screen.findByText('일반 후기 · 특강 · 별점 2/5')).toBeTruthy();
    expect(screen.getByText('구매 확인 후기 · 정규 수업 · 별점 5/5')).toBeTruthy();
  });

  it('반려 사유를 요구하고 확인한 버전을 함께 제출한다', async () => {
    renderPage();
    await screen.findByText('외부활동 후기');
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '반려' }));
    fireEvent.click(screen.getByRole('button', { name: '반려하기' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '작성자에게 안내할 사유를 적어주세요.');
    expect(moderateReview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '전화번호를 지우고 다시 제출해 주세요.' } });
    fireEvent.click(screen.getByRole('button', { name: '반려하기' }));
    await waitFor(() => expect(moderateReview).toHaveBeenCalledWith('review-one', {
      action: 'reject', version: 3, reason: '전화번호를 지우고 다시 제출해 주세요.',
    }));
  });

  it('검수 도중 내용이 바뀌면 오래된 승인 창을 닫고 최신 목록을 읽는다', async () => {
    moderateReview.mockRejectedValue(Object.assign(new Error('버전 충돌'), { status: 409 }));
    renderPage();
    await screen.findByText('외부활동 후기');
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '공개' }));
    fetchReviewQueue.mockResolvedValue({ reviews: [{ ...pendingReview, title: '수정된 후기', version: 4 }], counts: { pending: 1 }, nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: '공개하기' }));
    expect(await screen.findByText('수정된 후기')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('후기가 변경됐어요. 최신 내용을 확인하고 다시 처리해 주세요.');
  });

  it('개인정보를 이유로 숨길 때 원문 복원을 기본 허용하지 않는다', async () => {
    fetchReviewQueue.mockResolvedValue({ reviews: [{ ...pendingReview, status: 'published', pendingVersion: null, publishedVersion: 3 }], counts: {}, nextCursor: null });
    renderPage();
    await screen.findByText('외부활동 후기');
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '숨김' }));
    expect(screen.getByRole('checkbox').checked).toBe(false);
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '제삼자의 개인정보가 있어요.' } });
    fireEvent.click(screen.getByRole('button', { name: '숨김하기' }));
    await waitFor(() => expect(moderateReview).toHaveBeenCalledWith('review-one', {
      action: 'hide', version: 3, reason: '제삼자의 개인정보가 있어요.', allowRestore: false,
    }));
  });

  it('조회 실패를 빈 목록으로 표시하지 않고 재시도한다', async () => {
    fetchReviewQueue.mockRejectedValueOnce(new Error('서버 연결 오류'));
    renderPage();
    expect(await screen.findByText('서버 연결 오류')).toBeTruthy();
    expect(screen.queryByText('검수 대기 후기가 없어요')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /다시/ }));
    expect(await screen.findByText('외부활동 후기')).toBeTruthy();
  });

  it('사유가 없는 공개 요청 중에도 종료를 보호하고 중복 처리를 막는다', async () => {
    let finish;
    moderateReview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPage();
    await screen.findByText('외부활동 후기');
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '공개' }));
    fireEvent.click(screen.getByRole('button', { name: '공개하기' }));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: '공개하기' }).disabled).toBe(true);
    expect(moderateReview).toHaveBeenCalledTimes(1);
    await act(async () => finish({ review: pendingReview }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('수정본을 반려한 뒤에도 실제 승인본을 확인할 수 있다', async () => {
    fetchReviewQueue.mockResolvedValue({ reviews: [{
      ...pendingReview, status: 'published', pendingVersion: null, publishedVersion: 2,
      body: '반려된 새 본문', publishedContent: { title: '승인된 제목', body: '현재 공개되고 있는 승인 본문' },
      moderationReason: '개인정보를 제거해주세요.',
    }], counts: {}, nextCursor: null });
    renderPage();
    expect(await screen.findByText('현재 공개된 내용 보기')).toBeTruthy();
    expect(screen.getByText('현재 공개되고 있는 승인 본문')).toBeTruthy();
  });
});
