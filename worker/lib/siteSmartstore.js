// This is a link to a public product, not a payment gateway or order integration.
export function normalizeSmartstoreProductUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('invalid_smartstore_url');
  const input = value.trim(); if (!input) return null;
  if (input.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(input)) throw new Error('invalid_smartstore_url');
  let url; try { url = new URL(input); } catch { throw new Error('invalid_smartstore_url'); }
  const authority = input.match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (url.protocol !== 'https:' || !['smartstore.naver.com','m.smartstore.naver.com'].includes(url.hostname)
    || !authority || authority.includes(':') || url.username || url.password || url.port
    || !/^\/[a-z0-9][a-z0-9_-]{0,49}\/products\/[1-9]\d{0,19}\/?$/i.test(url.pathname)) throw new Error('invalid_smartstore_url');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
export function siteShopSalesMode(env) { return env?.SITE_SHOP_SALES_MODE === 'direct' ? 'direct' : 'smartstore'; }
