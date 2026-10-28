/** Only the synchronous SQL operations used by these replaceable storage adapters. */
export type SqlBinding = string | number | null;
export type SqliteStorage = {
  sql: { exec(query: string, ...bindings: SqlBinding[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(operation: () => T): T;
};
