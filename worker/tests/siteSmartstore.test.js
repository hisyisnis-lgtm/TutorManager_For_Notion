import { describe, it, expect } from 'vitest';
import { normalizeSmartstoreProductUrl, siteShopSalesMode } from '../lib/siteSmartstore.js';

describe('public Smartstore product URL canonicalization', () => {
  it.each([
    ['https://smartstore.naver.com/hanul-books/products/12345?NaPm=tracking#info', 'https://smartstore.naver.com/hanul-books/products/12345'],
    ['  https://m.smartstore.naver.com/hanul_books/products/12345/  ', 'https://m.smartstore.naver.com/hanul_books/products/12345'],
    ['HTTPS://SMARTSTORE.NAVER.COM/Hanul123/products/12345', 'https://smartstore.naver.com/Hanul123/products/12345'],
  ])('keeps a canonical public product path and strips tracking: %s', (input, expected) => {
    expect(normalizeSmartstoreProductUrl(input)).toBe(expected);
  });
  it.each([
    'http://smartstore.naver.com/store/products/1', 'javascript:alert(1)',
    'https://smartstore.naver.com.evil.invalid/store/products/1', 'https://evil.invalid/store/products/1',
    'https://smartstore.naver.com:443/store/products/1', 'https://smartstore.naver.com:8443/store/products/1',
    'https://user:password@smartstore.naver.com/store/products/1', 'https://smartstore.naver.com@evil.invalid/store/products/1',
    'https://smartstore.naver.com/store', 'https://smartstore.naver.com/store/products',
    'https://smartstore.naver.com/store/products/0', 'https://smartstore.naver.com/store/products/01',
    'https://smartstore.naver.com/store/products/abc', 'https://smartstore.naver.com/store/products/123/extra',
    'https://smartstore.naver.com/store/products/123456789012345678901',
    'https://smartstore.naver.com/store space/products/1', 'https://smartstore.naver.com/%2fstore/products/1',
    'https://smartstore.naver.com\\store/products/1', 'https://smartstore.naver.com/store/products/1?track=bad\nvalue',
  ])('rejects a disguised or non-product URL: %s', input => { expect(() => normalizeSmartstoreProductUrl(input)).toThrow(); });
  it('allows an empty link without constructing a store or product URL', () => {
    for (const input of [null, undefined, '', '  ']) expect(normalizeSmartstoreProductUrl(input)).toBeNull();
  });
  it('opens direct sales only for an explicitly configured exact mode', () => {
    expect(siteShopSalesMode({ SITE_SHOP_SALES_MODE: 'direct' })).toBe('direct');
    for (const value of [undefined, null, '', 'smartstore', 'DIRECT', 'typo', false]) expect(siteShopSalesMode({ SITE_SHOP_SALES_MODE: value })).toBe('smartstore');
  });
});
