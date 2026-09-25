import type { Env } from '../env';
import { all, first, nowIso, placeholders, uuid } from './db';
import type { Chat, Model, Order, Plan, Role, User, Lang, PlanPaymentPrice } from './types';
import { dialogMessageLimitForPlan, DEFAULT_FREE_DIALOG_MESSAGES, DEFAULT_SUBSCRIBER_DIALOG_MESSAGES, DEFAULT_TWO_YEAR_DIALOG_MESSAGES } from '../utils/chat-limits';

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
  const code = (tgUser.language_code ?? '').toLowerCase();
  const lang: Lang = existing?.language ?? (code.startsWith('ru') ? 'ru' : code.startsWith('uz') ? 'uz' : 'en');
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

  const resetHours = Number(
    (await getSetting(db, 'free_period_hours')) ?? 24
  );
  const reset = new Date(
    Date.now() + Math.max(1, resetHours) * 3600 * 1000
  ).toISOString();

  const defaultModel = await getSetting(db, 'default_model_key');
  const defaultRole = await getRole(db, 'assistant');

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO users(
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
        `INSERT OR IGNORE INTO balances(
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
      ),

    db
      .prepare(
        'UPDATE users SET username=?, first_name=?, last_seen_at=? WHERE id=?'
      )
      .bind(
        tgUser.username ?? null,
        tgUser.first_name ?? null,
        now,
        tgUser.id
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

  const configured = providerConfigured(m, env);

  if (m.provider === 'xkiro') {
    console.log('XKIRO_MODEL_CHECK', {
      modelKey: m.model_key,
      modelId: m.model_id,
      provider: m.provider,
      hasApiKey: Boolean(env.XKIRO_API_KEY),
      configured
    });
  }

  if (!configured) {
    return null;
  }

  return m;
}

/** Search Mode selection is independent from normal chat-provider filtering. */
export async function getSearchModel(db: D1Database, key: string): Promise<Model | null> {
  return first<Model>(
    db.prepare(
      "SELECT * FROM models WHERE model_key=? AND is_active=1 AND type='search'"
    ).bind(key)
  );
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

    case 'xkiro': {
      const configured = Boolean(env.XKIRO_API_KEY) && model.model_id.includes('/');
      console.log('XKIRO_PROVIDER_CHECK', {
        modelKey: model.model_key,
        modelId: model.model_id,
        hasApiKey: Boolean(env.XKIRO_API_KEY),
        validModelId: model.model_id.includes('/'),
        configured
      });
      return configured;
    }
    
    case 'groq':
      return Boolean(env.GROQ_API_KEY);
    
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
  _env: Env
): Promise<Model[]> {
  // Search models remain selectable independently of normal provider filtering.
  // The AI provider is checked only after web results have been found.
  return all<Model>(
    db.prepare(
      "SELECT * FROM models WHERE is_active=1 AND type='search' ORDER BY sort,name"
    )
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

export async function isPaymentProviderEnabled(
  db: D1Database,
  provider: string
): Promise<boolean> {
  const value = await getSetting(db, `payment_method_${provider}`);

  // Backward compatibility for databases created before provider-level
  // switches were introduced.
  return value == null ? true : Number(value) === 1;
}

export async function isPaymentMethodEnabled(
  db: D1Database,
  provider: string
): Promise<boolean> {
  return (
    Number((await getSetting(db, 'feature_payments')) ?? 0) === 1 &&
    await isPaymentProviderEnabled(db, provider)
  );
}

export async function setPaymentMethodEnabled(
  db: D1Database,
  provider: string,
  enabled: boolean
): Promise<void> {
  await setSetting(
    db,
    `payment_method_${provider}`,
    enabled ? '1' : '0'
  );
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

export async function getPlanPaymentPrice(
  db: D1Database,
  planKey: string,
  provider: string
): Promise<PlanPaymentPrice | null> {
  return first<PlanPaymentPrice>(
    db.prepare(
      'SELECT * FROM plan_payment_prices WHERE plan_key=? AND provider=? AND is_active=1'
    ).bind(planKey, provider)
  );
}

export async function setPlanPaymentPrice(
  db: D1Database,
  planKey: string,
  provider: string,
  currency: string,
  amount: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO plan_payment_prices(plan_key,provider,currency,amount,is_active,updated_at)
     VALUES(?,?,?,?,1,?)
     ON CONFLICT(plan_key,provider)
     DO UPDATE SET currency=excluded.currency,amount=excluded.amount,is_active=1,updated_at=excluded.updated_at`
  ).bind(planKey, provider, currency, amount, nowIso()).run();
}

