import { WORKER_URL } from '../config.js';
import { getToken, handleTeacherAuthExpiry } from './authUtils.js';

export function pushSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
    && 'serviceWorker' in navigator && 'PushManager' in window;
}

function base64urlToUint8Array(value) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function pushFetch(path, options = {}, bearer = getToken()) {
  const response = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  if (response.status === 401) handleTeacherAuthExpiry(bearer);
  if (!response.ok) {
    const error = new Error(response.status === 503 ? '푸시 알림 서버 설정이 아직 완료되지 않았습니다.' : '푸시 알림을 설정하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function getPushStatus() {
  if (!pushSupported()) return { state: 'unsupported' };
  if (window.Notification.permission === 'denied') return { state: 'denied' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const config = await pushFetch('/push/config').then((response) => response.json());
  if (!config.configured) return { state: 'unconfigured' };
  if (subscription) {
    // 브라우저 구독은 남았지만 서버 저장소가 복구·초기화된 경우에도 설정 진입 시 자동 복원한다.
    await pushFetch('/push/subscription', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  }
  return { state: subscription ? 'enabled' : 'disabled' };
}

export async function enablePushNotifications() {
  if (!pushSupported()) throw new Error('이 기기에서는 푸시 알림을 지원하지 않습니다.');
  // iOS는 사용자 클릭의 활성 컨텍스트가 사라지기 전에 권한 요청을 시작해야 한다.
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') throw new Error('기기 설정에서 알림 권한을 허용해주세요.');
  const config = await pushFetch('/push/config').then((response) => response.json());
  if (!config.configured || !config.publicKey) throw new Error('푸시 알림 서버 설정이 아직 완료되지 않았습니다.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToUint8Array(config.publicKey),
    });
  }
  await pushFetch('/push/subscription', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  return { state: 'enabled' };
}

export async function disablePushNotifications() {
  if (!pushSupported()) return { state: 'unsupported' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    try {
      await pushFetch('/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
    } finally {
      await subscription.unsubscribe();
    }
  }
  return { state: 'disabled' };
}
