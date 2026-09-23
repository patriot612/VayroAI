import type { Env } from './env';
import { Telegram, TelegramError } from './telegram/api';
import type { TgUpdate } from './telegram/types';
import { loadSettings } from './db/settings';
import { upsertUser, acquireLock, releaseLock, markBotBlocked } from './db/users';
import { first, run } from './db/client';
import { normLang } from './i18n';
import type { Ctx } from './bot/context';
import { handleCommand, handleCallback, handleText } from './bot/dispatch';
import { t } from './i18n';
import { runCleanup } from './jobs/cleanup';
import { nowSec, logError } from './util/misc';

const COMMAND_LIST: { command: string; key: Parameters<typeof t>[1] }[] = [
  { command: 'menu', key: 'cmd.menu' },
  { command: 'new', key: 'cmd.new' },
  { command: 'chats', key: 'cmd.chats' },
  { command: 'images', key: 'cmd.images' },
  { command: 'templates', key: 'cmd.templates' },
  { command: 'models', key: 'cmd.models' },
  { command: 'rename', key: 'cmd.rename' },
  { command: 'status', key: 'cmd.status' },
  { command: 'plans', key: 'cmd.plans' },
  { command: 'language', key: 'cmd.language' },
  { command: 'help', key: 'cmd.help' },
  { command: 'paysupport', key: 'cmd.paysupport' },
  { command: 'orders', key: 'cmd.orders' },
  { command: 'chat', key: 'cmd.chat' },
  { command: 'tools', key: 'cmd.tools' },
  { command: 'search', key: 'cmd.search' },
  { command: 'files', key: 'cmd.files' },
  { command: 'roles', key: 'cmd.roles' },
  { command: 'voice', key: 'cmd.voice' },
  { command: 'speak', key: 'cmd.speak' },
];

async function setupWebhookAndCommands(env: Env, workerUrl: string): Promise<Response> {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  const webhookUrl = `${workerUrl.replace(/\/$/, '')}/telegram/webhook`;
  await tg.call('setWebhook', {
    url: webhookUrl,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    drop_pending_updates: false,
  });
  await tg.call('setMyCommands', { commands: COMMAND_LIST.map((c) => ({ command: c.command, description: t('ru', c.key) })), language_code: 'ru' });
  await tg.call('setMyCommands', { commands: COMMAND_LIST.map((c) => ({ command: c.command, description: t('en', c.key) })), language_code: 'en' });
  await tg.call('setMyDescription', { description: t('ru', 'bot.description'), language_code: 'ru' });
  await tg.call('setMyDescription', { description: t('en', 'bot.description'), language_code: 'en' });
  await tg.call('setMyShortDescription', { short_description: t('ru', 'bot.short'), language_code: 'ru' });
  await tg.call('setMyShortDescription', { short_description: t('en', 'bot.short'), language_code: 'en' });
  return new Response(`Webhook set to ${webhookUrl}\n`, { status: 200 });
}

/** Deduplicate Telegram retries (it may resend an update if we're slow to answer). */
async function alreadyProcessed(db: D1Database, updateId: number, now: number): Promise<boolean> {
  try {
    await run(db, 'INSERT INTO processed_updates(update_id, created_at) VALUES(?,?)', updateId, now);
    return false;
  } catch {
    return true; // PRIMARY KEY collision -> we've seen this update_id before
  }
}

async function buildCtx(env: Env, tgUserId: number, username: string | undefined, firstName: string | undefined, chatId: number, now: number): Promise<Ctx | null> {
  const db = env.DB;
  try {
    const settings = await loadSettings(db);
    const defaultLang = normLang(env.DEFAULT_LANGUAGE, 'ru');
    const { user } = await upsertUser(db, { id: tgUserId, username, first_name: firstName }, defaultLang, now);
    if (user.is_blocked) return null;
    return { env, db, tg: new Telegram(env.TELEGRAM_BOT_TOKEN), settings, user, lang: normLang(user.language, defaultLang), now, chatId };
  } catch (e) {
    // DIAGNOSTIC (temporary): buildCtx/upsertUser failed — likely a D1 schema mismatch
    // (e.g. migrations/0003_ui_message.sql not applied to the remote DB). This used to
    // fail silently because buildCtx was called outside any try/catch in processUpdate.
    logError('build_ctx_failed', e, { tgUserId, chatId });
    throw e;
  }
}

async function withRateLimit(ctx: Ctx): Promise<boolean> {
  const bucket = Math.floor(ctx.now / 60);
  const limit = ctx.settings.int('rate_limit_per_minute');
  await run(ctx.db, 'INSERT INTO rate_limits(user_id,bucket,count) VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1', ctx.user.id, bucket);
  const row = await first<{ count: number }>(ctx.db, 'SELECT count FROM rate_limits WHERE user_id=? AND bucket=?', ctx.user.id, bucket);
  return (row?.count ?? 0) <= limit;
}

