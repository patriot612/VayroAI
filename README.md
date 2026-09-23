# VayroAI

VayroAI is a Telegram AI assistant designed for Cloudflare Workers + D1. This repository is a clean reconstruction based on the supplied VayroAI master T3 specification. It does not depend on the previous ZIP project.

## Architecture

Telegram Bot API → Cloudflare Worker → D1 / provider adapter / Workers AI → Telegram.

The application keeps user configuration, models, chats, points, plans, orders and state in D1. Secrets stay in Cloudflare Secrets. No VPS, permanent local disk or R2 is required for current chat operation.

## Prerequisites

- Node.js 20+ recommended
- npm
- A Cloudflare account with Workers, D1 and Workers AI available for the intended deployment
- A Telegram bot token

## Install

```bash
npm install
```

The repository intentionally does not contain real credentials.

## Create the D1 database

Create a database and copy its ID into `wrangler.toml`:

```bash
npx wrangler d1 create vayroai-db
```

Set the returned database ID in:

```toml
[[d1_databases]]
binding = "DB"
database_name = "vayroai-db"
database_id = "YOUR_DATABASE_ID"
```

## Apply migrations

Remote:

```bash
npm run db:migrate
```

Local development database:

```bash
npm run db:migrate:local
```

The initial migration creates all required tables and seeds only configuration: the baseline Workers AI model, roles, settings and plans. It does not create fake users or statistics.

## Workers AI binding

`wrangler.toml` contains the `AI` binding. The baseline model is seeded automatically:

- key: `llama-3-1-8b`
- name: `Llama 3.1 8B Fast`
- family: `Llama`
- provider: `workers_ai`
- model ID: `@cf/meta/llama-3.1-8b-instruct-fast`
- type: `chat`
- tier: `daily`
- cost: `1`

No external API key is required for this built-in provider. The project still requires the Workers AI binding to exist.

## Cloudflare Secrets

Use:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_TELEGRAM_ID
```

Optional providers:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put KIMI_API_KEY
```

Secrets are never stored in D1, source code, Wrangler configuration or usage logs.

For custom OpenAI-compatible providers, store only the secret name and base URL in the model `config`, for example:

```json
{"api_key_env":"MY_PROVIDER_KEY","base_url":"https://provider.example/v1"}
```

Then create `MY_PROVIDER_KEY` with Wrangler. One provider secret can be reused across multiple model versions.

## Telegram webhook setup

Deploy the worker:

```bash
npm run deploy
```

Then open:

```text
https://YOUR-WORKER.workers.dev/setup?secret=YOUR_WEBHOOK_SECRET
```

The setup endpoint registers `POST /telegram/webhook` as the Telegram webhook and registers only the public user command menu. Admin commands are deliberately not registered publicly.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill the values for a local test environment:

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Telegram webhook testing normally requires a public HTTPS endpoint. For an actual production Telegram webhook, use the deployed Worker URL.

## Public commands

The public command menu includes normal user commands such as `/menu`, `/new`, `/chats`, `/models`, `/plans`, `/orders`, `/search`, `/roles` and `/help`.

Admin commands are not added to this menu and must be manually typed by an authorized admin.

## Admin authorization

`ADMIN_TELEGRAM_ID` supports multiple comma-separated Telegram IDs:

```text
123456789,987654321
```

Every admin command and admin callback checks this list.

## Admin commands

The project implements the legacy command names:

```text
/admin
/user <id>
/users [page]
/addpoints <id> <n>
/takepoints <id> <n>
/grantsub <id> <days>
/block <id> [reason]
/unblock <id>
/markpaid <order_id>
/setmodel <key> <field> <value>
/addmodel <key>|<family>|<provider>|<model_id>|<name>|<daily/advanced>|<cost>[|<chat/search>]
/delmodel <key>
/setting <key> <value>
```

New commands:

```text
/price <plan_key> <price>
/broadcast
```

## Dynamic model management

The normal UI reads models from D1. There are no hard-coded family/provider buttons in the model-selection screen.

A new model appears automatically when:

1. it exists in D1;
2. it is active;
3. its provider adapter exists;
4. its required credentials/configuration are available.

Examples:

```text
/addmodel my-gemini|Gemini|gemini|gemini-model-id|My Gemini|daily|2|chat
/setmodel my-gemini cost 3
/setmodel my-gemini config {"max_tokens":4096}
/delmodel my-gemini
```

For an OpenAI-compatible provider:

```text
/addmodel my-model|My Family|openai_compat|provider-model|My Model|advanced|10|chat
/setmodel my-model config {"api_key_env":"MY_PROVIDER_KEY","base_url":"https://provider.example/v1","max_tokens":4096}
```

