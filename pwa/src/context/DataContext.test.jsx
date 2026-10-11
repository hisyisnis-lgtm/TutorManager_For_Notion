import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';

vi.mock('../api/students.js', () => ({ fetchAllStudents: vi.fn(), parseStudent: (value) => value }));
vi.mock('../api/classTypes.js', () => ({ fetchAllClassTypes: vi.fn(async () => []), parseClassType: (value) => value }));
vi.mock('../api/discounts.js', () => ({ fetchAllDiscounts: vi.fn(async () => []), parseDiscount: (value) => value }));
vi.mock('../api/payments.js', () => ({ fetchAllPayments: vi.fn(async () => []), parsePayment: (value) => value,
  remainingSessionsOf: (student, payments) => payments.reduce((sum, payment) => sum + payment.effectiveSessions, 0) - (student.usedSessions ?? 0) }));
import { fetchAllStudents } from '../api/students.js';
import { fetchAllPayments } from '../api/payments.js';
import { fetchAllClassTypes } from '../api/classTypes.js';
import { fetchAllDiscounts } from '../api/discounts.js';
import { DataProvider, useData } from './DataContext.jsx';

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.clearAllMocks();
  fetchAllPayments.mockImplementation(async () => []);
  fetchAllClassTypes.mockImplementation(async () => []);
  fetchAllDiscounts.mockImplementation(async () => []);
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.restoreAllMocks(); });

