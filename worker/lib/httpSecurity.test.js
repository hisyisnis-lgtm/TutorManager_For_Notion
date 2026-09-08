import { describe, it, expect } from 'vitest';
import { boundedRequest, RequestTooLarge, requestByteLimit, secureResponse } from './httpSecurity.js';

describe('request byte boundary', () => {
  it('blocks dishonest Content-Length and streamed body before parsing', async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8193)); c.close(); } });
    const request = new Request('https://audit.invalid/auth/login', { method: 'POST', body, duplex: 'half', headers: { 'Content-Length': '1' } });
    await expect(boundedRequest(request)).rejects.toBeInstanceOf(RequestTooLarge);
  });
  it('preserves a valid multipart request and authorization', async () => {
    const body = new FormData();
    body.append('file', new File(['%PDF-1.7 fixture'], 'lesson.pdf', { type: 'application/pdf' }));
    const request = await boundedRequest(new Request('https://audit.invalid/homework/upload', { method: 'POST', body, headers: { Authorization: 'Bearer fixture' } }));
    expect(request.headers.get('Authorization')).toBe('Bearer fixture');
    expect((await request.formData()).get('file').name).toBe('lesson.pdf');
  });
  it('uses tight limits on public forms and strips no response CSP', () => {
    expect(requestByteLimit('/game/dashboard')).toBe(4096);
    const result = secureResponse(new Response('ok', { headers: { 'Content-Security-Policy': "script-src 'nonce-a'" } }));
    expect(result.headers.get('Content-Security-Policy')).toBe("script-src 'nonce-a'");
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
