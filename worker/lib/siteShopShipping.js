import { z } from 'zod';

const money = z.number().int().min(0).max(1_000_000_000);
const postalCode = z.string().regex(/^\d{5}$/);
const range = z.object({ start: postalCode, end: postalCode }).strict();
export const regionalShippingSchema = z.object({
  jejuExtraFee: money.nullable(),
  remoteExtraFee: money.nullable(),
  remotePostalRanges: z.array(range).max(500).nullable(),
}).strict().superRefine((value, context) => {
  const ranges = value.remotePostalRanges;
  if (ranges) {
    const ordered = [...ranges].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index].start > ordered[index].end || (index && ordered[index - 1].end >= ordered[index].start)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['remotePostalRanges'], message: '도서산간 우편번호 범위를 확인해주세요.' });
        break;
      }
    }
  }
  if (value.remoteExtraFee > 0 && Array.isArray(ranges) && ranges.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['remotePostalRanges'], message: '추가 배송비를 적용할 도서산간 우편번호를 등록해주세요.' });
  }
}).transform(value => ({ ...value, remotePostalRanges: value.remotePostalRanges === null ? null
  : [...value.remotePostalRanges].sort((left, right) => left.start.localeCompare(right.start)) }));

export function productRegionalShipping(product) {
  if (product.product_type !== 'physical' || product.regional_shipping_json == null) return null;
  let value;
  try { value = JSON.parse(product.regional_shipping_json); } catch { return null; }
  const result = regionalShippingSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function shippingPolicyReady(product) {
  if (product.product_type === 'digital') return true;
  const policy = productRegionalShipping(product);
  return !!policy && Number.isSafeInteger(policy.jejuExtraFee) && Number.isSafeInteger(policy.remoteExtraFee)
    && Array.isArray(policy.remotePostalRanges);
}

export function productFreeShippingThreshold(product) {
  if (product.product_type !== 'physical' || product.free_shipping_threshold == null) return null;
  const checked = money.safeParse(product.free_shipping_threshold);
  return checked.success ? checked.data : null;
}
export function chargedBaseShippingFee(product, itemAmount) {
  if (product.product_type === 'digital') return 0;
  const threshold = productFreeShippingThreshold(product);
  return threshold != null && Number.isSafeInteger(itemAmount) && itemAmount >= threshold ? 0 : product.shipping_fee;
}

export function destinationShipping(product, destination = {}, itemAmount = 0) {
  if (product.product_type === 'digital') return { shipping: { zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 }, policy: null };
  const policy = productRegionalShipping(product);
  if (!shippingPolicyReady(product) || product.free_shipping_threshold != null && !money.safeParse(product.free_shipping_threshold).success) {
    return { error: 'shipping_configuration_pending' };
  }
  if (!postalCode.safeParse(destination.postalCode).success || typeof destination.address !== 'string'
    || !destination.address.trim() || /[\x00-\x1f\x7f]/.test(destination.address)) return { error: 'shipping_address_invalid' };
  // Korea Post assigns the 63 prefix to Jeju. Remote-area ranges are supplied
  // by the seller for their chosen courier; no nationwide dataset is invented.
  const jejuPostal = /^63\d{3}$/.test(destination.postalCode);
  const jejuAddress = /^(?:제주특별자치도|제주도|제주)(?:\s|$)/.test(destination.address.trim());
  if (jejuPostal !== jejuAddress) return { error: 'shipping_address_mismatch' };
  const remote = policy.remotePostalRanges.some(item => item.start <= destination.postalCode && destination.postalCode <= item.end);
  const zone = remote ? 'remote' : jejuPostal ? 'jeju' : 'general';
  const extraFee = remote ? policy.remoteExtraFee : jejuPostal ? policy.jejuExtraFee : 0;
  const baseFee = chargedBaseShippingFee(product, itemAmount), fee = baseFee + extraFee;
  if (!Number.isSafeInteger(baseFee) || baseFee < 0 || !Number.isSafeInteger(fee) || fee > 1_000_000_000) return { error: 'shipping_configuration_pending' };
  return { shipping: { zone, baseFee, extraFee, fee }, policy };
}

export function orderShippingBreakdown(snapshot, order) {
  const value = snapshot.shippingBreakdown;
  if (value && ['general', 'jeju', 'remote', 'not_applicable'].includes(value.zone)
    && [value.baseFee, value.extraFee, value.fee].every(amount => Number.isSafeInteger(amount) && amount >= 0)
    && value.baseFee + value.extraFee === value.fee && value.fee === order.shipping_fee) {
    return { zone: value.zone, baseFee: value.baseFee, extraFee: value.extraFee, fee: value.fee };
  }
  return { zone: order.product_type === 'digital' ? 'not_applicable' : 'general', baseFee: order.shipping_fee, extraFee: 0, fee: order.shipping_fee };
}
