import type { Env } from '../env';
import type { Settings } from '../db/settings';
import type { UserRow } from '../db/users';
import { Telegram } from '../telegram/api';
import type { Lang } from '../i18n';

/** Everything a handler needs, assembled once per update. */
export interface Ctx {
  env: Env;
  db: D1Database;
  tg: Telegram;
  settings: Settings;
  user: UserRow;
  lang: Lang;
  now: number;
  chatId: number; // Telegram chat id (private chat == user id)
}
