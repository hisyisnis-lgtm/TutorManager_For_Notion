import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { captureAuthScope, isAuthScopeCurrent, getAuthRevision, subscribeAuthChanges, SENSITIVE_CACHE_TTL } from '../api/authState.js';
import { fetchAllStudents, parseStudent } from '../api/students.js';
import { fetchAllClassTypes, parseClassType } from '../api/classTypes.js';
import { fetchAllDiscounts, parseDiscount } from '../api/discounts.js';
import { fetchAllPayments, parsePayment, remainingSessionsOf } from '../api/payments.js';
import { trackRevalidation, pruneRevalidations } from '../hooks/useCachedResource.js';

const DataContext = createContext(null);

const CACHE_KEY = 'tutor_master_cache_v3';
const MAX_CACHE_BYTES = 1024 * 1024;

// Notion 롤업이 환불을 반영하지 않아 학생·결제를 함께 확인한 뒤 직접 계산한다.
function remainingMap(students, payments) {
  const paymentsByStudent = {};
  for (const payment of payments) {
    for (const id of payment.studentIds) (paymentsByStudent[id] ??= []).push(payment);
  }
  return Object.fromEntries(students.map((student) => [student.id,
    remainingSessionsOf(student, paymentsByStudent[student.id] ?? [])]));
}

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw && raw.length * 2 > MAX_CACHE_BYTES) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    const cache = raw ? JSON.parse(raw) : null;
    if (!isAuthScopeCurrent(captureAuthScope()) || !Number.isFinite(cache?.savedAt)
      || Date.now() - cache.savedAt > SENSITIVE_CACHE_TTL || cache.savedAt > Date.now()) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function saveCache(data, auth) {
  if (!isAuthScopeCurrent(auth)) return;
  try {
    const serialized = JSON.stringify({ savedAt: Date.now(), data });
    if (serialized.length * 2 > MAX_CACHE_BYTES) {
      sessionStorage.removeItem(CACHE_KEY);
      return;
    }
    sessionStorage.setItem(CACHE_KEY, serialized);
  } catch {}
}

export function DataProvider({ children }) {
  const revision = useSyncExternalStore(subscribeAuthChanges, getAuthRevision, () => 0);
  const [cachedEntry] = useState(loadCache);
  const cached = cachedEntry?.data;
  const dataRevision = useRef(revision);
  const requestId = useRef(0);

  const [students, setStudents] = useState(cached?.students ?? []);
  const [classTypes, setClassTypes] = useState(cached?.classTypes ?? []);
  const [discounts, setDiscounts] = useState(cached?.discounts ?? []);
  const [payments, setPayments] = useState(cached?.payments ?? []);
  const [loading, setLoading] = useState(!cached);
  const [stale, setStale] = useState(!!cached);
  const [error, setError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [lastSuccessAt, setLastSuccessAt] = useState(cachedEntry?.savedAt ?? null);
  const [ready, setReady] = useState({ students: !!cached, classTypes: !!cached, discounts: !!cached, payments: !!cached });
  const [remainingByStudent, setRemainingByStudent] = useState(() => cached ? remainingMap(cached.students ?? [], cached.payments ?? []) : {});
  const hasData = useRef(!!cached);

  const load = useCallback(async () => {
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    const request = ++requestId.current;
    if (!hasData.current) setLoading(true);
    setError(null);
    try {
      const fresh = {};
      const isCurrent = () => request === requestId.current && isAuthScopeCurrent(auth);
      const publish = async (key, fetcher, parse, setValue) => {
        const values = (await fetcher()).map(parse);
        if (!isCurrent()) return;
        fresh[key] = values;
        setValue(values);
        setReady((previous) => ({ ...previous, [key]: true }));
        // 새 학생 목록만으로 잔여 시간을 계산하면 아직 조회 중인 결제가 0으로 처리된다.
        // 학생·결제가 함께 확인되기 전에는 이전 계산값을 유지한다.
        if ((key === 'students' || key === 'payments') && fresh.students && fresh.payments) {
          setRemainingByStudent(remainingMap(fresh.students, fresh.payments));
        }
      };
      await trackRevalidation(async () => {
        const results = await Promise.allSettled([
          publish('students', fetchAllStudents, parseStudent, setStudents),
          publish('payments', () => fetchAllPayments(undefined, { ledgerOnly: true }), parsePayment, setPayments),
          publish('classTypes', fetchAllClassTypes, parseClassType, setClassTypes),
          publish('discounts', fetchAllDiscounts, parseDiscount, setDiscounts),
        ]);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
      }, { key: 'master', label: '학생·수강 정보', global: true, lastSuccessAt: loadCache()?.savedAt,
        retry: () => load(), isCurrent: () => request === requestId.current && isAuthScopeCurrent(auth) });
      if (request !== requestId.current || !isAuthScopeCurrent(auth)) return;
      setStale(false);
      hasData.current = true;
      setRefreshError(null);
      setLastSuccessAt(Date.now());
      saveCache(fresh, auth);
    } catch (e) {
      if (request !== requestId.current || !isAuthScopeCurrent(auth)) return;
      if (!hasData.current) setError(e.message);
      setRefreshError(e.message || '최신 정보를 확인하지 못했어요.');
      setStale(hasData.current);
    } finally {
      if (request === requestId.current && isAuthScopeCurrent(auth)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataRevision.current !== revision) {
      setStudents([]); setClassTypes([]); setDiscounts([]); setPayments([]);
      setReady({ students: false, classTypes: false, discounts: false, payments: false });
      setRemainingByStudent({});
      setStale(false); setError(null);
      hasData.current = false; setRefreshError(null); setLastSuccessAt(null);
      dataRevision.current = revision;
    }
    load();
    return () => { requestId.current += 1; pruneRevalidations(); };
  }, [load, revision]);

  const studentNameMap = Object.fromEntries(students.map((s) => [s.id, s.name]));
  const classTypeMap = Object.fromEntries(classTypes.map((ct) => [ct.id, ct]));
  const activeStudents = students.filter((s) => s.status === '🟢 수강중');

  const current = dataRevision.current === revision && isAuthScopeCurrent(captureAuthScope());
  return (
    <DataContext.Provider
      value={{
        students: current ? students : [],
        classTypes: current ? classTypes : [],
        discounts: current ? discounts : [],
        payments: current ? payments : [],
        remainingByStudent: current ? remainingByStudent : {},
        loading,
        studentsReady: current && ready.students,
        classTypesReady: current && ready.classTypes,
        studentsLoading: loading && !ready.students,
        stale,
        error,
        refreshError,
        lastSuccessAt,
        refresh: load,
        studentNameMap: current ? studentNameMap : {},
        classTypeMap: current ? classTypeMap : {},
        activeStudents: current ? activeStudents : [],
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
