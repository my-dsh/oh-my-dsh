/**
 * Default SQLite-backed provider for the `tokenUsageStore` Service Definition:
 * a function plugin that opens (or reuses) a token-usage database at a
 * configured path and registers one {@link SqliteTokenUsageStore} on the
 * context. A deployment composes this row to make the cross-session
 * token-usage capture side active; without it the capture plugin's fiber
 * stays pending on the store and writes nothing.
 *
 * @module @deepseek-ai/dsh-token-usage/sqlite-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import { openTokenUsageDatabase, SqliteTokenUsageStore } from './store.ts'

/** Provider configuration: the database path (created when absent). */
export interface TokenUsageSqliteConfig {
  /**
   * SQLite database file path. A `:memory:` path opens a private in-memory
   * database (useful for tests; lost on process exit). Any other path opens
   * or creates a file-backed database.
   */
  path: string
}

/** Cordis plugin name. */
export const name = 'token-usage-sqlite'

/** No service injection: the provider creates the `tokenUsageStore` service. */
export const inject: readonly string[] = []

/**
 * Open the database and register the SQLite-backed store on this context.
 * The Service base class registers itself in its constructor, so
 * instantiating `SqliteTokenUsageStore` is the whole registration act; the
 * owning fiber removes it automatically on unload. The effect below closes
 * the database handle when the fiber disposes.
 * @param ctx - provider context.
 * @param config - the database path configuration.
 */
export function apply(ctx: Context, config: TokenUsageSqliteConfig): void {
  const db = openTokenUsageDatabase(config.path)
  // Construction registers the store on `ctx`; nothing further is needed.
  new SqliteTokenUsageStore(ctx, db)
  ctx.effect(() => () => {
    try { db.close() } catch { /* a double close is the only reachable error */ }
  }, 'token-usage sqlite provider')
}
