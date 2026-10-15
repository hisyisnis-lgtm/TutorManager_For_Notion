// Cloudflare Email Sending builder API. There is deliberately no production fixture transport.
// https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function siteEmailReady(env) {
  const binding = env.SITE_EMAIL || env.EMAIL;
  return typeof binding?.send === 'function' && emailAddress(env.SITE_EMAIL_FROM);
}

export function buildSiteEmail(env, to, { code, resetUrl } = {}) {
  if (!emailAddress(env.SITE_EMAIL_FROM) || !emailAddress(to)) throw new Error('invalid_site_email_address');
  if ((code !== undefined) === (resetUrl !== undefined)) throw new Error('invalid_site_email_content');
  if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) throw new Error('invalid_site_email_content');
  if (resetUrl !== undefined) {
    try {
      const origin = new URL(env.SITE_ORIGIN || 'https://tiantianchinese.com');
      const url = new URL(resetUrl);
      const local = env.SITE_ENVIRONMENT === 'development' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !(origin.protocol === 'https:' || local)
        || url.origin !== origin.origin || url.username || url.password || url.pathname !== '/password/reset/' || url.hash
        || [...url.searchParams.keys()].length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token') || '')) throw new Error();
    } catch { throw new Error('invalid_site_email_content'); }
  }
  const subject = code ? '[하늘하늘중국어] 이메일 인증번호' : '[하늘하늘중국어] 비밀번호 재설정';
  const text = code
    ? `이메일 인증번호는 ${code}입니다. 5분 안에 입력해주세요. 직접 요청하지 않았다면 이 메일을 무시해주세요.`
    : `비밀번호를 재설정하려면 다음 링크를 15분 안에 열어주세요.\n${resetUrl}\n직접 요청하지 않았다면 이 메일을 무시해주세요.`;
  const content = code
    ? `<h1 style="font-size:24px;line-height:1.5;margin:0 0 20px">이메일을 인증해 주세요</h1><p>아래 인증번호를 5분 안에 입력해 주세요.</p><p style="font-size:36px;font-weight:600;letter-spacing:8px;background:#f5f5f5;padding:20px;text-align:center;border-radius:12px">${escapeHtml(code)}</p>`
    : `<h1 style="font-size:24px;line-height:1.5;margin:0 0 20px">비밀번호 재설정</h1><p>아래 버튼을 눌러 새 비밀번호를 설정해 주세요.<br>링크는 15분 동안 사용할 수 있어요.</p><p style="margin:28px 0"><a style="display:inline-block;background:#262626;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600" href="${escapeHtml(resetUrl)}">비밀번호 재설정</a></p><p style="font-size:13px;color:#666;word-break:break-all">버튼이 열리지 않으면 아래 주소를 복사해 주세요.<br>${escapeHtml(resetUrl)}</p>`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f7f7;color:#222;font-family:Arial,sans-serif;line-height:1.8"><main style="max-width:520px;margin:32px auto;padding:32px 24px;background:#fff;border:1px solid #e5e5e5;border-radius:12px"><p style="margin:0 0 28px;font-size:18px;font-weight:600">하늘하늘중국어</p>${content}<p style="border-top:1px solid #eee;margin-top:32px;padding-top:20px;font-size:13px;color:#666">직접 요청하지 않았다면 이 메일을 무시해 주세요.<br>본 메일은 회원 인증을 위한 자동 발송 메일입니다.</p></main></body></html>`;
  return { to, from: { email: env.SITE_EMAIL_FROM, name: '하늘하늘중국어' }, subject, text, html };
}

export async function sendSiteEmail(env, to, content) {
  if (!siteEmailReady(env)) throw new Error('site_email_unavailable');
  const binding = env.SITE_EMAIL || env.EMAIL;
  const message = buildSiteEmail(env, to, content);
  // Never log the recipient, code, reset URL, provider response, or thrown provider error.
  let receipt;
  try { receipt = await binding.send(message); }
  catch { throw new Error('site_email_delivery_failed'); }
  if (typeof receipt?.messageId !== 'string' || !receipt.messageId.trim()) throw new Error('site_email_unconfirmed');
}
