import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { fetchAllStudents, parseStudent } from '../api/students.js';
import { fetchAllClassTypes, parseClassType } from '../api/classTypes.js';
import { fetchAllDiscounts, parseDiscount } from '../api/discounts.js';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [students, setStudents] = useState([]);
  const [classTypes, setClassTypes] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rawStudents, rawClassTypes, rawDiscounts] = await Promise.all([
        fetchAllStudents(),
        fetchAllClassTypes(),
        fetchAllDiscounts(),
      ]);
      setStudents(rawStudents.map(parseStudent));
      setClassTypes(rawClassTypes.map(parseClassType));
      setDiscounts(rawDiscounts.map(parseDiscount));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** ID → 이름 빠른 조회 */
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
