import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../components/shadcn/button';
import PageHeader from '../components/layout/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { WORKER_URL } from '../config.js';
import { clearAuth } from '../api/authUtils.js';
import { captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges } from '../api/authState.js';
import { BellIcon } from '@phosphor-icons/react';
import { TEXT_TERTIARY,
  TEXT_INACTIVE, BORDER_NEUTRAL } from '../constants/theme.js';

const STORAGE_KEY = 'teacher_push_notifications';
const LAST_READ_KEY = 'teacher_push_last_read';
const MAX_NOTIFICATIONS = 100;

const PRIORITY_STYLE = {
  1: { bar: 'bg-gray-300', label: '최소', text: 'text-gray-400' },
  2: { bar: 'bg-gray-400', label: '낮음', text: 'text-gray-500' },
  3: { bar: 'bg-blue-500', label: '보통', text: 'text-blue-500' },
  4: { bar: 'bg-orange-500', label: '높음', text: 'text-orange-500' },
  5: { bar: 'bg-red-500', label: '긴급', text: 'text-red-500' },
};

function loadNotifications() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveNotifications(list) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_NOTIFICATIONS)));
}

function mergeNotifications(existing, incoming) {
  const ids = new Set(existing.map((n) => n.id));
  const merged = [...existing];
  for (const n of incoming) {
    if (!ids.has(n.id)) {
      ids.add(n.id);
      merged.push(n);
    }
  }
  return merged.sort((a, b) => b.time - a.time);
}

function relativeTime(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState(loadNotifications);
  const [connStatus, setConnStatus] = useState('connecting'); // connecting | connected | error | off
  const authRef = useRef(captureAuthScope());
  const selectedId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
  const selectedRef = useRef(null);

  useEffect(() => {
    if (!selectedId || !selectedRef.current) return;
    selectedRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [notifications, selectedId]);

  // 페이지 진입 시 읽음 처리
  useEffect(() => {
    if (isAuthScopeCurrent(authRef.current)) sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
  }, []);

  const addNotifications = useCallback((incoming) => {
    if (!isAuthScopeCurrent(authRef.current)) return;
    setNotifications((prev) => {
      if (!isAuthScopeCurrent(authRef.current)) return [];
      const merged = mergeNotifications(prev, incoming);
      saveNotifications(merged);
      return merged;
    });
  }, []);

  // D1 히스토리 로드. 열린 앱에는 서비스 워커가 push 메시지를 직접 전달하고,
  // 포커스 복귀/주기 갱신으로 닫혀 있던 동안의 알림도 보충한다.
  useEffect(() => {
    const auth = authRef.current;
    if (!isAuthScopeCurrent(auth)) return;
    let cancelled = false;
    const controller = new AbortController();
    let refreshTimer;
    const current = () => !cancelled && isAuthScopeCurrent(auth);
    const unsubscribe = subscribeAuthChanges(() => {
      if (!isAuthScopeCurrent(auth)) {
        cancelled = true;
        controller.abort();
        clearInterval(refreshTimer);
        setNotifications([]);
      }
    });
    const receive = (line) => {
      if (!current()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'message') {
          sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
          addNotifications([msg]);
        }
      } catch { /* 빈 heartbeat·잘못된 줄은 표시하지 않는다. */ }
    };
    const load = async () => {
      try {
        const res = await fetch(`${WORKER_URL}/notifications`, {
        headers: { Authorization: `Bearer ${auth.credential}` },
        cache: 'no-store', signal: controller.signal,
        });
        if (res.status === 401 && current()) clearAuth();
        if (!res.ok) {
          const error = new Error('알림을 불러오지 못했습니다.');
          error.status = res.status;
          throw error;
        }
        const text = await res.text();
        if (!current()) return;
        text.split('\n').filter(Boolean).forEach(receive);
        setConnStatus('connected');
      } catch (error) {
        if (!current()) return;
        if (error.status === 503) { setConnStatus('off'); return; }
        setConnStatus('error');
      }
    };
    const onPushMessage = (event) => {
      if (event.data?.type === 'teacher-push' && event.data.notification) addNotifications([event.data.notification]);
    };
    const onFocus = () => { if (current()) load(); };
    load();
    refreshTimer = setInterval(load, 60000);
    navigator.serviceWorker?.addEventListener('message', onPushMessage);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(refreshTimer);
      controller.abort();
      navigator.serviceWorker?.removeEventListener('message', onPushMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, [addNotifications]);

  const handleClearAll = () => {
    setNotifications([]);
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
  };

  const statusDot = {
    connecting: 'bg-yellow-400',
    connected: 'bg-green-500',
    error: 'bg-red-500',
    off: 'bg-gray-300',
  }[connStatus];

  const statusLabel = {
    connecting: '연결 중',
    connected: '연결됨',
    error: '연결 오류',
    off: '알림 내역 이용 불가',
  }[connStatus];

  if (connStatus === 'off') {
    return (
      <>
        <PageHeader title="알림" back />
        <div className="flex flex-col items-center justify-center px-8 pt-24 gap-4 text-center">
          <span className="text-5xl">🔔</span>
          <p className="text-gray-700 font-semibold">알림 상세 내역을 표시할 수 없어요</p>
          <p className="text-sm text-gray-500">
            수업·상담 등 자세한 정보는 강사앱의 해당 화면에서 확인해 주세요.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="알림"
        back
        action={
          notifications.length > 0 && (
            <Button
              variant="ghost"
              onClick={handleClearAll}
              style={{ color: TEXT_INACTIVE }}
            >
              모두 지우기
            </Button>
          )
        }
      />

      {/* 연결 상태 바 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
        <span className={`w-2 h-2 rounded-full ${statusDot}`} />
        <span className="text-xs text-gray-500">{statusLabel}</span>
      </div>

      {/* 알림 목록 */}
      <div className="pb-24">
        {notifications.length === 0 ? (
          <EmptyState icon={<BellIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="아직 받은 알림이 없습니다" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((n) => {
              const p = PRIORITY_STYLE[n.priority] ?? PRIORITY_STYLE[3];
              const tags = n.tags ?? [];
              return (
                <li
                  key={n.id}
                  ref={n.id === selectedId ? selectedRef : undefined}
                  className={`flex gap-3 px-4 py-3 active:bg-gray-50 transition-[background-color] duration-150 ${n.id === selectedId ? 'bg-brand-50' : ''}`}
                >
                  {/* 우선순위 색상 바 */}
                  <div className={`w-1 rounded-full shrink-0 self-stretch ${p.bar}`} />
                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <p className="text-sm font-semibold text-gray-800 leading-snug">{n.title}</p>
                    )}
                    <p className={`text-sm leading-snug ${n.title ? 'text-gray-600' : 'font-semibold text-gray-800'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {tags.length > 0 && (
                        <span className="text-xs text-gray-500">{tags.join(' · ')}</span>
                      )}
                      <span className="text-xs ml-auto shrink-0" style={{ color: TEXT_TERTIARY }}>
                        {relativeTime(n.time)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
