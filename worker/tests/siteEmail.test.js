import { describe, it, expect, vi } from 'vitest';
import { buildSiteEmail, sendSiteEmail, siteEmailReady } from '../lib/siteEmail.js';

const settings = { SITE_EMAIL_FROM: 'no-reply@tiantianchinese.com' };
const recipient = 'member@example.invalid';
const resetUrl = `https://tiantianchinese.com/password/reset/?token=${'a'.repeat(43)}`;

describe('transactional site email', () => {
  it('builds brand-consistent text and self-contained HTML without tracking or external assets', () => {
    const message = buildSiteEmail(settings, recipient, { code: '123456' });
    expect(message.from.name).toBe('하늘하늘중국어');
    expect(message.subject).toBe('[하늘하늘중국어] 이메일 인증번호');
    expect(message.text).toMatch(/123456.*5분/);
    expect(message.html).toContain('lang="ko"');
    expect(message.html).toContain('직접 요청하지 않았다면');
    expect(message.html).not.toMatch(/<script|<iframe|<img|https?:/);
  });
  it('sends only the exact site reset path and one opaque token in text and HTML', () => {
    const message = buildSiteEmail(settings, recipient, { resetUrl });
    expect(message.text).toContain(resetUrl);
    expect(message.html).toContain(`href="${resetUrl}"`);
    expect(message.text).toContain('15분');
    for (const invalid of [resetUrl.replace('tiantianchinese.com', 'evil.example'), resetUrl.replace('/password/reset/', '/login/'), `${resetUrl}&next=evil`, `${resetUrl}&token=second`, `${resetUrl}#private`, resetUrl.replace('https:', 'http:'), resetUrl.replace('/password/', ':password@evil.example/password/')]) {
      expect(() => buildSiteEmail(settings, recipient, { resetUrl: invalid })).toThrow('invalid_site_email_content');
    }
  });
  it('permits local reset URLs only with the matching explicit development origin', () => {
    const localUrl = resetUrl.replace('https://tiantianchinese.com', 'http://localhost:4330');
    expect(() => buildSiteEmail({ ...settings, SITE_ORIGIN: 'http://localhost:4330' }, recipient, { resetUrl: localUrl })).toThrow();
    expect(buildSiteEmail({ ...settings, SITE_ORIGIN: 'http://localhost:4330', SITE_ENVIRONMENT: 'development' }, recipient, { resetUrl: localUrl }).text).toContain(localUrl);
  });
  it('rejects malformed recipients, sender headers and ambiguous or invalid authentication payloads before transport', async () => {
    const send = vi.fn();
    for (const payload of [{}, { code: '123456', resetUrl }, { code: '<b>123456</b>' }, { code: 123456 }, { code: '12345' }, { resetUrl: 'javascript:alert(1)' }]) {
      await expect(sendSiteEmail({ ...settings, SITE_EMAIL: { send } }, recipient, payload)).rejects.toThrow('invalid_site_email_content');
    }
    expect(() => buildSiteEmail(settings, 'member@example.invalid\r\nBcc: other@example.invalid', { code: '123456' })).toThrow('invalid_site_email_address');
    expect(siteEmailReady({ SITE_EMAIL_FROM: 'Name <sender@example.com>', SITE_EMAIL: { send } })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps the selected binding and requires a provider acceptance receipt', async () => {
    const primary = vi.fn(async () => ({ messageId: 'accepted' })), fallback = vi.fn();
    await sendSiteEmail({ ...settings, SITE_EMAIL: { send: primary }, EMAIL: { send: fallback } }, recipient, { code: '123456' });
    expect(primary).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
    for (const result of [undefined, {}, { messageId: '' }, { messageId: ' ' }]) {
      await expect(sendSiteEmail({ ...settings, EMAIL: { send: async () => result } }, recipient, { code: '123456' })).rejects.toThrow('site_email_unconfirmed');
    }
  });
  it('does not expose a provider error containing recipient or authentication contents', async () => {
    await expect(sendSiteEmail({ ...settings, SITE_EMAIL: { send: async () => { throw new Error(`private ${recipient} ${resetUrl}`); } } }, recipient, { code: '123456' })).rejects.toThrow(/^site_email_delivery_failed$/);
  });
});
