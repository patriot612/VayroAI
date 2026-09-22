import { first, run, stmt } from './client';
import { rid } from '../util/misc';
import type { Settings } from './settings';

export interface Balance {
  free: number;
  freeLimit: number;
  freeResetAt: number;
  paid: number;
  subExpiresAt: number | null;
  hasSub: boolean;
}

interface BalanceRow {
  free_points: number;
  free_reset_at: number;
  purchased_points: number;
  sub_expires: number | null;
}

/**
 * Read the balance. Free points are refilled lazily (no cron needed):
 * when the period is over the balance is RESET to the limit (no carry-over).
 */
export async function getBalance(db: D1Database, userId: number, settings: Settings, now: number): Promise<Balance> {
  const sql = `SELECT b.free_points, b.free_reset_at, b.purchased_points,
                      (SELECT MAX(expires_at) FROM subscriptions s WHERE s.user_id=b.user_id) AS sub_expires
               FROM balances b WHERE b.user_id=?`;
  let row = await first<BalanceRow>(db, sql, userId);
  if (!row) {
    await run(db, 'INSERT OR IGNORE INTO balances(user_id,free_points,free_reset_at,purchased_points,updated_at) VALUES(?,0,0,0,?)', userId, now);
    row = (await first<BalanceRow>(db, sql, userId))!;
  }
  const hasSub = (row.sub_expires ?? 0) > now;
  const freeLimit = hasSub ? settings.int('free_points_subscriber') : settings.int('free_points_daily');
  let free = row.free_points;
  let resetAt = row.free_reset_at;

  if (now >= resetAt) {
    const period = Math.max(1, settings.int('free_period_hours')) * 3600;
    const newReset = now + period;
    const res = await db.batch([
      stmt(db, 'UPDATE balances SET free_points=?, free_reset_at=?, updated_at=? WHERE user_id=? AND free_reset_at<=?', freeLimit, newReset, now, userId, now),
      stmt(
        db,
        `INSERT INTO transactions(user_id,kind,delta_free,delta_paid,ref,created_at)
         SELECT ?,'refill',?,0,'period',? WHERE changes()=1`,
        userId,
        freeLimit - free,
        now,
      ),
    ]);
    if ((res[0]?.meta?.changes ?? 0) === 1) {
      free = freeLimit;
      resetAt = newReset;
    } else {
      // somebody else refilled at the same moment — read again
      const fresh = (await first<BalanceRow>(db, sql, userId))!;
      free = fresh.free_points;
      resetAt = fresh.free_reset_at;
    }
  }
  return { free, freeLimit, freeResetAt: resetAt, paid: row.purchased_points, subExpiresAt: row.sub_expires, hasSub };
}

export interface ChargePlan {
  ok: boolean;
  free: number;
  paid: number;
  reason?: 'insufficient';
}

/**
 * Which balance pays for an answer?
 *  - "daily" models: free points first, then purchased points.
 *  - "advanced" models: subscribers may use their daily points; everybody else pays with purchased points.
 */
export function planCharge(bal: Balance, cost: number, tier: 'daily' | 'advanced'): ChargePlan {
  if (cost <= 0) return { ok: true, free: 0, paid: 0 };
  const freeUsable = tier === 'advanced' && !bal.hasSub ? 0 : bal.free;
  const free = Math.min(freeUsable, cost);
  const paid = cost - free;
  if (paid > bal.paid) return { ok: false, free: 0, paid: 0, reason: 'insufficient' };
  return { ok: true, free, paid };
}

/**
 * Atomically reserve points. Returns a hold id or null when the balance changed / is too low.
 * The 3 statements run in one D1 batch (= one transaction); the changes() guards make the
 * hold + ledger rows appear only if the balance UPDATE actually took effect.
 */
