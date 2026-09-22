import { Telegram, TelegramError } from '../telegram/api';
import type { Screen } from '../telegram/types';
import { mdToTelegramHtml } from '../util/markdown';
import {
  clearUiMessageId,
  getUiMessageId,
  setUiMessageId,
} from '../db/users';

/**
 * Show a normal screen.
 *
 * This function is used for ordinary screen rendering when an exact
 * Telegram message ID is supplied.
 */
export async function showScreen(
  tg: Telegram,
  chatId: number,
  screen: Screen,
  editMessageId?: number,
): Promise<number | undefined> {
  const html = mdToTelegramHtml(screen.text);

  if (editMessageId) {
    try {
      const r = await tg.editMessageText(
        chatId,
        editMessageId,
        html,
        {
          markup: screen.kb,
          html: true,
          noPreview: true,
        },
      );

      return typeof r === 'object'
        ? r.message_id
        : editMessageId;
    } catch (e) {
      if (
        e instanceof TelegramError &&
        e.notModified
      ) {
        return editMessageId;
      }

      if (
        !(e instanceof TelegramError &&
          e.gone)
      ) {
        throw e;
      }
    }
  }

  const m = await tg.sendMessage(
    chatId,
    html,
    {
      markup: screen.kb,
      html: true,
      noPreview: true,
    },
  );

  return m.message_id;
}

/**
 * Show the dedicated navigation/UI message.
 *
 * This message is completely separate from AI answers and other
 * generated results.
 *
 * If the stored message cannot be edited for ANY Telegram "message
 * is no longer editable/found" error, the stored ID is cleared and
 * a fresh UI message is created.
 */
export async function showUiScreen(
  tg: Telegram,
  db: D1Database,
  userId: number,
  chatId: number,
  screen: Screen,
): Promise<number | undefined> {
  const html = mdToTelegramHtml(screen.text);

  let existingMessageId: number | null = null;

  try {
    existingMessageId = await getUiMessageId(
      db,
      userId,
    );
  } catch {
    /*
     * If the DB read fails, do not prevent the bot from responding.
     * Simply create a fresh UI message.
     */
    existingMessageId = null;
  }

  if (existingMessageId) {
    try {
      const result = await tg.editMessageText(
        chatId,
        existingMessageId,
        html,
        {
          markup: screen.kb,
          html: true,
          noPreview: true,
        },
      );

      const messageId =
        typeof result === 'object'
          ? result.message_id
          : existingMessageId;

      await setUiMessageId(
        db,
        userId,
        messageId,
      );

      return messageId;
    } catch (e) {
      /*
       * The UI message may have been deleted, may belong to an old
       * message, or Telegram may simply refuse editing it.
       *
       * In all such cases we discard the stored reference and create
       * a new UI message.
       */
      if (
        e instanceof TelegramError &&
        e.notModified
      ) {
        return existingMessageId;
      }

      if (
        e instanceof TelegramError &&
        e.gone
      ) {
        await clearUiMessageId(
          db,
          userId,
        );
      } else {
        /*
         * Do not let a stale UI-message reference break Account,
         * Tools, Chat, Models, etc.
         */
        await clearUiMessageId(
          db,
          userId,
        );
      }
    }
  }

  const message = await tg.sendMessage(
    chatId,
    html,
    {
      markup: screen.kb,
      html: true,
      noPreview: true,
    },
  );

  try {
    await setUiMessageId(
      db,
      userId,
      message.message_id,
    );
  } catch {
    /*
     * The UI message was already sent successfully.
     * A DB failure must not make the bot look broken to the user.
     */
  }

  return message.message_id;
}

/**
 * Forget the stored navigation/UI message.
 *
 * Does NOT delete anything from Telegram.
 */
export async function resetUiMessage(
  db: D1Database,
  userId: number,
): Promise<void> {
  await clearUiMessageId(
    db,
    userId,
  );
}
