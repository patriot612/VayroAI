import type { Ctx } from './context';
import { deleteModel, insertModel, listAllModels, updateModelField } from '../db/models';
import { modelIsConfigured } from '../ai/router';
import { adjustPurchased } from '../db/points';
import { getUser, setBlocked } from '../db/users';
import { all, first, run, scalar } from '../db/client';
import { getOrder, recordPaymentAndMarkPaid } from '../db/orders';
import { setSetting, SETTING_DEFAULTS } from '../db/settings';
import { t, formatMoney, formatDateTime } from '../i18n';
import { showScreen } from './render';
import { rows, btn } from './keyboards';
import { rid } from '../util/misc';

async function reply(ctx: Ctx, text: string): Promise<void> {
  await ctx.tg.sendMessage(ctx.chatId, text);
}

/** Returns true if the command was recognised and handled (so dispatch.ts stops there). */
export async function handleAdminCommand(ctx: Ctx, cmd: string, rest: string[]): Promise<boolean> {
  switch (cmd) {
    case '/admin':
      return void (await showAdminPanel(ctx)), true;

    case '/user': {
      const id = Number(rest[0]);
      if (!id) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const u = await getUser(ctx.db, id);
      if (!u) return void (await reply(ctx, t(ctx.lang, 'ad.not_found'))), true;
      const bal = await first<{ free_points: number; purchased_points: number }>(ctx.db, 'SELECT free_points, purchased_points FROM balances WHERE user_id=?', id);
      const sub = await first<{ expires_at: number }>(ctx.db, 'SELECT MAX(expires_at) as expires_at FROM subscriptions WHERE user_id=?', id);
      const status = u.is_blocked ? `🚫 ${u.block_reason ?? ''}`.trim() : 'ok';
      await reply(
        ctx,
        t(ctx.lang, 'ad.user_card', {
          id: String(u.id),
          username: u.username ?? '—',
          lang: u.language,
          created: formatDateTime(ctx.lang, u.created_at),
          free: String(bal?.free_points ?? 0),
          paid: String(bal?.purchased_points ?? 0),
          sub: sub?.expires_at && sub.expires_at > ctx.now ? formatDateTime(ctx.lang, sub.expires_at) : t(ctx.lang, 'account.sub_none'),
          status,
        }),
      );
      return true;
    }

    case '/users': {
      const page = Math.max(0, Number(rest[0] ?? 0) - 1);
      const list = await all<{ id: number; username: string | null; created_at: number }>(
        ctx.db,
        'SELECT id, username, created_at FROM users ORDER BY created_at DESC LIMIT 20 OFFSET ?',
        page * 20,
      );
      const lines = list.map((u) => `${u.id} @${u.username ?? '—'} · ${formatDateTime(ctx.lang, u.created_at)}`);
      await reply(ctx, `${t(ctx.lang, 'ad.users_head', { page: String(page + 1) })}\n\n${lines.join('\n') || '—'}`);
      return true;
    }

    case '/addpoints':
    case '/takepoints': {
      const id = Number(rest[0]);
      const n = Number(rest[1]);
      if (!id || !Number.isFinite(n)) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const delta = cmd === '/addpoints' ? Math.abs(n) : -Math.abs(n);
      await adjustPurchased(ctx.db, id, delta, 'admin', `admin:${ctx.user.id}`, ctx.now);
      await reply(ctx, t(ctx.lang, 'ad.done'));
      return true;
    }

    case '/grantsub': {
      const id = Number(rest[0]);
      const days = Number(rest[1]);
      if (!id || !days) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      await run(
        ctx.db,
        'INSERT INTO subscriptions(id,user_id,plan_key,starts_at,expires_at,source,created_at) VALUES(?,?,?,?,?,?,?)',
        rid(16),
        id,
        'admin-grant',
        ctx.now,
        ctx.now + days * 86400,
        'admin',
        ctx.now,
      );
      await reply(ctx, t(ctx.lang, 'sub.activated', { date: formatDateTime(ctx.lang, ctx.now + days * 86400) }));
      return true;
    }

    case '/block': {
      const id = Number(rest[0]);
      if (!id) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      await setBlocked(ctx.db, id, true, rest.slice(1).join(' ') || null);
      await reply(ctx, t(ctx.lang, 'ad.done'));
      return true;
    }
    case '/unblock': {
      const id = Number(rest[0]);
      if (!id) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      await setBlocked(ctx.db, id, false, null);
      await reply(ctx, t(ctx.lang, 'ad.done'));
      return true;
    }

    case '/markpaid': {
      const orderId = rest[0];
      if (!orderId) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const order = await first<{ id: string; user_id: number }>(ctx.db, 'SELECT id, user_id FROM orders WHERE id=?', orderId);
      if (!order) return void (await reply(ctx, t(ctx.lang, 'ad.not_found'))), true;
      const full = (await getOrder(ctx.db, order.user_id, orderId))!;
      const ok = await recordPaymentAndMarkPaid(ctx.db, full, 'manual', `manual:${ctx.now}`, ctx.now);
      await reply(ctx, ok ? t(ctx.lang, 'ad.done') : t(ctx.lang, 'ad.bad_args'));
      return true;
    }

    case '/setmodel': {
      const [key, field, ...valueParts] = rest;
      if (!key || !field) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const res = await updateModelField(ctx.db, key, field, valueParts.join(' '));
      await reply(ctx, res === 'ok' ? t(ctx.lang, 'ad.done') : t(ctx.lang, 'ad.bad_args'));
      return true;
    }

    case '/addmodel': {
      const raw = rest.join(' ');
      const [key, family, provider, modelId, name, tier, cost, type] = raw.split('|').map((s) => s.trim());
      if (!key || !family || !provider || !modelId || !name || !tier || !cost) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const ok = await insertModel(ctx.db, { key, family, provider, model_id: modelId, name, tier, cost: Number(cost), type: type || 'chat' }, ctx.now);
      await reply(ctx, ok ? t(ctx.lang, 'ad.done') : t(ctx.lang, 'ad.bad_args'));
      return true;
    }

    case '/delmodel': {
      const key = rest[0];
      if (!key) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      const n = await deleteModel(ctx.db, key);
      await reply(ctx, n ? t(ctx.lang, 'ad.done') : t(ctx.lang, 'ad.not_found'));
      return true;
    }

    case '/setting': {
      const [key, ...valueParts] = rest;
      if (!key || !(key in SETTING_DEFAULTS)) return void (await reply(ctx, t(ctx.lang, 'ad.bad_args'))), true;
      await setSetting(ctx.db, key, valueParts.join(' '));
      await reply(ctx, t(ctx.lang, 'ad.done'));
      return true;
    }

    default:
      return false;
  }
}

