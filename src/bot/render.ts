import { Telegram, TelegramError } from '../telegram/api';
import type { Screen } from '../telegram/types';
import { mdToTelegramHtml } from '../util/markdown';
import { clearUiMessageId, getUiMessageId, setUiMessageId } from '../db/users';

/**
 * Show a normal screen.
 *
 * This function keeps the existing behaviour:
 * - if editMessageId is provided, edit that exact message;
 * - otherwise send a new message.
 *
 * IMPORTANT:
 * This function is NOT used for AI answers, translations,
 * images, documents, audio or other generated results.
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
        !(e instanceof TelegramError &&
          (e.notModified || e.gone))
      ) {
        throw e;
      }

      if (
        e instanceof TelegramError &&
        e.notModified
      ) {
        return editMessageId;
      }

      // The old message no longer exists.
      // Fall through and create a fresh UI message.
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
 * Show a navigation/UI screen for a user.
 *
 * ONLY navigation screens should use this function.
 *
 * The stored ui_message_id belongs exclusively to the UI.
 * It must NEVER be used for:
 * - AI answers
 * - translations
 * - generated images
 * - documents
 * - audio
 * - voice
 * - other user-requested results
 *
 * If a UI message already exists, edit it.
 * If it no longer exists, create a new UI message and save its ID.
 */
export async function showUiScreen(
  tg: Telegram,
  db: D1Database,
  userId: number,
  chatId: number,
  screen: Screen,
): Promise<number | undefined> {
  const html = mdToTelegramHtml(screen.text);

  const existingMessageId = await getUiMessageId(
    db,
    userId,
  );

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
        throw e;
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

  await setUiMessageId(
    db,
    userId,
    message.message_id,
  );

  return message.message_id;
}

/**
 * Clear the navigation/UI message reference.
 *
 * This does NOT delete the Telegram message.
 * It only tells the application that there is currently
 * no reusable UI message.
 */
export async function resetUiMessage(
  db: D1Database,
  userId: number,
): Promise<void> {
  await clearUiMessageId(db, userId);
}
