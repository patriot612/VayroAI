import type { Ctx } from './context';
import { showScreen, showUiScreen } from './render';
import * as S from './screens';
import { mainReplyKeyboard } from './keyboards';
import {
  createChat,
  deleteChat,
  getChat,
  listChats,
  countChats,
  messageCount,
  recentMessages,
  renameChat,
  setArchived,
  setChatModel,
  setChatRole,
} from '../db/chats';
import { getModel, listModels } from '../db/models';
import { getBalance } from '../db/points';
import { setCurrentChat, setLanguage, setLastModel, setMode, setSearchModel } from '../db/users';
import { getRole, listRoles } from '../db/content';
import { getPlan, listPlans, createOrder, getOrder, listOrders, setOrderStatus } from '../db/orders';
import { modelIsConfigured } from '../ai/router';
import { answerAndSend, chatModel, ensureCurrentChat, firstAvailableModel, modelUsable, sendOutcomeError } from './core';
import { normLang, t } from '../i18n';
import { truncate, logError, logEvent } from '../util/misc';
import { handleAdminCommand, handleAdminCallback } from './admin';
import { isAdmin } from '../env';

async function usableModels(ctx: Ctx, type: string) {
  const list = await listModels(ctx.db, type, true);
  return list.filter((m) => modelIsConfigured(ctx.env, m));
}

async function showNavigationScreen(
  ctx: Ctx,
  screen: Parameters<typeof showScreen>[2],
  editId?: number,
): Promise<void> {
  if (typeof editId === 'number') {
    await showScreen(
      ctx.tg,
      ctx.chatId,
      screen,
      editId,
    );
    return;
  }

  await showUiScreen(
    ctx.tg,
    ctx.db,
    ctx.user.id,
    ctx.chatId,
    screen,
  );
}

async function showMainMenu(ctx: Ctx, editId?: number): Promise<void> {
  // DIAGNOSTIC (temporary): trace exactly where /start's second message can stop.
  logEvent('show_main_menu_start', { userId: ctx.user.id, chatId: ctx.chatId });
  try {
    const chat = await ensureCurrentChat(ctx);
    const model = await chatModel(ctx, chat);
    const n = await messageCount(ctx.db, ctx.user.id, chat.id, ctx.now);
    await showNavigationScreen(ctx, S.mainMenuScreen(ctx.lang, chat, model, n), editId);
    logEvent('show_main_menu_ok', { userId: ctx.user.id });
  } catch (e) {
    logError('show_main_menu_failed', e, { userId: ctx.user.id });
    throw e;
  }
}

async function showChatOpen(ctx: Ctx, isNew: boolean, editId?: number): Promise<void> {
  await setMode(ctx.db, ctx.user.id, 'chat');
  const chat = await ensureCurrentChat(ctx);
  const model = await chatModel(ctx, chat);

  await showNavigationScreen(ctx, S.chatOpenScreen(ctx.lang, chat, model, isNew), editId);
}

async function showModels(ctx: Ctx, editId?: number): Promise<void> {
  const chat = await ensureCurrentChat(ctx);
  const models = await usableModels(ctx, 'chat');
  const current = await getModel(ctx.db, chat.model_key);

  const byFamily = new Map<string, typeof models>();

  for (const m of models) {
    byFamily.set(
      m.family,
      [...(byFamily.get(m.family) ?? []), m],
    );
  }

  await showNavigationScreen(ctx, S.modelsScreen(ctx.lang, chat, current, byFamily), editId);
}

async function showChats(
  ctx: Ctx,
  archived: boolean,
  page: number,
  editId?: number,
): Promise<void> {
  const pageSize = 8;

  const [list, total] = await Promise.all([
    listChats(
      ctx.db,
      ctx.user.id,
      archived,
      pageSize + 1,
      page * pageSize,
    ),
    countChats(ctx.db, ctx.user.id, archived),
  ]);

  const hasMore = list.length > pageSize;
  const shown = list.slice(0, pageSize);
  const current = await getChat(
    ctx.db,
    ctx.user.id,
    ctx.user.current_chat_id,
  );

  await showNavigationScreen(ctx, S.chatListScreen(
      ctx.lang,
      current,
      shown,
      archived,
      hasMore,
      page,
    ), editId);

  void total;
}

