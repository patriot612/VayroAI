import type { Ctx } from './context';
import { getChat, createChat, recentMessages, saveExchangeStatements, type ChatRow } from '../db/chats';
import { getModel, listModels } from '../db/models';
import type { ModelRow } from '../db/models';
import { getBalance, planCharge, reservePoints, releaseHold, captureStatement } from '../db/points';
import { routeCompletion, modelIsConfigured } from '../ai/router';
import { ProviderError } from '../ai/types';
import { getRole } from '../db/content';
import { t } from '../i18n';
import { renderAnswer } from '../util/markdown';
import { logError, oneLine, truncate } from '../util/misc';
import { run } from '../db/client';

/** The model bound to a chat (or the family fallback if it was disabled after the chat was created). */
export async function chatModel(ctx: Ctx, chat: ChatRow): Promise<ModelRow | null> {
  const m = await getModel(ctx.db, chat.model_key);
  if (m && modelUsable(ctx, m)) return m;
  return firstAvailableModel(ctx, 'chat');
}

export async function firstAvailableModel(ctx: Ctx, type: string): Promise<ModelRow | null> {
  const list = await listModels(ctx.db, type, true);
  return list.find((m) => modelUsable(ctx, m)) ?? null;
}

export function modelUsable(ctx: Ctx, m: ModelRow): boolean {
  return Boolean(m.is_active) && modelIsConfigured(ctx.env, m);
}

/** Get the user's current chat, creating one with a default model if none exists yet. */
export async function ensureCurrentChat(ctx: Ctx): Promise<ChatRow> {
  const existing = await getChat(ctx.db, ctx.user.id, ctx.user.current_chat_id);
  if (existing) return existing;
  const model = ctx.user.last_model_key ? await getModel(ctx.db, ctx.user.last_model_key) : null;
  const chosen = model && modelUsable(ctx, model) ? model : await firstAvailableModel(ctx, 'chat');
  const modelKey = chosen?.key ?? 'unavailable';
  return createChat(ctx.db, ctx.user.id, modelKey, ctx.user.default_role_key, ctx.settings.chatTtlSec, ctx.now);
}

export interface AnswerOutcome {
  status: 'ok' | 'no_points' | 'unavailable' | 'blocked' | 'error' | 'rate_limited';
  errorKey?: string;
}

/**
 * Full "ask the model and reply" flow shared by normal chat, search mode and roles:
 * reserve points -> call provider -> on success: save messages + capture; on failure: release hold.
 * Returns what happened so the caller can show the right screen/back-button state.
 */
export async function answerAndSend(
  ctx: Ctx,
  opts: {
    chat: ChatRow;
    model: ModelRow;
    userText: string;
    search?: boolean;
    roleOverride?: { prompt: string } | null;
    statusKey: 'status.think' | 'status.search' | 'status.doc' | 'status.voice';
    saveTitleFromText?: boolean;
  },
): Promise<AnswerOutcome> {
  const { chat, model } = opts;
  const bal = await getBalance(ctx.db, ctx.user.id, ctx.settings, ctx.now);
  const plan = planCharge(bal, model.cost, model.tier);
  if (!plan.ok) return { status: 'no_points' };

  const ref = `chat:${chat.id}:${ctx.now}`;
  const holdId = await reservePoints(ctx.db, ctx.user.id, { free: plan.free, paid: plan.paid }, bal.freeResetAt, ref, ctx.now);
  if (!holdId) return { status: 'no_points' };

  const statusMsg = await ctx.tg.safe(ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, opts.statusKey)), 'status_send');
  await ctx.tg.safe(ctx.tg.sendChatAction(ctx.chatId, opts.search ? 'typing' : 'typing'), 'chat_action');

  let system: string | undefined;
  if (opts.roleOverride) system = opts.roleOverride.prompt;
  else if (chat.custom_role) system = chat.custom_role;
  else if (chat.role_key) {
    const role = await getRole(ctx.db, chat.role_key);
    system = role?.prompt;
  }

  const history = (await recentMessages(ctx.db, ctx.user.id, chat.id, ctx.now, ctx.settings.int('context_max_messages'))).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  // trim by total characters too, dropping oldest turns first
  let totalChars = history.reduce((a, h) => a + h.content.length, 0) + opts.userText.length;
  while (totalChars > ctx.settings.int('context_max_chars') && history.length > 0) {
    totalChars -= history.shift()!.content.length;
  }

  let outcome: AnswerOutcome;
  try {
    const result = await routeCompletion(ctx.env, model, {
      system,
      history,
      input: opts.userText,
      search: opts.search,
      maxOutputTokens: model.max_output ?? 2048,
    });
    let answerMd = result.text;
    if (result.citations?.length) {
      const lines = result.citations.slice(0, 5).map((c) => `• [${oneLine(c.title)}](${c.url})`);
      answerMd += `\n\n**${t(ctx.lang, 'search.sources')}:**\n${lines.join('\n')}`;
    }

    const autoTitle = opts.saveTitleFromText && !chat.title && ctx.settings.bool('auto_title') ? truncate(oneLine(opts.userText), 60) : null;
    await ctx.db.batch([
      ...saveExchangeStatements(ctx.db, {
        chat,
        userId: ctx.user.id,
        userText: opts.userText,
        answer: answerMd,
        cost: model.cost,
        now: ctx.now,
        messageTtlSec: ctx.settings.messageTtlSec,
        chatTtlSec: ctx.settings.chatTtlSec,
        autoTitle,
      }),
      captureStatement(ctx.db, holdId, ctx.now),
    ]);
    await run(
      ctx.db,
      "INSERT INTO usage_logs(user_id,kind,model_key,status,points,created_at) VALUES(?,?,?,'ok',?,?)",
      ctx.user.id,
      opts.search ? 'search' : 'chat',
      model.key,
      model.cost,
      ctx.now,
    );

    const parts = renderAnswer(answerMd);
    for (const p of parts) {
      await ctx.tg.sendMessage(ctx.chatId, p.html, { html: true, noPreview: true });
    }
    outcome = { status: 'ok' };
  } catch (e) {
    await releaseHold(ctx.db, holdId, ctx.now);
    const errKind = e instanceof ProviderError ? e.kind : 'unknown';
    try {
      await run(
        ctx.db,
        "INSERT INTO usage_logs(user_id,kind,model_key,status,error_code,points,created_at) VALUES(?,?,?,'error',?,0,?)",
        ctx.user.id,
        opts.search ? 'search' : 'chat',
        model.key,
        errKind,
        ctx.now,
      );
    } catch (logErr) {
      logError('usage_log_failed', logErr);
    }
    logError('answer_failed', e, { model: model.key, kind: errKind });
    if (errKind === 'blocked') outcome = { status: 'blocked' };
    else if (errKind === 'rate_limited') outcome = { status: 'rate_limited' };
    else outcome = { status: 'unavailable' };
  } finally {
    if (statusMsg) await ctx.tg.safe(ctx.tg.deleteMessage(ctx.chatId, statusMsg.message_id), 'status_delete');
  }
  return outcome;
}

export async function sendOutcomeError(ctx: Ctx, outcome: AnswerOutcome): Promise<void> {
  const key =
    outcome.status === 'no_points'
      ? 'err.no_points'
      : outcome.status === 'blocked'
        ? 'err.content_blocked'
        : outcome.status === 'rate_limited'
          ? 'err.rate'
          : outcome.status === 'unavailable'
            ? 'err.model_unavailable'
            : 'err.generic';
  await ctx.tg.sendMessage(ctx.chatId, t(ctx.lang, key as never));
}
