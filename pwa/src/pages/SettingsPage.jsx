import { useState } from 'react';
import PageHeader from '../components/layout/PageHeader.jsx';

const STORAGE_KEY = 'instructor_name';

export function getInstructorName() {
  return localStorage.getItem(STORAGE_KEY) || '강사님';
}

export default function SettingsPage() {
  const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const trimmed = name.trim();
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader title="설정" back />
      <div className="px-4 pt-6 pb-8 space-y-6">
        <div>
          <label className="label">강사 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            placeholder="강사 이름 입력"
            className="input-field"
            maxLength={20}
          />
          <p className="text-xs text-gray-400 mt-1.5">홈 화면 인사말에 표시됩니다.</p>
        </div>

        <button
          onClick={handleSave}
          className={`btn-primary w-full transition-all ${saved ? 'bg-green-600 active:bg-green-700' : ''}`}
        >
          {saved ? '저장됨 ✓' : '저장'}
        </button>
      </div>
    </>
  );
}
