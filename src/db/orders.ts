import { all, first, run, stmt } from './client';
import { rid } from '../util/misc';

export interface PlanRow {
  key: string;
  kind: 'subscription' | 'points';
  unit: string | null;
  qty: number;
  duration_days: number | null;
  price_minor: number;
  currency: string;
  is_active: number;
  is_featured: number;
  sort: number;
}

export interface OrderRow {
  id: string;
  user_id: number;
  plan_key: string;
  kind: string;
  title_ru: string;
  title_en: string;
  amount_minor: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired' | 'review';
  provider: string | null;
  provider_order_id: string | null;
  payment_url: string | null;
  created_at: number;
  paid_at: number | null;
  expires_at: number;
}

export async function listPlans(db: D1Database, kind?: 'subscription' | 'points'): Promise<PlanRow[]> {
  return kind
    ? all<PlanRow>(db, 'SELECT * FROM plans WHERE is_active=1 AND kind=? ORDER BY sort', kind)
    : all<PlanRow>(db, 'SELECT * FROM plans WHERE is_active=1 ORDER BY sort');
}

export async function getPlan(db: D1Database, key: string): Promise<PlanRow | null> {
  return first<PlanRow>(db, 'SELECT * FROM plans WHERE key=?', key);
}

export async function createOrder(
  db: D1Database,
  userId: number,
  plan: PlanRow,
  titleRu: string,
  titleEn: string,
  now: number,
  ttlSec: number,
): Promise<OrderRow> {
  const id = rid(20);
  await run(
    db,
    `INSERT INTO orders(id,user_id,plan_key,kind,title_ru,title_en,amount_minor,currency,status,created_at,expires_at)
     VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`,
    id,
    userId,
    plan.key,
    plan.kind,
    titleRu,
    titleEn,
    plan.price_minor,
    plan.currency,
    now,
    now + ttlSec,
  );
  return (await getOrder(db, userId, id))!;
}

export async function getOrder(db: D1Database, userId: number, id: string): Promise<OrderRow | null> {
  return first<OrderRow>(db, 'SELECT * FROM orders WHERE id=? AND user_id=?', id, userId);
}

export async function listOrders(db: D1Database, userId: number, limit: number): Promise<OrderRow[]> {
  return all<OrderRow>(db, 'SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, limit);
}

export async function setOrderPaymentUrl(db: D1Database, id: string, provider: string, providerOrderId: string, url: string): Promise<void> {
  await run(db, 'UPDATE orders SET provider=?, provider_order_id=?, payment_url=? WHERE id=?', provider, providerOrderId, url, id);
}

export async function setOrderStatus(db: D1Database, id: string, status: OrderRow['status'], paidAt: number | null): Promise<void> {
  await run(db, 'UPDATE orders SET status=?, paid_at=? WHERE id=?', status, paidAt, id);
}

/**
 * Mark an order paid exactly once. `payments` has a UNIQUE(provider, provider_payment_id)
 * constraint, so a duplicate webhook / duplicate manual /markpaid is rejected safely.
 */
export async function recordPaymentAndMarkPaid(
  db: D1Database,
  order: OrderRow,
  provider: string,
  providerPaymentId: string,
  now: number,
): Promise<boolean> {
  try {
    const res = await db.batch([
      stmt(db, 'INSERT INTO payments(order_id,provider,provider_payment_id,amount_minor,currency,created_at) VALUES(?,?,?,?,?,?)', order.id, provider, providerPaymentId, order.amount_minor, order.currency, now),
      stmt(db, "UPDATE orders SET status='paid', paid_at=? WHERE id=? AND status IN ('pending','review')", now, order.id),
    ]);
    return (res[1]?.meta?.changes ?? 0) === 1;
  } catch {
    return false; // UNIQUE constraint hit -> already processed
  }
}
