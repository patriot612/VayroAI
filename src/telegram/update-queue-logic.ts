export type UpdateQueueDecisionRow = {
  status: 'processing' | 'completed' | 'failed';
  updated_at: string;
};

export const UPDATE_PROCESSING_STALE_MS = 5 * 60 * 1000;

export function shouldRetryUpdate(
  row: UpdateQueueDecisionRow,
  nowMs = Date.now(),
  staleMs = UPDATE_PROCESSING_STALE_MS
): boolean {
  if (row.status === 'completed') return false;
  if (row.status === 'failed') return true;
  const updatedMs = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedMs)) return true;
  return nowMs - updatedMs >= staleMs;
}
