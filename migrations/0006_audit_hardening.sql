-- Audit hardening for existing and fresh installations.
-- Keep the current feature flag behavior explicit in D1.
INSERT INTO settings(key,value,updated_at)
VALUES('feature_search','1',datetime('now'))
ON CONFLICT(key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_expires
  ON subscriptions(user_id,expires_at);

CREATE INDEX IF NOT EXISTS idx_payments_order
  ON payments(order_id);
