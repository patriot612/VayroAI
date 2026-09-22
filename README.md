# Telegram AI Assistant Bot (V1)

A Telegram AI assistant bot built on **Cloudflare Workers + D1**, with a UX
structure inspired by a reference bot's screenshots (menu layout, button
organization, wording style) — **without** copying that bot's name, logo, or
branding. Two languages: 🇷🇺 Russian (default) and 🇬🇧 English.

This is **V1** of the phased roadmap in the original spec: `/start`, language
selection, main menu, AI chat, the AI Router, free AI models, model
selection, conversations, 24‑hour message expiration, a points system,
account screen, basic admin commands, and automatic cleanup.

V2 (images), V3 (search/documents/roles — search and roles are already
included below), V4 (voice/TTS), V5 (payments) and V6 (broadcasts/advanced
stats) are scaffolded in the schema and code but intentionally minimal or
stubbed — see **"What's implemented vs. stubbed"** below.

---

## 1. Requirements

- A [Cloudflare](https://dash.cloudflare.com) account (Workers Free plan is enough to start).
- [Node.js](https://nodejs.org) 18+ and npm.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- At least one free AI provider API key (recommended: **Google Gemini**, see below).

## 2. Install

```bash
npm install
```

This installs `wrangler`, TypeScript, and `@cloudflare/workers-types`.

## 3. Create the D1 database

```bash
npx wrangler login
npx wrangler d1 create tg-ai-assistant
```

Copy the printed `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tg-ai-assistant"
database_id = "PASTE-IT-HERE"
```

Apply the schema + seed data:

```bash
npm run db:migrate          # remote (production) database
npm run db:migrate:local    # local database, for `wrangler dev`
```

Migrations live in `migrations/`:
- `0001_init.sql` — full schema (users, chats, messages, points, orders, …).
- `0002_seed.sql` — default free models, roles, image templates, subscription
  plans. **Edit this file (or use the `/setmodel`, `/addmodel`, `/setting`
  admin commands after deploying) to match the providers you actually enable.**

## 4. Secrets

**Never put API keys in `wrangler.toml` or in source code.** Use Wrangler secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET        # any long random string you invent
npx wrangler secret put ADMIN_TELEGRAM_ID     # your numeric Telegram user id (comma-separated for several admins)

# Only set the ones you actually have a key for:
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put KIMI_API_KEY
```

A model whose provider has no configured key is **automatically hidden** from
users (see `modelIsConfigured` in `src/ai/router.ts`) — you never need to edit
code to "turn off" a model you don't have a key for.

For local development, copy `.env.example` (or `.dev.vars.example`) to
`.dev.vars` and fill it in — `wrangler dev` reads secrets from there. **Never
commit `.dev.vars`.**

## 5. Deploy

```bash
npm run deploy
```

Wrangler prints your Worker's URL, e.g. `https://tg-ai-assistant.<you>.workers.dev`.

## 6. Point Telegram at your Worker

Open, in a browser (or `curl`), replacing the two placeholders:

```
https://tg-ai-assistant.<you>.workers.dev/setup?secret=YOUR_WEBHOOK_SECRET
```

This one call sets the Telegram webhook **and** registers the bot's command
list / description / short description in both languages. Re-run it any time
you change the Worker's URL or the command list in `src/index.ts`.

Send `/start` to your bot — you're done.

## 7. Verify which AI models are actually free right now

**Providers change their free tiers over time.** Before enabling a model as
`is_free = 1` in `migrations/0002_seed.sql` (or via `/setmodel`), check the
provider's current documentation:

- Google Gemini: <https://ai.google.dev/gemini-api/docs/pricing> and
  <https://ai.google.dev/gemini-api/docs/rate-limits>. As of writing, `gemini-3.1-flash-lite`
  and `gemini-3.5-flash-lite` have a genuinely free tier; Pro-tier models generally do not.
- Cloudflare Workers AI: <https://developers.cloudflare.com/workers-ai/platform/pricing/> —
  10,000 free "Neurons"/day on the Workers Free plan, no API key needed (uses the `AI` binding
  already declared in `wrangler.toml`). Good open-weight fallback (Llama 3.1 8B, etc.).
- OpenAI / DeepSeek / Kimi (Moonshot) currently require a paid key for meaningful use — their
  adapters exist (`src/ai/providers/openai_compat.ts`) but the seed data ships them **inactive**
  (`is_active = 0`) under the `advanced` tier. Flip them on once you configure billing.

If a "free" model's quota disappears or the provider starts requiring payment, just deactivate
it: `/setmodel <key> is_active 0` (as an admin, in the bot) — no redeploy needed.

## 8. Cloudflare Workers limits that shaped this design

- **Free plan CPU time is 10 ms/request.** Network waits (the AI API call, D1 queries) do
  **not** count against this, so a typical chat turn (parse JSON, build prompt, one `fetch`,
  a couple of D1 statements) fits comfortably. Very large Markdown‑to‑HTML conversions or
  huge document text (V3) are the main things to watch if you outgrow the free plan.
- **50 subrequests/invocation, 6 simultaneous connections** on the Free plan — the bot makes
  at most a handful of subrequests per update (Telegram calls + one AI call + D1 batches, which
  count as one subrequest each), so this is not a practical limit for V1.
- **5 Cron Triggers/account, 10 ms CPU per Cron invocation on Free.** The included cleanup job
  (`src/jobs/cleanup.ts`) runs hourly and batches its deletes (`LIMIT 500` per statement) to stay
  within that budget; if your `messages` table backlog is ever unusually large, it just takes a
  few extra hourly runs to fully catch up, which is safe.
- **No R2, no VPS** — per spec, nothing here writes files to disk or object storage. Documents
  (V3) are meant to be extracted to text and stored in D1 **with an expiry**, never as blobs.
- If you outgrow the Free plan, `npx wrangler` deploys the same code to Workers Paid; only
  `wrangler.toml`/dashboard settings change (CPU time, cron count, subrequest limits all scale up).

## 9. What's implemented vs. stubbed

| Area | Status |
|---|---|
| `/start`, language (RU/EN), main menu, Telegram commands | ✅ full |
| AI chat, AI Router (provider-agnostic, DB-driven models) | ✅ full |
| Model selection per chat, multiple conversations, rename/archive/delete | ✅ full |
| 24h message expiration + hourly cleanup cron | ✅ full |
| Points (free + purchased), safe reserve→capture/release, admin adjust | ✅ full |
| Web search tool (Gemini grounding) | ✅ full (needs `GEMINI_API_KEY`) |
| Roles (built-in + custom per chat) | ✅ full |
| Account, basic admin panel (`/admin`, stats, users, models, settings, blocks) | ✅ full |
| Images, image editing, templates (V2) | 🚧 UI stub only (`soon` screen) |
| Documents / PDF-DOCX-TXT Q&A (V3) | 🚧 schema ready, handler stub |
| Voice / TTS (V4) | 🚧 UI stub only |
| Subscriptions, points purchase, payment provider (V5) | 🚧 orders/plans schema + UI complete; **no payment provider wired** — `/markpaid` (admin) or your own `src/payments/<provider>.ts` integration confirms an order |
| Broadcasts, advanced stats (V6) | 🚧 minimal stats implemented; broadcast is a stub |

Adding a real payment provider: implement it under `src/payments/`, call
`setOrderPaymentUrl()` when creating the invoice and
`recordPaymentAndMarkPaid()` from its webhook (already de-duplicated via a
`UNIQUE(provider, provider_payment_id)` constraint, so a retried webhook can
never double-credit a user).

## 10. Project layout

```
src/
  index.ts            Worker entry: webhook + /setup + hourly cron
  env.ts              Env (bindings/secrets) typing + admin helpers
  i18n/                Russian + English dictionaries, pluralisation, date/money formatting
  db/                  D1 access layer (users, chats, points, models, orders, settings, content)
  ai/
    router.ts           picks a provider for a model, hides unconfigured ones
    providers/           gemini.ts, openai_compat.ts (OpenAI/DeepSeek/Kimi), workers_ai.ts
  bot/
    context.ts           per-update Ctx (env, db, tg, settings, user, lang)
    dispatch.ts           command / callback / plain-text routing
    core.ts               chat/points/AI orchestration shared by chat + search
    screens.ts             pure functions: data -> {text, keyboard}
    keyboards.ts            inline-keyboard builders
    render.ts                edit-in-place-with-fallback screen renderer
    admin.ts                  admin commands + admin inline panel
  telegram/            Minimal typed Telegram Bot API client
  jobs/cleanup.ts       Hourly data-minimisation job
  util/                 markdown->Telegram HTML, misc helpers
migrations/            D1 schema + seed data
```

## 11. Data-minimisation / privacy notes

- Chat message **content** always carries `expires_at` and is deleted by the
  hourly cron; the hard cap is 24h regardless of the `message_ttl_hours`
  setting (see `Settings.messageTtlSec`).
- Uploaded files, generated images and voice audio are never written to any
  Cloudflare storage — everything is designed to flow `Telegram → Worker →
  provider API → Telegram` and be discarded.
- Every D1 query that touches a user's own data includes `WHERE user_id = ?`
  (or `AND user_id = ?` for chats), so one user can never read or modify
  another user's chats, points, or orders.
- Admin commands never log message content — `usage_logs` stores only
  `kind`, `model_key`, `status`, an error code, and point cost.

## 12. Local development

```bash
cp .dev.vars.example .dev.vars   # fill in your test bot token + keys
npm run db:migrate:local
npm run dev
```

`wrangler dev` gives you a local tunnel URL; call `/setup?secret=...` against
that URL the same way as in production to test end-to-end with a *test* bot.
