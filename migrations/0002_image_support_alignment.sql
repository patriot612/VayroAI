-- Align image feature gating and image-model metadata for existing installations.
INSERT INTO settings(key,value,updated_at)
VALUES('feature_image','1',datetime('now'))
ON CONFLICT(key) DO NOTHING;

UPDATE models
SET supports_images=1
WHERE type='image';
