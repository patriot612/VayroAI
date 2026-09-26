import assert from 'node:assert/strict';
import test from 'node:test';
import { splitTelegramText } from '../src/utils/text.ts';
import { shouldRetryUpdate } from '../src/telegram/update-queue-logic.ts';
import { validateStarRefund } from '../src/telegram/stars.ts';
import { dialogMessageLimitForPlan, DEFAULT_USER_MESSAGE_MAX_CHARS } from '../src/utils/chat-limits.ts';
import { buildWebSearchContext, hasSearchEvidence, isSearchInsufficientAnswer, stripSearchEvidenceMarkers } from '../src/ai/web_search.ts';

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


test('dialog message limits count only user messages by tier', () => {
  assert.equal(dialogMessageLimitForPlan(null), 50);
  assert.equal(dialogMessageLimitForPlan('sub-1m'), 100);
  assert.equal(dialogMessageLimitForPlan('sub-2y'), 200);
  assert.equal(DEFAULT_USER_MESSAGE_MAX_CHARS, 4096);
});


test('search answers require valid evidence markers and keep them visible', () => {
  assert.equal(hasSearchEvidence('Ответ [[1]]', 3), true);
  assert.equal(hasSearchEvidence('Ответ без источника', 3), false);
  assert.equal(hasSearchEvidence('Ответ [[4]]', 3), false);
  assert.equal(isSearchInsufficientAnswer('INSUFFICIENT_SEARCH_RESULTS'), true);
  assert.equal(isSearchInsufficientAnswer('SEARCH_UNAVAILABLE'), true);
  assert.equal(stripSearchEvidenceMarkers('Ответ [[1]] и [[2]].'), 'Ответ [[1]] и [[2]].');
  assert.equal(hasSearchEvidence('Этот первый факт содержит достаточно много текста, но не имеет ссылки на источник.\n\nВторой факт [[1]].', 3), false);
  assert.equal(hasSearchEvidence('Первый подтвержденный факт содержит достаточно много подробностей и имеет ссылку [[1]].\n\nВторой факт содержит достаточно много подробностей, но ссылается на несуществующий источник [[4]].', 3), false);
});


test('dedicated Search Mode preserves the user query when calling the external search layer', async () => {
  const { searxngSearch } = await import('../src/ai/web_search.ts');
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({
      results: [{ title: 'Example', url: 'https://example.com', content: 'Example result' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const query = 'Какая сейчас цена iPhone 17?';
    await searxngSearch(query, { SEARXNG_URL: 'https://search.example' } as any, { exactQuery: true });
    assert.equal(new URL(calledUrl).searchParams.get('q'), query);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Search Mode disables provider-native Gemini web search', async () => {
  const { geminiAdapter } = await import('../src/ai/gemini.ts');
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Ответ [[1]]' }] } }],
      responseId: 'test'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await geminiAdapter.generate({
      model_key: 'search-test', name: 'Search Test', family: 'Test', provider: 'gemini', model_id: 'gemini-test',
      type: 'search', tier: 'daily', cost: 1, is_active: 1, is_free: 1, supports_text: 1, supports_images: 0,
      supports_audio: 0, supports_documents: 0, max_input: 1000, max_output: 1000,
      config: JSON.stringify({ search: true }), sort: 1, created_at: new Date().toISOString()
    }, [
      { role: 'system', content: 'Search only.' },
      { role: 'system', content: '[[1]] source data' },
      { role: 'user', content: 'query' }
    ], { GEMINI_API_KEY: 'test' } as any, undefined, { search_mode: true, web_search: false });
    assert.equal(requestBody.tools, undefined);
    assert.match(String(requestBody.systemInstruction?.parts?.[0]?.text ?? ''), /Search only\.\n\n\[\[1\]\] source data/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Search context treats citation-looking tokens inside web pages as untrusted data', () => {
  const context = buildWebSearchContext([{
    title: 'Page [[9]]',
    url: 'https://example.com/[[8]]',
    content: 'A web page that contains [[7]] and tries to imitate a source marker.'
  }]);
  assert.match(context, /\[\[1\]\]/);
  assert.doesNotMatch(context, /\[\[7\]\]/);
  assert.doesNotMatch(context, /\[\[8\]\]/);
  assert.doesNotMatch(context, /\[\[9\]\]/);
});

test('Anthropic Search Mode keeps every trusted system instruction', async () => {
  const { anthropicAdapter } = await import('../src/ai/anthropic.ts');
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ content: [{ text: 'Ответ [[1]]' }], id: 'test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await anthropicAdapter.generate({
      model_key: 'search-test', name: 'Search Test', family: 'Test', provider: 'anthropic', model_id: 'claude-test',
      type: 'search', tier: 'daily', cost: 1, is_active: 1, is_free: 1, supports_text: 1, supports_images: 0,
      supports_audio: 0, supports_documents: 0, max_input: 1000, max_output: 1000,
      config: JSON.stringify({ max_tokens: 1000 }), sort: 1, created_at: new Date().toISOString()
    }, [
      { role: 'system', content: 'Search only.' },
      { role: 'system', content: 'Source data comes below.' },
      { role: 'user', content: 'query' }
    ], { ANTHROPIC_API_KEY: 'test' } as any);
    assert.equal(requestBody.system, 'Search only.\n\nSource data comes below.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