async function showChatDetail(
  ctx: Ctx,
  chatId: string,
  editId?: number,
): Promise<void> {
  const chat = await getChat(
    ctx.db,
    ctx.user.id,
    chatId,
  );

  if (!chat) {
    return void (
      await ctx.tg.safe(
        ctx.tg.sendMessage(
          ctx.chatId,
          t(ctx.lang, 'chat.not_found'),
        ),
        'nf',
      )
    );
  }

  const model = await getModel(
    ctx.db,
    chat.model_key,
  );

  const msgs = await recentMessages(
    ctx.db,
    ctx.user.id,
    chatId,
    ctx.now,
    20,
  );

  const total = await messageCount(
    ctx.db,
    ctx.user.id,
    chatId,
    ctx.now,
  );

  await showNavigationScreen(ctx, S.chatDetailScreen(
      ctx.lang,
      chat,
      model,
      msgs,
      total === 0 && total < 999999 && false,
      chat.is_archived === 1,
    ), editId);
}

async function showTools(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  await showNavigationScreen(ctx, S.toolsScreen(ctx.lang), editId);
}

async function showSearch(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const models = await usableModels(
    ctx,
    'search',
  );

  const key =
    ctx.user.search_model_key &&
    models.some(
      (m) => m.key === ctx.user.search_model_key,
    )
      ? ctx.user.search_model_key
      : models[0]?.key;

  if (
    key &&
    key !== ctx.user.search_model_key
  ) {
    await setSearchModel(
      ctx.db,
      ctx.user.id,
      key,
    );
  }

  const current = key
    ? await getModel(ctx.db, key)
    : null;

  await setMode(
    ctx.db,
    ctx.user.id,
    'search',
  );

  await showNavigationScreen(ctx, S.searchScreen(
      ctx.lang,
      models,
      current,
    ), editId);
}

async function showRoles(
  ctx: Ctx,
  chatId: string,
  editId?: number,
): Promise<void> {
  const roles = await listRoles(ctx.db);

  const chat = await getChat(
    ctx.db,
    ctx.user.id,
    chatId,
  );

  await showNavigationScreen(ctx, S.rolesScreen(
      ctx.lang,
      roles,
      chat?.role_key ?? null,
    ), editId);
}

async function showAccount(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  // DIAGNOSTIC (temporary): trace exactly where the "👤 Аккаунт" button can stop.
  logEvent('show_account_start', { userId: ctx.user.id, chatId: ctx.chatId });
  try {
    const bal = await getBalance(
      ctx.db,
      ctx.user.id,
      ctx.settings,
      ctx.now,
    );

    await showNavigationScreen(ctx, S.accountScreen(
        ctx.lang,
        ctx.user,
        bal,
      ), editId);
    logEvent('show_account_ok', { userId: ctx.user.id });
  } catch (e) {
    logError('show_account_failed', e, { userId: ctx.user.id });
    throw e;
  }
}

async function showLanguage(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  await showNavigationScreen(ctx, S.languageScreen(ctx.lang), editId);
}

async function showHelp(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  await showNavigationScreen(ctx, S.helpScreen(
      ctx.lang,
      String(
        Math.max(
          1,
          Math.round(
            ctx.settings.int(
              'voice_max_seconds',
            ) / 60,
          ),
        ),
      ),
      String(
        ctx.settings.int(
          'message_ttl_hours',
        ),
      ),
    ), editId);
}

