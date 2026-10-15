// A phone login identity is verified ownership, never the editable profile phone.
export function normalizeSitePhone(value) {
  if (typeof value !== 'string' || value.length > 24 || !/^[+\d\s()-]+$/.test(value)) return null;
  const compact = value.replace(/[\s()-]/g, '');
  if (/^010\d{8}$/.test(compact)) return `+82${compact.slice(1)}`;
  return /^\+8210\d{8}$/.test(compact) ? compact : null;
}
export const domesticSitePhone = value => `0${value.slice(3)}`;
export function maskSitePhone(value) {
  const normalized = normalizeSitePhone(value);
  return normalized ? `010-****-${normalized.slice(-4)}` : null;
}
export function sitePhoneDailyLimit(env) {
  const raw = env.SITE_PHONE_DAILY_LIMIT === undefined ? '100' : env.SITE_PHONE_DAILY_LIMIT;
  return typeof raw === 'string' && /^[1-9]\d{0,4}$/.test(raw) && Number(raw) <= 10000 ? Number(raw) : null;
}
export function sitePhoneReady(env) {
  return env.SITE_PHONE_ENABLED === 'true' && sitePhoneDailyLimit(env) !== null
    && typeof env.SOLAPI_API_KEY === 'string' && env.SOLAPI_API_KEY.length > 0
    && typeof env.SOLAPI_API_SECRET === 'string' && env.SOLAPI_API_SECRET.length > 0
    && typeof env.SOLAPI_SENDER === 'string' && /^0\d{8,10}$/.test(env.SOLAPI_SENDER);
}
export const phoneQuotaDay = now => new Date(now * 1000 + 9 * 3600_000).toISOString().slice(0, 10);
export const phoneQuotaRetryAfter = now => (Math.floor((now + 9 * 3600) / 86400) + 1) * 86400 - 9 * 3600 - now;
