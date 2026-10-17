// The API worker's bindings and secrets, as the admin panel and the feedback
// forms use them. Only the parts of Cloudflare's D1 and KV interfaces this
// code calls, so it needs no extra type package.

export interface D1Result<T> {
  results: T[];
  meta?: { size_after?: number; rows_read?: number; rows_written?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
}

export interface Env {
  /** D1 tfp-results: results, history, the feedback table */
  RESULTS_DB?: D1Database;
  /** KV: members:list and each member's record */
  MEMBER_DATA: KVNamespace;
  /** The admin key (wrangler secret), typed once at /admin */
  ADMIN_SECRET?: string;
  /** Cloudflare Turnstile's secret for the feedback forms' bot check */
  TURNSTILE_SECRET?: string;
}
