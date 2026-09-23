-- 0004_fix_workers_ai_llama31.sql
-- Cloudflare deprecated @cf/meta/llama-3.1-8b-instruct on 2026-05-30.
-- The active replacement is @cf/meta/llama-3.1-8b-instruct-fast.
-- This migration fixes databases where 0002_seed.sql was already applied.

UPDATE models
SET
  name = 'Llama 3.1 8B Fast',
  model_id = '@cf/meta/llama-3.1-8b-instruct-fast',
  max_input = 128000,
  max_output = 2048,
  config = '{"max_tokens":2048}'
WHERE key = 'llama-3-1-8b'
  AND provider = 'workers_ai';
