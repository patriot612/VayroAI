-- Qwen3.8 Max Premium via xKiro, plus per-chat AI settings.
CREATE TABLE IF NOT EXISTS chat_ai_settings(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL REFERENCES models(model_key) ON DELETE CASCADE,
  reasoning_mode TEXT NOT NULL DEFAULT 'deep',
  web_search_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,chat_id,model_key)
);

CREATE INDEX IF NOT EXISTS idx_chat_ai_settings_user_chat
  ON chat_ai_settings(user_id,chat_id);

INSERT INTO models(
  model_key,name,family,provider,model_id,type,tier,cost,is_active,is_free,
  supports_text,supports_images,supports_audio,supports_documents,
  max_input,max_output,config,sort,created_at
)
VALUES(
  'qwen3-8-max-premium',
  'Qwen3.8 Max',
  'Qwen',
  'xkiro',
  'qwen/qwen3.8-max:free',
  'chat',
  'advanced',
  1,
  1,
  0,
  1,
  1,
  0,
  0,
  24000,
  65536,
  '{"emoji":"⭐","premium":true,"reasoning":true,"web_search":true,"streaming":true,"structured_output":true,"function_calling":true,"video":false,"web_search_count":5,"max_tokens":65536}',
  15,
  datetime('now')
)
ON CONFLICT(model_key) DO UPDATE SET
  name=excluded.name,
  family=excluded.family,
  provider=excluded.provider,
  model_id=excluded.model_id,
  type=excluded.type,
  tier=excluded.tier,
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
