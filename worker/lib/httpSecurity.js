import { MAX_FILE_BYTES } from './upload.js';

export class RequestTooLarge extends Error {
  constructor() { super('요청 용량이 너무 큽니다.'); this.name = 'RequestTooLarge'; }
}

export function requestByteLimit(path) {
  if (path === '/game/dashboard') return 4 * 1024;
  if (path === '/homework/upload' || /^\/homework\/student-upload\/[^/]+$/.test(path)) return MAX_FILE_BYTES + 64 * 1024;
  if (path.startsWith('/personal/auth/') || path.startsWith('/game/auth/') || path === '/auth/login' || path === '/game/event') return 8 * 1024;
  if (path === '/consult' || path === '/error-log') return 32 * 1024;
  return 512 * 1024;
}

// Count actual bytes before JSON/multipart parsing; Content-Length alone is not trusted.
export async function boundedRequest(request) {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return request;
  const limit = requestByteLimit(new URL(request.url).pathname);
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) throw new RequestTooLarge();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new RequestTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request, { body: bytes });
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-store');
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
