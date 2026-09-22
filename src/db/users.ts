import { first, run, stmt } from './client';
import type { Lang } from '../i18n';

export interface UserRow {
  id: number;
  username: string | null;
  first_name: string | null;
  language: Lang;
  mode: string;
  mode_arg: string | null;
  current_chat_id: string | null;
  last_model_key: string | null;
  search_model_key: string | null;
  default_role_key: string | null;
  is_blocked: number;
  block_reason: string | null;
  bot_blocked: number;
  processing_until: number;
  created_at: number;
  last_seen_at: number;
}

export type Mode = 'chat' | 'image' | 'search' | 'docs' | 'voice' | 'rename' | 'role';

/** Load (or create) the user. Writes only when something actually changed. */
export async function upsertUser(
  db: D1Database,
  tg: { id: number; username?: string; first_name?: string },
  defaultLang: Lang,
  now: number,
): Promise<{ user: UserRow; isNew: boolean }> {
  const existing = await first<UserRow>(db, 'SELECT * FROM users WHERE id=?', tg.id);
  if (!existing) {
    await db.batch([
      stmt(
        db,
        'INSERT OR IGNORE INTO users(id,username,first_name,language,created_at,last_seen_at) VALUES(?,?,?,?,?,?)',
        tg.id,
        tg.username ?? null,
        tg.first_name ?? null,
        defaultLang,
        now,
        now,
      ),
      stmt(db, 'INSERT OR IGNORE INTO balances(user_id,free_points,free_reset_at,purchased_points,updated_at) VALUES(?,0,0,0,?)', tg.id, now),
    ]);
    const user = (await first<UserRow>(db, 'SELECT * FROM users WHERE id=?', tg.id))!;
    return { user, isNew: true };
  }
  const changed =
    (tg.username ?? null) !== existing.username || (tg.first_name ?? null) !== existing.first_name || now - existing.last_seen_at > 300;
  if (changed) {
    await run(db, 'UPDATE users SET username=?, first_name=?, last_seen_at=?, bot_blocked=0 WHERE id=?', tg.username ?? null, tg.first_name ?? null, now, tg.id);
    existing.username = tg.username ?? null;
    existing.first_name = tg.first_name ?? null;
    existing.last_seen_at = now;
    existing.bot_blocked = 0;
  }
  return { user: existing, isNew: false };
}

export async function getUser(db: D1Database, id: number): Promise<UserRow | null> {
  return first<UserRow>(db, 'SELECT * FROM users WHERE id=?', id);
}

export async function setMode(db: D1Database, userId: number, mode: Mode, arg: string | null = null): Promise<void> {
  await run(db, 'UPDATE users SET mode=?, mode_arg=? WHERE id=?', mode, arg, userId);
}

export async function setLanguage(db: D1Database, userId: number, lang: Lang): Promise<void> {
  await run(db, 'UPDATE users SET language=? WHERE id=?', lang, userId);
}

export async function setCurrentChat(db: D1Database, userId: number, chatId: string | null): Promise<void> {
  await run(db, 'UPDATE users SET current_chat_id=? WHERE id=?', chatId, userId);
}

export async function setLastModel(db: D1Database, userId: number, key: string): Promise<void> {
  await run(db, 'UPDATE users SET last_model_key=? WHERE id=?', key, userId);
}

export async function setSearchModel(db: D1Database, userId: number, key: string): Promise<void> {
  await run(db, 'UPDATE users SET search_model_key=? WHERE id=?', key, userId);
}

/** Per-user lock: returns true if acquired. Prevents parallel (double-charged) requests. */
export async function acquireLock(db: D1Database, userId: number, now: number, ttlSec: number): Promise<boolean> {
  const n = await run(db, 'UPDATE users SET processing_until=? WHERE id=? AND processing_until<=?', now + ttlSec, userId, now);
  return n === 1;
}

export async function releaseLock(db: D1Database, userId: number): Promise<void> {
  await run(db, 'UPDATE users SET processing_until=0 WHERE id=?', userId);
}

export async function setBlocked(db: D1Database, userId: number, blocked: boolean, reason: string | null): Promise<number> {
  return run(db, 'UPDATE users SET is_blocked=?, block_reason=? WHERE id=?', blocked ? 1 : 0, blocked ? reason : null, userId);
}

export async function markBotBlocked(db: D1Database, userId: number, v: boolean): Promise<void> {
  await run(db, 'UPDATE users SET bot_blocked=? WHERE id=?', v ? 1 : 0, userId);
}
