import { WORKER_URL } from '../config.js';

// 로그아웃/세션 만료 시 서버 응답과 무관하게 로컬 구독부터 해제해 이 기기의 상세 알림을 중단한다.
export async function revokePushSubscription(bearer) {
  if (!bearer || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await Promise.allSettled([
      fetch(`${WORKER_URL}/push/subscription`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        cache: 'no-store',
        keepalive: true,
      }),
      subscription.unsubscribe(),
    ]);
  } catch { /* 로컬 세션 삭제는 푸시 정리 실패 때문에 막지 않는다. */ }
}