export async function reservePoints(
  db: D1Database,
  userId: number,
  plan: { free: number; paid: number },
  freeResetAt: number,
  ref: string,
  now: number,
): Promise<string | null> {
  const holdId = rid(14);
  const res = await db.batch([
    stmt(
      db,
      `UPDATE balances SET free_points=free_points-?, purchased_points=purchased_points-?, updated_at=?
       WHERE user_id=? AND free_points>=? AND purchased_points>=? AND free_reset_at=?`,
      plan.free,
      plan.paid,
      now,
      userId,
      plan.free,
      plan.paid,
      freeResetAt,
    ),
    stmt(
      db,
      `INSERT INTO point_holds(id,user_id,free_amount,paid_amount,free_reset_at,status,ref,created_at)
       SELECT ?,?,?,?,?,'held',?,? WHERE changes()=1`,
      holdId,
      userId,
      plan.free,
      plan.paid,
      freeResetAt,
      ref,
      now,
    ),
    stmt(
      db,
      `INSERT INTO transactions(user_id,kind,delta_free,delta_paid,ref,hold_id,created_at)
       SELECT ?,'reserve',?,?,?,?,? WHERE changes()=1`,
      userId,
      -plan.free,
      -plan.paid,
      ref,
      holdId,
      now,
    ),
  ]);
  return (res[0]?.meta?.changes ?? 0) === 1 ? holdId : null;
}

/** Statement that confirms a reservation (points stay spent). Add it to the success batch. */
export function captureStatement(db: D1Database, holdId: string, now: number): D1PreparedStatement {
  return stmt(db, "UPDATE point_holds SET status='captured', finished_at=? WHERE id=? AND status='held'", now, holdId);
}

/** Give the reserved points back (failure path). Idempotent: only a 'held' reservation is released. */
export async function releaseHold(db: D1Database, holdId: string, now: number): Promise<boolean> {
  const res = await db.batch([
    stmt(db, "UPDATE point_holds SET status='released', finished_at=? WHERE id=? AND status='held'", now, holdId),
    stmt(
      db,
      `UPDATE balances SET
         purchased_points = purchased_points + (SELECT paid_amount FROM point_holds WHERE id=?),
         free_points = free_points + (SELECT CASE WHEN balances.free_reset_at = h.free_reset_at THEN h.free_amount ELSE 0 END
                                      FROM point_holds h WHERE h.id=?),
         updated_at=?
       WHERE user_id=(SELECT user_id FROM point_holds WHERE id=?) AND changes()=1`,
      holdId,
      holdId,
      now,
      holdId,
    ),
    stmt(
      db,
      `INSERT INTO transactions(user_id,kind,delta_free,delta_paid,ref,hold_id,created_at)
       SELECT h.user_id,'release',
              CASE WHEN b.free_reset_at = h.free_reset_at THEN h.free_amount ELSE 0 END,
              h.paid_amount, h.ref, h.id, ?
       FROM point_holds h JOIN balances b ON b.user_id=h.user_id
       WHERE h.id=? AND changes()=1`,
      now,
      holdId,
    ),
  ]);
  return (res[0]?.meta?.changes ?? 0) === 1;
}

/** Admin / purchase adjustments of purchased points (clamped at 0). */
export async function adjustPurchased(db: D1Database, userId: number, delta: number, kind: string, ref: string, now: number): Promise<void> {
  await db.batch([
    stmt(db, 'UPDATE balances SET purchased_points=MAX(0, purchased_points+?), updated_at=? WHERE user_id=?', delta, now, userId),
    stmt(db, 'INSERT INTO transactions(user_id,kind,delta_free,delta_paid,ref,created_at) VALUES(?,?,0,?,?,?)', userId, kind, delta, ref, now),
  ]);
}

/** Release reservations that were never confirmed (worker crashed mid-request). */
export async function staleHolds(db: D1Database, olderThan: number, limit: number): Promise<string[]> {
  const rows = await db.prepare("SELECT id FROM point_holds WHERE status='held' AND created_at<? ORDER BY created_at LIMIT ?").bind(olderThan, limit).all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}