async function showAdminPanel(ctx: Ctx): Promise<void> {
  const kb = rows(
    [btn(t(ctx.lang, 'ad.btn.stats'), 'admin:stats'), btn(t(ctx.lang, 'ad.btn.users'), 'admin:users')],
    [btn(t(ctx.lang, 'ad.btn.models'), 'admin:models'), btn(t(ctx.lang, 'ad.btn.settings'), 'admin:settings')],
    [btn(t(ctx.lang, 'ad.btn.blocks'), 'admin:blocks'), btn(t(ctx.lang, 'ad.btn.broadcast'), 'admin:broadcast')],
  );
  await showScreen(ctx.tg, ctx.chatId, { text: `${t(ctx.lang, 'ad.title')}\n\n${t(ctx.lang, 'ad.help')}`, kb });
}

/** Callback data starting with "admin:" — called from the top-level callback dispatcher. */
export async function handleAdminCallback(ctx: Ctx, action: string, editId: number): Promise<void> {
  const back = rows([btn(t(ctx.lang, 'ad.btn.back'), 'admin:panel')]);
  if (action === 'panel') return void (await showAdminPanel(ctx));

  if (action === 'stats') {
    const now = ctx.now;
    const day = now - 86400;
    const [users, new24, active24, ai24, aiTotal, err24, msgs, paid, revenue, subs] = await Promise.all([
      scalar(ctx.db, 'SELECT COUNT(*) FROM users'),
      scalar(ctx.db, 'SELECT COUNT(*) FROM users WHERE created_at>?', day),
      scalar(ctx.db, 'SELECT COUNT(*) FROM users WHERE last_seen_at>?', day),
      scalar(ctx.db, "SELECT COUNT(*) FROM usage_logs WHERE created_at>? AND status='ok'", day),
      scalar(ctx.db, "SELECT COUNT(*) FROM usage_logs WHERE created_at>? AND status='ok'", now - 30 * 86400),
      scalar(ctx.db, "SELECT COUNT(*) FROM usage_logs WHERE created_at>? AND status='error'", day),
      scalar(ctx.db, 'SELECT COUNT(*) FROM messages WHERE expires_at>?', now),
      scalar(ctx.db, "SELECT COUNT(*) FROM orders WHERE status='paid'"),
      scalar(ctx.db, "SELECT COALESCE(SUM(amount_minor),0) FROM orders WHERE status='paid'"),
      scalar(ctx.db, 'SELECT COUNT(*) FROM subscriptions WHERE expires_at>?', now),
    ]);
    await showScreen(
      ctx.tg,
      ctx.chatId,
      {
        text: t(ctx.lang, 'ad.stats', {
          users: String(users),
          new24: String(new24),
          active24: String(active24),
          ai24: String(ai24),
          aiTotal: String(aiTotal),
          err24: String(err24),
          msgs: String(msgs),
          paid: String(paid),
          revenue: formatMoney(ctx.lang, revenue, 'RUB'),
          subs: String(subs),
        }),
        kb: back,
      },
      editId,
    );
    return;
  }

  if (action === 'users') {
    const list = await all<{ id: number; username: string | null }>(ctx.db, 'SELECT id, username FROM users ORDER BY created_at DESC LIMIT 15');
    const lines = list.map((u) => `${u.id} @${u.username ?? '—'}`).join('\n') || '—';
    await showScreen(ctx.tg, ctx.chatId, { text: `${t(ctx.lang, 'ad.users_head', { page: '1' })}\n\n${lines}`, kb: back }, editId);
    return;
  }

  if (action === 'models') {
    const models = await listAllModels(ctx.db);
    const kbRows = models.map((m) => {
      const configured = modelIsConfigured(ctx.env, m);
      const mark = !m.is_active ? '⛔' : configured ? '✅' : '🔑';
      return [btn(`${mark} ${m.name} (${m.type})`, `admin:model:${m.key}`)];
    });
    kbRows.push([btn(t(ctx.lang, 'ad.btn.back'), 'admin:panel')]);
    await showScreen(ctx.tg, ctx.chatId, { text: t(ctx.lang, 'ad.models_head'), kb: { inline_keyboard: kbRows } }, editId);
    return;
  }

  if (action.startsWith('model:')) {
    const key = action.slice('model:'.length);
    const models = await listAllModels(ctx.db);
    const m = models.find((x) => x.key === key);
    if (m) await updateModelField(ctx.db, key, 'is_active', String(m.is_active ? 0 : 1));
    return void (await handleAdminCallback(ctx, 'models', editId));
  }

  if (action === 'settings') {
    const rowsInfo = await all<{ key: string; value: string }>(ctx.db, 'SELECT key, value FROM settings');
    const map: Record<string, string> = {};
    for (const r of rowsInfo) map[r.key] = r.value;
    const lines = Object.keys(SETTING_DEFAULTS)
      .map((k) => `${k} = ${map[k] ?? SETTING_DEFAULTS[k]}`)
      .join('\n');
    await showScreen(ctx.tg, ctx.chatId, { text: `${t(ctx.lang, 'ad.settings_head')}\n\n${lines}`, kb: back }, editId);
    return;
  }

  if (action === 'blocks') {
    const list = await all<{ id: number; username: string | null; block_reason: string | null }>(ctx.db, 'SELECT id, username, block_reason FROM users WHERE is_blocked=1');
    const text = list.length ? `${t(ctx.lang, 'ad.blocks_head')}\n\n${list.map((u) => `${u.id} @${u.username ?? '—'} — ${u.block_reason ?? ''}`).join('\n')}` : t(ctx.lang, 'ad.blocks_none');
    await showScreen(ctx.tg, ctx.chatId, { text, kb: back }, editId);
    return;
  }

  if (action === 'broadcast') {
    await showScreen(ctx.tg, ctx.chatId, { text: t(ctx.lang, 'ad.broadcast_soon'), kb: back }, editId);
    return;
  }
}
