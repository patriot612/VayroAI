import type { Env } from '../env';
import { run, scalar } from '../db/client';
import { staleHolds, releaseHold } from '../db/points';
import { logEvent, logError } from '../util/misc';

const BATCH = 500;

/**
 * Hourly maintenance (Cron Trigger). Everything here is safe to run more than
 * once and safe to run late — cheap idempotent deletes / releases.
 * Keeps within the Workers Free 10ms CPU budget by deleting in small batches
 * (D1 I/O time does not count against CPU time, but very large single
 * statements can still be slow — batches keep each step small).
 */
export async function runCleanup(env: Env): Promise<void> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  const report: Record<string, number> = {};

  try {
    // 1) expired chat messages (core privacy requirement: no content older than 24h)
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const n = await run(db, 'DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE expires_at<=? LIMIT ?)', now, BATCH);
      total += n;
      if (n < BATCH) break;
    }
    report.messages = total;

    // 2) empty / idle chat shells past their expiry
    report.chats = await run(db, 'DELETE FROM chats WHERE expires_at<=? AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.chat_id=chats.id)', now);

    // 3) temporary document text + chunks (V3)
    report.documents = await run(db, 'DELETE FROM documents WHERE expires_at<=?', now);
    report.doc_chunks = await run(db, 'DELETE FROM document_chunks WHERE expires_at<=?', now);

    // 4) stale point holds (crashed mid-request) -> release back to the user
    const stale = await staleHolds(db, now - 900, 200);
    let released = 0;
    for (const id of stale) {
      if (await releaseHold(db, id, now)) released++;
    }
    report.holds_released = released;

    // 5) pending confirmation dialogs (e.g. "spend purchased points?")
    report.pending_actions = await run(db, 'DELETE FROM pending_actions WHERE expires_at<=?', now);

    // 6) expired orders left pending
    report.orders_expired = await run(db, "UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<=?", now);

    // 7) old dedupe / rate-limit / log rows (bounded retention, not user content)
    report.processed_updates = await run(db, 'DELETE FROM processed_updates WHERE created_at<=?', now - 3 * 86400);
    report.rate_limits = await run(db, 'DELETE FROM rate_limits WHERE bucket<=?', Math.floor((now - 3600) / 60));
    report.usage_logs = await run(db, 'DELETE FROM usage_logs WHERE created_at<=?', now - 90 * 86400);

    const remainingMessages = await scalar(db, 'SELECT COUNT(*) FROM messages');
    logEvent('cleanup_done', { ...report, remaining_messages: remainingMessages });
  } catch (e) {
    logError('cleanup_failed', e);
  }
}
