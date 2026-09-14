import { z } from 'zod';
import { rateLimitCheck } from './securityStore.js';
import { validateBody } from './validation.js';

const RECIPIENT = 'tiantianchinese_@naver.com';
const SENDER = { email: 'contact@tiantianchinese.com', name: '하늘하늘 중국어' };
const TYPES = { lecture: '기업·기관 출강', collaboration: '콘텐츠·브랜드 협업' };
const singleLine = (max) => z.string().regex(/^[^\u0000-\u001f\u007f]*$/, '줄바꿈 없이 입력해주세요')
  .trim().min(1, '필수 항목입니다').max(max, `${max}자 이내로 입력해주세요`);

// Never accept message headers or recipients from the public form.
const ContactSchema = z.object({
  type: z.enum(['lecture', 'collaboration']),
  company: singleLine(100),
  name: singleLine(50),
  email: singleLine(254).email('이메일 주소를 확인해주세요'),
  message: z.string().trim().min(1, '문의 내용을 입력해주세요').max(2000, '문의 내용은 2000자 이내로 입력해주세요')
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, '문의 내용을 확인해주세요'),
  website: z.literal('').optional(),
}).strict();

const reply = (corsHeaders, status, data) => Response.json(data, { status, headers: corsHeaders });
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export async function handleContactRequest(request, env, corsHeaders) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!(await rateLimitCheck(env, `contact:ip:${ip}`, 5, 300))) {
    return reply(corsHeaders, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(corsHeaders, 415, { error: '잘못된 요청 형식입니다.' });
  }
  const body = await request.json().catch(() => null);
  const validation = validateBody(ContactSchema, body, corsHeaders);
  if (!validation.ok) return validation.response;
  const { type, company, name, email, message } = validation.data;

  if (typeof env.CONTACT_EMAIL?.send !== 'function') {
    return reply(corsHeaders, 503, { error: '현재 문의를 접수할 수 없습니다. 잠시 후 다시 시도해주세요.' });
  }
  // Existing D1 limiter stores HMAC keys, never the submitted email or IP.
  if (!(await rateLimitCheck(env, `contact:email:${email.toLowerCase()}`, 3, 86400))) {
    return reply(corsHeaders, 429, { error: '오늘 문의 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.' });
  }

  const text = [
    `문의 유형: ${TYPES[type]}`, `기업·기관명: ${company}`, `담당자: ${name}`, `답변 이메일: ${email}`,
    '', '문의 내용', message,
  ].join('\n');
  try {
    // Await the provider once. A rejection or an unconfirmed result is not a successful submission.
    const result = await env.CONTACT_EMAIL.send({
      to: RECIPIENT,
      from: SENDER,
      replyTo: email,
      subject: `[${TYPES[type]}] ${company}`,
      text,
      html: `<div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(text)}</div>`,
    });
    if (typeof result?.messageId !== 'string' || !result.messageId.trim()) {
      return reply(corsHeaders, 502, { error: '문의 전송을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
    return reply(corsHeaders, 200, { ok: true });
  } catch {
    // Provider exceptions can contain the sender, recipient or message. Do not log or echo them.
    return reply(corsHeaders, 502, { error: '문의 전송을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
