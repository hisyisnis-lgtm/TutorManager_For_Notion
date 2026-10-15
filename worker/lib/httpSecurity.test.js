import { describe, it, expect, vi } from 'vitest';
import { boundedRequest, RequestTooLarge, requestByteLimit, secureResponse } from './httpSecurity.js';
import { MAX_FILE_BYTES } from './upload.js';

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
  it('grants the multipart budget only to the exact administrator product-file POST route', () => {
    const filePath = '/api/site/admin/products/fixture-product/file';
    expect(requestByteLimit(filePath, 'POST')).toBe(MAX_FILE_BYTES + 64*1024);
    for (const method of ['PUT','DELETE','GET']) expect(requestByteLimit(filePath, method)).toBe(128*1024);
    for (const path of [`${filePath}/extra`, '/api/site/admin/products/Uppercase/file',
      `/api/site/admin/products/${'a'.repeat(81)}/file`, '/api/site/admin/content/fixture-product/file', '/api/site/admin/products/fixture-product/files']) {
      expect(requestByteLimit(path, 'POST')).toBe(128*1024);
    }
    expect(requestByteLimit('/api/site/admin/products', 'POST')).toBe(64*1024);
    expect(requestByteLimit('/api/site/admin/products/fixture-product', 'PUT')).toBe(64*1024);
    expect(requestByteLimit('/api/site/admin/content/fixture-article', 'PUT')).toBe(128*1024);
    expect(requestByteLimit('/api/site/student-app/homework/upload', 'POST')).toBe(MAX_FILE_BYTES + 64*1024);
  });
  it('counts actual oversized administrator upload bytes and cancels the incoming stream', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(MAX_FILE_BYTES + 64*1024 + 1)); }, cancel: cancelled }, { highWaterMark: 0 });
    const request = new Request('https://audit.invalid/api/site/admin/products/fixture-product/file', {
      method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': '1', 'Content-Type': 'multipart/form-data; boundary=synthetic' } });
    await expect(boundedRequest(request)).rejects.toBeInstanceOf(RequestTooLarge); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('grants the image upload budget only to exact POST gallery collections', async () => {
    const path='/api/site/admin/products/fixture-product/images';
    expect(requestByteLimit(path,'POST')).toBe(2*1024*1024+64*1024);
    for (const method of ['GET','PATCH','DELETE','PUT']) expect(requestByteLimit(path,method)).toBe(128*1024);
    for (const route of [`${path}/11111111-1111-4111-8111-111111111111`, `${path}/extra`, '/api/site/products/fixture-product/images',
      '/api/site/admin/products/Uppercase/images', '/api/site/admin/products/fixture-product/image']) expect(requestByteLimit(route,'POST')).toBe(128*1024);
  });
  it('rejects an excessive declared administrator upload size before reading the stream', async () => {
    const read = vi.fn();
    const stream = new ReadableStream({ pull: read }, { highWaterMark: 0 });
    const request = new Request('https://audit.invalid/api/site/admin/products/fixture-product/file', {
      method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': String(MAX_FILE_BYTES + 64*1024 + 1) } });
    await expect(boundedRequest(request)).rejects.toBeInstanceOf(RequestTooLarge); expect(read).not.toHaveBeenCalled();
  });
  it('grants the content-image multipart budget only to exact administrator thumbnail POST routes', () => {
    const path = '/api/site/admin/content/fixture-article/thumbnail';
    expect(requestByteLimit(path, 'POST')).toBe(2*1024*1024+64*1024);
    for (const method of ['PUT','GET','DELETE']) expect(requestByteLimit(path, method)).toBe(128*1024);
    for (const route of [`${path}/extra`, '/api/site/content/fixture-article/thumbnail',
      '/api/site/admin/content/Uppercase/thumbnail', `/api/site/admin/content/${'a'.repeat(81)}/thumbnail`]) {
      expect(requestByteLimit(route, 'POST')).toBe(128*1024);
    }
  });
  it('preserves cookie, CSRF, fetch metadata and multipart content after bounded buffering for the second authorization check', async () => {
    const form = new FormData(); form.set('version', '1'); form.set('file', new File(['%PDF-fixture'], 'fixture.pdf', { type: 'application/pdf' }));
    const request = await boundedRequest(new Request('https://audit.invalid/api/site/admin/products/fixture-product/file', {
      method: 'POST', body: form, headers: { Cookie: '__Host-hanul_site_admin=opaque-cookie', 'X-CSRF-Token': 'synthetic-csrf',
        Origin: 'https://site.example.invalid', 'Sec-Fetch-Site': 'same-origin' } }));
    expect(request.headers.get('Cookie')).toBe('__Host-hanul_site_admin=opaque-cookie');
    expect(request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf'); expect(request.headers.get('Origin')).toBe('https://site.example.invalid');
    expect(request.headers.get('Sec-Fetch-Site')).toBe('same-origin');
    const parsed = await request.formData(); expect(parsed.get('version')).toBe('1'); expect(parsed.get('file').name).toBe('fixture.pdf');
  });
  it('retains Strict HttpOnly administrator cookies and private JSON response security headers', () => {
    const header = '__Host-hanul_site_admin=opaque; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800';
    const response = secureResponse(Response.json({ authenticated: false }, { headers: { 'Set-Cookie': header, 'Cache-Control': 'private, no-store' } }));
    expect(response.headers.get('Set-Cookie')).toBe(header); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'"); expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});
