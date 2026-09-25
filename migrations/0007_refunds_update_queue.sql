-- Reliable Telegram update processing state + Telegram Stars refund audit data.

ALTER TABLE processed_updates ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE processed_updates ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE processed_updates ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE processed_updates ADD COLUMN last_error TEXT;

UPDATE processed_updates
SET updated_at=created_at
WHERE updated_at='';

UPDATE processed_updates
SET attempts=1
WHERE attempts=0;

ALTER TABLE payments ADD COLUMN refunded_at TEXT;
ALTER TABLE payments ADD COLUMN refunded_by INTEGER;
ALTER TABLE payments ADD COLUMN refund_error TEXT;
ALTER TABLE payments ADD COLUMN refund_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_processed_updates_status_updated
  ON processed_updates(status,updated_at);

CREATE INDEX IF NOT EXISTS idx_payments_status_provider
  ON payments(provider,status);

CREATE INDEX IF NOT EXISTS idx_orders_provider_status_created
  ON orders(provider,status,created_at);
