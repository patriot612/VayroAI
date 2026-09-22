import { t, tp, formatDateTime, formatInt, type Lang } from '../i18n';
import type { InlineKeyboard, Screen } from '../telegram/types';
import { btn, grid, mergeKb, row, rows, urlRow } from './keyboards';
import type { ChatRow, MessageRow } from '../db/chats';
import type { ModelRow } from '../db/models';
import type { Balance } from '../db/points';
import type { UserRow } from '../db/users';
import type { RoleRow } from '../db/content';
import type { OrderRow } from '../db/orders';
import type { PlanRow } from '../db/orders';
import { truncate } from '../util/misc';

const NAV = (lang: Lang) => rows(row(btn(t(lang, 'btn.to_chat'), 'goto:chat')));

export function modelLabel(m: ModelRow): string {
  return m.name;
}

export function chatTitle(lang: Lang, c: ChatRow): string {
  return c.title ?? `${t(lang, 'chat.default_title')} №${c.seq}`;
}

export function mainMenuScreen(lang: Lang, chat: ChatRow | null, model: ModelRow | null, msgCount: number): Screen {
  const modelName = model ? modelLabel(model) : '—';
  const chatLine = t(lang, 'menu.chat_line', { model: modelName });
  const body = msgCount > 0 ? t(lang, 'menu.nonempty', { n: msgCount }) : t(lang, 'menu.empty');
  const text = [t(lang, 'menu.title'), '', chatLine, body, '', t(lang, 'next.chat')].join('\n');
  const kb = mergeKb(
    row(btn(t(lang, 'btn.chat'), 'goto:chat'), btn(t(lang, 'btn.models'), 'goto:models')),
    row(btn(t(lang, 'btn.new'), 'chat:new'), btn(t(lang, 'btn.chats'), 'goto:chats')),
    row(btn(t(lang, 'btn.images'), 'goto:images'), btn(t(lang, 'btn.tools'), 'goto:tools')),
    row(btn(t(lang, 'btn.account'), 'goto:account'), btn(t(lang, 'btn.help'), 'goto:help')),
  );
  return { text, kb };
}

export function chatOpenScreen(lang: Lang, chat: ChatRow, model: ModelRow | null, isNew: boolean): Screen {
  const modelName = model ? modelLabel(model) : '—';
  const text = isNew
    ? t(lang, 'chat.new', { model: modelName })
    : t(lang, 'chat.continue', { title: chatTitle(lang, chat), model: modelName });
  const kb = mergeKb(row(btn(t(lang, 'btn.models'), 'goto:models'), btn(t(lang, 'btn.chats'), 'goto:chats')));
  return { text, kb };
}