async function processUpdate(env: Env, update: TgUpdate): Promise<void> {
  const now = nowSec();

  if (update.my_chat_member) {
    const m = update.my_chat_member;
    if (m.chat.type === 'private' && (m.new_chat_member.status === 'kicked' || m.new_chat_member.status === 'left')) {
      await markBotBlocked(env.DB, m.chat.id, true);
    }
    return;
  }

  const cb = update.callback_query;
  const msg = update.message;
  const from = cb?.from ?? msg?.from;
  const chatId = cb?.message?.chat.id ?? msg?.chat.id;
  if (!from || !chatId) return;

  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  let ctx: Ctx | null;
  try {
    ctx = await buildCtx(env, from.id, from.username, from.first_name, chatId, now);
  } catch (e) {
    // buildCtx/upsertUser threw (e.g. D1 schema mismatch). Previously this propagated all
    // the way out of processUpdate and was swallowed by the top-level waitUntil catch in
    // fetch() with no message sent to the user at all (fully silent failure). Now we at
    // least tell the user something went wrong, using the default language since we don't
    // have a Ctx yet.
    logError('update_failed_no_ctx', e, { tgUserId: from.id, chatId });
    if (cb) await tg.safe(tg.answerCallbackQuery(cb.id, t('ru', 'err.generic'), true), 'no_ctx_toast');
    else await tg.safe(tg.sendMessage(chatId, t('ru', 'err.generic')), 'no_ctx_msg');
    return;
  }
  if (!ctx) {
    if (cb) await tg.safe(tg.answerCallbackQuery(cb.id, t('ru', 'err.blocked'), true), 'blocked_toast');
    else await tg.safe(tg.sendMessage(chatId, t('ru', 'err.blocked')), 'blocked_msg');
    return;
  }

  const okRate = await withRateLimit(ctx);
  if (!okRate) {
    if (cb) await ctx.tg.safe(ctx.tg.answerCallbackQuery(cb.id, t(ctx.lang, 'err.rate'), true), 'rate_toast');
    else await ctx.tg.safe(ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'err.rate')), 'rate_msg');
    return;
  }

  try {
    if (cb) {
      await handleCallbackQuery(ctx, cb);
      return;
    }
    if (msg) {
      await handleIncomingMessage(ctx, msg);
      return;
    }
  } catch (e) {
    if (e instanceof TelegramError && e.botBlocked) {
      await markBotBlocked(env.DB, ctx.user.id, true);
      return;
    }
    logError('update_failed', e, { userId: ctx.user.id });
    await ctx.tg.safe(ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'err.generic')), 'generic_err');
  }
}

async function handleCallbackQuery(ctx: Ctx, cb: NonNullable<TgUpdate['callback_query']>): Promise<void> {
  if (!cb.data || !cb.message) {
    await ctx.tg.safe(ctx.tg.answerCallbackQuery(cb.id), 'ack');
    return;
  }
  try {
    const result = await handleCallback(ctx, cb.data, cb.message.message_id);
    await ctx.tg.safe(ctx.tg.answerCallbackQuery(cb.id, result?.toast), 'ack');
  } catch (e) {
    await ctx.tg.safe(ctx.tg.answerCallbackQuery(cb.id, t(ctx.lang, 'err.stale')), 'ack_err');
    throw e;
  }
}

async function handleIncomingMessage(ctx: Ctx, msg: NonNullable<TgUpdate['message']>): Promise<void> {
  const text = msg.text ?? msg.caption;
  if (text === undefined) {
    if (msg.photo || msg.document || msg.voice || msg.audio || msg.video || msg.sticker) {
      await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'err.media'));
    }
    return;
  }
  if (text.startsWith('/')) {
    await handleCommand(ctx, text);
    return;
  }

  const gotLock = await acquireLock(ctx.db, ctx.user.id, ctx.now, 60);
  if (!gotLock) {
    await ctx.tg.safe(ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, 'err.busy')), 'busy');
    return;
  }
  try {
    await handleText(ctx, text.trim());
  } finally {
    await releaseLock(ctx.db, ctx.user.id);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      try {
        return await setupWebhookAndCommands(env, `${url.protocol}//${url.host}`);
      } catch (e) {
        logError('setup_failed', e);
        return new Response('setup failed, see logs', { status: 500 });
      }
    }

    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response('bad request', { status: 400 });
      }
      // Answer Telegram immediately; do the actual work in the background (via waitUntil) so a
      // slow AI provider never causes Telegram to consider the webhook failed and retry it.
      // Note: Workers Free caps a request's *duration* only by the client staying connected plus
      // a 30s grace period after response — see README "Cloudflare Workers limits" for details.
      ctx.waitUntil(
        (async () => {
          try {
            if (await alreadyProcessed(env.DB, update.update_id, nowSec())) return;
            await processUpdate(env, update);
          } catch (e) {
            logError('webhook_background_failed', e, { updateId: update.update_id });
          }
        })(),
      );
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/health') return new Response('ok', { status: 200 });
    return new Response('not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCleanup(env));
  },
} satisfies ExportedHandler<Env>;
