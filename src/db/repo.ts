import type { Env } from '../env';
import { all, first, nowIso, placeholders, uuid } from './db';
import type { Chat, Model, Order, Plan, Role, User } from './types';

export async function getUser(db: D1Database, userId: number): Promise<User | null> {
  return first<User>(db.prepare('SELECT * FROM users WHERE id = ?').bind(userId));
}

export async function upsertUser(
  db: D1Database,
  tgUser: {
    id: number;
    username?: string;
    first_name?: string;
    language_code?: string;
  }
): Promise<User> {
  const existing = await getUser(db, tgUser.id);
  const lang: 'ru' | 'en' =
    existing?.language ??
    (tgUser.language_code?.toLowerCase().startsWith('ru') ? 'ru' : 'en');

  const now = nowIso();

  if (existing) {
    await db
      .prepare(
        'UPDATE users SET username=?, first_name=?, last_seen_at=? WHERE id=?'
      )
      .bind(
        tgUser.username ?? null,
        tgUser.first_name ?? null,
        now,
        tgUser.id
      )
      .run();

    return (await getUser(db, tgUser.id))!;
  }

  const free = Number(
    (await getSetting(db, 'free_points_daily')) ?? '50'
  );

  const reset = new Date(
    Date.now() + 24 * 3600 * 1000
  ).toISOString();

  const defaultModel = await getSetting(db, 'default_model_key');
  const defaultRole = await getRole(db, 'assistant');

  await db.batch([
    db
      .prepare(
        `INSERT INTO users(
          id,
          username,
          first_name,
          language,
          mode,
          mode_arg,
          current_chat_id,
          last_model_key,
          search_model_key,
          default_role_key,
          is_blocked,
          bot_blocked,
          created_at,
          last_seen_at
        )
        VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?)`
      )
      .bind(
        tgUser.id,
        tgUser.username ?? null,
        tgUser.first_name ?? null,
        lang,
        'chat',
        null,
        null,
        defaultModel || null,
        null,
        defaultRole?.role_key ?? null,
        now,
        now
      ),

    db
      .prepare(
        `INSERT INTO balances(
          user_id,
          free_points,
          free_reset_at,
          purchased_points,
          updated_at
        )
        VALUES(?,?,?,?,?)`
      )
      .bind(
        tgUser.id,
        free,
        reset,
        0,
        now
      )
  ]);

  return (await getUser(db, tgUser.id))!;
}

export async function ensureChat(
  db: D1Database,
  user: User,
  env: import('../env').Env
): Promise<Chat> {
  if (user.current_chat_id) {
    const chat = await getChat(db, user.current_chat_id, user.id);

    if (chat) {
      const usable = await getUsableModel(
        db,
        chat.model_key,
        env
      );

      if (usable) return chat;

      const fallback = await getDefaultChatModel(db, env);

      if (fallback) {
        await updateChatModel(
          db,
          chat.id,
          user.id,
          fallback.model_key
        );

        return (await getChat(
          db,
          chat.id,
          user.id
        ))!;
      }

      return chat;
    }
  }

  const model = await getDefaultChatModel(db, env);

  if (!model) {
    throw new Error('NO_MODEL');
  }

  return createChat(
    db,
    user.id,
    model.model_key,
    user.default_role_key ?? 'assistant'
  );
}

export async function getChat(
  db: D1Database,
  chatId: string,
  userId: number
): Promise<Chat | null> {
  return first<Chat>(
    db
      .prepare(
        'SELECT * FROM chats WHERE id=? AND user_id=?'
      )
      .bind(chatId, userId)
  );
}