async function showPlans(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const featured = (
    await listPlans(
      ctx.db,
      'subscription',
    )
  ).filter(
    (p) => p.is_featured,
  );

  const dailyModel =
    await firstAvailableModel(
      ctx,
      'chat',
    );

  const advModels = (
    await listModels(
      ctx.db,
      'chat',
      true,
    )
  ).filter(
    (m) => m.tier === 'advanced',
  );

  await showNavigationScreen(ctx, S.plansScreen(
      ctx.lang,
      String(
        ctx.settings.int(
          'free_points_daily',
        ),
      ),
      dailyModel,
      advModels[0] ?? null,
      featured,
    ), editId);
}

async function showPlansMore(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const all = (
    await listPlans(
      ctx.db,
      'subscription',
    )
  ).filter(
    (p) => !p.is_featured,
  );

  const kbRows = all.map(
    (p) => [
      {
        text: `${S.planLabel(ctx.lang, p)} · ${S.planPrice(ctx.lang, p)}`,
        callback_data: `plan:show:${p.key}`,
      },
    ],
  );

  kbRows.push([
    {
      text: t(
        ctx.lang,
        'btn.back_plans',
      ),
      callback_data: 'goto:plans',
    },
  ]);

  kbRows.push([
    {
      text: t(
        ctx.lang,
        'btn.to_account',
      ),
      callback_data: 'goto:account',
    },
    {
      text: t(
        ctx.lang,
        'btn.to_chat',
      ),
      callback_data: 'goto:chat',
    },
  ]);

  await showNavigationScreen(ctx, {
      text: t(
        ctx.lang,
        'plans.more',
      ),
      kb: {
        inline_keyboard: kbRows,
      },
    }, editId);
}

async function showPlanConfirm(
  ctx: Ctx,
  planKey: string,
  editId?: number,
): Promise<void> {
  const plan = await getPlan(
    ctx.db,
    planKey,
  );

  if (!plan || !plan.is_active) {
    return;
  }

  const title =
    plan.kind === 'subscription'
      ? S.planLabel(ctx.lang, plan)
      : S.planLabel(ctx.lang, plan);

  const key =
    plan.kind === 'subscription'
      ? 'plans.confirm'
      : 'plans.confirm_points';

  const text =
    t(ctx.lang, key as never, {
      title,
      price: S.planPrice(
        ctx.lang,
        plan,
      ),
    }) +
    (
      plan.kind === 'subscription'
        ? t(
            ctx.lang,
            'plans.confirm_tail',
          )
        : ''
    );

  const kb = {
    inline_keyboard: [
      [
        {
          text: t(
            ctx.lang,
            'btn.create_invoice',
          ),
          callback_data:
            `plan:buy:${plan.key}`,
        },
      ],
      [
        {
          text: t(
            ctx.lang,
            'btn.back_plans',
          ),
          callback_data:
            plan.kind === 'subscription'
              ? 'goto:plans'
              : 'goto:points',
        },
      ],
      [
        {
          text: t(
            ctx.lang,
            'btn.to_chat',
          ),
          callback_data: 'goto:chat',
        },
      ],
    ],
  };

  await showNavigationScreen(ctx, {
      text,
      kb,
    }, editId);
}

async function showPoints(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const plans = await listPlans(
    ctx.db,
    'points',
  );

  const kbRows = plans.map(
    (p) => [
      {
        text: `${S.planLabel(ctx.lang, p)} · ${S.planPrice(ctx.lang, p)}`,
        callback_data: `plan:show:${p.key}`,
      },
    ],
  );

  kbRows.push([
    {
      text: t(
        ctx.lang,
        'btn.to_account',
      ),
      callback_data: 'goto:account',
    },
    {
      text: t(
        ctx.lang,
        'btn.to_chat',
      ),
      callback_data: 'goto:chat',
    },
  ]);

  await showNavigationScreen(ctx, {
      text: t(
        ctx.lang,
        'plans.points',
      ),
      kb: {
        inline_keyboard: kbRows,
      },
    }, editId);
}

