import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { fetchAllStudents, parseStudent } from '../api/students.js';
import { fetchAllClassTypes, parseClassType } from '../api/classTypes.js';
import { fetchAllDiscounts, parseDiscount } from '../api/discounts.js';
import { fetchAllPayments, parsePayment, remainingSessionsOf } from '../api/payments.js';

const DataContext = createContext(null);

const CACHE_KEY = 'tutor_master_cache_v2';

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
}

export function DataProvider({ children }) {
  const cached = loadCache();

  const [students, setStudents] = useState(cached?.students ?? []);
  const [classTypes, setClassTypes] = useState(cached?.classTypes ?? []);
  const [discounts, setDiscounts] = useState(cached?.discounts ?? []);
  const [payments, setPayments] = useState(cached?.payments ?? []);
  const [loading, setLoading] = useState(!cached);
  const [stale, setStale] = useState(!!cached);
  // stale은 load가 useCallback([])이라 클로저에 갇힌다. 캐시로 시작한 세션에서 이후 조회
  // 실패가 영원히 조용히 무시되던 원인이라, 현재 값을 보도록 ref로 함께 들고 있는다.
  const staleRef = useRef(!!cached);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!staleRef.current) setLoading(true);
    setError(null);
    try {
      const [rawStudents, rawClassTypes, rawDiscounts, rawPayments] = await Promise.all([
        fetchAllStudents(),
        fetchAllClassTypes(),
        fetchAllDiscounts(),
        fetchAllPayments(),
      ]);
      const parsedStudents = rawStudents.map(parseStudent);
      const parsedClassTypes = rawClassTypes.map(parseClassType);
      const parsedDiscounts = rawDiscounts.map(parseDiscount);
      const parsedPayments = rawPayments.map(parsePayment);

      setStudents(parsedStudents);
      setClassTypes(parsedClassTypes);
      setDiscounts(parsedDiscounts);
      setPayments(parsedPayments);
      setStale(false);
      staleRef.current = false;
      saveCache({ students: parsedStudents, classTypes: parsedClassTypes, discounts: parsedDiscounts, payments: parsedPayments });
    } catch (e) {
      if (!staleRef.current) setError(e.message);
      // 캐시가 있으면 오류를 표시하지 않고 캐시 데이터 유지
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <DataContext.Provider
      value={{
        students,
        classTypes,
        discounts,
        payments,
        remainingByStudent,
        loading,
        stale,
        error,
        refresh: load,
        studentNameMap,
        classTypeMap,
        activeStudents,
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
