import { createContext, useContext } from 'react';
export const StudentAppContext = createContext(null);
export const useStudentAppContext = () => useContext(StudentAppContext);