The admin model screen marks entries as:

- ✅ enabled and configured
- 🔑 enabled but not configured
- ⛔ disabled

## Points

Every model has a cost in D1. A request reserves points before the provider call, captures them on success and releases them on failure.

Default free points are 50 per free period and 100 for subscribers. Purchased points do not expire under the current rules.

Message content is retained for no more than 24 hours. The runtime clamps the TTL to 24 hours even if a setting attempts to exceed it.

## Chats and archive

`➕ Новый диалог` automatically archives the previous current chat, then creates and selects a new chat.

Active chat lists contain only `is_archived = 0` conversations. The archive contains only archived AI conversations and allows continue, rename, unarchive and delete.

The chat shell is not automatically deleted when message content expires. Opening a chat after its message history has expired shows that the history is unavailable, while the user can continue in the same chat.

## Roles

Built-in roles are seeded in D1:

- assistant / Помощник
- editor / Редактор
- translator / Переводчик
- teacher / Учитель
- programmer / Программист

Users can also configure a custom role per chat.

## Web search

Search is a separate mode. Only active, configured D1 models of `type = search` appear in the search UI. Gemini search models are seeded as configurable examples and remain hidden until the Gemini credential is configured.

The Gemini adapter uses the current `generateContent` REST shape and Google Search grounding support.

## Plans, prices and orders

Subscription seed prices are stored as integer minor units in D1:

- 1 week — 199 RUB
- 1 month — 699 RUB
- 3 months — 1,399 RUB
- 6 months — 2,399 RUB
- 1 year — 3,599 RUB
- 2 years — 6,499 RUB

They are not hard-coded UI strings.

Change a price without redeploying:

```text
/price sub-1m 799
/price sub-1y 3999
/price pts-100 99
```

Money is stored as integer minor units. The annual monthly average is calculated from the live annual plan price.

The current version does not implement a real payment provider. When `feature_payments = 0`, selecting a plan shows that payment is unavailable rather than faking a successful payment. `/markpaid` can be used by the admin to manually settle an order and applies the existing order/payment ledger logic.

## Broadcasts

`/broadcast` starts a full broadcast workflow:

1. the admin sends the content;
2. the bot previews recipient count;
3. the admin confirms or cancels;
4. delivery runs in D1-fetched batches;
5. blocked Telegram users are marked `bot_blocked = 1` and excluded from future broadcasts;
6. one progress message is edited between batches;
7. temporary D1 broadcast state is deleted after completion.

Text and photo broadcasts are supported. Photo media is represented by Telegram `file_id` and/or source message metadata; binary media is never stored in D1.

The project does not create one D1 recipient row per user.

## Providers

Implemented provider adapters include:

- Cloudflare Workers AI
- Gemini
- OpenAI-compatible HTTP
- OpenAI
- DeepSeek
- Kimi
- optional Anthropic

The DeepSeek adapter follows the provider's OpenAI-style Chat Completions API; the current DeepSeek docs specify `https://api.deepseek.com` as the OpenAI-format base URL.

The Kimi adapter uses Kimi's OpenAI-compatible Chat Completions endpoint at `https://api.moonshot.ai/v1`.

## Disabled / future features

The current release deliberately does not fake functionality for:

- image generation/editing
- document Q&A
- voice transcription/input
- text-to-speech
- automatic real payment verification

Those areas have only scaffolding or clear coming-soon UI.

## Cleanup Cron

The Worker cron runs hourly and cleans:

- expired message content;
- stale point holds;
- expired pending actions;
- expired pending orders;
- old processed update IDs;
- old rate-limit buckets;
- stale temporary broadcast state;
- old technical usage logs according to the configured retention.

It does not delete chat shells just because their messages expired.

## Security and data minimization

- Telegram webhook requests are checked using `WEBHOOK_SECRET`.
- Telegram update IDs are deduplicated.
- Each user-owned D1 query is scoped by Telegram user ID.
- Only one AI request may run per user at a time.
- Rate limiting defaults to 20 updates per minute.
- AI chat content is not copied into technical usage logs.
- API keys stay in Cloudflare Secrets.

## Type checking

The repository includes a self-contained ambient Cloudflare/D1 type layer so the source can be checked with a TypeScript installation even before Wrangler dependencies are installed:

```bash
npm run typecheck
```

## Deployment summary

```bash
npm install
npx wrangler d1 create vayroai-db
# put the database ID into wrangler.toml
npm run db:migrate
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_TELEGRAM_ID
npm run deploy
```

Then run:

```text
https://YOUR-WORKER.workers.dev/setup?secret=YOUR_WEBHOOK_SECRET
```

No VPS is required by this deployment plan.
