import { Telegram, TelegramError } from '../telegram/api';
import type { Screen } from '../telegram/types';
import { mdToTelegramHtml } from '../util/markdown';

/**
 * Show a screen. If `editMessageId` is given, try to edit that message in place
 * (per spec: "avoid unnecessary new messages"); fall back to sending a new one
 * when the edit is impossible (message gone, or content identical).
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
      const r = await tg.editMessageText(chatId, editMessageId, html, { markup: screen.kb, html: true, noPreview: true });
      return typeof r === 'object' ? r.message_id : editMessageId;
    } catch (e) {
      if (!(e instanceof TelegramError && (e.notModified || e.gone))) throw e;
      if (e instanceof TelegramError && e.notModified) return editMessageId;
      // message gone -> fall through to send a fresh one
    }
  }
  const m = await tg.sendMessage(chatId, html, { markup: screen.kb, html: true, noPreview: true });
  return m.message_id;
}
