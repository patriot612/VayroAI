export const nowSec = (): number => Math.floor(Date.now() / 1000);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random URL-safe id (not guessable): used for chats, holds, pending actions. */
export function rid(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Log without ever including secrets or message text. */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ event, ...data }));
  } catch {
    console.log(event);
  }
}

export function logError(event: string, err: unknown, data: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ event, message: truncate(message, 300), ...data }));
}

export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