export async function createChat(
  db: D1Database,
  userId: number,
  modelKey: string,
  roleKey: string | null
): Promise<Chat> {
  const row = await first<{ max_seq: number | null }>(
    db
      .prepare(
        'SELECT MAX(seq) as max_seq FROM chats WHERE user_id=?'
      )
      .bind(userId)
  );

  const seq = (row?.max_seq ?? 0) + 1;
  const id = uuid();
  const title = `Новый диалог №${seq}`;
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `INSERT INTO chats(
          id,
          user_id,
          seq,
          title,
          model_key,
          role_key,
          custom_role,
          is_archived,
          created_at,
          updated_at
        )
        VALUES(?,?,?,?,?,?,NULL,0,?,?)`
      )
      .bind(
        id,
        userId,
        seq,
        title,
        modelKey,
        roleKey,
        now,
        now
      ),

    db
      .prepare(
        'UPDATE users SET current_chat_id=?, last_model_key=? WHERE id=?'
      )
      .bind(
        id,
        modelKey,
        userId
      )
  ]);

  return (await getChat(
    db,
    id,
    userId
  ))!;
}

export async function getDefaultChatModel(
  db: D1Database,
  env?: Env
): Promise<Model | null> {
  const preferred = await getSetting(
    db,
    'default_model_key'
  );

  if (preferred) {
    const m = await getUsableModel(
      db,
      preferred,
      env
    );

    if (m) return m;
  }

  const baseline = await getUsableModel(
    db,
    'llama-3-1-8b',
    env
  );

  if (baseline) return baseline;

  const models = await all<Model>(
    db.prepare(
      `SELECT *
       FROM models
       WHERE type='chat'
       AND is_active=1
       ORDER BY sort ASC, created_at ASC`
    )
  );

  if (!env) {
    return models[0] ?? null;
  }

  return (
    models.find(
      m => providerConfigured(m, env)
    ) ?? null
  );
}

export async function getUsableModel(
  db: D1Database,
  key: string,
  env?: Env
): Promise<Model | null> {
  const m = await first<Model>(
    db
      .prepare(
        'SELECT * FROM models WHERE model_key=? AND is_active=1'
      )
      .bind(key)
  );

  if (!m) return null;

  if (!env) return m;

  if (!providerConfigured(m, env)) {
    return null;
  }

  return m;
}