async function buyPlan(
  ctx: Ctx,
  planKey: string,
  editId?: number,
): Promise<void> {
  const plan = await getPlan(
    ctx.db,
    planKey,
  );

  if (!plan || !plan.is_active) {
    return;
  }

  if (
    !ctx.settings.bool(
      'feature_payments',
    )
  ) {
    await ctx.tg.safe(
      ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'pay.unavailable',
        ),
      ),
      'no_pay',
    );

    return;
  }

  const title = S.planLabel(
    ctx.lang,
    plan,
  );

  const order = await createOrder(
    ctx.db,
    ctx.user.id,
    plan,
    title,
    title,
    ctx.now,
    3600 * 24,
  );

  await showOrder(
    ctx,
    order.id,
    editId,
  );
}

async function showOrders(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const orders = await listOrders(
    ctx.db,
    ctx.user.id,
    ctx.settings.int(
      'orders_page_size',
    ),
  );

  await showNavigationScreen(ctx, S.ordersListScreen(
      ctx.lang,
      orders,
      String(
        ctx.settings.int(
          'orders_page_size',
        ),
      ),
    ), editId);
}

async function showOrder(
  ctx: Ctx,
  orderId: string,
  editId?: number,
): Promise<void> {
  const order = await getOrder(
    ctx.db,
    ctx.user.id,
    orderId,
  );

  if (!order) {
    return;
  }

  await showNavigationScreen(ctx, S.orderCardScreen(
      ctx.lang,
      order,
    ), editId);
}

async function checkOrder(
  ctx: Ctx,
  orderId: string,
  editId?: number,
): Promise<void> {
  // No payment provider is wired in V1.
  // This only re-renders the current order status.
  await showOrder(
    ctx,
    orderId,
    editId,
  );
}

// ---------------------------------------------------------------- commands

export async function handleCommand(
  ctx: Ctx,
  rawText: string,
): Promise<void> {
  const [
    cmdRaw,
    ...rest
  ] = rawText
    .trim()
    .split(/\s+/);

  const cmd = (
    cmdRaw ?? ''
  )
    .replace(
      /@\w+$/,
      '',
    )
    .toLowerCase();

  const arg = rest.join(' ');

  if (
    cmd.startsWith('/') &&
    isAdmin(
      ctx.env,
      ctx.user.id,
    ) &&
    (
      await handleAdminCommand(
        ctx,
        cmd,
        rest,
      )
    )
  ) {
    return;
  }

  switch (cmd) {
    case '/start':
      await ctx.tg.sendMessage(
        ctx.chatId,
        t(ctx.lang, 'welcome'),
        {
          markup: mainReplyKeyboard(ctx.lang),
        },
      );

      await showMainMenu(ctx);
      return;

    case '/menu':
      await showMainMenu(
        ctx,
      );
      return;

    case '/chat':
      await showChatOpen(
        ctx,
        false,
      );
      return;

    case '/new':
      await chatNew(ctx);
      return;

    case '/chats':
      await showChats(
        ctx,
        false,
        0,
      );
      return;

    case '/models':
      await showModels(ctx);
      return;

    case '/images':
      await showUiScreen(
        ctx.tg,
        ctx.db,
        ctx.user.id,
        ctx.chatId,
        S.soonScreen(
          ctx.lang,
        ),
      );
      return;

    case '/templates':
      await showUiScreen(
        ctx.tg,
        ctx.db,
        ctx.user.id,
        ctx.chatId,
        S.soonScreen(
          ctx.lang,
        ),
      );
      return;

    case '/tools':
      await showTools(ctx);
      return;

    case '/search':
      await showSearch(ctx);
      return;

    case '/files':
      await showUiScreen(
        ctx.tg,
        ctx.db,
        ctx.user.id,
        ctx.chatId,
        S.soonScreen(
          ctx.lang,
        ),
      );
      return;

    case '/roles': {
      const chat =
        await ensureCurrentChat(
          ctx,
        );

      await showRoles(
        ctx,
        chat.id,
      );

      return;
    }

    case '/voice':
      await showUiScreen(
        ctx.tg,
        ctx.db,
        ctx.user.id,
        ctx.chatId,
        S.soonScreen(
          ctx.lang,
        ),
      );
      return;

    case '/speak':
      await showUiScreen(
        ctx.tg,
        ctx.db,
        ctx.user.id,
        ctx.chatId,
        S.soonScreen(
          ctx.lang,
        ),
      );
      return;

    case '/rename': {
      const chat =
        await ensureCurrentChat(
          ctx,
        );

      await setMode(
        ctx.db,
        ctx.user.id,
        'rename',
        chat.id,
      );

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'chat.rename_prompt',
        ),
      );

      return;
    }

    case '/account':
      await showAccount(ctx);
      return;

    case '/status': {
      const bal =
        await getBalance(
          ctx.db,
          ctx.user.id,
          ctx.settings,
          ctx.now,
        );

      await ctx.tg.sendMessage(
        ctx.chatId,
        S.accountScreen(
          ctx.lang,
          ctx.user,
          bal,
        ).text,
      );

      return;
    }

    case '/plans':
      await showPlans(ctx);
      return;

    case '/orders':
      await showOrders(ctx);
      return;

    case '/language':
      await showLanguage(ctx);
      return;

    case '/help':
      await showHelp(ctx);
      return;

    case '/paysupport': {
      const contact =
        ctx.env.SUPPORT_CONTACT
          ? t(
              ctx.lang,
              'paysupport.contact',
              {
                contact:
                  ctx.env.SUPPORT_CONTACT,
              },
            )
          : '';

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'paysupport.body',
          {
            contact,
          },
        ),
      );

      return;
    }

    default:
      if (
        cmd.startsWith('/')
      ) {
        await ctx.tg.sendMessage(
          ctx.chatId,
          t(
            ctx.lang,
            'err.unknown_cmd',
          ),
        );
      }
  }
}

