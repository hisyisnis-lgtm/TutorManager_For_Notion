import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { setAuth, clearAuth } from '../api/authUtils.js';
import { notifyAuthChange } from '../api/authState.js';
import { fixtureSession } from '../api/authFixtures.js';

vi.mock('../api/students.js', () => ({ fetchAllStudents: vi.fn(), parseStudent: (value) => value }));
vi.mock('../api/classTypes.js', () => ({ fetchAllClassTypes: vi.fn(async () => []), parseClassType: (value) => value }));
vi.mock('../api/discounts.js', () => ({ fetchAllDiscounts: vi.fn(async () => []), parseDiscount: (value) => value }));
vi.mock('../api/payments.js', () => ({ fetchAllPayments: vi.fn(async () => []), parsePayment: (value) => value, remainingSessionsOf: () => 0 }));
import { fetchAllStudents } from '../api/students.js';
import { DataProvider, useData } from './DataContext.jsx';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); vi.clearAllMocks(); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); });

describe('강사 master 데이터 수명', () => {
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
