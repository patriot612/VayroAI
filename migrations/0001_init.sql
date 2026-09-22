-- =====================================================================
-- 0001_init.sql — schema for the Telegram AI assistant (Cloudflare D1)
-- All timestamps are UNIX seconds (UTC).
-- Data-minimisation: message text / documents carry expires_at and are
-- purged by the hourly cron (see src/jobs/cleanup.ts).
-- =====================================================================

-- ---------- users & account ----------
CREATE TABLE users (
  id               INTEGER PRIMARY KEY,               -- Telegram user id
  username         TEXT,
  first_name       TEXT,
  language         TEXT    NOT NULL DEFAULT 'ru',     -- 'ru' | 'en'
  mode             TEXT    NOT NULL DEFAULT 'chat',   -- what the NEXT message means
  mode_arg         TEXT,                              -- e.g. chat id being renamed
  current_chat_id  TEXT,
  last_model_key   TEXT,                              -- model used for new chats
  search_model_key TEXT,
  default_role_key TEXT,
  is_blocked       INTEGER NOT NULL DEFAULT 0,
  block_reason     TEXT,
  bot_blocked      INTEGER NOT NULL DEFAULT 0,        -- user blocked the bot
  processing_until INTEGER NOT NULL DEFAULT 0,        -- per-user request lock
  created_at       INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL
);
CREATE INDEX idx_users_last_seen ON users(last_seen_at);

CREATE TABLE balances (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_points      INTEGER NOT NULL DEFAULT 0,        -- refilled per period, no carry-over
  free_reset_at    INTEGER NOT NULL DEFAULT 0,        -- next refill time
  purchased_points INTEGER NOT NULL DEFAULT 0,        -- never expire
  updated_at       INTEGER NOT NULL
);