export async function createProviderOrder(
  db: D1Database,
  userId: number,
  plan: Plan,
  provider: string,
  amount: number,
  currency: string,
  paymentUrl: string | null = null
): Promise<Order> {
  const id = `ord_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const now = nowIso();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await db.prepare(
    `INSERT INTO orders(
      id,user_id,plan_key,kind,title_ru,title_en,amount_minor,currency,status,
      provider,provider_order_id,payment_url,created_at,expires_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,userId,plan.plan_key,plan.kind,plan.title_ru,plan.title_en,amount,currency,
    'pending',provider,null,paymentUrl,now,expires
  ).run();

  return (await first<Order>(db.prepare('SELECT * FROM orders WHERE id=?').bind(id)))!;
}

export type StarsOrderResult = {
  order: Order;
  plan: Plan;
  alreadyPaid: boolean;
  expiresAt?: string;
  points?: number;
  days?: number;
};

export async function completeTelegramStarsOrder(
  db: D1Database,
  orderId: string,
  userId: number,
  amountStars: number,
  chargeId: string
): Promise<StarsOrderResult | null> {
  const order = await first<Order>(
    db.prepare('SELECT * FROM orders WHERE id=?').bind(orderId)
  );
  if (!order || order.user_id !== userId) return null;

  const plan = await getPlan(db, order.plan_key);
  if (!plan || plan.kind !== 'subscription' || !plan.duration_days) return null;

  if (order.status === 'paid') {
    const expires = await first<{expires_at:string}>(
      db.prepare(
        'SELECT expires_at FROM subscriptions WHERE order_id=? ORDER BY created_at DESC LIMIT 1'
      ).bind(orderId)
    );
    return { order, plan, alreadyPaid:true, expiresAt:expires?.expires_at };
  }

  if (
    order.status !== 'pending' ||
    order.provider !== 'telegram_stars' ||
    order.currency !== 'XTR' ||
    Number(order.amount_minor) !== Number(amountStars) ||
    !chargeId
  ) return null;

  const now = nowIso();
  if (order.expires_at && new Date(order.expires_at).getTime() <= Date.now()) return null;

  const existing = await first<{expires_at:string}>(
    db.prepare(
      'SELECT expires_at FROM subscriptions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1'
    ).bind(userId, now)
  );
  const start = existing ? new Date(existing.expires_at) : new Date(now);
  const expiresAt = new Date(start.getTime() + plan.duration_days * 86400000).toISOString();
  const dailyPoints = Number(plan.points) > 0
    ? Number(plan.points)
    : Number((await getSetting(db,'free_points_subscriber')) ?? 100);
  const resetHours = Math.max(1, Number((await getSetting(db,'free_period_hours')) ?? 24));

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE orders
       SET status='paid',paid_at=?,provider='telegram_stars',provider_order_id=?
       WHERE id=? AND status='pending' AND provider='telegram_stars' AND currency='XTR'`
    ).bind(now, chargeId, orderId),

    db.prepare(
      `INSERT INTO payments(
        id,order_id,provider,provider_payment_id,amount_minor,currency,status,created_at
      )
      SELECT ?,?,?,?,?,?,'paid',?
      WHERE EXISTS(
        SELECT 1 FROM orders
        WHERE id=? AND status='paid' AND provider='telegram_stars' AND provider_order_id=?
      )
      ON CONFLICT(provider,provider_payment_id) DO NOTHING`
    ).bind(
      uuid(),orderId,'telegram_stars',chargeId,amountStars,'XTR',now,orderId,chargeId
    ),

    db.prepare(
      `INSERT INTO subscriptions(
        id,user_id,plan_key,starts_at,expires_at,source,order_id,created_at
      )
      SELECT ?,?,?,?,?,?,?,?
      WHERE EXISTS(
        SELECT 1 FROM payments
        WHERE order_id=? AND provider='telegram_stars' AND provider_payment_id=? AND status='paid'
      )
      AND NOT EXISTS(
        SELECT 1 FROM subscriptions WHERE order_id=?
      )`
    ).bind(
      uuid(),userId,plan.plan_key,start.toISOString(),expiresAt,'telegram_stars',orderId,now,
      orderId,chargeId,orderId
    ),

    db.prepare(
      `UPDATE balances
       SET free_points=?,free_reset_at=?,updated_at=?
       WHERE user_id=?
       AND EXISTS(
         SELECT 1 FROM subscriptions WHERE order_id=?
       )
       AND NOT EXISTS(
         SELECT 1 FROM transactions WHERE user_id=? AND ref=? AND kind='subscription_bonus'
       )`
    ).bind(
      dailyPoints,new Date(Date.now()+resetHours*3600000).toISOString(),now,userId,
      orderId,userId,orderId
    ),

    db.prepare(
      `INSERT INTO transactions(
        id,user_id,kind,free_amount,paid_amount,ref,created_at
      )
      SELECT ?,?, 'subscription_bonus',?,0,?,?
      WHERE EXISTS(
        SELECT 1 FROM subscriptions WHERE order_id=?
      )
      AND NOT EXISTS(
        SELECT 1 FROM transactions WHERE user_id=? AND ref=? AND kind='subscription_bonus'
      )`
    ).bind(
      uuid(),userId,dailyPoints,orderId,now,orderId,userId,orderId
    )
  ];

  let batchResult:Array<{success?:boolean;meta?:{changes?:number}&Record<string,unknown>}>;
  try {
    batchResult=await db.batch(statements);
  } catch (err) {
    console.error('telegram_stars_complete_error', String(err));
    throw new Error('STARS_DB_ACTIVATION_FAILED');
  }

  const paidOrder = await first<Order>(
    db.prepare('SELECT * FROM orders WHERE id=?').bind(orderId)
  );
  if (!paidOrder) return null;

  if (paidOrder.status === 'paid' && paidOrder.provider_order_id === chargeId) {
    const payment = await first<{status:string}>(
      db.prepare('SELECT status FROM payments WHERE order_id=? AND provider_payment_id=?').bind(orderId,chargeId)
    );
    const subscription = await first<{expires_at:string}>(
      db.prepare('SELECT expires_at FROM subscriptions WHERE order_id=? ORDER BY created_at DESC LIMIT 1').bind(orderId)
    );
    if (payment?.status === 'paid' && subscription) {
      return {
        order: paidOrder,
        plan,
        alreadyPaid: Number(batchResult?.[1]?.meta?.changes??0) !== 1,
        expiresAt: subscription.expires_at,
        points: dailyPoints,
        days: plan.duration_days
      };
    }
  }

  const existingPayment = await first<{status:string}>(
    db.prepare('SELECT status FROM payments WHERE order_id=?').bind(orderId)
  );
  const existingSubscription = await first<{expires_at:string}>(
    db.prepare('SELECT expires_at FROM subscriptions WHERE order_id=? ORDER BY created_at DESC LIMIT 1').bind(orderId)
  );
  if (paidOrder.status === 'paid' && existingPayment?.status === 'paid' && existingSubscription) {
    return { order:paidOrder, plan, alreadyPaid:true, expiresAt:existingSubscription.expires_at };
  }

  return null;
}

export type RefundableStarsOrder = Order & {
  payment_id: string;
  payment_status: string;
  provider_payment_id: string;
  refunded_at: string | null;
  refunded_by: number | null;
  refund_error: string | null;
  username: string | null;
  first_name: string | null;
};

export async function getRefundableStarsOrder(db:D1Database,orderId:string):Promise<RefundableStarsOrder|null>{
  return first<RefundableStarsOrder>(db.prepare(`
    SELECT
      o.*,
      p.id AS payment_id,
      p.status AS payment_status,
      p.provider_payment_id,
      p.refunded_at,
      p.refunded_by,
      p.refund_error,
      u.username,
      u.first_name
    FROM orders o
    JOIN payments p ON p.order_id=o.id AND p.provider='telegram_stars'
    JOIN users u ON u.id=o.user_id
    WHERE o.id=?
    LIMIT 1
  `).bind(orderId));
}

export async function listAdminStarsPayments(db:D1Database,limit=20):Promise<RefundableStarsOrder[]>{
  const n=Math.max(1,Math.min(50,Math.floor(limit)));
  return all<RefundableStarsOrder>(db.prepare(`
    SELECT
      o.*,
      p.id AS payment_id,
      p.status AS payment_status,
      p.provider_payment_id,
      p.refunded_at,
      p.refunded_by,
      p.refund_error,
      u.username,
      u.first_name
    FROM orders o
    JOIN payments p ON p.order_id=o.id AND p.provider='telegram_stars'
    JOIN users u ON u.id=o.user_id
    WHERE o.provider='telegram_stars'
    ORDER BY o.created_at DESC
    LIMIT ?
  `).bind(n));
}

export async function beginStarsRefund(db:D1Database,orderId:string,adminId:number):Promise<boolean>{
  const startedAt=nowIso();
  const result=await db.prepare(`
    UPDATE payments
    SET status='refund_pending',refunded_by=?,refund_error=NULL,refund_started_at=?
    WHERE order_id=? AND provider='telegram_stars' AND status='paid'
  `).bind(adminId,startedAt,orderId).run();
  return Number(result.meta?.changes??0)===1;
}

export async function failStarsRefund(db:D1Database,orderId:string,error:unknown):Promise<void>{
  await db.prepare(`
    UPDATE payments
    SET status='paid',refund_error=?,refund_started_at=NULL
    WHERE order_id=? AND provider='telegram_stars' AND status='refund_pending'
  `).bind(String(error instanceof Error?error.message:error).slice(0,1000),orderId).run();
}

export async function finalizeStarsRefund(db:D1Database,orderId:string,adminId:number,revokeSubscription:boolean):Promise<boolean>{
  const now=nowIso();
  const statements:D1PreparedStatement[]=[
    db.prepare(`
      UPDATE payments
      SET status='refunded',refunded_at=?,refunded_by=?,refund_error=NULL
      WHERE order_id=? AND provider='telegram_stars' AND status='refund_pending'
    `).bind(now,adminId,orderId),
    db.prepare("UPDATE orders SET status='refunded' WHERE id=? AND status='paid'").bind(orderId),
  ];

  if(revokeSubscription){
    const order=await first<{user_id:number}>(db.prepare('SELECT user_id FROM orders WHERE id=?').bind(orderId));
    if(!order)return false;
    const freeDaily=Math.max(0,Number((await getSetting(db,'free_points_daily'))??50));
    const resetHours=Math.max(1,Number((await getSetting(db,'free_period_hours'))??24));
    statements.push(
      db.prepare("UPDATE subscriptions SET expires_at=? WHERE order_id=? AND expires_at>?").bind(now,orderId,now),
      db.prepare(`
        UPDATE balances
        SET free_points=?,free_reset_at=?,updated_at=?
        WHERE user_id=?
        AND NOT EXISTS(
          SELECT 1 FROM subscriptions
          WHERE user_id=? AND expires_at>? AND order_id<>?
        )
      `).bind(freeDaily,new Date(Date.now()+resetHours*3600000).toISOString(),now,order.user_id,order.user_id,now,orderId)
    );
  }

  try {
    const result=await db.batch(statements);
    const paymentChanged=Number(result[0]?.meta?.changes??0)===1;
    const orderChanged=Number(result[1]?.meta?.changes??0)===1;
    return paymentChanged && orderChanged;
  } catch(err){
    console.error('stars_refund_finalize_error',String(err));
    return false;
  }
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

  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

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
        "SELECT COUNT(*) as count FROM messages WHERE chat_id=? AND user_id=? AND role='user' AND expires_at>?"
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

  // Rows arrive newest-first. Keep the most recent messages that fit,
  // then restore chronological order for the model.
  let total = 0;
  const out: Array<{role:string;content:string}> = [];
  for (const row of rows) {
    if(total + row.content.length > maxChars) break;
    total += row.content.length;
    out.push(row);
  }
  out.reverse();
  return out;
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
        'UPDATE chats SET model_key=?, role_key=NULL, custom_role=NULL, updated_at=? WHERE id=? AND user_id=?'
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
): Promise<boolean> {
  const count = await first<{count:number}>(db.prepare('SELECT COUNT(*) as count FROM chats WHERE user_id=? AND is_archived=1').bind(userId));
  if(Number(count?.count ?? 0) >= 15) return false;
  const retention = await getArchiveRetentionHours(db,userId);
  const now = nowIso();
  const expires = new Date(Date.now()+retention*3600000).toISOString();
  await db.batch([
    db.prepare('UPDATE chats SET is_archived=1, updated_at=? WHERE id=? AND user_id=?').bind(now,chatId,userId),
    db.prepare('UPDATE messages SET expires_at=? WHERE chat_id=? AND user_id=? AND expires_at>?').bind(expires,chatId,userId,now)
  ]);
  return true;
}

export async function unarchiveChat(
  db: D1Database, chatId: string, userId: number
): Promise<boolean> {
  const active = await first<{count:number}>(db.prepare('SELECT COUNT(*) as count FROM chats WHERE user_id=? AND is_archived=0').bind(userId));
  if(Number(active?.count ?? 0) >= 15) return false;
  await db.prepare('UPDATE chats SET is_archived=0, updated_at=? WHERE id=? AND user_id=?').bind(nowIso(),chatId,userId).run();
  return true;
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
    throw new Error('BALANCE_NOT_FOUND');
  }

  if (new Date(bal.free_reset_at).getTime() <= Date.now()) {
    const activeSub =
      await first<{ plan_key: string }>(
        db
          .prepare(
            `SELECT plan_key
             FROM subscriptions
             WHERE user_id=?
             AND expires_at>?
             ORDER BY expires_at DESC
             LIMIT 1`
          )
          .bind(userId, nowIso())
      );

    let amount = Number(
      (await getSetting(db, 'free_points_daily')) ?? 50
    );

    if (activeSub) {
      const plan = await getPlan(db, activeSub.plan_key);
      if (plan?.kind === 'subscription' && Number(plan.points) > 0) {
        amount = Number(plan.points);
      } else {
        amount = Number(
          (await getSetting(db, 'free_points_subscriber')) ?? 100
        );
      }
    }

    const resetHours = Number(
      (await getSetting(db, 'free_period_hours')) ?? 24
    );
    const resetAt = new Date(
      Date.now() + resetHours * 3600 * 1000
    ).toISOString();
    const now = nowIso();
    const txId = `refill:${userId}:${bal.free_reset_at}`;

    await db.batch([
      db
        .prepare(
          `UPDATE balances
           SET free_points=?,
               free_reset_at=?,
               updated_at=?
           WHERE user_id=?
           AND free_reset_at=?
           AND free_reset_at<=?`
        )
        .bind(
          amount,
          resetAt,
          now,
          userId,
          bal.free_reset_at,
          now
        ),

      db
        .prepare(
          `INSERT OR IGNORE INTO transactions(
            id,
            user_id,
            kind,
            free_amount,
            paid_amount,
            ref,
            created_at
          )
          SELECT ?,user_id,'refill',free_points,0,?,?
          FROM balances
          WHERE user_id=?
          AND free_reset_at=?`
        )
        .bind(
          txId,
          `daily:${bal.free_reset_at}`,
          now,
          userId,
          resetAt
        )
    ]);

    const current =
      await first<{ free_points: number; purchased_points: number }>(
        db
          .prepare(
            'SELECT free_points,purchased_points FROM balances WHERE user_id=?'
          )
          .bind(userId)
      );

    return {
      free: Number(current?.free_points ?? 0),
      paid: Number(current?.purchased_points ?? 0)
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
      balance: await getBalance(db, userId)
    };
  }

  await resetFreePointsIfNeeded(db, userId);

  const holdId = uuid();
  const now = nowIso();

  await db.batch([
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
        SELECT
          ?,
          user_id,
          MIN(free_points, ?),
          ? - MIN(free_points, ?),
          free_reset_at,
          'held',
          ?,
          ?
        FROM balances
        WHERE user_id=?
        AND free_points+purchased_points>=?`
      )
      .bind(
        holdId,
        cost,
        cost,
        cost,
        ref,
        now,
        userId,
        cost
      ),

    db
      .prepare(
        `UPDATE balances
         SET free_points=free_points-MIN(free_points,?),
             purchased_points=purchased_points-(?-MIN(free_points,?)),
             updated_at=?
         WHERE user_id=?
         AND free_points+purchased_points>=?`
      )
      .bind(
        cost,
        cost,
        cost,
        now,
        userId,
        cost
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
        SELECT ?,user_id,'reserve',-free_amount,-paid_amount,ref,?
        FROM point_holds
        WHERE id=?
        AND status='held'`
      )
      .bind(
        `${holdId}:reserve`,
        now,
        holdId
      )
  ]);

  const hold =
    await first<{ free_amount: number; paid_amount: number; status: string }>(
      db
        .prepare(
          'SELECT free_amount,paid_amount,status FROM point_holds WHERE id=?'
        )
        .bind(holdId)
    );

  const balance = await getBalance(db, userId);

  if (!hold || hold.status !== 'held') {
    return {
      ok: false,
      freeAmount: 0,
      paidAmount: 0,
      balance
    };
  }

  return {
    ok: true,
    holdId,
    freeAmount: Number(hold.free_amount),
    paidAmount: Number(hold.paid_amount),
    balance
  };
}

export async function captureHold(
  db: D1Database,
  holdId: string
): Promise<void> {
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE point_holds
         SET status='captured',
             finished_at=?
         WHERE id=?
         AND status='held'`
      )
      .bind(now, holdId),

    db
      .prepare(
        `INSERT OR IGNORE INTO transactions(
          id,
          user_id,
          kind,
          free_amount,
          paid_amount,
          ref,
          created_at
        )
        SELECT ?,user_id,'capture',0,0,ref,?
        FROM point_holds
        WHERE id=?
        AND status='captured'
        AND finished_at=?`
      )
      .bind(
        `${holdId}:capture`,
        now,
        holdId,
        now
      )
  ]);
}

