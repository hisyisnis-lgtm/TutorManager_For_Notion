import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { DataProvider, useData } from '../context/DataContext.jsx';
import { setAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';
import { getPage, queryAll, updatePage, deletePage } from '../api/notionClient.js';
import PaymentDetailPage from './PaymentDetailPage.jsx';
import PaymentFormPage from './PaymentFormPage.jsx';

vi.mock('../api/notionClient.js', () => ({ getPage: vi.fn(), queryAll: vi.fn(), queryPage: vi.fn(), updatePage: vi.fn(), deletePage: vi.fn(), createPage: vi.fn() }));
vi.mock('../api/students.js', () => ({ fetchAllStudents: async () => [{ id: 'student', name: '가상 학생', usedSessions: 2, status: '🟢 수강중' }], parseStudent: (student) => student }));
vi.mock('../api/classTypes.js', () => ({ fetchAllClassTypes: async () => [{ id: 'class-type', title: '개인 수업', unitPrice: 50000 }], parseClassType: (type) => type }));
vi.mock('../api/discounts.js', () => ({ fetchAllDiscounts: async () => [], parseDiscount: (discount) => discount }));

let paymentRows;
const payment = ({ refundAmount = 0, method = '카드', date = '2026-09-10' } = {}) => ({ id: 'payment', properties: {
  타이틀: { title: [{ plain_text: '가상 결제' }] },
  학생: { relation: [{ id: 'student' }] },
  '수업 종류': { relation: [{ id: 'class-type' }] },
  '시간 회차': { number: 10 },
  '실제 결제 금액': { number: 500000 },
  '환불 금액': { number: refundAmount },
  '시간당 단가': { rollup: { number: 50000 } },
  '유효 시간 회차': { formula: { number: (500000 - refundAmount) / 50000 } },
  '결제 금액': { formula: { number: 500000 } },
  결제수단: { select: method ? { name: method } : null },
  결제일: { date: date ? { start: date } : null },
} });

function Shell() {
  return <DataProvider><Remaining /><Outlet /></DataProvider>;
}
function Remaining() {
  const { remainingByStudent } = useData();
  return <output data-testid="remaining">{remainingByStudent.student}</output>;
}
function renderPage(path) {
  const router = createMemoryRouter([{ element: <Shell />, children: [
    { path: '/payments', element: <p>결제 목록</p> },
    { path: '/payments/:id', element: <PaymentDetailPage /> },
    { path: '/payments/:id/edit', element: <PaymentFormPage /> },
  ] }], { initialEntries: ['/payments', path] });
  render(<RouterProvider router={router} />);
  return router;
}
async function refund(amount) {
  fireEvent.click(await screen.findByRole('button', { name: '환불 처리' }));
  fireEvent.change(screen.getByPlaceholderText('환불할 금액'), { target: { value: String(amount) } });
  fireEvent.click(screen.getByRole('button', { name: '저장', exact: true }));
  const confirm = await screen.findByRole('dialog', { name: '환불을 처리하시겠습니까?' });
  fireEvent.click(within(confirm).getByRole('button', { name: '환불 처리' }));
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession());
  paymentRows = [payment()];
  getPage.mockImplementation(async () => paymentRows[0]);
  queryAll.mockImplementation(async () => paymentRows);
  updatePage.mockImplementation(async (_id, properties) => {
    if (properties['환불 금액']) paymentRows = [payment({ refundAmount: properties['환불 금액'].number })];
    return {};
  });
  deletePage.mockImplementation(async () => { paymentRows = []; return {}; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('결제 변경 후 학생 잔여 시간과 메타데이터 유지', () => {
  it('환불 저장 후 같은 DataProvider에서 잔여 시간이 8시간에서 6시간으로 바뀐다', async () => {
    const router = renderPage('/payments/payment');
    await screen.findByText('가상 학생', { selector: 'p' });
    expect(screen.getByTestId('remaining').textContent).toBe('8');
    await refund(100000);
    await screen.findByRole('button', { name: '환불 내역 수정' });
    expect(screen.getByTestId('remaining').textContent).toBe('6');
    expect(queryAll).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it('환불 저장은 성공하고 상세 재조회가 실패해도 학생 잔여 시간을 먼저 갱신한다', async () => {
    const router = renderPage('/payments/payment');
    await screen.findByText('가상 학생', { selector: 'p' });
    getPage.mockRejectedValueOnce(new Error('상세 재조회 실패'));
    await refund(100000);
    await screen.findByText('상세 재조회 실패');
    expect(screen.getByTestId('remaining').textContent).toBe('6');
    router.dispose();
  });

  it('결제 삭제 후 목록으로 돌아가기 전에 결제 배열과 잔여 시간을 갱신한다', async () => {
    const router = renderPage('/payments/payment/edit');
    fireEvent.click(await screen.findByRole('button', { name: '결제 내역 삭제' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: '결제 내역을 삭제하시겠습니까?' })).getByRole('button', { name: '삭제', exact: true }));
    await screen.findByText('결제 목록');
    expect(deletePage).toHaveBeenCalledWith('payment');
    expect(screen.getByTestId('remaining').textContent).toBe('-2');
    expect(queryAll).toHaveBeenCalledTimes(2);
    router.dispose();
  });

  it('결제수단·결제일을 지운 폼은 null PATCH를 보내고 빈 결제일로 다시 열린다', async () => {
    const router = renderPage('/payments/payment/edit');
    await screen.findByRole('button', { name: '수정하기' });
    fireEvent.click(screen.getByRole('button', { name: '선택 지우기' }));
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '수정하기' }));
    await screen.findByText('결제 목록');
    expect(updatePage).toHaveBeenCalledWith('payment', expect.objectContaining({ 결제수단: { select: null }, 결제일: { date: null } }));
    paymentRows = [payment({ method: '', date: '' })];
    await act(async () => { await router.navigate('/payments/payment/edit'); });
    await screen.findByRole('button', { name: '수정하기' });
    expect(document.querySelector('input[type="date"]').value).toBe('');
    router.dispose();
  });
});
