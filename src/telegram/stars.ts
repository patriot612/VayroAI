export type RefundableStarsOrder = {
  order_status: string;
  provider: string | null;
  currency: string;
  payment_status: string;
  charge_id: string | null;
  user_id: number;
};

export type StarRefundMode = 'refund_only' | 'refund_revoke';

export type StarRefundValidation =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_paid' | 'not_stars' | 'already_refunded' | 'missing_charge' };

export function validateStarRefund(order: RefundableStarsOrder | null): StarRefundValidation {
  if (!order) return { ok: false, reason: 'not_found' };
  if (order.payment_status === 'refunded' || order.order_status === 'refunded') {
    return { ok: false, reason: 'already_refunded' };
  }
  if (order.order_status !== 'paid' || order.payment_status !== 'paid') {
    return { ok: false, reason: 'not_paid' };
  }
  if (order.provider !== 'telegram_stars' || order.currency !== 'XTR') {
    return { ok: false, reason: 'not_stars' };
  }
  if (!order.charge_id) return { ok: false, reason: 'missing_charge' };
  return { ok: true };
}