-- Reservation ledger: points are taken at "reserve", confirmed at "capture",
-- given back at "release". Stale holds are released by cron.
CREATE TABLE point_holds (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  free_amount   INTEGER NOT NULL,
  paid_amount   INTEGER NOT NULL,
  free_reset_at INTEGER NOT NULL,                     -- free period the points were taken from
  status        TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','captured','released')),
  ref           TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_holds_status ON point_holds(status, created_at);

-- Every balance change writes a row here.
CREATE TABLE transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                           -- refill|reserve|release|purchase|admin|subscription_bonus
  delta_free INTEGER NOT NULL DEFAULT 0,
  delta_paid INTEGER NOT NULL DEFAULT 0,
  ref        TEXT,
  hold_id    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tx_user ON transactions(user_id, id);

CREATE TABLE subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_key   TEXT,
  starts_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'order',           -- order | admin
  order_id   TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_subs_user ON subscriptions(user_id, expires_at);

-- ---------- AI models / roles / templates ----------
CREATE TABLE models (
  key                 TEXT PRIMARY KEY,               -- stable slug
  name                TEXT NOT NULL,                  -- display name
  family              TEXT NOT NULL,                  -- UI group: GPT, Claude, Gemini, DeepSeek, Kimi, Llama...
  provider            TEXT NOT NULL,                  -- adapter: gemini|openai|anthropic|deepseek|kimi|openai_compat|workers_ai
  model_id            TEXT NOT NULL,                  -- provider-side model id
  type                TEXT NOT NULL DEFAULT 'chat',   -- chat|search|image|stt|tts
  tier                TEXT NOT NULL DEFAULT 'daily',  -- daily | advanced
  cost                INTEGER NOT NULL DEFAULT 1,     -- points per answer
  is_active           INTEGER NOT NULL DEFAULT 1,
  is_free             INTEGER NOT NULL DEFAULT 1,
  supports_text       INTEGER NOT NULL DEFAULT 1,
  supports_images     INTEGER NOT NULL DEFAULT 0,
  supports_audio      INTEGER NOT NULL DEFAULT 0,
  supports_documents  INTEGER NOT NULL DEFAULT 0,
  max_input           INTEGER,
  max_output          INTEGER,
  config              TEXT NOT NULL DEFAULT '{}',     -- JSON: base_url, api_key_env, thinking_level, extra body...
  sort                INTEGER NOT NULL DEFAULT 100,
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_models_type ON models(type, is_active, sort);

CREATE TABLE roles (
  key       TEXT PRIMARY KEY,
  name_ru   TEXT NOT NULL,
  name_en   TEXT NOT NULL,
  prompt    TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE templates (
  key       TEXT PRIMARY KEY,
  category  TEXT NOT NULL,
  icon      TEXT NOT NULL DEFAULT '',
  name_ru   TEXT NOT NULL,
  name_en   TEXT NOT NULL,
  prompt    TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 100
);

-- ---------- conversations (content expires) ----------
CREATE TABLE chats (
  id          TEXT PRIMARY KEY,                       -- random public id
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,                       -- per-user number ("Новый диалог №3")
  title       TEXT,
  model_key   TEXT NOT NULL,
  role_key    TEXT,
  custom_role TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL                        -- empty shell is deleted after this
);
CREATE INDEX idx_chats_user ON chats(user_id, is_archived, updated_at);
CREATE INDEX idx_chats_expires ON chats(expires_at);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  cost       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL                         -- max 24h after created_at
);
CREATE INDEX idx_messages_chat ON messages(chat_id, id);
CREATE INDEX idx_messages_expires ON messages(expires_at);

-- ---------- temporary tool data (reserved for V2-V4) ----------
CREATE TABLE image_generations (                      -- metadata only, NEVER image bytes
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  model_key  TEXT,
  resolution TEXT,
  ratio      TEXT,
  status     TEXT NOT NULL,
  points     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename          TEXT,
  temporary_content TEXT,                             -- extracted text, expires
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL
);
CREATE INDEX idx_documents_expires ON documents(expires_at);

CREATE TABLE document_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  content     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_chunks_doc ON document_chunks(document_id, idx);

-- Confirmation dialogs (e.g. "spend purchased points?") — short-lived.
CREATE TABLE pending_actions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_pending_expires ON pending_actions(expires_at);

-- ---------- commerce (V5 infrastructure) ----------
CREATE TABLE plans (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('subscription','points')),
  unit          TEXT,                                 -- week|month|year (subscription)
  qty           INTEGER NOT NULL DEFAULT 1,           -- number of units / points in the pack
  duration_days INTEGER,                              -- subscription length
  price_minor   INTEGER NOT NULL,                     -- kopecks
  currency      TEXT NOT NULL DEFAULT 'RUB',
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_featured   INTEGER NOT NULL DEFAULT 0,           -- shown on the first plans screen
  sort          INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE orders (
  id                TEXT PRIMARY KEY,                 -- uuid
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_key          TEXT NOT NULL,
  kind              TEXT NOT NULL,
  title_ru          TEXT NOT NULL,
  title_en          TEXT NOT NULL,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'RUB',
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','cancelled','expired','review')),
  provider          TEXT,
  provider_order_id TEXT,
  payment_url       TEXT,
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER,
  expires_at        INTEGER NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);

-- One row per successful provider payment. UNIQUE stops double processing.
CREATE TABLE payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            TEXT NOT NULL REFERENCES orders(id),
  provider            TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount_minor        INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  UNIQUE (provider, provider_payment_id)
);

-- ---------- operations ----------
CREATE TABLE usage_logs (                             -- technical statistics only, no content
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,                           -- chat|search|image|document|voice
  model_key  TEXT,
  status     TEXT NOT NULL,                           -- ok|error
  error_code TEXT,
  points     INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_usage_created ON usage_logs(created_at);
CREATE INDEX idx_usage_user ON usage_logs(user_id, created_at);

CREATE TABLE broadcasts (                             -- reserved for V6
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  blocked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Telegram retries: each update_id is processed once.
CREATE TABLE processed_updates (
  update_id  INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_processed_created ON processed_updates(created_at);

CREATE TABLE rate_limits (
  user_id INTEGER NOT NULL,
  bucket  INTEGER NOT NULL,                           -- minute bucket
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);
