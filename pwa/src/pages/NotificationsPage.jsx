import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import PageHeader from '../components/layout/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { getNtfyTopic } from './SettingsPage.jsx';

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
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveNotifications(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_NOTIFICATIONS)));
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
  const navigate = useNavigate();
  const topic = getNtfyTopic();
  const [notifications, setNotifications] = useState(loadNotifications);
  const [connStatus, setConnStatus] = useState('connecting'); // connecting | connected | error | off
  const sseRef = useRef(null);

  // 페이지 진입 시 읽음 처리
  useEffect(() => {
    localStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
  }, []);

  const addNotifications = useCallback((incoming) => {
    setNotifications((prev) => {
      const merged = mergeNotifications(prev, incoming);
      saveNotifications(merged);
      return merged;
    });
  }, []);

  // 히스토리 로드 + SSE 연결
  useEffect(() => {
    if (!topic) {
      setConnStatus('off');
      return;
    }

    let cancelled = false;

    // 최근 24시간 히스토리 로드
    fetch(`https://ntfy.sh/${topic}/json?poll=1&since=24h`)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        const msgs = text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => { try { return JSON.parse(line); } catch { return null; } })
          .filter((m) => m && m.event === 'message');
        addNotifications(msgs);
      })
      .catch((e) => console.error('[알림] 이전 알림 불러오기 오류', e));

    // SSE 실시간 연결
    const sse = new EventSource(`https://ntfy.sh/${topic}/sse`);
    sseRef.current = sse;

    sse.onopen = () => { if (!cancelled) setConnStatus('connected'); };
    sse.onerror = () => { if (!cancelled) setConnStatus('error'); };
    sse.addEventListener('message', (e) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'message') {
          // 새 알림 수신 시 last_read 업데이트 (현재 페이지에 있으므로 즉시 읽음)
          localStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
          addNotifications([msg]);
        }
      } catch (e) {
        console.error('[알림] SSE 메시지 파싱 오류', e);
      }
    });

    return () => {
      cancelled = true;
      sse.close();
      sseRef.current = null;
    };
  }, [topic, addNotifications]);

  const handleClearAll = () => {
    setNotifications([]);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(LAST_READ_KEY, String(Math.floor(Date.now() / 1000)));
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
    off: '토픽 미설정',
  }[connStatus];

  if (!topic) {
    return (
      <>
        <PageHeader title="알림" back />
        <div className="flex flex-col items-center justify-center px-8 pt-24 gap-4 text-center">
          <span className="text-5xl">🔔</span>
          <p className="text-gray-700 font-medium">ntfy 토픽이 설정되지 않았어요</p>
          <p className="text-sm text-gray-500">
            설정에서 ntfy 토픽을 입력하면<br />실시간 알림을 받을 수 있습니다.
          </p>
          <Button
            type="primary"
            onClick={() => navigate('/settings')}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 8 }}
          >
            설정으로 이동
          </Button>
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
              type="text"
              onClick={handleClearAll}
              style={{ fontSize: 14, color: '#9ca3af' }}
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
        <span className="text-xs ml-auto" style={{ color: '#767676' }}>ntfy.sh/{topic}</span>
      </div>

      {/* 알림 목록 */}
      <div className="pb-24">
        {notifications.length === 0 ? (
          <EmptyState icon="🔔" title="아직 받은 알림이 없습니다" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((n) => {
              const p = PRIORITY_STYLE[n.priority] ?? PRIORITY_STYLE[3];
              const tags = n.tags ?? [];
              return (
                <li key={n.id} className="flex gap-3 px-4 py-3 active:bg-gray-50 transition-[background-color] duration-150">
                  {/* 우선순위 색상 바 */}
                  <div className={`w-1 rounded-full shrink-0 self-stretch ${p.bar}`} />
                  <div className="flex-1 min-w-0">
                    {n.title && (
                      <p className="text-sm font-semibold text-gray-800 leading-snug">{n.title}</p>
                    )}
                    <p className={`text-sm leading-snug ${n.title ? 'text-gray-600' : 'font-medium text-gray-800'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {tags.length > 0 && (
                        <span className="text-xs text-gray-500">{tags.join(' · ')}</span>
                      )}
                      <span className="text-xs ml-auto shrink-0" style={{ color: '#767676' }}>
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
