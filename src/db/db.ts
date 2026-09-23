export const nowIso = (): string => new Date().toISOString();

export async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  return (await stmt.first<T>()) ?? null;
}

export async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const result = await stmt.all<T>();
  return result.results ?? [];
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

export function uuid(): string {
  return crypto.randomUUID();
}