async function chatNew(
  ctx: Ctx,
  editId?: number,
): Promise<void> {
  const current =
    await getChat(
      ctx.db,
      ctx.user.id,
      ctx.user.current_chat_id,
    );

  const currentModel =
    current
      ? await getModel(
          ctx.db,
          current.model_key,
        )
      : null;

  const model =
    currentModel &&
    modelUsable(
      ctx,
      currentModel,
    )
      ? currentModel
      : await firstAvailableModel(
          ctx,
          'chat',
        );

  const modelKey =
    model?.key ??
    'unavailable';

  await createChat(
    ctx.db,
    ctx.user.id,
    modelKey,
    ctx.user.default_role_key,
    ctx.settings.chatTtlSec,
    ctx.now,
  );

  await showChatOpen(
    ctx,
    true,
    editId,
  );
}

// ---------------------------------------------------------------- callbacks

export async function handleCallback(
  ctx: Ctx,
  data: string,
  editId: number,
): Promise<
  { toast?: string } | void
> {
  const [
    ns,
    action,
    ...args
  ] = data.split(':');

  if (
    ns === 'noop'
  ) {
    return;
  }

  if (
    ns === 'admin'
  ) {
    if (
      !isAdmin(
        ctx.env,
        ctx.user.id,
      )
    ) {
      return {
        toast: t(
          ctx.lang,
          'ad.denied',
        ),
      };
    }

    const rest =
      args.length
        ? `${action}:${args.join(':')}`
        : action;

    await handleAdminCallback(
      ctx,
      rest ?? '',
      editId,
    );

    return;
  }

  if (
    ns === 'goto'
  ) {
    switch (action) {
      case 'menu':
        return void (
          await showMainMenu(ctx, editId)
        );

      case 'chat':
        return void (
          await showChatOpen(
            ctx,
            false,
            editId,
          )
        );

      case 'models':
        return void (
          await showModels(ctx, editId)
        );

      case 'chats':
        return void (
          await showChats(
            ctx,
            false,
            0,
            editId,
          )
        );

      case 'images':
      case 'docs':
      case 'voice':
        return void (
          await showNavigationScreen(
            ctx,
            S.soonScreen(ctx.lang),
            editId,
          )
        );

      case 'tools':
        return void (
          await showTools(ctx, editId)
        );

      case 'search':
        return void (
          await showSearch(ctx, editId)
        );

      case 'roles': {
        const chat =
          await ensureCurrentChat(
            ctx,
          );

        return void (
          await showRoles(
            ctx,
            chat.id,
            editId,
          )
        );
      }

      case 'account':
        return void (
          await showAccount(ctx, editId)
        );

      case 'language':
        return void (
          await showLanguage(ctx, editId)
        );

      case 'help':
        return void (
          await showHelp(ctx, editId)
        );

      case 'plans':
        return void (
          await showPlans(ctx, editId)
        );

      case 'points':
        return void (
          await showPoints(ctx, editId)
        );

      case 'orders':
        return void (
          await showOrders(ctx, editId)
        );
    }

    return;
  }

  if (
    ns === 'chat'
  ) {
    if (
      action === 'new'
    ) {
      return void (
        await chatNew(ctx, editId)
      );
    }

    const id =
      args.join(':');

    if (
      action === 'open'
    ) {
      await setCurrentChat(
        ctx.db,
        ctx.user.id,
        id,
      );

      return void (
        await showChatOpen(
          ctx,
          false,
          editId,
        )
      );
    }

    if (
      action === 'view'
    ) {
      return void (
        await showChatDetail(
          ctx,
          id,
          editId,
        )
      );
    }

    if (
      action === 'rename'
    ) {
      const chat =
        await getChat(
          ctx.db,
          ctx.user.id,
          id,
        );

      if (!chat) {
        return;
      }

      await setMode(
        ctx.db,
        ctx.user.id,
        'rename',
        id,
      );

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'chat.rename_prompt',
        ),
      );

      return;
    }

    if (
      action === 'archive' ||
      action === 'unarchive'
    ) {
      await setArchived(
        ctx.db,
        ctx.user.id,
        id,
        action === 'archive',
      );

      return void (
        await showChats(
          ctx,
          false,
          0,
          editId,
        )
      );
    }

    if (
      action === 'del'
    ) {
      const chat =
        await getChat(
          ctx.db,
          ctx.user.id,
          id,
        );

      if (!chat) {
        return;
      }

      return void (
        await showNavigationScreen(
          ctx,
          S.deleteConfirmScreen(ctx.lang, chat),
          editId,
        )
      );
    }

    if (
      action === 'del2'
    ) {
      const wasCurrent =
        ctx.user.current_chat_id ===
        id;

      await deleteChat(
        ctx.db,
        ctx.user.id,
        id,
      );

      await ctx.tg.safe(
        ctx.tg.sendMessage(
          ctx.chatId,
          t(
            ctx.lang,
            'chat.deleted',
          ),
        ),
        'deleted',
      );

      return void (
        await showChats(
          ctx,
          false,
          0,
          editId,
        )
      );
    }

    return;
  }

  if (
    ns === 'model' &&
    action === 'set'
  ) {
    const key =
      args.join(':');

    const model =
      await getModel(
        ctx.db,
        key,
      );

    if (
      !model ||
      !model.is_active ||
      !modelIsConfigured(
        ctx.env,
        model,
      )
    ) {
      return {
        toast: t(
          ctx.lang,
          'err.model_unavailable',
        ),
      };
    }

    const chat =
      await ensureCurrentChat(
        ctx,
      );

    await setChatModel(
      ctx.db,
      ctx.user.id,
      chat.id,
      key,
    );

    await setLastModel(
      ctx.db,
      ctx.user.id,
      key,
    );

    await showModels(ctx, editId);

    return {
      toast: t(
        ctx.lang,
        'models.changed',
      ),
    };
  }

  if (
    ns === 'search' &&
    action === 'set'
  ) {
    const key =
      args.join(':');

    await setSearchModel(
      ctx.db,
      ctx.user.id,
      key,
    );

    await showSearch(ctx, editId);

    return;
  }

  if (
    ns === 'role'
  ) {
    if (
      action === 'custom'
    ) {
      const chat =
        await ensureCurrentChat(
          ctx,
        );

      await setMode(
        ctx.db,
        ctx.user.id,
        'role',
        chat.id,
      );

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'roles.custom',
        ),
      );

      return;
    }

    if (
      action === 'set'
    ) {
      const key =
        args.join(':');

      const chat =
        await ensureCurrentChat(
          ctx,
        );

      await setChatRole(
        ctx.db,
        ctx.user.id,
        chat.id,
        key,
        null,
      );

      await showRoles(
        ctx,
        chat.id,
        editId,
      );

      return {
        toast: t(
          ctx.lang,
          'roles.set',
        ),
      };
    }

    return;
  }

  if (
    ns === 'lang' &&
    action === 'set'
  ) {
    const lang =
      normLang(args[0]);

    await setLanguage(
      ctx.db,
      ctx.user.id,
      lang,
    );

    ctx.lang = lang;

    await showLanguage(ctx, editId);

    await ctx.tg.safe(
      ctx.tg.sendMessage(
        ctx.chatId,
        t(
          lang,
          'lang.changed',
        ),
        {
          markup:
            mainReplyKeyboard(
              lang,
            ),
        },
      ),
      'lang_kb',
    );

    return;
  }

  if (
    ns === 'chats' &&
    action === 'page'
  ) {
    const archived =
      args[0] === '1';

    const page =
      Number(
        args[1] ?? 0,
      ) || 0;

    return void (
      await showChats(
        ctx,
        archived,
        page,
        editId,
      )
    );
  }

  if (
    ns === 'plans' &&
    action === 'more'
  ) {
    return void (
      await showPlansMore(ctx, editId)
    );
  }

  if (
    ns === 'plan'
  ) {
    const key =
      args.join(':');

    if (
      action === 'show'
    ) {
      return void (
        await showPlanConfirm(
          ctx,
          key,
          editId,
        )
      );
    }

    if (
      action === 'buy'
    ) {
      return void (
        await buyPlan(
          ctx,
          key,
          editId,
        )
      );
    }
  }

  if (
    ns === 'order'
  ) {
    const id =
      args.join(':');

    if (
      action === 'view'
    ) {
      return void (
        await showOrder(
          ctx,
          id,
          editId,
        )
      );
    }

    if (
      action === 'check'
    ) {
      return void (
        await checkOrder(
          ctx,
          id,
          editId,
        )
      );
    }
  }
}

