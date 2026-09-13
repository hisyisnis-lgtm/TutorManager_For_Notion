import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { captureAuthScope, isAuthScopeCurrent, getAuthRevision, subscribeAuthChanges, SENSITIVE_CACHE_TTL } from '../api/authState.js';
import { fetchAllStudents, parseStudent } from '../api/students.js';
import { fetchAllClassTypes, parseClassType } from '../api/classTypes.js';
import { fetchAllDiscounts, parseDiscount } from '../api/discounts.js';
import { fetchAllPayments, parsePayment, remainingSessionsOf } from '../api/payments.js';
import { trackRevalidation, pruneRevalidations } from '../hooks/useCachedResource.js';

const DataContext = createContext(null);

const CACHE_KEY = 'tutor_master_cache_v3';

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
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
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
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
  const hasData = useRef(!!cached);

  const load = useCallback(async () => {
    const auth = captureAuthScope();
    if (!isAuthScopeCurrent(auth)) return;
    const request = ++requestId.current;
    if (!hasData.current) setLoading(true);
    setError(null);
    try {
      const [rawStudents, rawClassTypes, rawDiscounts, rawPayments] = await trackRevalidation(() => Promise.all([
        fetchAllStudents(),
        fetchAllClassTypes(),
        fetchAllDiscounts(),
        fetchAllPayments(),
      ]), { key: 'master', label: '학생·수강 정보', global: true, lastSuccessAt: loadCache()?.savedAt,
        retry: () => load(), isCurrent: () => request === requestId.current && isAuthScopeCurrent(auth) });
      if (request !== requestId.current || !isAuthScopeCurrent(auth)) return;
      const parsedStudents = rawStudents.map(parseStudent);
      const parsedClassTypes = rawClassTypes.map(parseClassType);
      const parsedDiscounts = rawDiscounts.map(parseDiscount);
      const parsedPayments = rawPayments.map(parsePayment);

      setStudents(parsedStudents);
      setClassTypes(parsedClassTypes);
      setDiscounts(parsedDiscounts);
      setPayments(parsedPayments);
      setStale(false);
      hasData.current = true;
      setRefreshError(null);
      setLastSuccessAt(Date.now());
      saveCache({ students: parsedStudents, classTypes: parsedClassTypes, discounts: parsedDiscounts, payments: parsedPayments }, auth);
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

  // 학생별 잔여 시간(60분=1) — Notion 롤업이 환불을 반영하지 않아 결제 데이터로 직접 계산한다.
  // (근거는 payments.js remainingSessionsOf 주석)
  const paymentsByStudent = {};
  for (const p of payments) {
    for (const sid of p.studentIds) (paymentsByStudent[sid] ??= []).push(p);
  }
  const remainingByStudent = Object.fromEntries(
    students.map((s) => [s.id, remainingSessionsOf(s, paymentsByStudent[s.id] ?? [])])
  );

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
