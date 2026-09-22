import { all, first, run, scalar, stmt } from './client';
import { rid } from '../util/misc';

export interface ChatRow {
  id: string;
  user_id: number;
  seq: number;
  title: string | null;
  model_key: string;
  role_key: string | null;
  custom_role: string | null;
  is_archived: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

/** Ownership is ALWAYS part of the query: a user can never read another user's chat. */
export async function getChat(db: D1Database, userId: number, chatId: string | null | undefined): Promise<ChatRow | null> {
  if (!chatId) return null;
  return first<ChatRow>(db, 'SELECT * FROM chats WHERE id=? AND user_id=?', chatId, userId);
}

export async function createChat(
  db: D1Database,
  userId: number,
  modelKey: string,
  roleKey: string | null,
  ttlSec: number,
  now: number,
): Promise<ChatRow> {
  const id = rid(10);
  await db.batch([
    stmt(
      db,
      `INSERT INTO chats(id,user_id,seq,title,model_key,role_key,is_archived,created_at,updated_at,expires_at)
       SELECT ?,?,COALESCE(MAX(seq),0)+1,NULL,?,?,0,?,?,? FROM chats WHERE user_id=?`,
      id,
      userId,
      modelKey,
      roleKey,
      now,
      now,
      now + ttlSec,
      userId,
    ),
    stmt(db, 'UPDATE users SET current_chat_id=?, mode=\'chat\', mode_arg=NULL WHERE id=?', id, userId),
  ]);
  return (await getChat(db, userId, id))!;
}

export async function listChats(db: D1Database, userId: number, archived: boolean, limit: number, offset: number): Promise<ChatRow[]> {
  return all<ChatRow>(
    db,
    'SELECT * FROM chats WHERE user_id=? AND is_archived=? ORDER BY updated_at DESC, seq DESC LIMIT ? OFFSET ?',
    userId,
    archived ? 1 : 0,
    limit,
    offset,
  );
}

export async function countChats(db: D1Database, userId: number, archived: boolean): Promise<number> {
  return scalar(db, 'SELECT COUNT(*) FROM chats WHERE user_id=? AND is_archived=?', userId, archived ? 1 : 0);
}

export async function messageCount(db: D1Database, userId: number, chatId: string, now: number): Promise<number> {
  return scalar(db, 'SELECT COUNT(*) FROM messages WHERE chat_id=? AND user_id=? AND expires_at>?', chatId, userId, now);
}

/** Newest-last list of live (non-expired) messages, limited by count. */
export async function recentMessages(db: D1Database, userId: number, chatId: string, now: number, limit: number): Promise<MessageRow[]> {
  const rows = await all<MessageRow>(
    db,
    `SELECT id, role, content, created_at FROM messages
     WHERE chat_id=? AND user_id=? AND expires_at>? ORDER BY id DESC LIMIT ?`,
    chatId,
    userId,
    now,
    limit,
  );
  return rows.reverse();
}

export async function renameChat(db: D1Database, userId: number, chatId: string, title: string): Promise<boolean> {
  return (await run(db, 'UPDATE chats SET title=? WHERE id=? AND user_id=?', title, chatId, userId)) === 1;
}

export async function setChatModel(db: D1Database, userId: number, chatId: string, modelKey: string): Promise<boolean> {
  return (await run(db, 'UPDATE chats SET model_key=? WHERE id=? AND user_id=?', modelKey, chatId, userId)) === 1;
}

export async function setChatRole(db: D1Database, userId: number, chatId: string, roleKey: string | null, custom: string | null): Promise<boolean> {
  return (await run(db, 'UPDATE chats SET role_key=?, custom_role=? WHERE id=? AND user_id=?', roleKey, custom, chatId, userId)) === 1;
}

export async function setArchived(db: D1Database, userId: number, chatId: string, archived: boolean): Promise<boolean> {
  return (await run(db, 'UPDATE chats SET is_archived=? WHERE id=? AND user_id=?', archived ? 1 : 0, chatId, userId)) === 1;
}

export async function deleteChat(db: D1Database, userId: number, chatId: string): Promise<boolean> {
  const res = await db.batch([
    stmt(db, 'DELETE FROM chats WHERE id=? AND user_id=?', chatId, userId),
    stmt(db, 'UPDATE users SET current_chat_id=NULL WHERE id=? AND current_chat_id=?', userId, chatId),
  ]);
  return (res[0]?.meta?.changes ?? 0) === 1;
}

/** Statements that persist one successful exchange (user + assistant message) and bump the chat. */
export function saveExchangeStatements(
  db: D1Database,
  p: {
    chat: ChatRow;
    userId: number;
    userText: string;
    answer: string;
    cost: number;
    now: number;
    messageTtlSec: number;
    chatTtlSec: number;
    autoTitle: string | null;
  },
): D1PreparedStatement[] {
  const exp = p.now + p.messageTtlSec;
  return [
    stmt(db, 'INSERT INTO messages(chat_id,user_id,role,content,cost,created_at,expires_at) VALUES(?,?,?,?,0,?,?)', p.chat.id, p.userId, 'user', p.userText, p.now, exp),
    stmt(db, 'INSERT INTO messages(chat_id,user_id,role,content,cost,created_at,expires_at) VALUES(?,?,?,?,?,?,?)', p.chat.id, p.userId, 'assistant', p.answer, p.cost, p.now, exp),
    stmt(
      db,
      'UPDATE chats SET updated_at=?, expires_at=?, title=COALESCE(title, ?) WHERE id=? AND user_id=?',
      p.now,
      p.now + p.chatTtlSec,
      p.autoTitle,
      p.chat.id,
      p.userId,
    ),
  ];
}
