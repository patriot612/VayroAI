-- Telegram Stars payment provider for subscription plans.
-- Provider-specific pricing keeps the existing plan/RUB price intact and
-- leaves room for additional payment methods later.

CREATE TABLE IF NOT EXISTS plan_payment_prices(
  plan_key TEXT NOT NULL REFERENCES plans(plan_key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(plan_key,provider)
);

CREATE INDEX IF NOT EXISTS idx_plan_payment_prices_provider
  ON plan_payment_prices(provider,is_active);

-- Initial Telegram Stars price: 100 Stars for every active subscription plan.
INSERT INTO plan_payment_prices(plan_key,provider,currency,amount,is_active,updated_at)
SELECT plan_key,'telegram_stars','XTR',100,1,datetime('now')
FROM plans
WHERE kind='subscription' AND is_active=1
ON CONFLICT(plan_key,provider) DO NOTHING;

-- Enable the existing payment feature now that Telegram Stars is available.
UPDATE settings
SET value='1', updated_at=datetime('now')
WHERE key='feature_payments';
