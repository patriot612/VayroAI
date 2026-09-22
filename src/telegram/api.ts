import type { ReplyMarkup, TgMessage } from './types';
import { logError, truncate } from '../util/misc';

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
    public retryAfter?: number,
  ) {
    super(`${method}: ${code} ${description}`);
  }
  get notModified(): boolean {
    return /message is not modified/i.test(this.description);
  }
  get cantParse(): boolean {
    return /can't parse entities|can't find end of the entity|unsupported start tag/i.test(this.description);
  }
  get gone(): boolean {
    return /message to edit not found|message can't be edited|MESSAGE_ID_INVALID|message to delete not found/i.test(this.description);
  }
  get botBlocked(): boolean {
    return this.code === 403;
  }
}

type Params = Record<string, unknown>;

export class Telegram {
  constructor(private readonly token: string) {}

  async call<T = unknown>(method: string, params: Params = {}): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    let data: { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new TelegramError(method, res.status, 'invalid JSON response');
    }
    if (!data.ok) {
      throw new TelegramError(method, data.error_code ?? res.status, data.description ?? 'unknown error', data.parameters?.retry_after);
    }
    return data.result as T;
  }

  sendMessage(chatId: number, text: string, opts: { markup?: ReplyMarkup; html?: boolean; noPreview?: boolean } = {}): Promise<TgMessage> {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...(opts.html ? { parse_mode: 'HTML' } : {}),
      ...(opts.markup ? { reply_markup: opts.markup } : {}),
      ...(opts.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
    });
  }

  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    opts: { markup?: ReplyMarkup; html?: boolean; noPreview?: boolean } = {},
  ): Promise<TgMessage | true> {
    return this.call<TgMessage | true>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(opts.html ? { parse_mode: 'HTML' } : {}),
      ...(opts.markup ? { reply_markup: opts.markup } : {}),
      ...(opts.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<true> {
    return this.call<true>('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: truncate(text, 190), show_alert: showAlert } : {}) });
  }

  deleteMessage(chatId: number, messageId: number): Promise<true> {
    return this.call<true>('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  sendChatAction(chatId: number, action = 'typing'): Promise<true> {
    return this.call<true>('sendChatAction', { chat_id: chatId, action });
  }

  /** Best-effort: never throws (used for cosmetic calls). */
  async safe<T>(p: Promise<T>, what: string): Promise<T | undefined> {
    try {
      return await p;
    } catch (e) {
      if (!(e instanceof TelegramError && (e.notModified || e.gone))) logError('tg_safe_failed', e, { what });
      return undefined;
    }
  }
}
