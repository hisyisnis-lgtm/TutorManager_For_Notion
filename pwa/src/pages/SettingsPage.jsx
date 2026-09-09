import {
  useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CaretRightIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import { Input } from '../components/shadcn/input';
import PageHeader from '../components/layout/PageHeader.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { clearAuth } from '../api/authUtils.js';
import { getNtfyTopic, saveNtfyTopic } from '../api/ntfy.js';
import { TEXT_SECONDARY,
  TEXT_TERTIARY,
  STATUS_ERROR_BORDER,
  STATUS_ERROR_TEXT,
  STATUS_SUCCESS_DARK } from '../constants/theme.js';

const STORAGE_KEY = 'instructor_name';

const SHARE_LINKS = [
  { key: 'intro', label: '홈페이지', path: '/intro' },
  { key: 'pricing', label: '수강료 안내', path: '/pricing' },
  { key: 'consent', label: '수업 동의서', path: '/#/consent' },
];

// 이름 미설정이면 빈 문자열 — 호출부가 "<이름> 강사님"으로 조립하므로
// 여기서 '강사님'을 폴백으로 주면 "강사님 강사님"이 된다.
export function getInstructorName() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export default function SettingsPage() {
  const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [topic, setTopic] = useState(getNtfyTopic);
  const [topicError, setTopicError] = useState('');
  const topicInputRef = useRef(null);
  const [saved, setSaved] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [updating, setUpdating] = useState(false);

  function copyLink(key, path) {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    });
  }

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
    } finally {
      window.location.reload();
    }
  };

  const handleSave = () => {
    try {
      setTopic(saveNtfyTopic(topic));
      setTopicError('');
    } catch (error) {
      setTopicError(error?.message || '알림 코드를 저장하지 못했어요. 다시 시도해 주세요.');
      setSaved(false);
      topicInputRef.current?.focus();
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName) {
      localStorage.setItem(STORAGE_KEY, trimmedName);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader title="설정" back />
      <div className="px-4 pt-6 space-y-6">
        <div>
          <label htmlFor="instructor-name" style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>강사 이름</label>
          <Input
            id="instructor-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            placeholder="강사 이름 입력"
            maxLength={20}
          />
          <p className="text-xs text-gray-500 mt-1.5">홈 화면 인사말에 표시됩니다.</p>
        </div>

        <div>
          <label htmlFor="ntfy-topic" style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>ntfy 알림 코드</label>
          <Input
            ref={topicInputRef}
            id="ntfy-topic"
            type="text"
            value={topic}
            onChange={(e) => { setTopic(e.target.value); setTopicError(''); setSaved(false); }}
            placeholder="ntfy 앱에서 구독한 토픽 코드"
            maxLength={128}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(topicError)}
            aria-describedby={`ntfy-topic-help${topicError ? ' ntfy-topic-error' : ''}`}
          />
          <div id="ntfy-topic-help" className="text-xs mt-1.5 space-y-1" style={{ color: TEXT_TERTIARY }}>
            <p>ntfy 앱에서 구독한 토픽 코드를 입력하면 같은 알림을 앱 알림함에서 볼 수 있어요.</p>
            <p>공개 토픽 코드를 아는 사람은 내용을 읽을 수 있으니 공유에 주의해 주세요. 비워서 저장하면 연결이 해제돼요.</p>
          </div>
          {topicError && <p id="ntfy-topic-error" role="alert" className="text-xs mt-1.5" style={{ color: STATUS_ERROR_TEXT }}>{topicError}</p>}
          <Button asChild variant="link" className="mt-1 px-0">
            <Link to="/notifications">알림함 보기</Link>
          </Button>
        </div>

        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>수업 설정</span>
          <Link
            to="/notices"
            className="press flex items-center gap-2 bg-white shadow-border rounded-2xl pl-3 pr-2.5 py-2.5 active:bg-gray-50 transition-[background-color] duration-150 ease-out mb-2"
            style={{ minHeight: 52, textDecoration: 'none' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm" style={{ color: TEXT_SECONDARY, margin: 0 }}>공지</p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_TERTIARY, margin: 0 }}>학생 앱 공지 탭에 올릴 내용을 관리해요</p>
            </div>
            <CaretRightIcon size={16} weight="bold" style={{ color: TEXT_TERTIARY, flexShrink: 0 }} />
          </Link>
          {/* 하단 탭에서 '숙제'에 자리를 내주고 여기로 내려온 화면. 라우트(/bookings)는 그대로다. */}
          <Link
            to="/bookings"
            className="press flex items-center gap-2 bg-white shadow-border rounded-2xl pl-3 pr-2.5 py-2.5 active:bg-gray-50 transition-[background-color] duration-150 ease-out"
            style={{ minHeight: 52, textDecoration: 'none' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm" style={{ color: TEXT_SECONDARY, margin: 0 }}>휴무·불가 시간</p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_TERTIARY, margin: 0 }}>휴무일·차단 시간대를 관리해요</p>
            </div>
            <CaretRightIcon size={16} weight="bold" style={{ color: TEXT_TERTIARY, flexShrink: 0 }} />
          </Link>
        </div>

        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>공유 링크</span>
          <div className="space-y-2">
            {SHARE_LINKS.map(({ key, label, path }) => (
              <div key={key} className="flex items-center gap-2 bg-white shadow-border rounded-2xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="text-xs text-gray-600 font-mono truncate">{window.location.origin}{path}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(key, path)}
                  className="press shrink-0 text-xs text-brand-600 border border-brand-100 rounded-lg px-3 min-h-[40px] flex items-center active:bg-brand-50 transition-[background-color] duration-150 ease-out"
                >
                  {copiedKey === key ? '복사됨' : '복사'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <Button
          block
          onClick={handleSave}
          // 저장 완료 상태만 성공색으로 — radius/height/weight는 우리 Button 기본값이라 뺐다
          style={saved ? { backgroundColor: STATUS_SUCCESS_DARK, borderColor: STATUS_SUCCESS_DARK } : undefined}
        >
          {saved ? '저장됨' : '저장'}
        </Button>

        <Button
          variant="outline"
          block
          onClick={handleUpdate}
          loading={updating}
        >
          업데이트 (강력 새로고침)
        </Button>

        <Button
          variant="destructiveOutline"
          block
          onClick={() => setConfirmLogout(true)}
          style={{ borderColor: STATUS_ERROR_BORDER }}
        >
          로그아웃
        </Button>

        <p className="text-center text-xs pt-4" style={{ color: TEXT_TERTIARY }}>v{__APP_VERSION__}</p>
      </div>

      {confirmLogout && (
        <ConfirmDialog
          title="로그아웃"
          message="로그아웃하면 다시 비밀번호를 입력해야 합니다."
          confirmLabel="로그아웃"
          // 서버 데이터는 보존하고 이 기기에 임시 저장한 개인정보만 정리한다.
          danger={false}
          onConfirm={() => {
            clearAuth();
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </>
  );
}
