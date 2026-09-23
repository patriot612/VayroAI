export {};

declare global {
  interface D1Meta { changes?: number; duration?: number; last_row_id?: number; served_by?: string; }
  interface D1Result<T=unknown> { results: T[]; success?: boolean; meta: D1Meta; }
  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T=unknown>(colName?: string): Promise<T | null>;
    all<T=unknown>(): Promise<D1Result<T>>;
    run(): Promise<D1Result<unknown>>;
  }
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T=unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  }
  interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
  interface ScheduledController { scheduledTime: number; cron: string; }
}
