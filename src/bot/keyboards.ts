import type { InlineKeyboard, ReplyKeyboard } from '../telegram/types';
import { t, type Lang } from '../i18n';

/** Persistent bottom keyboard shown under the chat input, matching the reference screenshots. */
export function mainReplyKeyboard(lang: Lang): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: t(lang, 'btn.chat') }, { text: t(lang, 'btn.images') }],
      [{ text: t(lang, 'btn.models') }, { text: t(lang, 'btn.chats') }],
      [{ text: t(lang, 'btn.tools') }, { text: t(lang, 'btn.account') }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function rows(...groups: { text: string; data: string }[][]): InlineKeyboard {
  return { inline_keyboard: groups.map((g) => g.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

export function row(...buttons: { text: string; data: string }[]): { text: string; data: string }[] {
  return buttons;
}

export function btn(text: string, data: string): { text: string; data: string } {
  return { text, data };
}

/** A row with a single URL button (Telegram opens it directly, no callback round-trip). */
export function urlRow(text: string, url: string): InlineKeyboard['inline_keyboard'][number] {
  return [{ text, url }];
}

/** Split N buttons into rows of at most `perRow`. */
export function grid(items: { text: string; data: string }[], perRow: number): InlineKeyboard {
  const out: { text: string; data: string }[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return rows(...out);
}

export function mergeKb(...groups: { text: string; data: string }[][]): InlineKeyboard {
  return rows(...groups);
}
