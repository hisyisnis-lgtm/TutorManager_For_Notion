import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { fixtureSession } from '../../api/authFixtures.js';
import { setAuth } from '../../api/authUtils.js';
import { notifyAuthChange, SENSITIVE_CACHE_TTL } from '../../api/authState.js';
import { peekCache } from '../../hooks/useCachedResource.js';
import { queryAll, queryPage } from '../../api/notionClient.js';
import IncomeSummary from './IncomeSummary.jsx';

vi.mock('../../api/notionClient.js', () => ({ queryAll: vi.fn(), queryPage: vi.fn() }));
vi.mock('../../api/payments.js', () => ({ PAYMENTS_DB: 'payments', parsePayment: (payment) => payment }));
vi.mock('../../api/classes.js', () => ({ CLASSES_DB: 'classes', parseClass: (cls) => cls }));
const fixture = vi.hoisted(() => ({ data: null }));
vi.mock('../../context/DataContext.jsx', () => ({ useData: () => fixture.data }));

const forecastKey = 'payments:forecastInputs:v1:2026-10-11';
const student = { id: 'student', name: '가상 학생', status: '🟢 수강중' };
const classType = { id: 'type', title: '개인 수업' };
const payments = (amount = 300000) => ['2026-09-25', '2026-08-25'].map((paymentDate, index) => ({
  id: `payment-${index}`, studentIds: ['student'], classTypeId: 'type',
  paymentDate, actualAmount: amount, unitPrice: 50000, discountRate: 0,
}));
const inputs = (amount = 300000) => ({ payments: payments(amount), futureClasses: [] });
function context(overrides = {}) {
  const value = { students: [student], classTypes: [classType], studentsReady: true, classTypesReady: true, ...overrides };
  return { ...value, studentNameMap: Object.fromEntries(value.students.map((s) => [s.id, s.name])),
    classTypeMap: Object.fromEntries(value.classTypes.map((type) => [type.id, type])) };
}
function cache(value, age = 60000) {
  sessionStorage.setItem(`swr_${forecastKey}`, JSON.stringify({ savedAt: Date.now() - age, value }));
}
const forecastButton = (bucket = '다음') => screen.getByRole('button', { name: new RegExp(`예상 ${bucket} 달`) });
const never = () => new Promise(() => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T03:00:00Z'));
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.clearAllMocks();
  fixture.data = context();
  queryAll.mockResolvedValue([]);
  queryPage.mockImplementation(never);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.useRealTimers(); });

