import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTelegramText } from '../src/utils/text.ts';
import { shouldRetryUpdate } from '../src/telegram/update-queue-logic.ts';
import { validateStarRefund } from '../src/telegram/stars.ts';

test('update queue does not retry a fresh processing update', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  assert.equal(
    shouldRetryUpdate(
      { status: 'processing', updated_at: '2026-09-25T11:59:00.000Z' },
      now,
      120_000
    ),
    false
  );
});

test('update queue retries a stale processing update', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  assert.equal(
    shouldRetryUpdate(
      { status: 'processing', updated_at: '2026-09-25T11:57:00.000Z' },
      now,
      120_000
    ),
    true
  );
});

test('failed update is eligible for retry and completed update is not', () => {
  assert.equal(shouldRetryUpdate({ status: 'failed', updated_at: '2026-09-25T12:00:00.000Z' }), true);
  assert.equal(shouldRetryUpdate({ status: 'completed', updated_at: '2026-09-25T12:00:00.000Z' }), false);
});

test('refund is allowed only for a paid Telegram Stars payment', () => {
  assert.deepEqual(
    validateStarRefund({
      order_status: 'paid',
      provider: 'telegram_stars',
      currency: 'XTR',
      payment_status: 'paid',
      charge_id: 'charge_123',
      user_id: 123
    }),
    { ok: true }
  );
  assert.equal(validateStarRefund({
    order_status: 'paid', provider: 'telegram_stars', currency: 'XTR', payment_status: 'refunded', charge_id: 'charge_123', user_id: 123
  }).ok, false);
  assert.equal(validateStarRefund({
    order_status: 'paid', provider: 'other', currency: 'RUB', payment_status: 'paid', charge_id: 'charge_123', user_id: 123
  }).ok, false);
});

test('long Telegram HTML is split without breaking markup', () => {
  const source = `<b>${'Тест '.repeat(1400)}</b>\n<a href="https://example.com">ссылка</a>`;
  const parts = splitTelegramText(source, 3900);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(!part.includes('<b>') || part.includes('</b>'));
    assert.ok(!part.includes('<a href=') || part.includes('</a>'));
  }
});
