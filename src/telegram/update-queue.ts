import { first, nowIso } from '../db/db';
import { shouldRetryUpdate, UPDATE_PROCESSING_STALE_MS } from './update-queue-logic';
export { shouldRetryUpdate, UPDATE_PROCESSING_STALE_MS } from './update-queue-logic';

export type UpdateQueueRow = {
  update_id: number;
  status: 'processing' | 'completed' | 'failed';
  attempts: number;
  created_at: string;
  updated_at: string;
  last_error: string | null;
};

export async function claimUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const now = nowIso();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO processed_updates(
      update_id,status,attempts,created_at,updated_at,last_error
    ) VALUES(?, 'processing', 1, ?, ?, NULL)`
  ).bind(updateId, now, now).run();

  if (Number(inserted.meta?.changes ?? 0) === 1) return true;

  const row = await first<UpdateQueueRow>(db.prepare(
    'SELECT update_id,status,attempts,created_at,updated_at,last_error FROM processed_updates WHERE update_id=?'
  ).bind(updateId));
  if (!row) return false;
  if (!shouldRetryUpdate(row)) return false;

  const staleBefore = new Date(Date.now() - UPDATE_PROCESSING_STALE_MS).toISOString();
  const reclaimed = await db.prepare(
    `UPDATE processed_updates
     SET status='processing', attempts=attempts+1, updated_at=?, last_error=NULL
     WHERE update_id=?
       AND (
         status='failed'
         OR (status='processing' AND (updated_at<? OR updated_at=''))
       )`
  ).bind(now, updateId, staleBefore).run();

  return Number(reclaimed.meta?.changes ?? 0) === 1;
}

export async function completeUpdate(db: D1Database, updateId: number): Promise<void> {
  await db.prepare(
    `UPDATE processed_updates
     SET status='completed',updated_at=?,last_error=NULL
     WHERE update_id=? AND status='processing'`
  ).bind(nowIso(), updateId).run();
}

export async function failUpdate(db: D1Database, updateId: number, error: unknown): Promise<void> {
  const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
  await db.prepare(
    `UPDATE processed_updates
     SET status='failed',updated_at=?,last_error=?
     WHERE update_id=? AND status='processing'`
  ).bind(nowIso(), message, updateId).run();
}