// ---------------------------------------------------------------- plain text

export async function handleText(
  ctx: Ctx,
  text: string,
): Promise<void> {
  /*
   * Telegram Reply Keyboard buttons are received as ordinary text.
   *
   * Handle them BEFORE sending text to the AI model.
   *
   * Navigation screens use showUiScreen(), so they reuse the
   * dedicated UI message instead of creating a new message.
   */

  if (
    text ===
    t(ctx.lang, 'btn.chat')
  ) {
    await showChatOpen(
      ctx,
      false,
    );
    return;
  }

  if (
    text ===
    t(ctx.lang, 'btn.images')
  ) {
    await showUiScreen(
      ctx.tg,
      ctx.db,
      ctx.user.id,
      ctx.chatId,
      S.soonScreen(
        ctx.lang,
      ),
    );
    return;
  }

  if (
    text ===
    t(ctx.lang, 'btn.models')
  ) {
    await showModels(ctx);
    return;
  }

  if (
    text ===
    t(ctx.lang, 'btn.chats')
  ) {
    await showChats(
      ctx,
      false,
      0,
    );
    return;
  }

  if (
    text ===
    t(ctx.lang, 'btn.tools')
  ) {
    await showTools(ctx);
    return;
  }

  if (
    text ===
    t(ctx.lang, 'btn.account')
  ) {
    await showAccount(ctx);
    return;
  }

  const maxChars =
    ctx.settings.int(
      'user_message_max_chars',
    );

  if (
    text.length >
    maxChars
  ) {
    await ctx.tg.sendMessage(
      ctx.chatId,
      t(
        ctx.lang,
        'err.too_long',
        {
          n: String(
            maxChars,
          ),
        },
      ),
    );

    return;
  }

  /*
   * The following messages are user interactions/results,
   * NOT navigation UI.
   *
   * They remain normal Telegram messages.
   */

  if (
    ctx.user.mode ===
    'rename'
  ) {
    const chatId =
      ctx.user.mode_arg;

    await setMode(
      ctx.db,
      ctx.user.id,
      'chat',
    );

    if (chatId) {
      const title =
        truncate(
          text.trim(),
          60,
        );

      await renameChat(
        ctx.db,
        ctx.user.id,
        chatId,
        title,
      );

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'chat.renamed',
          {
            title,
          },
        ),
      );
    }

    return;
  }

  if (
    ctx.user.mode ===
    'role'
  ) {
    const chatId =
      ctx.user.mode_arg;

    await setMode(
      ctx.db,
      ctx.user.id,
      'chat',
    );

    if (chatId) {
      await setChatRole(
        ctx.db,
        ctx.user.id,
        chatId,
        null,
        text.trim(),
      );

      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'roles.saved',
        ),
      );
    }

    return;
  }

  if (
    ctx.user.mode ===
    'search'
  ) {
    const key =
      ctx.user.search_model_key;

    const model =
      key
        ? await getModel(
            ctx.db,
            key,
          )
        : null;

    if (
      !model ||
      !model.is_active ||
      !modelIsConfigured(
        ctx.env,
        model,
      )
    ) {
      await ctx.tg.sendMessage(
        ctx.chatId,
        t(
          ctx.lang,
          'search.none',
        ),
      );

      return;
    }

    const chat =
      await ensureCurrentChat(
        ctx,
      );

    const outcome =
      await answerAndSend(
        ctx,
        {
          chat,
          model,
          userText: text,
          search: true,
          statusKey:
            'status.search',
          saveTitleFromText:
            true,
        },
      );

    if (
      outcome.status !==
      'ok'
    ) {
      await sendOutcomeError(
        ctx,
        outcome,
      );
    }

    return;
  }

  if (
    ctx.user.mode ===
      'docs' ||
    ctx.user.mode ===
      'voice' ||
    ctx.user.mode ===
      'image'
  ) {
    await setMode(
      ctx.db,
      ctx.user.id,
      'chat',
    );
  }

  const chat =
    await ensureCurrentChat(
      ctx,
    );

  const model =
    await chatModel(
      ctx,
      chat,
    );

  if (
    !model ||
    !modelIsConfigured(
      ctx.env,
      model,
    )
  ) {
    await ctx.tg.sendMessage(
      ctx.chatId,
      t(
        ctx.lang,
        'err.model_unavailable',
      ),
    );

    return;
  }

  /*
   * AI answer is intentionally NOT passed through showUiScreen().
   *
   * answerAndSend() sends a normal Telegram message.
   * Therefore the AI answer stays in the chat and is never replaced
   * when the user later opens Account, Tools, Models, etc.
   */

  const outcome =
    await answerAndSend(
      ctx,
      {
        chat,
        model,
        userText: text,
        statusKey:
          'status.think',
        saveTitleFromText:
          true,
      },
    );

  if (
    outcome.status !==
    'ok'
  ) {
    await sendOutcomeError(
      ctx,
      outcome,
    );
  }
}