describe('강사 master 데이터 수명', () => {
  it('master 잔여 시간은 전체 페이지의 원장 속성만 요청한다', async () => {
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '학생', usedSessions: 2 }]);
    fetchAllPayments.mockResolvedValue([{ studentIds: ['fixture'], effectiveSessions: 10 }]);
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchAllPayments).toHaveBeenCalledWith(undefined, { ledgerOnly: true });
    expect(result.current.remainingByStudent.fixture).toBe(8);
  });

  it('원장 속성을 확인하지 못하면 최초 잔여 시간을 0으로 확정하지 않는다', async () => {
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '학생', usedSessions: 2 }]);
    fetchAllPayments.mockRejectedValue(new Error('결제 유효 시간 원장을 확인하지 못했어요.'));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.remainingByStudent).toEqual({});
    expect(result.current.refreshError).toBe('결제 유효 시간 원장을 확인하지 못했어요.');
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
  });

  it('원장 갱신 실패는 이전에 확인한 잔여 시간을 유지한다', async () => {
    sessionStorage.setItem('tutor_master_cache_v3', JSON.stringify({ savedAt: Date.now() - 1000, data: {
      students: [{ id: 'fixture', name: '이전 학생', usedSessions: 2 }], classTypes: [], discounts: [],
      payments: [{ studentIds: ['fixture'], effectiveSessions: 10 }],
    } }));
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '최신 학생', usedSessions: 4 }]);
    fetchAllPayments.mockRejectedValue(new Error('결제 유효 시간 원장을 확인하지 못했어요.'));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.refreshError).toBe('결제 유효 시간 원장을 확인하지 못했어요.'));
    expect(result.current.remainingByStudent.fixture).toBe(8);
    expect(result.current.stale).toBe(true);
    expect(result.current.refreshError).toBe('결제 유효 시간 원장을 확인하지 못했어요.');
  });

  it('1MiB를 넘는 master 캐시는 JSON 파싱 전에 제거하고 실제 조회를 진행한다', async () => {
    const oversized = ' '.repeat(512 * 1024 + 1);
    sessionStorage.setItem('tutor_master_cache_v3', oversized);
    const parse = vi.spyOn(JSON, 'parse');
    let respondStudents;
    fetchAllStudents.mockImplementation(() => new Promise(resolve => { respondStudents = resolve; }));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
    expect(parse.mock.calls.some(([value]) => value === oversized)).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(async () => respondStudents([{ id: 'fixture', name: '실제 조회 학생', usedSessions: 0 }]));
    expect(result.current.studentNameMap.fixture).toBe('실제 조회 학생');
    expect(result.current.loading).toBe(false);
  });

  it('1MiB 초과 응답은 이전 master 캐시를 지우고 최신 메모리 데이터를 유지한다', async () => {
    sessionStorage.setItem('tutor_master_cache_v3', JSON.stringify({ savedAt: Date.now() - 1000, data: {
      students: [{ id: 'fixture', name: '이전 학생', usedSessions: 2 }], classTypes: [], discounts: [],
      payments: [{ studentIds: ['fixture'], effectiveSessions: 10 }],
    } }));
    const memo = '가'.repeat(600000);
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '최신 학생', memo, usedSessions: 2 }]);
    fetchAllPayments.mockResolvedValue([{ studentIds: ['fixture'], effectiveSessions: 6 }]);
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.remainingByStudent.fixture).toBe(4));
    expect(result.current.students[0].memo?.length).toBe(memo.length);
    expect(result.current.remainingByStudent.fixture).toBe(4);
    expect(result.current.stale).toBe(false);
    expect(result.current.refreshError).toBeNull();
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
  });

  it('학생명과 유형은 먼저 공개하고 잔여 시간은 학생·결제가 함께 확인된 후 계산한다', async () => {
    let respondStudents; let respondPayments; let respondTypes; let respondDiscounts;
    fetchAllStudents.mockImplementation(() => new Promise(resolve => { respondStudents = resolve; }));
    fetchAllPayments.mockImplementation(() => new Promise(resolve => { respondPayments = resolve; }));
    fetchAllClassTypes.mockImplementation(() => new Promise(resolve => { respondTypes = resolve; }));
    fetchAllDiscounts.mockImplementation(() => new Promise(resolve => { respondDiscounts = resolve; }));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await act(async () => respondStudents([{ id: 'fixture', name: '빠른 학생', usedSessions: 2 }]));
    expect(result.current.studentNameMap.fixture).toBe('빠른 학생');
    expect(result.current.studentsReady).toBe(true);
    expect(result.current.studentsLoading).toBe(false);
    expect(result.current.remainingByStudent).toEqual({});
    expect(result.current.loading).toBe(true);
    await act(async () => respondTypes([{ id: 'type', title: '개인 수업' }]));
    expect(result.current.classTypeMap.type.title).toBe('개인 수업');
    await act(async () => respondPayments([{ studentIds: ['fixture'], effectiveSessions: 10 }]));
    expect(result.current.remainingByStudent.fixture).toBe(8);
    expect(result.current.loading).toBe(true);
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
    await act(async () => respondDiscounts([]));
    expect(result.current.loading).toBe(false);
    expect(sessionStorage.getItem('tutor_master_cache_v3')).not.toBeNull();
  });

  it('보조 정보가 실패해도 성공한 학생·잔여 시간은 공개하고 전체 캐시는 저장하지 않는다', async () => {
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '확인된 학생', usedSessions: 2 }]);
    fetchAllPayments.mockResolvedValue([{ studentIds: ['fixture'], effectiveSessions: 10 }]);
    fetchAllDiscounts.mockRejectedValue(new Error('할인 조회 실패'));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.studentNameMap.fixture).toBe('확인된 학생');
    expect(result.current.remainingByStudent.fixture).toBe(8);
    expect(result.current.refreshError).toBe('할인 조회 실패');
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
  });

  it('갱신 중에는 이전 잔여 시간을 유지하고 두 조회가 완료되면 함께 교체한다', async () => {
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '학생', usedSessions: 2 }]);
    fetchAllPayments.mockResolvedValue([{ studentIds: ['fixture'], effectiveSessions: 10 }]);
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.remainingByStudent.fixture).toBe(8);
    let respondPayments;
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '학생', usedSessions: 4 }]);
    fetchAllPayments.mockImplementation(() => new Promise(resolve => { respondPayments = resolve; }));
    let refresh;
    await act(async () => { refresh = result.current.refresh(); });
    expect(result.current.students[0].usedSessions).toBe(4);
    expect(result.current.remainingByStudent.fixture).toBe(8);
    await act(async () => { respondPayments([{ studentIds: ['fixture'], effectiveSessions: 10 }]); await refresh; });
    expect(result.current.remainingByStudent.fixture).toBe(6);
  });
  it('캐시가 있는 일부 조회 실패는 이전 데이터를 유지하고 재시도로 복구한다', async () => {
    const savedAt = Date.now() - 60000;
    sessionStorage.setItem('tutor_master_cache_v3', JSON.stringify({ savedAt, data: {
      students: [{ id: 'fixture', name: '이전 학생' }], classTypes: [], discounts: [], payments: [],
    } }));
    fetchAllStudents.mockRejectedValueOnce(new Error('최신 조회 실패')).mockResolvedValueOnce([{ id: 'fixture', name: '최신 학생' }]);
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.refreshError).toBe('최신 조회 실패'));
    expect(result.current.students[0].name).toBe('이전 학생');
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.lastSuccessAt).toBe(savedAt);
    await act(async () => result.current.refresh());
    expect(result.current.students[0].name).toBe('최신 학생');
    expect(result.current.refreshError).toBeNull();
    expect(result.current.stale).toBe(false);
    expect(result.current.lastSuccessAt).toBeGreaterThan(savedAt);
  });

  it('조회 결과는 현재 탭에만 저장하고 로그아웃하면 파생 맵까지 제거한다', async () => {
    fetchAllStudents.mockResolvedValue([{ id: 'fixture', name: '가상 학생', phone: 'fixture-only', status: '🟢 수강중' }]);
    const { result } = renderHook(useData, { wrapper: DataProvider });
    await waitFor(() => expect(result.current.students).toHaveLength(1));
    expect(localStorage.getItem('tutor_master_cache_v3')).toBeNull();
    expect(sessionStorage.getItem('tutor_master_cache_v3')).not.toBeNull();
    act(() => clearAuth());
    expect(result.current.students).toEqual([]);
    expect(result.current.studentNameMap).toEqual({});
    expect(result.current.remainingByStudent).toEqual({});
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
  });

  it('로그아웃 전에 시작한 master 조회가 늦게 완료돼도 개인정보를 다시 저장하지 않는다', async () => {
    let respond;
    fetchAllStudents.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const { result } = renderHook(useData, { wrapper: DataProvider });
    act(() => clearAuth());
    await act(async () => respond([{ id: 'fixture', name: '늦은 응답' }]));
    expect(result.current.students).toEqual([]);
    expect(sessionStorage.getItem('tutor_master_cache_v3')).toBeNull();
    expect(fetchAllStudents).toHaveBeenCalledOnce();
  });
});
