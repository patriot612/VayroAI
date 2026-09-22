import { all, run } from './client';

/** Defaults; every key can be overridden in the D1 `settings` table (admin: /setting key value). */
export const SETTING_DEFAULTS: Record<string, string> = {
  // points
  free_points_daily: '50', // free points per period for everyone
  free_points_subscriber: '100', // free points per period for active subscribers
  free_period_hours: '24', // refill period; unused free points do NOT carry over
  confirm_purchased_spend: '1', // ask before spending purchased points
  // privacy / retention
  message_ttl_hours: '24', // chat message lifetime (hard-capped at 24)
  chat_ttl_hours: '168', // an idle chat "shell" (title, model) is deleted after this
  // chat behaviour
  context_max_messages: '20',
  context_max_chars: '24000',
  user_message_max_chars: '8000',
  auto_title: '1',
  ai_timeout_ms: '25000', // Workers waitUntil() budget is 30 s -> keep below
  // protection
  rate_limit_per_minute: '20',
  // features (V1 = chat, search, roles; later versions flip these on)
  feature_images: '0',
  feature_docs: '0',
  feature_voice: '0',
  feature_payments: '0',
  // documents (V3)
  doc_max_mb: '10',
  doc_max_pages: '50',
  doc_max_chars: '24000',
  // voice (V4)
  voice_max_seconds: '60',
  // misc
  orders_page_size: '10',
  default_model_key: '',
};

export class Settings {
  constructor(private readonly map: Record<string, string>) {}
  str(key: string): string {
    return this.map[key] ?? SETTING_DEFAULTS[key] ?? '';
  }
  int(key: string): number {
    const n = Number(this.str(key));
    return Number.isFinite(n) ? Math.trunc(n) : Number(SETTING_DEFAULTS[key] ?? 0);
  }
  bool(key: string): boolean {
    return this.str(key) === '1' || this.str(key).toLowerCase() === 'true';
  }
  get all(): Record<string, string> {
    return { ...SETTING_DEFAULTS, ...this.map };
  }
  /** Message lifetime in seconds — never more than 24 h (privacy requirement). */
  get messageTtlSec(): number {
    const h = Math.min(24, Math.max(1, this.int('message_ttl_hours') || 24));
    return h * 3600;
  }
  get chatTtlSec(): number {
    return Math.max(24, this.int('chat_ttl_hours') || 168) * 3600;
  }
}

let cache: { at: number; settings: Settings } | null = null;

export async function loadSettings(db: D1Database, force = false): Promise<Settings> {
  const now = Date.now();
  if (!force && cache && now - cache.at < 20_000) return cache.settings;
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  cache = { at: now, settings: new Settings(map) };
  return cache.settings;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await run(db, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
  cache = null;
}
