-- VayroAI hardening: indexes for fair FIFO image queues and cleanup.
CREATE INDEX IF NOT EXISTS idx_image_generations_user_status_created
  ON image_generations(user_id,status,created_at);

CREATE INDEX IF NOT EXISTS idx_image_generations_status_created
  ON image_generations(status,created_at);