describe('결제 예상 수입의 캐시와 준비 상태', () => {
  it('재방문은 갱신 응답을 기다리지 않고 기존 입력으로 이번 달·다음 달 예측을 표시한다', () => {
    cache(inputs());
    sessionStorage.setItem('swr_payments:monthSummary', JSON.stringify({ savedAt: Date.now(), value: [] }));
    render(<IncomeSummary />);
    expect(forecastButton('이번').textContent).toContain('₩300,000');
    expect(forecastButton().textContent).toContain('₩300,000');
    expect(forecastButton().disabled).toBe(false);
    expect(queryPage).toHaveBeenCalledTimes(2);
  });

  it('학생 도착 후 유형과 예측 입력을 병렬 조회하되 유형 전에는 체험 결제를 예측하지 않는다', async () => {
    fixture.data = context({ students: [], classTypes: [], studentsReady: false, classTypesReady: false });
    queryPage.mockImplementation(async (db) => ({ results: db === 'payments' ? payments() : [] }));
    const view = render(<IncomeSummary />);
    expect(queryPage).not.toHaveBeenCalled();
    fixture.data = context({ classTypes: [], classTypesReady: false });
    view.rerender(<IncomeSummary />);
    await waitFor(() => expect(peekCache(forecastKey)).toEqual(inputs()));
    expect(queryPage).toHaveBeenCalledTimes(2);
    expect(forecastButton().disabled).toBe(true);
    expect(forecastButton().textContent).not.toContain('₩');
    fixture.data = context({ classTypes: [{ ...classType, title: '체험수업' }] });
    view.rerender(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩0');
    expect(forecastButton().disabled).toBe(false);
    expect(queryPage).toHaveBeenCalledTimes(2);
  });

  it('학생 상태·유형이 바뀌면 캐시 입력을 다시 계산하고 활성 학생이 없을 때도 0으로 완료한다', () => {
    cache(inputs());
    const view = render(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩300,000');
    fixture.data = context({ classTypes: [{ ...classType, title: '원데이클래스' }] });
    view.rerender(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩0');
    expect(queryPage).toHaveBeenCalledTimes(2);
    fixture.data = context({ students: [{ ...student, status: '⚪ 휴강중' }] });
    view.rerender(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩0');
    expect(forecastButton().disabled).toBe(false);
    fixture.data = context();
    view.rerender(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩300,000');
  });

  it('입력 재조회가 실패해도 기존 계산액·캐시를 유지한다', async () => {
    cache(inputs());
    queryPage.mockRejectedValue(new Error('예측 조회 실패'));
    render(<IncomeSummary />);
    await waitFor(() => expect(queryPage).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(forecastButton().textContent).toContain('₩300,000');
    expect(screen.queryByText('계산 실패 · 새로고침')).toBeNull();
    expect(peekCache(forecastKey)).toEqual(inputs());
  });

  it('ref.reload는 두 예측 조회와 월 집계를 다시 받아 최신 계산액으로 교체한다', async () => {
    cache(inputs());
    const ref = createRef();
    render(<IncomeSummary ref={ref} />);
    queryPage.mockImplementation(async (db) => ({ results: db === 'payments' ? payments(600000) : [] }));
    queryAll.mockResolvedValue([{ id: 'confirmed', actualAmount: 200000, refundAmount: 50000 }]);
    await act(async () => ref.current.reload());
    expect(queryPage).toHaveBeenCalledTimes(4);
    expect(queryAll).toHaveBeenCalledTimes(2);
    expect(forecastButton('이번').textContent).toContain('₩750,000');
    expect(forecastButton().textContent).toContain('₩600,000');
    expect(peekCache(forecastKey)).toEqual(inputs(600000));
  });

  it('15분이 지난 입력은 예측액으로 표시하지 않고 첫 조회 실패를 0과 구분한다', async () => {
    cache(inputs(), SENSITIVE_CACHE_TTL + 1);
    queryPage.mockRejectedValue(new Error('첫 예측 조회 실패'));
    render(<IncomeSummary />);
    expect(forecastButton().disabled).toBe(true);
    expect(forecastButton().textContent).not.toContain('₩300,000');
    await waitFor(() => expect(forecastButton().textContent).toContain('계산 실패 · 새로고침'));
    expect(forecastButton().textContent).not.toContain('₩0');
    expect(peekCache(forecastKey)).toBeUndefined();
  });

  it('유형 준비가 해제된 동안 이전 계산액을 다시 노출하지 않는다', () => {
    cache(inputs());
    const view = render(<IncomeSummary />);
    expect(forecastButton().textContent).toContain('₩300,000');
    fixture.data = context({ classTypes: [], classTypesReady: false });
    view.rerender(<IncomeSummary />);
    expect(forecastButton().disabled).toBe(true);
    expect(forecastButton().textContent).not.toContain('₩300,000');
  });
});

describe('차트 조회 결과로 월 수입 공유', () => {
  it('별도 월 조회 없이 KST 월 경계와 환불을 적용해 전체 차트 데이터에서 월 수입을 계산한다', () => {
    cache(inputs());
    const data = [
      { paymentDate: '2026-10-11', actualAmount: 200000, refundAmount: 50000 },
      { paymentDate: '2026-09-30T16:00:00Z', actualAmount: 100000 },
      { paymentDate: '2026-09-30', actualAmount: 800000 },
      { paymentDate: '2026-10-31T15:00:00Z', actualAmount: 900000 },
      { actualAmount: 700000 },
    ];
    render(<IncomeSummary paymentsResource={{ data, loading: false }} />);
    expect(screen.getByRole('button', { name: /이번 달 결제 수입/ }).textContent).toContain('₩250,000');
    expect(queryAll).not.toHaveBeenCalled();
  });

  it('차트 첫 조회 중 월 수입과 이번 달 합계를 0으로 확정하지 않고 다음 달 예측은 표시한다', () => {
    cache(inputs());
    render(<IncomeSummary paymentsResource={{ data: undefined, loading: true }} />);
    expect(screen.getByRole('button', { name: /이번 달 결제 수입/ }).textContent).toContain('확인 중');
    expect(screen.getByRole('button', { name: /이번 달 결제 수입/ }).textContent).not.toContain('₩0');
    expect(forecastButton('이번').disabled).toBe(true);
    expect(forecastButton().textContent).toContain('₩300,000');
    expect(queryAll).not.toHaveBeenCalled();
  });

  it('공유 조회 실패와 갱신 실패를 구분하고 캐시가 있는 월 수입은 유지한다', () => {
    cache(inputs());
    const view = render(<IncomeSummary paymentsResource={{ data: undefined, loading: false, error: '조회 실패' }} />);
    expect(screen.getByRole('button', { name: /이번 달 결제 수입/ }).textContent).toContain('확인 실패');
    expect(forecastButton('이번').textContent).not.toContain('₩');
    view.rerender(<IncomeSummary paymentsResource={{ data: [{ paymentDate: '2026-10-11', actualAmount: 50000 }], loading: false, refreshError: '갱신 실패' }} />);
    expect(screen.getByRole('button', { name: /이번 달 결제 수입/ }).textContent).toContain('₩50,000');
    expect(queryAll).not.toHaveBeenCalled();
  });

  it('상위 화면이 공유 조회를 갱신하며 카드 reload는 예측만 갱신해 중복 월 요청을 만들지 않는다', async () => {
    cache(inputs());
    const ref = createRef();
    const refresh = vi.fn();
    render(<IncomeSummary ref={ref} paymentsResource={{ data: [], loading: false, refresh }} />);
    queryPage.mockImplementation(async (db) => ({ results: db === 'payments' ? payments(600000) : [] }));
    await act(async () => ref.current.reload());
    expect(queryAll).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(queryPage).toHaveBeenCalledTimes(4);
    expect(forecastButton().textContent).toContain('₩600,000');
  });
});
