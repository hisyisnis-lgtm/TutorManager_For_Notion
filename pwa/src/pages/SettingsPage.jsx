import {
  useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellIcon, CaretRightIcon } from '@phosphor-icons/react';
import { Button } from '../components/shadcn/button';
import { Input } from '../components/shadcn/input';
import PageHeader from '../components/layout/PageHeader.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { clearAuth } from '../api/authUtils.js';
import { disablePushNotifications, enablePushNotifications, getPushStatus } from '../api/pushNotifications.js';
import { TEXT_SECONDARY,
  TEXT_TERTIARY,
  STATUS_ERROR_BORDER,
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
  const [saved, setSaved] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [updating, setUpdating] = useState(false);
  const [pushState, setPushState] = useState('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    let active = true;
    getPushStatus().then(({ state }) => { if (active) setPushState(state); })
      .catch((error) => { if (active) { setPushState('error'); setPushError(error.message); } });
    return () => { active = false; };
  }, []);

  const handlePushToggle = async () => {
    setPushBusy(true);
    setPushError('');
    try {
      const result = pushState === 'enabled'
        ? await disablePushNotifications()
        : await enablePushNotifications();
      setPushState(result.state);
    } catch (error) {
      setPushError(error.message);
      setPushState(error.message.includes('권한') ? 'denied' : 'error');
    } finally {
      setPushBusy(false);
    }
  };

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
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>강사 이름</span>
          <Input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            placeholder="강사 이름 입력"
            maxLength={20}
          />
          <p className="text-xs text-gray-500 mt-1.5">홈 화면 인사말에 표시됩니다.</p>
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
          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY, display: 'block', marginBottom: 6 }}>알림 설정</span>
          <div className="bg-white shadow-border rounded-2xl p-3">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                <BellIcon size={20} weight="fill" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: TEXT_SECONDARY }}>이 기기 푸시 알림</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: TEXT_TERTIARY }}>
                  {{
                    loading: '현재 알림 상태를 확인하고 있어요.',
                    enabled: '수업·상담·숙제의 상세 알림을 받고 있어요.',
                    disabled: '앱을 닫아도 상세 알림을 받을 수 있어요.',
                    denied: '기기 설정에서 이 앱의 알림 권한을 허용해주세요.',
                    unsupported: '이 기기에서는 Web Push를 지원하지 않아요.',
                    unconfigured: '서버 알림 설정이 아직 완료되지 않았어요.',
                    error: pushError || '알림 상태를 확인하지 못했어요.',
                  }[pushState]}
                </p>
              </div>
            </div>
            {!['loading', 'unsupported', 'unconfigured', 'denied'].includes(pushState) && (
              <Button
                variant={pushState === 'enabled' ? 'outline' : 'default'}
                block
                className="mt-3"
                loading={pushBusy}
                onClick={handlePushToggle}
              >
                {pushState === 'enabled' ? '이 기기 알림 끄기' : '이 기기 알림 받기'}
              </Button>
            )}
          </div>
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
