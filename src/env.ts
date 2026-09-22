/** Bindings, secrets and variables available to the Worker. */
export interface Env {
  // --- bindings ---
  DB: D1Database;
  /** Cloudflare Workers AI (optional; free 10k neurons/day). */
  AI?: Ai;

  // --- secrets (wrangler secret put ...) ---
  TELEGRAM_BOT_TOKEN: string;
  /** Random string; Telegram sends it back in X-Telegram-Bot-Api-Secret-Token. Also protects /setup. */
  WEBHOOK_SECRET: string;
  /** Telegram user id(s) of admins, comma separated. */
  ADMIN_TELEGRAM_ID: string;

  // --- provider secrets (only configure the ones you need) ---
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  KIMI_API_KEY?: string;

  // --- plain variables (wrangler.toml [vars]) ---
  DEFAULT_LANGUAGE?: string;
  SUPPORT_CONTACT?: string;
  PAYMENT_PROVIDER?: string;

  /** Extra secrets referenced by models.config.api_key_env (custom OpenAI-compatible providers). */
  [extra: string]: unknown;
}

export function adminIds(env: Env): number[] {
  return String(env.ADMIN_TELEGRAM_ID ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function isAdmin(env: Env, userId: number): boolean {
  return adminIds(env).includes(userId);
}

/** Read a string secret/var by name (used for config-driven API keys). */
export function envString(env: Env, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
