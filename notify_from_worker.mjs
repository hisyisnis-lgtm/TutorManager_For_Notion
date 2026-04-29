// Worker → GitHub repository_dispatch → ntfy 발송 (IP 우회)
//
// Cloudflare Workers 공유 IP가 ntfy.sh의 IP-based daily quota에 묶여
// 429를 반환하는 문제를 우회한다. GitHub Actions runner IP는 별도 풀이라 정상.
//
// 트리거: repository_dispatch (event_type: ntfy-relay)
// 페이로드: { title, message, level? }

import { sendAlert } from './notion_utils.mjs';

const raw = process.env.PAYLOAD || '{}';
let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  console.error('[notify-from-worker] PAYLOAD 파싱 실패:', e.message);
  process.exit(1);
}

const { title, message, level = 'info' } = payload;
if (!title || !message) {
  console.error('[notify-from-worker] title/message 누락:', payload);
  process.exit(1);
}

await sendAlert({ level, title, message });