export async function releaseHold(
  db: D1Database,
  holdId: string
): Promise<void> {
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE balances
         SET free_points=free_points+(SELECT free_amount FROM point_holds WHERE id=? AND status='held'),
             purchased_points=purchased_points+(SELECT paid_amount FROM point_holds WHERE id=? AND status='held'),
             updated_at=?
         WHERE user_id=(SELECT user_id FROM point_holds WHERE id=? AND status='held')`
      )
      .bind(holdId, holdId, now, holdId),

    db
      .prepare(
        `UPDATE point_holds
         SET status='released',
             finished_at=?
         WHERE id=?
         AND status='held'`
      )
      .bind(now, holdId),

    db
      .prepare(
        `INSERT OR IGNORE INTO transactions(
          id,
          user_id,
          kind,
          free_amount,
          paid_amount,
          ref,
          created_at
        )
        SELECT ?,user_id,'release',free_amount,paid_amount,ref,?
        FROM point_holds
        WHERE id=?
        AND status='released'
        AND finished_at=?`
      )
      .bind(
        `${holdId}:release`,
        now,
        holdId,
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
      start.toISOString(),
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
    const resetHours = Math.max(1, Number((await getSetting(db,'free_period_hours')) ?? 24));

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
              resetHours *
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

export async function incrementLastSeen(
  db: D1Database,
  userId: number
): Promise<void> {
  await db
    .prepare(
      'UPDATE users SET last_seen_at=? WHERE id=?'
    )
    .bind(
      nowIso(),
      userId
    )
    .run();
}

export async function getChatAiSettings(db:D1Database,userId:number,chatId:string,modelKey:string):Promise<import('./types').ChatAiSettings|null>{
  return first<any>(db.prepare('SELECT * FROM chat_ai_settings WHERE user_id=? AND chat_id=? AND model_key=?').bind(userId,chatId,modelKey));
}

export async function ensureChatAiSettings(db:D1Database,userId:number,chatId:string,modelKey:string){
  const existing=await getChatAiSettings(db,userId,chatId,modelKey);
  if(existing)return existing;
  const now=nowIso();
  await db.prepare('INSERT OR IGNORE INTO chat_ai_settings(user_id,chat_id,model_key,reasoning_mode,web_search_enabled,updated_at) VALUES(?,?,?,?,?,?)').bind(userId,chatId,modelKey,'deep',0,now).run();
  return (await getChatAiSettings(db,userId,chatId,modelKey))!;
}

export async function upsertChatAiSettings(db:D1Database,userId:number,chatId:string,modelKey:string,patch:{reasoning_mode?:'fast'|'deep'|'max';web_search_enabled?:number}){
  const current=await ensureChatAiSettings(db,userId,chatId,modelKey);
  const reasoning=patch.reasoning_mode??current.reasoning_mode;
  const web=patch.web_search_enabled??current.web_search_enabled;
  await db.prepare('INSERT INTO chat_ai_settings(user_id,chat_id,model_key,reasoning_mode,web_search_enabled,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,chat_id,model_key) DO UPDATE SET reasoning_mode=excluded.reasoning_mode,web_search_enabled=excluded.web_search_enabled,updated_at=excluded.updated_at').bind(userId,chatId,modelKey,reasoning,web,nowIso()).run();
  return (await getChatAiSettings(db,userId,chatId,modelKey))!;
}

export async function resetChatAiSettings(db:D1Database,userId:number,chatId:string,modelKey:string){
  await db.prepare('DELETE FROM chat_ai_settings WHERE user_id=? AND chat_id=? AND model_key=?').bind(userId,chatId,modelKey).run();
  return ensureChatAiSettings(db,userId,chatId,modelKey);
}

export async function modelByKey(
  db: D1Database,
  key: string
): Promise<Model | null> {
  return first<Model>(
    db
      .prepare(
        'SELECT * FROM models WHERE model_key=?'
      )
      .bind(key)
  );
}

export async function adminModels(
  db: D1Database
): Promise<Model[]> {
  return all<Model>(
    db.prepare(
      'SELECT * FROM models ORDER BY family,sort,name'
    )
  );
} 

export async function modelUsedByChat(db:D1Database,key:string):Promise<boolean>{const r=await first<{count:number}>(db.prepare('SELECT COUNT(*) as count FROM chats WHERE model_key=?').bind(key));return Number(r?.count??0)>0;}

export async function modelIsDefault(db:D1Database,key:string):Promise<boolean>{return (await getSetting(db,'default_model_key'))===key;}


export async function findUserByRef(db:D1Database, ref:string):Promise<User|null>{
  const normalized=ref.trim().replace(/^@/,'');
  if(/^\d+$/.test(normalized)) return getUser(db,Number(normalized));
  return first<User>(db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').bind(normalized));
}

export async function countChats(db:D1Database,userId:number,archived:boolean):Promise<number>{
  const r=await first<{count:number}>(db.prepare('SELECT COUNT(*) as count FROM chats WHERE user_id=? AND is_archived=?').bind(userId,archived?1:0));
  return Number(r?.count??0);
}

export async function getArchiveRetentionHours(db:D1Database,userId:number):Promise<number>{
  const sub=await first<{plan_key:string}>(db.prepare('SELECT plan_key FROM subscriptions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(userId,nowIso()));
  if(!sub) return 24;
  const plan=await getPlan(db,sub.plan_key);
  return plan && plan.duration_days && plan.duration_days>=30 ? 48 : 24;
}

export async function getActiveSubscription(db:D1Database,userId:number):Promise<{plan:Plan|null;expires_at:string}|null>{
  const row=await first<{plan_key:string;expires_at:string}>(db.prepare('SELECT plan_key,expires_at FROM subscriptions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(userId,nowIso()));
  if(!row) return null;
  return {plan:await getPlan(db,row.plan_key),expires_at:row.expires_at};
}

export async function getDialogMessageLimit(db:D1Database,userId:number):Promise<number>{
  const free=Math.max(1,Number((await getSetting(db,'chat_message_limit_free'))??DEFAULT_FREE_DIALOG_MESSAGES));
  const subscriber=Math.max(1,Number((await getSetting(db,'chat_message_limit_subscriber'))??DEFAULT_SUBSCRIBER_DIALOG_MESSAGES));
  const twoYear=Math.max(1,Number((await getSetting(db,'chat_message_limit_2y'))??DEFAULT_TWO_YEAR_DIALOG_MESSAGES));
  const sub=await getActiveSubscription(db,userId);
  return dialogMessageLimitForPlan(sub?.plan?.plan_key??null,free,subscriber,twoYear);
}

export async function getContextUsage(db:D1Database,chatId:string,userId:number):Promise<{messages:number;chars:number}>{
  const r=await first<{messages:number;chars:number}>(db.prepare("SELECT COUNT(*) as messages, COALESCE(SUM(LENGTH(content)),0) as chars FROM messages WHERE chat_id=? AND user_id=? AND role='user' AND expires_at>?").bind(chatId,userId,nowIso()));
  return {messages:Number(r?.messages??0),chars:Number(r?.chars??0)};
}

export async function grantPoints(db:D1Database,userId:number,amount:number,source='admin'):Promise<void>{
  const now=nowIso();
  await db.batch([
    db.prepare('UPDATE balances SET purchased_points=purchased_points+?,updated_at=? WHERE user_id=?').bind(amount,now,userId),
    db.prepare('INSERT INTO transactions(id,user_id,kind,free_amount,paid_amount,ref,created_at) VALUES(?,?,?,?,?,?,?)').bind(uuid(),userId,'admin',0,amount,source,now)
  ]);
}

export async function takeBonusPoints(db:D1Database,userId:number,amount:number):Promise<boolean>{
  const r=await db.prepare('UPDATE balances SET purchased_points=purchased_points-?,updated_at=? WHERE user_id=? AND purchased_points>=?').bind(amount,nowIso(),userId,amount).run();
  return (r.meta?.changes??0)>0;
}

export async function grantSubscriptionPlan(db:D1Database,userId:number,planKey:string,source='admin'):Promise<{expiresAt:string;days:number;points:number}|null>{
  const plan=await getPlan(db,planKey);
  if(!plan || plan.kind!=='subscription' || !plan.duration_days) return null;
  const now=new Date();
  const existing=await first<{expires_at:string}>(db.prepare('SELECT expires_at FROM subscriptions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').bind(userId,now.toISOString()));
  const start=existing?new Date(existing.expires_at):now;
  const expires=new Date(start.getTime()+plan.duration_days*86400000).toISOString();
  const daily=Number(plan.points)>0?Number(plan.points):Number((await getSetting(db,'free_points_subscriber'))??100);
  const resetHours=Math.max(1,Number((await getSetting(db,'free_period_hours'))??24));
  const nowS=now.toISOString();
  await db.batch([
    db.prepare('INSERT INTO subscriptions(id,user_id,plan_key,starts_at,expires_at,source,order_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uuid(),userId,planKey,start.toISOString(),expires,source,null,nowS),
    db.prepare('UPDATE balances SET free_points=?,free_reset_at=?,updated_at=? WHERE user_id=?').bind(daily,new Date(Date.now()+resetHours*3600000).toISOString(),nowS,userId),
    db.prepare('INSERT INTO transactions(id,user_id,kind,free_amount,paid_amount,ref,created_at) VALUES(?,?,?,?,?,?,?)').bind(uuid(),userId,'subscription_bonus',daily,0,planKey,nowS)
  ]);
  return {expiresAt:expires,days:plan.duration_days,points:daily};
}

export async function listImageModels(db:D1Database,env:Env):Promise<Model[]>{
  const models=await all<Model>(db.prepare("SELECT * FROM models WHERE is_active=1 AND type='image' ORDER BY sort,name"));
  return models.filter(m=>providerConfigured(m,env));
}

export function modelConfig(model:Model):Record<string,any>{try{return JSON.parse(model.config||'{}')}catch{return {}}}

export function modelEmoji(model:Model):string{const cfg=modelConfig(model);if(typeof cfg.emoji==='string'&&cfg.emoji)return cfg.emoji;if(model.type==='image')return '🎨';if(model.type==='search')return '🔎';return model.tier==='advanced'?'🧠':'💬'}

export function isPremiumImageModel(model:Model):boolean{return model.type==='image' && model.is_free===0}

export async function imageInputCost(db:D1Database):Promise<number>{return Number((await getSetting(db,'image_input_cost'))??3)}
export async function templateCost(db:D1Database,id:string,defaultCost=5):Promise<number>{return Number((await getSetting(db,`image_template_price_${id}`))??defaultCost)}

export async function cleanupExpiredArchivedChats(db:D1Database):Promise<void>{
  const chats=await all<{id:string;user_id:number;updated_at:string}>(db.prepare("SELECT id,user_id,updated_at FROM chats WHERE is_archived=1 ORDER BY updated_at ASC LIMIT 100"));
  const now=Date.now();
  for(const c of chats){const keep=await getArchiveRetentionHours(db,c.user_id);if(new Date(c.updated_at).getTime()+keep*3600000<=now) await deleteChat(db,c.id,c.user_id)}
}

export async function switchToArchivedChat(db:D1Database,chatId:string,userId:number):Promise<boolean>{
  const target=await getChat(db,chatId,userId);if(!target||!target.is_archived)return false;
  const current=await first<{id:string}>(db.prepare('SELECT current_chat_id as id FROM users WHERE id=?').bind(userId));
  const now=nowIso();
  if(current?.id && current.id!==chatId){
    await db.batch([
      db.prepare('UPDATE chats SET is_archived=1,updated_at=? WHERE id=? AND user_id=?').bind(now,current.id,userId),
      db.prepare('UPDATE chats SET is_archived=0,updated_at=? WHERE id=? AND user_id=?').bind(now,chatId,userId),
      db.prepare('UPDATE messages SET expires_at=? WHERE chat_id=? AND user_id=? AND expires_at>?').bind(new Date(Date.now()+await getArchiveRetentionHours(db,userId)*3600000).toISOString(),current.id,userId,now),
      db.prepare('UPDATE users SET current_chat_id=?,last_model_key=? WHERE id=?').bind(chatId,target.model_key,userId)
    ]);
  } else {
    const active=await first<{count:number}>(db.prepare('SELECT COUNT(*) as count FROM chats WHERE user_id=? AND is_archived=0').bind(userId));
    if(Number(active?.count??0)>=15)return false;
    await db.batch([db.prepare('UPDATE chats SET is_archived=0,updated_at=? WHERE id=? AND user_id=?').bind(now,chatId,userId),db.prepare('UPDATE users SET current_chat_id=?,last_model_key=? WHERE id=?').bind(chatId,target.model_key,userId)]);
  }
  return true;
}

export async function currentChatForUser(db:D1Database,userId:number):Promise<Chat|null>{const u=await getUser(db,userId);return u?.current_chat_id?getChat(db,u.current_chat_id,userId):null}
