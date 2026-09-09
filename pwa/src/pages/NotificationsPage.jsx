import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/shadcn/button';
import PageHeader from '../components/layout/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges } from '../api/authState.js';
import { getNtfyTopic, subscribeNtfyTopic, clearNtfyHistory } from '../api/ntfy.js';
import { BellIcon } from '@phosphor-icons/react';
import { TEXT_TERTIARY,
  TEXT_INACTIVE, BORDER_NEUTRAL } from '../constants/theme.js';

const STORAGE_KEY = 'ntfy_notifications';
const LAST_READ_KEY = 'ntfy_last_read';
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
    if (!getNtfyTopic() || sessionStorage.getItem('ntfy_history_topic') !== getNtfyTopic()) return [];
    const list = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isNotification).slice(0, MAX_NOTIFICATIONS) : [];
  } catch {
    return [];
  }
}

function isNotification(msg) {
  return msg?.event === 'message' && typeof msg.id === 'string'
    && typeof msg.message === 'string' && Number.isFinite(msg.time);
}

function saveNotifications(list, topic) {
  sessionStorage.setItem('ntfy_history_topic', topic);
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
  return merged.sort((a, b) => b.time - a.time).slice(0, MAX_NOTIFICATIONS);
}

function relativeTime(unixSec) {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function NotificationsPage() {
  const [topic, setTopic] = useState(getNtfyTopic);
  const [notifications, setNotifications] = useState(loadNotifications);
  const [connStatus, setConnStatus] = useState('connecting'); // connecting | connected | error
  const authRef = useRef(captureAuthScope());

  useEffect(() => subscribeNtfyTopic(() => {
    setTopic(getNtfyTopic());
    setNotifications([]);
    setConnStatus('connecting');
  }), []);

  // 페이지 진입 시 읽음 처리
  useEffect(() => {
    if (isAuthScopeCurrent(authRef.current)) sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
  }, []);

  const addNotifications = useCallback((incoming) => {
    if (!isAuthScopeCurrent(authRef.current) || getNtfyTopic() !== topic) return;
    setNotifications((prev) => {
      if (!isAuthScopeCurrent(authRef.current) || getNtfyTopic() !== topic) return [];
      const merged = mergeNotifications(prev, incoming);
      saveNotifications(merged, topic);
      return merged;
    });
  }, [topic]);

  // 저장한 ntfy 토픽의 최근 이력 + 실시간 알림. 앱 인증정보를 ntfy로 보내지 않는다.
  useEffect(() => {
    const auth = authRef.current;
    if (!topic || !isAuthScopeCurrent(auth)) return;
    let cancelled = false;
    let controller;
    let attempt = 0;
    let retryTimer;
    let requestTimer;
    const current = () => !cancelled && isAuthScopeCurrent(auth) && getNtfyTopic() === topic;
    const disconnect = () => {
      attempt += 1;
      clearTimeout(retryTimer);
      clearTimeout(requestTimer);
      controller?.abort();
    };
    const unsubscribe = subscribeAuthChanges(() => {
      if (!isAuthScopeCurrent(auth)) {
        cancelled = true;
        disconnect();
        setNotifications([]);
      }
    });
    const receive = (line, stillCurrent) => {
      if (!stillCurrent()) return;
      try {
        const msg = JSON.parse(line);
        if (isNotification(msg)) {
          sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
          addNotifications([msg]);
        }
      } catch { /* 빈 heartbeat·잘못된 줄은 표시하지 않는다. */ }
    };
    const request = async (stream, signal) => {
      requestTimer = setTimeout(() => controller.abort(), 15000);
      const endpoint = stream ? 'sse' : 'json?poll=1&since=24h';
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/${endpoint}`, {
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      });
      if (!res.ok) {
        await res.body?.cancel();
        const error = new Error('알림을 불러오지 못했습니다.');
        error.status = res.status;
        throw error;
      }
      return res;
    };
    const readResponse = async (response, stream, stillCurrent) => {
      const reader = response.body.getReader();
      const decoder = new globalThis.TextDecoder();
      let buffer = '';
      let bytes = 0;
      const emit = (line) => {
        if (!stream) receive(line, stillCurrent);
        else if (line.startsWith('data:')) receive(line.slice(5).trim(), stillCurrent);
      };
      try {
        while (stillCurrent()) {
          if (stream) {
            clearTimeout(requestTimer);
            requestTimer = setTimeout(() => controller.abort(), 60000);
          }
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer) emit(buffer);
            break;
          }
          bytes += value.byteLength;
          buffer += decoder.decode(value, { stream: true });
          if (bytes > 2 * 1024 * 1024 || buffer.length > 256 * 1024) throw new Error('알림 응답이 너무 큽니다.');
          const lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(emit);
        }
      } finally {
        if (stillCurrent()) clearTimeout(requestTimer);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    };
    const connect = async () => {
      disconnect();
      if (!current() || document.visibilityState === 'hidden') return;
      controller = new AbortController();
      const signal = controller.signal;
      const connection = attempt;
      const stillCurrent = () => current() && connection === attempt;
      setConnStatus('connecting');
      try {
        const history = await request(false, signal);
        if (!stillCurrent()) { await history.body?.cancel(); return; }
        await readResponse(history, false, stillCurrent);
        if (!stillCurrent()) return;
        const response = await request(true, signal);
        if (!stillCurrent()) { await response.body?.cancel(); return; }
        setConnStatus('connected');
        await readResponse(response, true, stillCurrent);
      } catch {
        if (!stillCurrent()) return;
      }
      if (stillCurrent()) {
        clearTimeout(requestTimer);
        setConnStatus('error');
        retryTimer = setTimeout(connect, 5000);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') disconnect();
      else connect();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', connect);
    connect();
    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', connect);
      disconnect();
    };
  }, [addNotifications, topic]);

  const handleClearAll = () => {
    setNotifications([]);
    clearNtfyHistory();
    sessionStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
  };

  const statusDot = {
    connecting: 'bg-yellow-400',
    connected: 'bg-green-500',
    error: 'bg-red-500',
  }[connStatus];

  const statusLabel = {
    connecting: 'ntfy 연결 중',
    connected: 'ntfy 연결됨',
    error: 'ntfy 연결 오류 · 자동 재연결 중',
  }[connStatus];

  if (!topic) {
    return (
      <>
        <PageHeader title="알림" back />
        <div className="flex flex-col items-center justify-center px-8 pt-24 gap-4 text-center">
          <span className="text-5xl">🔔</span>
          <p className="text-gray-700 font-semibold">ntfy 알림 코드를 연결해 주세요</p>
          <p className="text-sm text-gray-500">
            설정에 ntfy 앱에서 구독한 코드를 저장하면 같은 토픽의 알림이 여기에 표시됩니다.
          </p>
          <Button asChild><Link to="/settings">알림 코드 설정</Link></Button>
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
      {connStatus === 'error' && (
        <p className="px-4 py-2 text-xs text-gray-500">
          네트워크와 설정의 알림 코드를 확인해 주세요. 비공개 토픽은 ntfy 앱에서 확인해 주세요.
        </p>
      )}

      {/* 알림 목록 */}
      <div className="pb-24">
        {notifications.length === 0 ? (
          <EmptyState icon={<BellIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="아직 받은 알림이 없습니다" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((n) => {
              const p = PRIORITY_STYLE[n.priority] ?? PRIORITY_STYLE[3];
              const tags = Array.isArray(n.tags) ? n.tags.filter((tag) => typeof tag === 'string') : [];
              return (
                <li key={n.id} className="flex gap-3 px-4 py-3 active:bg-gray-50 transition-[background-color] duration-150">
                  {/* 우선순위 색상 바 */}
                  <div className={`w-1 rounded-full shrink-0 self-stretch ${p.bar}`} />
                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <p className="text-sm font-semibold text-gray-800 leading-snug whitespace-pre-wrap break-words">{n.title}</p>
                    )}
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${n.title ? 'text-gray-600' : 'font-semibold text-gray-800'}`}>
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
