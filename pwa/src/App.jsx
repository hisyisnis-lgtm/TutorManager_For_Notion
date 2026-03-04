import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DataProvider } from './context/DataContext.jsx';
import BottomNav from './components/layout/BottomNav.jsx';
import LoginPage from './pages/LoginPage.jsx';

import StudentsPage from './pages/StudentsPage.jsx';
import StudentDetailPage from './pages/StudentDetailPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import ClassFormPage from './pages/ClassFormPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import PaymentFormPage from './pages/PaymentFormPage.jsx';
import LessonLogsPage from './pages/LessonLogsPage.jsx';
import LessonLogFormPage from './pages/LessonLogFormPage.jsx';

function checkAuth() {
  return !!(sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token'));
}

export default function App() {
  const [authed, setAuthed] = useState(checkAuth);

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />;
  }

  return (
    <DataProvider>
      <HashRouter>
        <div className="page-container">
          <Routes>
            <Route path="/" element={<Navigate to="/students" replace />} />

            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/:id" element={<StudentDetailPage />} />

            <Route path="/classes" element={<ClassesPage />} />
            <Route path="/classes/new" element={<ClassFormPage />} />
            <Route path="/classes/:id/edit" element={<ClassFormPage />} />

            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/new" element={<PaymentFormPage />} />
            <Route path="/payments/:id/edit" element={<PaymentFormPage />} />

            <Route path="/logs" element={<LessonLogsPage />} />
            <Route path="/logs/:id/edit" element={<LessonLogFormPage />} />
          </Routes>
        </div>
        <BottomNav />
      </HashRouter>
    </DataProvider>
  );
}
