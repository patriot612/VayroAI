-- Provider-level payment method controls.
-- Separate from the global feature_payments flag so each provider can be
-- temporarily disabled without changing plan prices or other providers.
INSERT INTO settings(key,value,updated_at)
VALUES('payment_method_telegram_stars','1',datetime('now'))
ON CONFLICT(key) DO NOTHING;
