// ntfy authentication alone does not make a topic private. Verify the current
// account-owned reservation on every operation; never cache or log this response
// because /v1/account may include access tokens and personal account details.
const PUBLIC_ALERTS = {
  critical: { title: '확인이 필요한 수업 관리 알림', priority: 5, tags: ['warning'] },
  warn: { title: '수업 관리 확인 알림', priority: 3, tags: ['warning'] },
  info: { title: '새 수업 관리 알림', priority: 4, tags: ['information_source'] },
  digest: { title: '수업 관리 요약 알림', priority: 2, tags: ['calendar'] },
};
// Match only for classification. Never copy a substring or captured value from
// the original title; this list follows the application's existing alert types.
const PUBLIC_ALERT_TYPES = [
  [/숙제 제출.*실패|숙제 제출 오류/, '숙제 제출 오류 알림'],
  [/숙제 제출/, '새 숙제 제출 알림'],
  [/상담.*저장.*실패|상담 신청 저장 오류/, '상담 신청 저장 오류 알림'],
  [/상담/, '새 상담 신청 알림'],
  [/수업 충돌|수업 일정 충돌/, '수업 일정 충돌 알림'],
  [/내일 수업/, '내일 수업 안내'],
  [/결제.*백업/, '결제 백업 알림'],
  [/백업|아카이브/, '백업 작업 알림'],
  [/결제|수납/, '결제 관리 확인 알림'],
  [/브리핑|일일 운영 리포트/, '일일 수업 관리 요약 알림'],
  [/PWA 클라이언트 에러|앱 오류/, '앱 오류 확인 알림'],
  [/Worker 에러|cron 실패|dispatch 실패|자동화 스크립트 실패|알림 미발송/, '시스템 오류 확인 알림'],
  [/수업/, '수업 안내'],
];

// Public ntfy topics may be read by anyone. Never derive this payload from an
// error, title, user input, recipient, reservation code or caller-supplied URL.
export function publicNtfyAlert(level, originalTitle) {
  const key = Object.hasOwn(PUBLIC_ALERTS, level) ? level : 'info';
  const alert = PUBLIC_ALERTS[key];
  const classificationInput = typeof originalTitle === 'string' ? originalTitle.slice(0, 512) : '';
  const type = PUBLIC_ALERT_TYPES.find(([pattern]) => pattern.test(classificationInput));
  return { title: type?.[1] || alert.title, message: '강사앱의 수업·상담 등 관련 항목을 확인해주세요.\nhttps://tiantian-chinese.pages.dev/', priority: alert.priority, tags: [...alert.tags] };
}

export async function isPrivateNtfyTopic(env, topic) {
  if (typeof env?.NTFY_TOKEN !== 'string' || !env.NTFY_TOKEN
    || typeof topic !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(topic)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('https://ntfy.sh/v1/account', {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.NTFY_TOKEN}`, Accept: 'application/json' },
      redirect: 'manual', cache: 'no-store', signal: controller.signal,
    });
    // 수동 리디렉션의 3xx도 거부하여 인증정보를 다른 호스트에 보내지 않는다.
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return false;
    }
    const reader = response.body.getReader();
    let size = 0;
    let json = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 128 * 1024) { await reader.cancel().catch(() => {}); return false; }
        json += decoder.decode(item.value, { stream: true });
      }
      json += decoder.decode();
    } finally { reader.releaseLock(); }
    const account = JSON.parse(json);
    if (!['user', 'admin'].includes(account?.role) || typeof account.username !== 'string'
      || !account.username || account.username === '*' || !Array.isArray(account.reservations)) return false;
    const owned = account.reservations.filter(reservation => reservation?.topic === topic);
    return owned.length === 1 && owned[0].everyone === 'deny-all';
  } catch {
    // Deliberately omit the response, topic, token and exception text.
    return false;
  } finally { clearTimeout(timer); }
}
