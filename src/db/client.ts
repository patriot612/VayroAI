// Thin helpers around D1. All values are normalised (undefined -> null) because D1 rejects undefined.

export type Bind = string | number | null | undefined | boolean;

const norm = (v: Bind): string | number | null => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function stmt(db: D1Database, sql: string, ...args: Bind[]): D1PreparedStatement {
  return db.prepare(sql).bind(...args.map(norm));
}

export async function first<T>(db: D1Database, sql: string, ...args: Bind[]): Promise<T | null> {
  return (await stmt(db, sql, ...args).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...args: Bind[]): Promise<T[]> {
  const r = await stmt(db, sql, ...args).all<T>();
  return r.results ?? [];
}

export async function run(db: D1Database, sql: string, ...args: Bind[]): Promise<number> {
  const r = await stmt(db, sql, ...args).run();
  return r.meta?.changes ?? 0;
}

export async function scalar(db: D1Database, sql: string, ...args: Bind[]): Promise<number> {
  const r = await first<Record<string, number>>(db, sql, ...args);
  if (!r) return 0;
  const v = Object.values(r)[0];
  return typeof v === 'number' ? v : Number(v ?? 0);
}