export function modelsScreen(lang: Lang, chat: ChatRow, current: ModelRow | null, byFamily: Map<string, ModelRow[]>): Screen {
  const families = [...byFamily.keys()];
  const head = t(lang, 'models.head', { model: current ? modelLabel(current) : '—', chat: chatTitle(lang, chat), family: families[0] ?? '' });
  let body = head;
  const dailyModels: ModelRow[] = [];
  const advModels: ModelRow[] = [];
  for (const list of byFamily.values()) for (const m of list) (m.tier === 'advanced' ? advModels : dailyModels).push(m);

  const familyButtons = families.map((f) => btn(f, 'noop'));
  const kbRows: { text: string; data: string }[][] = [];
  for (let i = 0; i < familyButtons.length; i += 3) kbRows.push(familyButtons.slice(i, i + 3));
  if (dailyModels.length) {
    body += t(lang, 'models.daily');
    for (const m of dailyModels) kbRows.push([btn(`${current?.key === m.key ? '✓ ' : ''}${m.name} · ${tp(lang, m.cost, 'unit.point')}`, `model:set:${m.key}`)]);
  }
  if (advModels.length) {
    body += t(lang, 'models.advanced');
    for (const m of advModels) kbRows.push([btn(`${current?.key === m.key ? '✓ ' : ''}${m.name} · ${tp(lang, m.cost, 'unit.point')}`, `model:set:${m.key}`)]);
  }
  if (!dailyModels.length && !advModels.length) body += '\n' + t(lang, 'models.none') + '\n';
  body += '\n' + t(lang, 'models.foot');
  kbRows.push([btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text: body, kb: rows(...kbRows) };
}

export function chatListScreen(lang: Lang, current: ChatRow | null, list: ChatRow[], archived: boolean, hasMore: boolean, page: number): Screen {
  const text = list.length === 0 ? (archived ? t(lang, 'chat.archive_empty') : t(lang, 'chat.list_empty')) : archived ? t(lang, 'chat.archive') : t(lang, 'chat.list', { title: current ? chatTitle(lang, current) : '—' });
  const kbRows: { text: string; data: string }[][] = [];
  for (const c of list) {
    const mark = current?.id === c.id ? '✓ ' : '';
    kbRows.push([btn(`${mark}${chatTitle(lang, c)}`, `chat:open:${c.id}`)]);
  }
  const nav: { text: string; data: string }[] = [];
  if (page > 0) nav.push(btn(t(lang, 'btn.prev'), `chats:page:${archived ? 1 : 0}:${page - 1}`));
  if (hasMore) nav.push(btn(t(lang, 'btn.next'), `chats:page:${archived ? 1 : 0}:${page + 1}`));
  if (nav.length) kbRows.push(nav);
  if (!archived) {
    kbRows.push([btn(t(lang, 'btn.archive'), 'chats:page:1:0')]);
    kbRows.push([btn(t(lang, 'btn.new'), 'chat:new')]);
  } else {
    kbRows.push([btn(t(lang, 'btn.to_chats'), 'chats:page:0:0')]);
  }
  kbRows.push([btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text, kb: rows(...kbRows) };
}

export function chatDetailScreen(lang: Lang, chat: ChatRow, model: ModelRow | null, msgs: MessageRow[], hasExpired: boolean, archived: boolean): Screen {
  const preview = msgs
    .slice(-6)
    .map((m) => `${m.role === 'user' ? t(lang, 'chat.item_you') : t(lang, 'chat.item_ai')}: ${truncate(m.content, 160)}`)
    .join('\n');
  let text = t(lang, 'chat.item', { title: chatTitle(lang, chat), model: model ? modelLabel(model) : '—', n: String(msgs.length) });
  if (preview) text += t(lang, 'chat.item_last', { preview });
  if (hasExpired) text += t(lang, 'chat.item_expired');
  const kb = mergeKb(
    row(btn(t(lang, 'btn.continue'), `chat:open:${chat.id}`), btn(t(lang, 'btn.rename'), `chat:rename:${chat.id}`)),
    row(
      btn(archived ? t(lang, 'btn.unarchive_it') : t(lang, 'btn.archive_it'), `chat:${archived ? 'unarchive' : 'archive'}:${chat.id}`),
      btn(t(lang, 'btn.delete'), `chat:del:${chat.id}`),
    ),
    row(btn(t(lang, 'btn.to_chats'), `chats:page:${archived ? 1 : 0}:0`)),
  );
  return { text, kb };
}

export function deleteConfirmScreen(lang: Lang, chat: ChatRow): Screen {
  return {
    text: t(lang, 'chat.delete_confirm', { title: chatTitle(lang, chat) }),
    kb: mergeKb(row(btn(t(lang, 'btn.delete_yes'), `chat:del2:${chat.id}`), btn(t(lang, 'btn.cancel'), `chat:view:${chat.id}`))),
  };
}

export function toolsScreen(lang: Lang): Screen {
  return {
    text: t(lang, 'tools.title'),
    kb: mergeKb(
      row(btn(t(lang, 'btn.search'), 'goto:search'), btn(t(lang, 'btn.docs'), 'goto:docs')),
      row(btn(t(lang, 'btn.roles'), 'goto:roles'), btn(t(lang, 'btn.voice'), 'goto:voice')),
      row(btn(t(lang, 'btn.to_chat'), 'goto:chat')),
    ),
  };
}

export function searchScreen(lang: Lang, models: ModelRow[], current: ModelRow | null): Screen {
  const price = current ? tp(lang, current.cost, 'unit.point') : '—';
  const text = t(lang, 'search.body', { model: current?.name ?? '—', price });
  const kbRows = models.map((m) => [btn(`${current?.key === m.key ? '✓ ' : ''}${m.name}`, `search:set:${m.key}`)]);
  kbRows.push([btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text, kb: rows(...kbRows) };
}

export function soonScreen(lang: Lang): Screen {
  return { text: t(lang, 'soon'), kb: NAV(lang) };
}

export function rolesScreen(lang: Lang, roles: RoleRow[], current: string | null): Screen {
  const kbRows = roles.map((r) => [btn(`${current === r.key ? '✓ ' : ''}${lang === 'ru' ? r.name_ru : r.name_en}`, `role:set:${r.key}`)]);
  kbRows.push([btn(t(lang, 'btn.custom_role'), 'role:custom'), btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text: t(lang, 'roles.body'), kb: rows(...kbRows) };
}

export function accountScreen(lang: Lang, user: UserRow, bal: Balance): Screen {
  const sub = bal.hasSub && bal.subExpiresAt ? t(lang, 'account.sub_until', { date: formatDateTime(lang, bal.subExpiresAt) }) : t(lang, 'account.sub_none');
  const text =
    t(lang, 'account.body', { free: formatInt(bal.free), limit: formatInt(bal.freeLimit), reset: formatDateTime(lang, bal.freeResetAt), paid: formatInt(bal.paid) }) +
    t(lang, 'account.extra', { sub, id: String(user.id), today: '—', total: '—' });
  const kb = mergeKb(
    row(btn(t(lang, 'btn.plans'), 'goto:plans')),
    row(btn(t(lang, 'btn.orders'), 'goto:orders')),
    row(btn(t(lang, 'btn.language', { lang: t(lang, `lang.name.${lang}` as never) }), 'goto:language')),
    row(btn(t(lang, 'btn.help'), 'goto:help')),
    row(btn(t(lang, 'btn.to_chat'), 'goto:chat')),
  );
  return { text, kb };
}

export function languageScreen(lang: Lang): Screen {
  return {
    text: t(lang, 'lang.title'),
    kb: mergeKb(
      row(btn(`${lang === 'ru' ? '✓ ' : ''}${t(lang, 'lang.name.ru')}`, 'lang:set:ru'), btn(`${lang === 'en' ? '✓ ' : ''}${t(lang, 'lang.name.en')}`, 'lang:set:en')),
      row(btn(t(lang, 'btn.to_account'), 'goto:account'), btn(t(lang, 'btn.to_chat'), 'goto:chat')),
    ),
  };
}

export function helpScreen(lang: Lang, voiceMin: string, hours: string): Screen {
  return { text: t(lang, 'help.body', { min: voiceMin, hours }), kb: NAV(lang) };
}

export function plansScreen(lang: Lang, dailyLimit: string, dailyModel: ModelRow | null, advModel: ModelRow | null, featured: PlanRow[]): Screen {
  const avgTerm = featured.find((p) => (p.duration_days ?? 0) >= 300);
  const avg =
    avgTerm && avgTerm.duration_days
      ? t(lang, 'plans.avg', {
          term: avgTerm.duration_days >= 300 ? (lang === 'ru' ? '1 год' : '1 year') : '',
          avg: '',
          total: '',
        })
      : '';
  const body = t(lang, 'plans.body', {
    daily: tp(lang, Number(dailyLimit), 'unit.point'),
    p_daily: dailyModel ? tp(lang, dailyModel.cost, 'unit.point') : '—',
    p_adv: advModel ? t(lang, 'plans.adv_line', { price: tp(lang, advModel.cost, 'unit.point') }) : '',
    avg,
  });
  const kbRows = featured.map((p) => [btn(`${planLabel(lang, p)} · ${planPrice(lang, p)}`, `plan:show:${p.key}`)]);
  kbRows.push([btn(t(lang, 'btn.other_terms'), 'plans:more')]);
  kbRows.push([btn(t(lang, 'btn.to_account'), 'goto:account'), btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text: body, kb: rows(...kbRows) };
}

export function planLabel(lang: Lang, p: PlanRow): string {
  if (p.kind === 'points') return tp(lang, p.qty, 'unit.point');
  const n = p.qty;
  if (p.unit === 'week') return lang === 'ru' ? `${n} нед.` : `${n} week${n > 1 ? 's' : ''}`;
  if (p.unit === 'year') return lang === 'ru' ? `${n} ${n === 1 ? 'год' : n < 5 ? 'года' : 'лет'}` : `${n} year${n > 1 ? 's' : ''}`;
  return lang === 'ru' ? `${n} мес.` : `${n} month${n > 1 ? 's' : ''}`;
}

import { formatMoney } from '../i18n';
export function planPrice(lang: Lang, p: PlanRow): string {
  return formatMoney(lang, p.price_minor, p.currency);
}

export function orderStatusLabel(lang: Lang, status: string): string {
  return t(lang, `order.status.${status}` as never);
}

export function ordersListScreen(lang: Lang, orders: OrderRow[], pageSize: string): Screen {
  const text = orders.length ? t(lang, 'orders.list', { n: pageSize }) : t(lang, 'orders.empty');
  const kbRows = orders.map((o) => [btn(`${planPrice(lang, { price_minor: o.amount_minor, currency: o.currency } as PlanRow)} · ${orderStatusLabel(lang, o.status)}`, `order:view:${o.id}`)]);
  kbRows.push([btn(t(lang, 'btn.to_account'), 'goto:account'), btn(t(lang, 'btn.to_chat'), 'goto:chat')]);
  return { text, kb: rows(...kbRows) };
}

export function orderCardScreen(lang: Lang, o: OrderRow): Screen {
  let text = t(lang, 'orders.card', {
    id: o.id,
    title: lang === 'ru' ? o.title_ru : o.title_en,
    amount: formatMoney(lang, o.amount_minor, o.currency),
    status: orderStatusLabel(lang, o.status),
    date: formatDateTime(lang, o.created_at),
  });
  if (o.status === 'pending') text += t(lang, 'orders.pending_note');
  if (o.status === 'paid') text += t(lang, 'orders.paid_note');
  if (o.status === 'review') text += t(lang, 'orders.review_note');
  const kbRows: InlineKeyboard['inline_keyboard'] = [];
  if (o.status === 'pending') {
    if (o.payment_url) kbRows.push(urlRow(t(lang, 'btn.pay'), o.payment_url));
    kbRows.push([{ text: t(lang, 'btn.check_pay'), callback_data: `order:check:${o.id}` }]);
  }
  kbRows.push([
    { text: t(lang, 'btn.orders'), callback_data: 'goto:orders' },
    { text: t(lang, 'btn.to_account'), callback_data: 'goto:account' },
  ]);
  return { text, kb: { inline_keyboard: kbRows } };
}
