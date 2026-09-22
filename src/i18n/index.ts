import { ru, type Key } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';
export type { Key };

// To add a language later: create src/i18n/xx.ts (Record<Key,string>), register it here,
// add it to LANGS, and extend the language picker in src/bot/screens.ts.
export const LANGS: Lang[] = ['ru', 'en'];
export const DEFAULT_LANG: Lang = 'ru';

const DICTS: Record<Lang, Record<Key, string>> = { ru, en };

export function isLang(x: unknown): x is Lang {
  return x === 'ru' || x === 'en';
}

export function normLang(x: unknown, fallback: Lang = DEFAULT_LANG): Lang {
  return isLang(x) ? x : fallback;
}

/** Translate a key and substitute {placeholders}. */
export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS[DEFAULT_LANG][key] ?? key;
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  }
  return s;
}

/** Plural-aware noun: tp('ru', 3, 'unit.point') -> "3 балла". */
export function tp(lang: Lang, n: number, key: Key): string {
  return `${formatInt(n)} ${pluralWord(lang, n, key)}`;
}

export function pluralWord(lang: Lang, n: number, key: Key): string {
  const forms = t(lang, key).split('|');
  if (lang === 'ru') {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2] ?? forms[0]!;
    if (b === 1) return forms[0]!;
    if (b >= 2 && b <= 4) return forms[1] ?? forms[0]!;
    return forms[2] ?? forms[0]!;
  }
  return Math.abs(n) === 1 ? forms[0]! : (forms[1] ?? forms[0]!);
}

const NBSP = '\u00A0';

export function formatInt(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return n < 0 ? '-' + grouped : grouped;
}

const MONTHS_RU = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 сент. 2026 г., 18:18 UTC"  |  "Sep 28, 2026, 18:18 UTC" */
export function formatDateTime(lang: Lang, unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  if (lang === 'ru') return `${day} ${MONTHS_RU[d.getUTCMonth()]} ${year} г., ${hh}:${mm} UTC`;
  return `${MONTHS_EN[d.getUTCMonth()]} ${day}, ${year}, ${hh}:${mm} UTC`;
}

/** Money from minor units. style 'short': "699 ₽" / "299,92 ₽"; style 'dot': "699.00 ₽". */
export function formatMoney(
  lang: Lang,
  minor: number,
  currency: string,
  style: 'short' | 'dot' = 'short',
): string {
  const sym = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  let body: string;
  if (style === 'dot') body = `${major}.${String(cents).padStart(2, '0')}`;
  else if (cents === 0) body = formatInt(major);
  else body = `${formatInt(major)}${lang === 'ru' ? ',' : '.'}${String(cents).padStart(2, '0')}`;
  return `${body}${NBSP}${sym}`;
}