export function providerConfigured(
  model: Model,
  env: Env
): boolean {
  switch (model.provider) {
    case 'workers_ai':
      return Boolean(env.AI);

    case 'gemini':
      return Boolean(env.GEMINI_API_KEY);

    case 'openai':
      return Boolean(env.OPENAI_API_KEY);

    case 'deepseek':
      return Boolean(env.DEEPSEEK_API_KEY);

    case 'kimi':
      return Boolean(env.KIMI_API_KEY);

    case 'anthropic':
      return Boolean(env.ANTHROPIC_API_KEY);

    case 'openai_compat': {
      try {
        const cfg = JSON.parse(
          model.config || '{}'
        ) as {
          api_key_env?: string;
          base_url?: string;
        };

        return Boolean(
          cfg.base_url &&
          cfg.api_key_env &&
          (env as Record<string, unknown>)[
            cfg.api_key_env
          ]
        );
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}

export async function listUsableChatFamilies(
  db: D1Database,
  env: Env
): Promise<Array<{ family: string; count: number }>> {
  const models = await all<Model>(
    db.prepare(
      "SELECT * FROM models WHERE is_active=1 AND type='chat' ORDER BY sort,name"
    )
  );

  const map = new Map<string, number>();

  for (const m of models) {
    if (providerConfigured(m, env)) {
      map.set(
        m.family,
        (map.get(m.family) ?? 0) + 1
      );
    }
  }

  return [...map.entries()].map(
    ([family, count]) => ({
      family,
      count
    })
  );
}

export async function listModelsForFamily(
  db: D1Database,
  env: Env,
  family: string
): Promise<Model[]> {
  const models = await all<Model>(
    db
      .prepare(
        "SELECT * FROM models WHERE is_active=1 AND family=? AND type='chat' ORDER BY tier,sort,name"
      )
      .bind(family)
  );

  return models.filter(
    m => providerConfigured(m, env)
  );
}

export async function listSearchModels(
  db: D1Database,
  env: Env
): Promise<Model[]> {
  const models = await all<Model>(
    db.prepare(
      "SELECT * FROM models WHERE is_active=1 AND type='search' ORDER BY sort,name"
    )
  );

  return models.filter(
    m => providerConfigured(m, env)
  );
}

export async function getRole(
  db: D1Database,
  key: string
): Promise<Role | null> {
  return first<Role>(
    db
      .prepare(
        'SELECT * FROM roles WHERE role_key=? AND is_active=1'
      )
      .bind(key)
  );
}

export async function listRoles(
  db: D1Database
): Promise<Role[]> {
  return all<Role>(
    db.prepare(
      'SELECT * FROM roles WHERE is_active=1 ORDER BY sort,name_ru'
    )
  );
}

export async function getSetting(
  db: D1Database,
  key: string
): Promise<string | null> {
  const r = await first<{ value: string }>(
    db
      .prepare(
        'SELECT value FROM settings WHERE key=?'
      )
      .bind(key)
  );

  return r?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  key: string,
  value: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings(key,value,updated_at)
       VALUES(?,?,?)
       ON CONFLICT(key)
       DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at`
    )
    .bind(
      key,
      value,
      nowIso()
    )
    .run();
}

export async function listSettings(
  db: D1Database
): Promise<Array<{ key: string; value: string }>> {
  return all(
    db.prepare(
      'SELECT key,value FROM settings ORDER BY key'
    )
  );
}

export async function getPlan(
  db: D1Database,
  planKey: string
): Promise<Plan | null> {
  return first<Plan>(
    db
      .prepare(
        'SELECT * FROM plans WHERE plan_key=?'
      )
      .bind(planKey)
  );
}

export async function listPlans(
  db: D1Database,
  kind?: 'subscription' | 'points'
): Promise<Plan[]> {
  return kind
    ? all<Plan>(
        db
          .prepare(
            'SELECT * FROM plans WHERE kind=? AND is_active=1 ORDER BY sort'
          )
          .bind(kind)
      )
    : all<Plan>(
        db.prepare(
          'SELECT * FROM plans WHERE is_active=1 ORDER BY kind,sort'
        )
      );
}

export async function createOrder(
  db: D1Database,
  userId: number,
  plan: Plan
): Promise<Order> {
  const id = `ord_${crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 20)}`;

  const now = nowIso();

  const expires = new Date(
    Date.now() + 24 * 3600 * 1000
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO orders(
        id,
        user_id,
        plan_key,
        kind,
        title_ru,
        title_en,
        amount_minor,
        currency,
        status,
        provider,
        provider_order_id,
        payment_url,
        created_at,
        expires_at
      )
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      id,
      userId,
      plan.plan_key,
      plan.kind,
      plan.title_ru,
      plan.title_en,
      plan.price_minor,
      plan.currency,
      'pending',
      null,
      null,
      null,
      now,
      expires
    )
    .run();

  return (await first<Order>(
    db
      .prepare(
        'SELECT * FROM orders WHERE id=?'
      )
      .bind(id)
  ))!;
}

export async function listUserOrders(
  db: D1Database,
  userId: number,
  page: number,
  pageSize: number
): Promise<Order[]> {
  return all<Order>(
    db
      .prepare(
        'SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      )
      .bind(
        userId,
        pageSize,
        (page - 1) * pageSize
      )
  );
}

export async function countLiveMessages(
  db: D1Database,
  chatId: string,
  userId: number
): Promise<number> {
  const r = await first<{ count: number }>(
    db
      .prepare(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id=? AND user_id=? AND expires_at>?'
      )
      .bind(
        chatId,
        userId,
        nowIso()
      )
  );

  return Number(r?.count ?? 0);
}

export async function getLiveMessages(
  db: D1Database,
  chatId: string,
  userId: number,
  limit: number,
  maxChars: number
): Promise<Array<{ role: string; content: string }>> {
  const rows = await all<{
    role: string;
    content: string;
  }>(
    db
      .prepare(
        `SELECT role,content
         FROM messages
         WHERE chat_id=?
         AND user_id=?
         AND expires_at>?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(
        chatId,
        userId,
        nowIso(),
        limit
      )
  );

  rows.reverse();

  let total = 0;

  const out: Array<{
    role: string;
    content: string;
  }> = [];

  for (const row of rows) {
    if (
      total + row.content.length >
      maxChars
    ) {
      break;
    }

    total += row.content.length;
    out.push(row);
  }

  return out.reverse();
}

export async function saveMessages(
  db: D1Database,
  chatId: string,
  userId: number,
  userText: string,
  assistantText: string,
  cost: number,
  ttlHours: number
): Promise<void> {
  const now = nowIso();

  const expires = new Date(
    Date.now() +
      Math.min(24, ttlHours) *
        3600 *
        1000
  ).toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT INTO messages(
          id,
          chat_id,
          user_id,
          role,
          content,
          cost,
          created_at,
          expires_at
        )
        VALUES(?,?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        chatId,
        userId,
        'user',
        userText,
        0,
        now,
        expires
      ),

    db
      .prepare(
        `INSERT INTO messages(
          id,
          chat_id,
          user_id,
          role,
          content,
          cost,
          created_at,
          expires_at
        )
        VALUES(?,?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        chatId,
        userId,
        'assistant',
        assistantText,
        cost,
        now,
        expires
      ),

    db
      .prepare(
        'UPDATE chats SET updated_at=? WHERE id=? AND user_id=?'
      )
      .bind(
        now,
        chatId,
        userId
      )
  ]);
}

export async function autoTitleIfNeeded(
  db: D1Database,
  chat: Chat,
  firstMessage: string
): Promise<void> {
  if (
    !chat.title.startsWith(
      'Новый диалог №'
    )
  ) {
    return;
  }

  const title =
    firstMessage
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) ||
    chat.title;

  await db
    .prepare(
      'UPDATE chats SET title=?, updated_at=? WHERE id=? AND user_id=?'
    )
    .bind(
      title,
      nowIso(),
      chat.id,
      chat.user_id
    )
    .run();
}

export async function updateChatModel(
  db: D1Database,
  chatId: string,
  userId: number,
  modelKey: string
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'UPDATE chats SET model_key=?, updated_at=? WHERE id=? AND user_id=?'
      )
      .bind(
        modelKey,
        nowIso(),
        chatId,
        userId
      ),

    db
      .prepare(
        'UPDATE users SET last_model_key=? WHERE id=?'
      )
      .bind(
        modelKey,
        userId
      )
  ]);
}

export async function setChatRole(
  db: D1Database,
  chatId: string,
  userId: number,
  roleKey: string | null,
  customRole: string | null
): Promise<void> {
  await db
    .prepare(
      'UPDATE chats SET role_key=?, custom_role=?, updated_at=? WHERE id=? AND user_id=?'
    )
    .bind(
      roleKey,
      customRole,
      nowIso(),
      chatId,
      userId
    )
    .run();
}

export async function archiveChat(
  db: D1Database,
  chatId: string,
  userId: number
): Promise<void> {
  await db
    .prepare(
      'UPDATE chats SET is_archived=1, updated_at=? WHERE id=? AND user_id=?'
    )
    .bind(
      nowIso(),
      chatId,
      userId
    )
    .run();
}

export async function unarchiveChat(
  db: D1Database,
  chatId: string,
  userId: number
): Promise<void> {
  await db
    .prepare(
      'UPDATE chats SET is_archived=0, updated_at=? WHERE id=? AND user_id=?'
    )
    .bind(
      nowIso(),
      chatId,
      userId
    )
    .run();
}

export async function deleteChat(
  db: D1Database,
  chatId: string,
  userId: number
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'DELETE FROM messages WHERE chat_id=? AND user_id=?'
      )
      .bind(chatId, userId),

    db
      .prepare(
        'DELETE FROM chats WHERE id=? AND user_id=?'
      )
      .bind(chatId, userId),

    db
      .prepare(
        'UPDATE users SET current_chat_id=NULL WHERE id=? AND current_chat_id=?'
      )
      .bind(
        userId,
        chatId
      )
  ]);
}

export async function listChats(
  db: D1Database,
  userId: number,
  archived: boolean,
  page: number,
  pageSize: number
): Promise<Chat[]> {
  return all<Chat>(
    db
      .prepare(
        'SELECT * FROM chats WHERE user_id=? AND is_archived=? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      )
      .bind(
        userId,
        archived ? 1 : 0,
        pageSize,
        (page - 1) * pageSize
      )
  );
}

export async function ensureActiveCurrentChat(
  db: D1Database,
  user: User,
  env: import('../env').Env
): Promise<Chat | null> {
  const candidates = await listChats(
    db,
    user.id,
    false,
    1,
    1
  );

  if (candidates[0]) {
    await db
      .prepare(
        'UPDATE users SET current_chat_id=?, last_model_key=? WHERE id=?'
      )
      .bind(
        candidates[0].id,
        candidates[0].model_key,
        user.id
      )
      .run();

    return candidates[0];
  }

  const model = await getDefaultChatModel(
    db,
    env
  );

  if (!model) return null;

  return createChat(
    db,
    user.id,
    model.model_key,
    user.default_role_key ?? 'assistant'
  );
}

/* =========================================================
   POINTS
   ========================================================= */

export async function resetFreePointsIfNeeded(
  db: D1Database,
  userId: number
): Promise<{
  free: number;
  paid: number;
}> {
  const bal =
    await first<{
      free_points: number;
      free_reset_at: string;
      purchased_points: number;
    }>(
      db
        .prepare(
          'SELECT free_points,free_reset_at,purchased_points FROM balances WHERE user_id=?'
        )
        .bind(userId)
    );

  if (!bal) {
    throw new Error(
      'BALANCE_NOT_FOUND'
    );
  }

  if (
    new Date(
      bal.free_reset_at
    ).getTime() <= Date.now()
  ) {
    const activeSub =
      await first<{
        plan_key: string;
      }>(
        db
          .prepare(
            `SELECT plan_key
             FROM subscriptions
             WHERE user_id=?
             AND expires_at>?
             ORDER BY expires_at DESC
             LIMIT 1`
          )
          .bind(
            userId,
            nowIso()
          )
      );

    let amount = Number(
      (await getSetting(
        db,
        'free_points_daily'
      )) ?? 50
    );

    if (activeSub) {
      const plan = await getPlan(
        db,
        activeSub.plan_key
      );

      if (
        plan?.kind ===
          'subscription' &&
        Number(plan.points) > 0
      ) {
        amount = Number(
          plan.points
        );
      } else {
        amount = Number(
          (await getSetting(
            db,
            'free_points_subscriber'
          )) ?? 100
        );
      }
    }

    const resetHours = Number(
      (await getSetting(
        db,
        'free_period_hours'
      )) ?? 24
    );

    const resetAt = new Date(
      Date.now() +
        resetHours *
          3600 *
          1000
    ).toISOString();

    const now = nowIso();

    await db.batch([
      db
        .prepare(
          `UPDATE balances
           SET free_points=?,
               free_reset_at=?,
               updated_at=?
           WHERE user_id=?`
        )
        .bind(
          amount,
          resetAt,
          now,
          userId
        ),

      db
        .prepare(
          `INSERT INTO transactions(
            id,
            user_id,
            kind,
            free_amount,
            paid_amount,
            ref,
            created_at
          )
          VALUES(?,?,?,?,?,?,?)`
        )
        .bind(
          uuid(),
          userId,
          'refill',
          amount,
          0,
          'daily',
          now
        )
    ]);

    return {
      free: amount,
      paid: bal.purchased_points
    };
  }

  return {
    free: bal.free_points,
    paid: bal.purchased_points
  };
}

export async function getBalance(
  db: D1Database,
  userId: number
): Promise<{
  free: number;
  paid: number;
}> {
  return resetFreePointsIfNeeded(
    db,
    userId
  );
}

export async function reservePoints(
  db: D1Database,
  userId: number,
  cost: number,
  ref: string
): Promise<{
  ok: boolean;
  holdId?: string;
  freeAmount: number;
  paidAmount: number;
  balance: {
    free: number;
    paid: number;
  };
}> {
  if (cost <= 0) {
    return {
      ok: true,
      freeAmount: 0,
      paidAmount: 0,
      balance: await getBalance(
        db,
        userId
      )
    };
  }

  const balance =
    await getBalance(
      db,
      userId
    );

  if (
    balance.free +
      balance.paid <
    cost
  ) {
    return {
      ok: false,
      freeAmount: 0,
      paidAmount: 0,
      balance
    };
  }

  const freeAmount =
    Math.min(
      balance.free,
      cost
    );

  const paidAmount =
    cost - freeAmount;

  const holdId = uuid();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE balances
         SET free_points=free_points-?,
             purchased_points=purchased_points-?,
             updated_at=?
         WHERE user_id=?`
      )
      .bind(
        freeAmount,
        paidAmount,
        now,
        userId
      ),

    db
      .prepare(
        `INSERT INTO point_holds(
          id,
          user_id,
          free_amount,
          paid_amount,
          free_reset_at,
          status,
          ref,
          created_at
        )
        SELECT ?,?,?,?,free_reset_at,?,?,?
        FROM balances
        WHERE user_id=?`
      )
      .bind(
        holdId,
        userId,
        freeAmount,
        paidAmount,
        'held',
        ref,
        now,
        userId
      ),

    db
      .prepare(
        `INSERT INTO transactions(
          id,
          user_id,
          kind,
          free_amount,
          paid_amount,
          ref,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        userId,
        'reserve',
        -freeAmount,
        -paidAmount,
        ref,
        now
      )
  ]);

  return {
    ok: true,
    holdId,
    freeAmount,
    paidAmount,
    balance: {
      free:
        balance.free -
        freeAmount,
      paid:
        balance.paid -
        paidAmount
    }
  };
}

export async function captureHold(
  db: D1Database,
  holdId: string
): Promise<void> {
  const hold =
    await first<{
      user_id: number;
      free_amount: number;
      paid_amount: number;
      ref: string;
    }>(
      db
        .prepare(
          `SELECT
            user_id,
            free_amount,
            paid_amount,
            ref
           FROM point_holds
           WHERE id=?
           AND status='held'`
        )
        .bind(holdId)
    );

  if (!hold) return;

  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE point_holds
         SET status=?,
             finished_at=?
         WHERE id=?
         AND status=?`
      )
      .bind(
        'captured',
        now,
        holdId,
        'held'
      ),

    db
      .prepare(
        `INSERT INTO transactions(
          id,
          user_id,
          kind,
          free_amount,
          paid_amount,
          ref,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        hold.user_id,
        'capture',
        0,
        0,
        hold.ref,
        now
      )
  ]);
}

export async function releaseHold(
  db: D1Database,
  holdId: string
): Promise<void> {
  const hold =
    await first<{
      user_id: number;
      free_amount: number;
      paid_amount: number;
      ref: string;
    }>(
      db
        .prepare(
          `SELECT
            user_id,
            free_amount,
            paid_amount,
            ref
           FROM point_holds
           WHERE id=?
           AND status='held'`
        )
        .bind(holdId)
    );

  if (!hold) return;

  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE balances
         SET free_points=free_points+?,
             purchased_points=purchased_points+?,
             updated_at=?
         WHERE user_id=?`
      )
      .bind(
        hold.free_amount,
        hold.paid_amount,
        now,
        hold.user_id
      ),

    db
      .prepare(
        `UPDATE point_holds
         SET status=?,
             finished_at=?
         WHERE id=?
         AND status=?`
      )
      .bind(
        'released',
        now,
        holdId,
        'held'
      ),

    db
      .prepare(
        `INSERT INTO transactions(
          id,
          user_id,
          kind,
          free_amount,
          paid_amount,
          ref,
          created_at
        )
        VALUES(?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        hold.user_id,
        'release',
        hold.free_amount,
        hold.paid_amount,
        hold.ref,
        now
      )
  ]);
}

export async function listPendingUsers(
  db: D1Database,
  page: number,
  pageSize: number
): Promise<
  Array<{
    id: number;
    username: string | null;
    created_at: string;
    is_blocked: number;
    bot_blocked: number;
  }>
> {
  return all(
    db
      .prepare(
        `SELECT
          id,
          username,
          created_at,
          is_blocked,
          bot_blocked
         FROM users
         ORDER BY created_at DESC
         LIMIT ?
         OFFSET ?`
      )
      .bind(
        pageSize,
        (page - 1) *
          pageSize
      )
  );
}

export async function countUsers(
  db: D1Database
): Promise<number> {
  const r =
    await first<{
      count: number;
    }>(
      db.prepare(
        'SELECT COUNT(*) as count FROM users'
      )
    );

  return Number(
    r?.count ?? 0
  );
}

export async function setUserBlock(
  db: D1Database,
  userId: number,
  blocked: boolean,
  reason: string | null
): Promise<void> {
  await db
    .prepare(
      'UPDATE users SET is_blocked=?,block_reason=? WHERE id=?'
    )
    .bind(
      blocked ? 1 : 0,
      reason,
      userId
    )
    .run();
}

export async function grantSubscription(
  db: D1Database,
  userId: number,
  days: number,
  source = 'admin'
): Promise<void> {
  const now = new Date();

  const existing =
    await first<{
      expires_at: string;
    }>(
      db
        .prepare(
          `SELECT expires_at
           FROM subscriptions
           WHERE user_id=?
           ORDER BY expires_at DESC
           LIMIT 1`
        )
        .bind(userId)
    );

  const start =
    existing &&
    new Date(
      existing.expires_at
    ) > now
      ? new Date(
          existing.expires_at
        )
      : now;

  const expires = new Date(
    start.getTime() +
      days *
        86400000
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO subscriptions(
        id,
        user_id,
        plan_key,
        starts_at,
        expires_at,
        source,
        order_id,
        created_at
      )
      VALUES(?,?,?,?,?,?,?,?)`
    )
    .bind(
      uuid(),
      userId,
      'manual',
      now.toISOString(),
      expires,
      source,
      null,
      nowIso()
    )
    .run();
}

/* =========================================================
   PAYMENTS / ORDERS
   ========================================================= */

export type PaidOrderResult = {
  order: Order;
  kind: 'subscription' | 'points';
  points: number;
  days?: number;
  expiresAt?: string;
};

export async function markOrderPaid(
  db: D1Database,
  orderId: string
): Promise<PaidOrderResult | null> {
  const order =
    await first<Order>(
      db
        .prepare(
          'SELECT * FROM orders WHERE id=?'
        )
        .bind(orderId)
    );

  if (
    !order ||
    order.status === 'paid'
  ) {
    return null;
  }

  const plan =
    await getPlan(
      db,
      order.plan_key
    );

  const now = nowIso();

  if (!plan) {
    return null;
  }

  const statements:
    D1PreparedStatement[] = [
    db
      .prepare(
        'UPDATE orders SET status=?,paid_at=?,provider=? WHERE id=?'
      )
      .bind(
        'paid',
        now,
        'manual',
        orderId
      ),

    db
      .prepare(
        `INSERT OR IGNORE INTO payments(
          id,
          order_id,
          provider,
          provider_payment_id,
          amount_minor,
          currency,
          status,
          created_at
        )
        VALUES(?,?,?,?,?,?,?,?)`
      )
      .bind(
        uuid(),
        orderId,
        'manual',
        `manual:${orderId}`,
        order.amount_minor,
        order.currency,
        'paid',
        now
      )
  ];

  /*
   * SUBSCRIPTION
   *
   * Подписка не является отдельным
   * доступом к конкретным моделям.
   *
   * Она определяет количество
   * ежедневных free_points через
   * plans.points.
   */
  if (
    plan.kind ===
      'subscription' &&
    plan.duration_days
  ) {
    const existing =
      await first<{
        expires_at: string;
      }>(
        db
          .prepare(
            `SELECT expires_at
             FROM subscriptions
             WHERE user_id=?
             AND expires_at>?
             ORDER BY expires_at DESC
             LIMIT 1`
          )
          .bind(
            order.user_id,
            now
          )
      );

    const start =
      existing
        ? new Date(
            existing.expires_at
          )
        : new Date();

    const expires =
      new Date(
        start.getTime() +
          plan.duration_days *
            86400000
      ).toISOString();

    const dailyPoints =
      Number(plan.points) > 0
        ? Number(plan.points)
        : Number(
            (await getSetting(
              db,
              'free_points_subscriber'
            )) ?? 100
          );

    statements.push(
      db
        .prepare(
          `INSERT INTO subscriptions(
            id,
            user_id,
            plan_key,
            starts_at,
            expires_at,
            source,
            order_id,
            created_at
          )
          VALUES(?,?,?,?,?,?,?,?)`
        )
        .bind(
          uuid(),
          order.user_id,
          plan.plan_key,
          start.toISOString(),
          expires,
          'purchase',
          orderId,
          now
        ),

      db
        .prepare(
          `UPDATE balances
           SET free_points=?,
               free_reset_at=?,
               updated_at=?
           WHERE user_id=?`
        )
        .bind(
          dailyPoints,
          new Date(
            Date.now() +
              24 *
                3600 *
                1000
          ).toISOString(),
          now,
          order.user_id
        ),

      db
        .prepare(
          `INSERT INTO transactions(
            id,
            user_id,
            kind,
            free_amount,
            paid_amount,
            ref,
            created_at
          )
          VALUES(?,?,?,?,?,?,?)`
        )
        .bind(
          uuid(),
          order.user_id,
          'subscription_bonus',
          dailyPoints,
          0,
          orderId,
          now
        )
    );

    await db.batch(
      statements
    );

    return {
      order,
      kind: 'subscription',
      points: dailyPoints,
      days: plan.duration_days,
      expiresAt: expires
    };
  }

  /*
   * POINTS PACKAGE
   *
   * Купленные баллы идут в
   * purchased_points и не имеют
   * ежедневного сброса.
   */
  if (
    plan.kind ===
    'points'
  ) {
    statements.push(
      db
        .prepare(
          `UPDATE balances
           SET purchased_points=
             purchased_points+?,
             updated_at=?
           WHERE user_id=?`
        )
        .bind(
          plan.points,
          now,
          order.user_id
        ),

      db
        .prepare(
          `INSERT INTO transactions(
            id,
            user_id,
            kind,
            free_amount,
            paid_amount,
            ref,
            created_at
          )
          VALUES(?,?,?,?,?,?,?)`
        )
        .bind(
          uuid(),
          order.user_id,
          'purchase',
          0,
          plan.points,
          orderId,
          now
        )
    );

    await db.batch(
      statements
    );

    return {
      order,
      kind: 'points',
      points: plan.points
    };
  }

  return null;
}

export async function getUserStats(
  db: D1Database,
  userId: number
) {
  const [
    responsesToday,
    totalResponses
  ] = await Promise.all([
    first<{ count: number }>(
      db
        .prepare(
          `SELECT COUNT(*) count
           FROM usage_logs
           WHERE user_id=?
           AND kind='ai'
           AND status='ok'
           AND created_at>=date('now','start of day')`
        )
        .bind(userId)
    ),

    first<{ count: number }>(
      db
        .prepare(
          `SELECT COUNT(*) count
           FROM usage_logs
           WHERE user_id=?
           AND kind='ai'
           AND status='ok'`
        )
        .bind(userId)
    )
  ]);

  return {
    responsesToday: Number(
      responsesToday?.count ?? 0
    ),
    totalResponses: Number(
      totalResponses?.count ?? 0
    )
  };
}
