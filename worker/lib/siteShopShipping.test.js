import { describe, it, expect } from 'vitest';
import { regionalShippingSchema, productRegionalShipping, productFreeShippingThreshold, chargedBaseShippingFee, shippingPolicyReady, destinationShipping, orderShippingBreakdown } from './siteShopShipping.js';

const policy = { jejuExtraFee: 3000, remoteExtraFee: 5000, remotePostalRanges: [{ start: '12345', end: '12349' }, { start: '63000', end: '63001' }] };
const product = value => ({ product_type: 'physical', shipping_fee: 3000, regional_shipping_json: value === undefined ? null : JSON.stringify(value) });

describe('gross merchandise free-shipping threshold', () => {
  it('distinguishes no condition from an explicit always-free threshold', () => {
    expect(productFreeShippingThreshold(product(policy))).toBeNull();
    expect(chargedBaseShippingFee(product(policy), 90000)).toBe(3000);
    expect(chargedBaseShippingFee({ ...product(policy), free_shipping_threshold: null }, 90000)).toBe(3000);
    expect(productFreeShippingThreshold({ ...product(policy), free_shipping_threshold: 0 })).toBe(0);
    expect(chargedBaseShippingFee({ ...product(policy), free_shipping_threshold: 0 }, 30000)).toBe(0);
  });
  it.each([[59999, 3000], [60000, 0], [60001, 0]])('uses the inclusive threshold boundary at %i gross won', (itemAmount, expectedBase) => {
    const selected = { ...product(policy), free_shipping_threshold: 60000 };
    expect(chargedBaseShippingFee(selected, itemAmount)).toBe(expectedBase);
    expect(destinationShipping(selected, { postalCode: '10000', address: '경기도 검수시 1' }, itemAmount).shipping)
      .toEqual({ zone: 'general', baseFee: expectedBase, extraFee: 0, fee: expectedBase });
  });
  it('waives only the base charge and preserves either configured region surcharge', () => {
    const selected = { ...product(policy), free_shipping_threshold: 60000 };
    expect(destinationShipping(selected, { postalCode: '63010', address: '제주특별자치도 제주시 검수로 1' }, 60000).shipping)
      .toEqual({ zone: 'jeju', baseFee: 0, extraFee: 3000, fee: 3000 });
    expect(destinationShipping(selected, { postalCode: '12345', address: '경기도 검수시 검수로 1' }, 60000).shipping)
      .toEqual({ zone: 'remote', baseFee: 0, extraFee: 5000, fee: 5000 });
  });
  it('keeps unconfigured policies blocked even when an always-free threshold exists', () => {
    expect(destinationShipping({ ...product(), free_shipping_threshold: 0 }, { postalCode: '10000', address: '검수 주소' }, 60000))
      .toEqual({ error: 'shipping_configuration_pending' });
  });
  it('fails closed for an invalid stored threshold and ignores shipping policy on digital products', () => {
    const invalid = { ...product(policy), free_shipping_threshold: -1 };
    expect(productFreeShippingThreshold(invalid)).toBeNull();
    expect(destinationShipping(invalid, { postalCode: '10000', address: '검수 주소' }, 60000)).toEqual({ error: 'shipping_configuration_pending' });
    const digital = { product_type: 'digital', shipping_fee: 0, free_shipping_threshold: 60000 };
    expect(productFreeShippingThreshold(digital)).toBeNull(); expect(chargedBaseShippingFee(digital, 30000)).toBe(0);
  });
});

