-- External SearXNG web-search route for Qwen3.8 Max.
-- This search model is separate from the normal Qwen chat model so its price is independent.
INSERT INTO models(
  model_key,name,family,provider,model_id,type,tier,cost,is_active,is_free,
  supports_text,supports_images,supports_audio,supports_documents,
  max_input,max_output,config,sort,created_at
)
VALUES(
  'qwen3-8-max-web-search',
  'Qwen3.8 Max',
  'Qwen',
  'xkiro',
  'qwen/qwen3.8-max:free',
  'search',
  'daily',
  5,
  1,
  1,
  1,
  0,
  0,
  0,
  24000,
  65536,
  '{"emoji":"🔎","premium":false,"search_provider":"searxng","max_results":5,"reasoning_effort":"high","max_tokens":65536,"streaming":true}',
  16,
  datetime('now')
)
ON CONFLICT(model_key) DO UPDATE SET
  name=excluded.name,
  family=excluded.family,
  provider=excluded.provider,
  model_id=excluded.model_id,
  type=excluded.type,
  tier=excluded.tier,
  cost=excluded.cost,
  is_active=excluded.is_active,
  is_free=excluded.is_free,
  supports_text=excluded.supports_text,
  supports_images=excluded.supports_images,
  supports_audio=excluded.supports_audio,
  supports_documents=excluded.supports_documents,
  max_input=excluded.max_input,
  max_output=excluded.max_output,
  config=excluded.config,
  sort=excluded.sort;
