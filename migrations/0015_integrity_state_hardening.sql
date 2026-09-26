-- VayroAI integrity/state hardening. Forward-only migration.
-- Keeps the existing UI/business behavior while making pending state, billing
-- invariants and image recovery materially safer under concurrent Workers.

-- pending_actions used to allow only one row per user. Rebuild it with a
-- per-(user,kind) key so independent flows no longer overwrite each other.
DROP INDEX IF EXISTS idx_pending_expiry;
ALTER TABLE pending_actions RENAME TO pending_actions_legacy;

CREATE TABLE pending_actions(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,kind)
);

INSERT INTO pending_actions(user_id,kind,payload,expires_at,created_at)
SELECT user_id,kind,payload,expires_at,created_at
FROM pending_actions_legacy;

DROP TABLE pending_actions_legacy;

CREATE INDEX idx_pending_expiry
  ON pending_actions(expires_at);
CREATE INDEX idx_pending_user_expiry
  ON pending_actions(user_id,expires_at);

-- Financial/database-level idempotency guards. Existing installations are
-- expected to have no duplicate values; the migration intentionally fails
-- instead of silently changing financial history if that invariant is broken.
CREATE UNIQUE INDEX uq_chats_user_seq
  ON chats(user_id,seq);

CREATE UNIQUE INDEX uq_subscriptions_order
  ON subscriptions(order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX uq_transactions_user_kind_ref
  ON transactions(user_id,kind,ref)
  WHERE ref IS NOT NULL AND kind <> 'admin';

ALTER TABLE users ADD COLUMN reply_keyboard_claimed_at TEXT;

CREATE TABLE image_queue_slots(
  slot_id INTEGER PRIMARY KEY,
  generation_id TEXT UNIQUE,
  claimed_at TEXT
);
INSERT OR IGNORE INTO image_queue_slots(slot_id) VALUES(1),(2),(3),(4),(5);
CREATE INDEX idx_image_queue_slots_claimed ON image_queue_slots(generation_id,claimed_at);

CREATE UNIQUE INDEX uq_payments_order
  ON payments(order_id);

CREATE INDEX idx_subscriptions_order
  ON subscriptions(order_id);

CREATE INDEX idx_orders_payment_identity
  ON orders(provider,provider_order_id,status);

CREATE INDEX idx_usage_user_created
  ON usage_logs(user_id,created_at);

-- Image jobs keep critical recovery data outside the opaque JSON payload.
ALTER TABLE image_generations ADD COLUMN hold_id TEXT;
ALTER TABLE image_generations ADD COLUMN started_at TEXT;

UPDATE image_generations
SET
  hold_id=CASE WHEN json_valid(prompt) THEN json_extract(prompt,'$.holdId') ELSE NULL END,
  started_at=CASE WHEN json_valid(prompt) THEN json_extract(prompt,'$.startedAt') ELSE NULL END
WHERE prompt IS NOT NULL;

CREATE INDEX idx_image_generations_hold_status
  ON image_generations(hold_id,status);
CREATE INDEX idx_image_generations_user_status
  ON image_generations(user_id,status);