describe('regional shipping policy validation and destination classification', () => {
  it('preserves unset amounts and validates an explicit no-surcharge policy', () => {
    expect(productRegionalShipping(product())).toBeNull();
    expect(shippingPolicyReady(product())).toBe(false);
    const pending = { jejuExtraFee: null, remoteExtraFee: null, remotePostalRanges: null };
    expect(productRegionalShipping(product(pending))).toEqual(pending);
    expect(shippingPolicyReady(product(pending))).toBe(false);
    const free = { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] };
    expect(shippingPolicyReady(product(free))).toBe(true);
    expect(destinationShipping(product(free), { postalCode: '63001', address: '제주특별자치도 제주시 검수로 1' }).shipping)
      .toEqual({ zone: 'jeju', baseFee: 3000, extraFee: 0, fee: 3000 });
  });
  it('sorts nonoverlapping ranges without dropping their zero prefixes', () => {
    const sorted = regionalShippingSchema.parse({ ...policy, remotePostalRanges: [{ start: '63000', end: '63001' }, { start: '01234', end: '01235' }] });
    expect(sorted.remotePostalRanges).toEqual([{ start: '01234', end: '01235' }, { start: '63000', end: '63001' }]);
  });
  it.each([
    { ...policy, jejuExtraFee: -1 }, { ...policy, remoteExtraFee: 0.5 }, { ...policy, jejuExtraFee: 1_000_000_001 },
    { ...policy, remotePostalRanges: [] }, { ...policy, remotePostalRanges: [{ start: '1234', end: '12345' }] },
    { ...policy, remotePostalRanges: [{ start: '12346', end: '12345' }] },
    { ...policy, remotePostalRanges: [{ start: '12345', end: '12349' }, { start: '12349', end: '12350' }] },
    { ...policy, remotePostalRanges: Array.from({ length: 501 }, (_, i) => ({ start: String(i).padStart(5, '0'), end: String(i).padStart(5, '0') })) },
    { ...policy, inventedFee: 1000 },
  ])('rejects invalid or ambiguous policies without making them ready', value => {
    expect(regionalShippingSchema.safeParse(value).success).toBe(false);
    expect(productRegionalShipping(product(value))).toBeNull();
    expect(shippingPolicyReady(product(value))).toBe(false);
  });
  it('charges one configured region surcharge with remote priority over Jeju', () => {
    const selected = product(policy);
    expect(destinationShipping(selected, { postalCode: '10000', address: '경기도 검수시 1' }).shipping)
      .toEqual({ zone: 'general', baseFee: 3000, extraFee: 0, fee: 3000 });
    expect(destinationShipping(selected, { postalCode: '63010', address: '제주특별자치도 제주시 검수로 1' }).shipping)
      .toEqual({ zone: 'jeju', baseFee: 3000, extraFee: 3000, fee: 6000 });
    expect(destinationShipping(selected, { postalCode: '12345', address: '경기도 검수시 검수로 1' }).shipping)
      .toEqual({ zone: 'remote', baseFee: 3000, extraFee: 5000, fee: 8000 });
    expect(destinationShipping(selected, { postalCode: '63001', address: '제주특별자치도 제주시 검수로 1' }).shipping)
      .toEqual({ zone: 'remote', baseFee: 3000, extraFee: 5000, fee: 8000 });
  });
  it.each([
    { postalCode: '63010', address: '서울특별시 검수로 1' },
    { postalCode: '10000', address: '제주특별자치도 제주시 검수로 1' },
  ])('rejects Jeju postal and address mismatches', destination => {
    expect(destinationShipping(product(policy), destination)).toEqual({ error: 'shipping_address_mismatch' });
  });
  it('never treats invalid stored policies or missing fees as free shipping', () => {
    expect(destinationShipping(product(), { postalCode: '10000', address: '검수 주소' })).toEqual({ error: 'shipping_configuration_pending' });
    expect(productRegionalShipping({ ...product(), regional_shipping_json: '{malformed' })).toBeNull();
    expect(destinationShipping({ ...product(policy), shipping_fee: null }, { postalCode: '10000', address: '검수 주소' }))
      .toEqual({ error: 'shipping_configuration_pending' });
  });
  it('returns zero shipping for digital products without needing an address', () => {
    const digital = { product_type: 'digital', shipping_fee: 0, regional_shipping_json: JSON.stringify(policy) };
    expect(productRegionalShipping(digital)).toBeNull(); expect(shippingPolicyReady(digital)).toBe(true);
    expect(destinationShipping(digital)).toEqual({ shipping: { zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 }, policy: null });
  });
  it('keeps the snapshot breakdown and uses the charged fee for legacy orders', () => {
    const stored = { zone: 'jeju', baseFee: 3000, extraFee: 3000, fee: 6000 };
    expect(orderShippingBreakdown({ shippingBreakdown: stored }, { product_type: 'physical', shipping_fee: 6000 })).toEqual(stored);
    expect(orderShippingBreakdown({}, { product_type: 'physical', shipping_fee: 3000 })).toEqual({ zone: 'general', baseFee: 3000, extraFee: 0, fee: 3000 });
    expect(orderShippingBreakdown({}, { product_type: 'digital', shipping_fee: 0 })).toEqual({ zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 });
  });
});
