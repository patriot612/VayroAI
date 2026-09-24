PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  language TEXT NOT NULL DEFAULT 'ru',
  mode TEXT NOT NULL DEFAULT 'chat',
  mode_arg TEXT,
  current_chat_id TEXT,
  last_model_key TEXT,
  search_model_key TEXT,
  default_role_key TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  block_reason TEXT,
  bot_blocked INTEGER NOT NULL DEFAULT 0,
  processing_until TEXT,
  ui_message_id INTEGER,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_points INTEGER NOT NULL DEFAULT 0,
  free_reset_at TEXT NOT NULL,
  purchased_points INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS point_holds(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  free_amount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  free_reset_at TEXT,
  status TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  free_amount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models(
  model_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  family TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  type TEXT NOT NULL,
  tier TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_free INTEGER NOT NULL DEFAULT 0,
  supports_text INTEGER NOT NULL DEFAULT 1,
  supports_images INTEGER NOT NULL DEFAULT 0,
  supports_audio INTEGER NOT NULL DEFAULT 0,
  supports_documents INTEGER NOT NULL DEFAULT 0,
  max_input INTEGER,
  max_output INTEGER,
  config TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles(
  role_key TEXT PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  prompt TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS templates(
  id TEXT PRIMARY KEY,
  name_ru TEXT,
  name_en TEXT,
  prompt TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  model_key TEXT NOT NULL,
  role_key TEXT,
  custom_role TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans(
  plan_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER,
  price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  title_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_order_id TEXT,
  payment_url TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider,provider_payment_id)
);

CREATE TABLE IF NOT EXISTS usage_logs(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model_key TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts(
  id TEXT PRIMARY KEY,
  admin_user_id INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  text TEXT,
  caption TEXT,
  file_id TEXT,
  source_chat_id INTEGER,
  source_message_id INTEGER,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  progress_message_id INTEGER,
  last_user_id INTEGER NOT NULL DEFAULT 0,
  max_user_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_updates(
  update_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits(
  user_id INTEGER NOT NULL,
  bucket_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,bucket_start)
);

CREATE TABLE IF NOT EXISTS pending_actions(
  user_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_generations(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  filename TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_chunks(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_jobs(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_users_blocked ON users(is_blocked,bot_blocked);
CREATE INDEX IF NOT EXISTS idx_chats_user_archived_updated ON chats(user_id,is_archived,updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id,created_at);
CREATE INDEX IF NOT EXISTS idx_holds_status_created ON point_holds(status,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_expiry ON orders(status,expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_status_updated ON broadcasts(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_pending_expiry ON pending_actions(expires_at);

INSERT INTO settings(key,value,updated_at) VALUES
('free_points_daily','50',datetime('now')),
('free_points_subscriber','100',datetime('now')),
('free_period_hours','24',datetime('now')),
('confirm_purchased_spend','1',datetime('now')),
('message_ttl_hours','24',datetime('now')),
('context_max_messages','20',datetime('now')),
('context_max_chars','24000',datetime('now')),
('user_message_max_chars','8000',datetime('now')),
('auto_title','1',datetime('now')),
('ai_timeout_ms','25000',datetime('now')),
('rate_limit_per_minute','20',datetime('now')),
('feature_image','1',datetime('now')),
('feature_docs','0',datetime('now')),
('feature_voice','0',datetime('now')),
('feature_payments','0',datetime('now')),
('orders_page_size','10',datetime('now')),
('default_model_key','llama-3-1-8b',datetime('now'))
ON CONFLICT(key) DO NOTHING;

INSERT INTO models(model_key,name,family,provider,model_id,type,tier,cost,is_active,is_free,supports_text,supports_images,supports_audio,supports_documents,max_input,max_output,config,sort,created_at)
VALUES
('llama-3-1-8b','Llama 3.1 8B Fast','Llama','workers_ai','@cf/meta/llama-3.1-8b-instruct-fast','chat','daily',1,1,1,1,0,0,0,24000,2048,'{"max_tokens":2048,"temperature":0.4}',10,datetime('now'))
ON CONFLICT(model_key) DO UPDATE SET name=excluded.name,provider=excluded.provider,model_id=excluded.model_id,type=excluded.type,tier=excluded.tier,cost=excluded.cost,is_active=excluded.is_active,is_free=excluded.is_free,config=excluded.config;

INSERT INTO models(model_key,name,family,provider,model_id,type,tier,cost,is_active,is_free,supports_text,config,sort,created_at)
VALUES
('gemini-2-5-flash-lite-search','Gemini 2.5 Flash-Lite','Gemini','gemini','gemini-2.5-flash-lite','search','daily',2,1,0,1,'{"search":true,"max_tokens":2048}',20,datetime('now')),
('gemini-2-5-flash-search','Gemini 2.5 Flash','Gemini','gemini','gemini-2.5-flash','search','advanced',5,1,0,1,'{"search":true,"max_tokens":4096}',21,datetime('now'))
ON CONFLICT(model_key) DO NOTHING;

INSERT INTO roles(role_key,name_ru,name_en,prompt,sort,is_active) VALUES
('assistant','Помощник','Assistant','Ты полезный AI-помощник. Отвечай ясно, точно и по делу.',10,1),
('editor','Редактор','Editor','Ты профессиональный редактор. Улучшай тексты, сохраняя смысл и стиль пользователя.',20,1),
('translator','Переводчик','Translator','Ты профессиональный переводчик. Сохраняй смысл, тон и естественность перевода.',30,1),
('teacher','Учитель','Teacher','Ты внимательный преподаватель. Объясняй пошагово и адаптируй сложность под пользователя.',40,1),
('programmer','Программист','Programmer','Ты опытный программист. Пиши рабочий код, объясняй ключевые решения и учитывай ограничения среды.',50,1)
ON CONFLICT(role_key) DO NOTHING;

INSERT INTO plans(plan_key,kind,title_ru,title_en,points,duration_days,price_minor,currency,is_active,sort) VALUES
('sub-1w','subscription','1 неделя','1 week',0,7,19900,'RUB',1,10),
('sub-1m','subscription','1 месяц','1 month',0,30,69900,'RUB',1,20),
('sub-3m','subscription','3 месяца','3 months',0,90,139900,'RUB',1,30),
('sub-6m','subscription','6 месяцев','6 months',0,180,239900,'RUB',1,40),
('sub-1y','subscription','1 год','1 year',0,365,359900,'RUB',1,50),
('sub-2y','subscription','2 года','2 years',0,730,649900,'RUB',1,60),
('pts-100','points','100 баллов','100 points',100,NULL,9900,'RUB',0,110),
('pts-500','points','500 баллов','500 points',500,NULL,39000,'RUB',0,120),
('pts-1000','points','1000 баллов','1000 points',1000,NULL,69000,'RUB',0,130),
('pts-5000','points','5000 баллов','5000 points',5000,NULL,299000,'RUB',0,140)
ON CONFLICT(plan_key) DO NOTHING;
