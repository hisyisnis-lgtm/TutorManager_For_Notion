import { useState } from 'react';
import PageHeader from '../components/layout/PageHeader.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';

const STORAGE_KEY = 'instructor_name';
const NTFY_TOPIC_KEY = 'ntfy_topic';

const SHARE_LINKS = [
  { key: 'intro', label: '랜딩 페이지 (홍보용)', path: '/#/intro' },
  { key: 'consult', label: '무료상담 신청', path: '/#/consult' },
  { key: 'book', label: '학생 예약코드 입력', path: '/#/book' },
];

export function getInstructorName() {
  return localStorage.getItem(STORAGE_KEY) || '강사님';
}

export function getNtfyTopic() {
  return localStorage.getItem(NTFY_TOPIC_KEY) || '';
}

export default function SettingsPage() {
  const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [ntfyTopic, setNtfyTopic] = useState(() => localStorage.getItem(NTFY_TOPIC_KEY) || '');
  const [saved, setSaved] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  function copyLink(key, path) {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    });
  }

  const handleSave = () => {
    const trimmedName = name.trim();
    if (trimmedName) {
      localStorage.setItem(STORAGE_KEY, trimmedName);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    const trimmedTopic = ntfyTopic.trim();
    if (trimmedTopic) {
      localStorage.setItem(NTFY_TOPIC_KEY, trimmedTopic);
    } else {
      localStorage.removeItem(NTFY_TOPIC_KEY);
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

        <div>
          <label className="label">ntfy 토픽</label>
          <input
            type="text"
            value={ntfyTopic}
            onChange={(e) => { setNtfyTopic(e.target.value); setSaved(false); }}
            placeholder="예) tutor-alerts"
            className="input-field"
            maxLength={64}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <p className="text-xs text-gray-400 mt-1.5">
            ntfy.sh/<span className="font-mono">{ntfyTopic || '토픽명'}</span> 으로 알림을 받습니다.
          </p>
        </div>

        <div>
          <label className="label">공유 링크</label>
          <div className="space-y-2">
            {SHARE_LINKS.map(({ key, label, path }) => (
              <div key={key} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className="text-xs text-gray-600 font-mono truncate">{window.location.origin}{path}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(key, path)}
                  className="shrink-0 text-xs text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1 active:bg-blue-50"
                >
                  {copiedKey === key ? '복사됨 ✓' : '복사'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          className={`btn-primary w-full transition-all ${saved ? 'bg-green-600 active:bg-green-700' : ''}`}
        >
          {saved ? '저장됨 ✓' : '저장'}
        </button>

        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          className="w-full py-3 rounded-xl text-sm font-medium border border-red-200 text-red-500 active:bg-red-50"
        >
          로그아웃
        </button>

        <p className="text-center text-xs text-gray-300 pt-4">v{__APP_VERSION__}</p>
      </div>

      {confirmLogout && (
        <ConfirmDialog
          title="로그아웃"
          message="로그아웃하면 다시 비밀번호를 입력해야 합니다."
          confirmLabel="로그아웃"
          onConfirm={() => {
            sessionStorage.removeItem('auth_token');
            localStorage.removeItem('auth_token');
            window.location.reload();
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </>
  );
}
