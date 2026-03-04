import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { fetchAllStudents, parseStudent } from '../api/students.js';
import { fetchAllClassTypes, parseClassType } from '../api/classTypes.js';
import { fetchAllDiscounts, parseDiscount } from '../api/discounts.js';

const DataContext = createContext(null);

const CACHE_KEY = 'tutor_master_cache_v1';

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
  const [loading, setLoading] = useState(!cached);
  const [stale, setStale] = useState(!!cached);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!stale) setLoading(true);
    setError(null);
    try {
      const [rawStudents, rawClassTypes, rawDiscounts] = await Promise.all([
        fetchAllStudents(),
        fetchAllClassTypes(),
        fetchAllDiscounts(),
      ]);
      const parsedStudents = rawStudents.map(parseStudent);
      const parsedClassTypes = rawClassTypes.map(parseClassType);
      const parsedDiscounts = rawDiscounts.map(parseDiscount);

      setStudents(parsedStudents);
      setClassTypes(parsedClassTypes);
      setDiscounts(parsedDiscounts);
      setStale(false);
      saveCache({ students: parsedStudents, classTypes: parsedClassTypes, discounts: parsedDiscounts });
    } catch (e) {
      if (!stale) setError(e.message);
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

  return (
    <DataContext.Provider
      value={{
        students,
        classTypes,
        discounts,
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
