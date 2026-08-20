/**
 * The SQLite-backed TokenUsageStore provider: an independent database file
 * with its own monotonic SCHEMA_VERSION, a `token_usage_events` table with a
 * `(date, provider, model)` index, synchronous append on the session firehose
 * hot path (write errors contained and logged, never rethrown), and SQL
 * aggregation for the daily summary.
 *
 * The calendar-day `date` column is derived at write time in the writer's
 * local time zone and powers the index. Summary reads instead bound each
 * query by the epoch `time` window of the requested calendar day in the
 * caller's time zone (`localDayWindow`), so the displayed day is the caller's
 * day regardless of the writer's zone.
 *
 * @module @deepseek-ai/dsh-token-usage/store
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TokenUsageDailyGroup,
  TokenUsageDailySummary,
  TokenUsageEventRecord,
  TokenUsageStore,
} from './types.ts'

/**
 * The on-disk schema version for the token-usage database. Bumped only on a
 * breaking change to the `token_usage_events` layout.
 */
export const TOKEN_USAGE_SCHEMA_VERSION = 2

/** SQLite application id protecting unrelated databases from store writes. */
export const TOKEN_USAGE_APPLICATION_ID = 0x44535455 // 'DSTU'

/** Calendar-day key (`YYYY-MM-DD`) in local timezone.
 * @param time - epoch milliseconds to key.
 * @returns the local-timezone calendar-day key.
 */
export function dayKey(time: number): string {
  const date = new Date(time)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The exact epoch boundaries of one calendar day in a caller time zone. The
 * day runs from local midnight of `dateKey` through local midnight of the
 * following calendar day, so DST-length days (23h/25h) aggregate exactly.
 * Bounding by each record's epoch `time` keeps reads correct regardless of
 * the writer's zone, which the append-time `date` column does not.
 *
 * Resolution scans the UTC offset around the candidate midnight and confirms
 * the epoch projects back onto `dateKey 00:00:00`, mirroring the schedule
 * package's transition-safe local-instant resolution.
 * @param timeZone - UTC or IANA Area/Location name bounding the day.
 * @param dateKey - `YYYY-MM-DD` in `timeZone`.
 * @returns the epoch-millisecond half-open window `[start, end)` of the day.
 * @throws on an unrepresentable date or unsupported time zone.
 */
export function localDayWindow(timeZone: string, dateKey: string): { start: number; end: number } {
  const [yearStr, monthStr, dayStr] = dateKey.split('-')
  const year = Number(yearStr ?? Number.NaN)
  const month = Number(monthStr ?? Number.NaN)
  const day = Number(dayStr ?? Number.NaN)
  const start = localMidnightMs(timeZone, year, month, day)
  const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000)
  const end = localMidnightMs(timeZone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
  return { start, end }
}

const OFFSET_NAME = /^GMT(?:(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?)?$/

/**
 * The UTC offset in effect at an instant, in the given time zone.
 * @param formatter - prebuilt `Intl.DateTimeFormat` for the target zone.
 * @param epoch - instant to sample, in epoch milliseconds.
 * @returns the offset in milliseconds (east positive).
 * @throws when the formatter does not expose a usable offset.
 */
function timeZoneOffsetMs(formatter: Intl.DateTimeFormat, epoch: number): number {
  const zoneValue = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]))['timeZoneName']
  const match = typeof zoneValue === 'string' ? OFFSET_NAME.exec(zoneValue) : null
  const groups = match?.groups
  /* v8 ignore next -- a formatter configured with longOffset always emits a GMT offset part. */
  if (match === null || groups === undefined) {
    throw new Error(`time zone ${JSON.stringify(formatter.resolvedOptions().timeZone)} did not expose a usable UTC offset`)
  }
  if (groups['sign'] === undefined) return 0
  const direction = groups['sign'] === '-' ? -1 : 1
  const hour = Number(groups['hour'])
  const minute = Number(groups['minute'])
  const second = Number(groups['second'] ?? '0')
  return direction * (hour * 3600 + minute * 60 + second) * 1_000
}

/** Four-digit-year bounds for the timezone-math arrays (matches schedule). */
const MIN_DATE_MS = Date.parse('0001-01-01T00:00:00.000Z')
const MAX_DATE_MS = Date.parse('9999-12-31T23:59:59.999Z')

/**
 * The epoch of local midnight (`00:00:00.000`) for one calendar day in a time
 * zone. Scans the offsets around the UTC-shaped guess and returns the first
 * candidate that projects back onto the requested local date at exactly
 * midnight.
 * @param timeZone - UTC or IANA Area/Location name.
 * @param year - calendar year.
 * @param month - 1-based calendar month.
 * @param day - calendar day.
 * @returns the epoch-millisecond instant of local midnight.
 * @throws when the zone or date cannot be resolved.
 */
function localMidnightMs(timeZone: string, year: number, month: number, day: number): number {
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
  const base = Date.UTC(year, month - 1, day)
  const offsets = new Set<number>()
  for (const delta of [-86_400_000, 0, 86_400_000]) {
    offsets.add(timeZoneOffsetMs(formatter, Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, base + delta))))
  }
  for (const offset of offsets) {
    const candidate = base - offset
    if (candidate < MIN_DATE_MS || candidate > MAX_DATE_MS) continue
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]))
    if (Number(parts['year']) === year
      && Number(parts['month']) === month
      && Number(parts['day']) === day
      && parts['hour'] === '00'
      && parts['minute'] === '00'
      && parts['second'] === '00') {
      return candidate
    }
  }
  throw new Error(`no local midnight for ${timeZone} ${year}-${month}-${day}`)
}

interface GroupRow {
  provider: string
  model: string
  requests: number
  turns: number
  llmMs: number
  toolMs: number
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  ttftMs: number
  ttftSamples: number
  decodeMs: number
}

/**
 * Open the token-usage database and apply its schema. An empty database with
 * a zero `user_version` is initialized at {@link TOKEN_USAGE_SCHEMA_VERSION};
 * every other version rejects rather than migrating in place (pre-release
 * stance: backends reject old on-disk formats).
 * @param path - the SQLite database file to open (created when absent).
 * @returns the open handle with pragmas applied and the table ensured.
 */
export function openTokenUsageDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    configureDatabase(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  let began = false
  try {
    db.exec('BEGIN IMMEDIATE')
    began = true
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { count: userObjectCount } = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
    ).get() as { count: number }
    if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error('token-usage database has an unversioned schema or application identity')
    }
    if (onDisk !== 0 && onDisk !== TOKEN_USAGE_SCHEMA_VERSION) {
      throw new Error(`token-usage database has schema version ${onDisk}, incompatible with this build (${TOKEN_USAGE_SCHEMA_VERSION})`)
    }
    if (onDisk === TOKEN_USAGE_SCHEMA_VERSION && applicationId !== TOKEN_USAGE_APPLICATION_ID) {
      throw new Error(`token-usage database has application id ${applicationId}, expected ${TOKEN_USAGE_APPLICATION_ID}`)
    }
    if (onDisk === 0) {
      db.exec(`PRAGMA application_id = ${TOKEN_USAGE_APPLICATION_ID}`)
      db.exec(SCHEMA_DDL)
      db.exec(`PRAGMA user_version = ${TOKEN_USAGE_SCHEMA_VERSION}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    if (began) {
      try { db.exec('ROLLBACK') } catch { /* a failed BEGIN IMMEDIATE leaves no transaction to roll back */ }
    }
    throw error
  }
}

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS token_usage_events (
  time INTEGER NOT NULL,
  date TEXT NOT NULL,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  turn INTEGER NOT NULL,
  step INTEGER NOT NULL,
  uncached_input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER,
  ttft_ms INTEGER,
  llm_ms INTEGER NOT NULL DEFAULT 0,
  tool_ms INTEGER NOT NULL DEFAULT 0,
  decode_ms INTEGER,
  PRIMARY KEY (session_id, turn, step)
);
CREATE INDEX IF NOT EXISTS idx_token_usage_date_provider_model ON token_usage_events (date, provider, model);
`

const INSERT_SQL = `
INSERT INTO token_usage_events (
  time, date, session_id, provider, model, turn, step,
  uncached_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  reasoning_tokens, ttft_ms, llm_ms, tool_ms, decode_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (session_id, turn, step) DO UPDATE SET
  time = excluded.time,
  date = excluded.date,
  provider = excluded.provider,
  model = excluded.model,
  uncached_input_tokens = excluded.uncached_input_tokens,
  output_tokens = excluded.output_tokens,
  cache_read_tokens = excluded.cache_read_tokens,
  cache_write_tokens = excluded.cache_write_tokens,
  reasoning_tokens = excluded.reasoning_tokens,
  ttft_ms = excluded.ttft_ms,
  llm_ms = excluded.llm_ms,
  tool_ms = excluded.tool_ms,
  decode_ms = excluded.decode_ms
`

const SELECT_GROUPS_SQL = `
SELECT
  provider, model,
  COUNT(*) AS requests,
  COUNT(DISTINCT session_id || ':' || turn) AS turns,
  COALESCE(SUM(llm_ms), 0) AS llmMs,
  COALESCE(SUM(tool_ms), 0) AS toolMs,
  COALESCE(SUM(uncached_input_tokens), 0) AS uncachedInputTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
  COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
  COALESCE(SUM(ttft_ms), 0) AS ttftMs,
  SUM(CASE WHEN ttft_ms IS NOT NULL THEN 1 ELSE 0 END) AS ttftSamples,
  COALESCE(SUM(decode_ms), 0) AS decodeMs
FROM token_usage_events
WHERE time >= ? AND time < ?
GROUP BY provider, model
ORDER BY provider, model
`

const SELECT_GROUPS_RANGE_SQL = SELECT_GROUPS_SQL

/**
 * The loadable SQLite-backed TokenUsageStore, registered as the
 * `tokenUsageStore` cordis Service by construction (the Service base class
 * calls `ctx.reflect.provide` in its constructor, so instantiating this class
 * is the whole registration act). One instance per context; a duplicate load
 * throws (cordis Service standard behavior), and the registration is removed
 * automatically when the owning fiber unloads.
 *
 * The append path is synchronous and fail-contained: it runs inside the
 * `session/event` listener, which cordis dispatches stop-on-throw, so a
 * write failure is logged and swallowed — never propagated into the agent
 * loop. Reads (dailySummary, purge) are independent transactions.
 */
export class SqliteTokenUsageStore extends Service implements TokenUsageStore {
  /**
   * @param ctx - the composing context; the Service registers under `tokenUsageStore`.
   * @param db - the open database handle (caller closes it via the returned disposer effect).
   */
  constructor(ctx: Context, private readonly db: DatabaseSync) {
    super(ctx, 'tokenUsageStore')
  }

  /** @inheritDoc */
  append(record: TokenUsageEventRecord): void {
    try {
      this.db.prepare(INSERT_SQL).run(
        record.time,
        record.date,
        record.sessionId,
        record.provider,
        record.model,
        record.turn,
        record.step,
        record.uncachedInputTokens,
        record.outputTokens,
        record.cacheReadTokens,
        record.cacheWriteTokens,
        record.reasoningTokens,
        record.ttftMs,
        record.llmMs,
        record.toolMs,
        record.decodeMs,
      )
    } catch (error) {
      // Contain: the firehose listener must not propagate errors into the loop.
      this.ctx.logger.warn(`token-usage: append failed for session ${record.sessionId} turn ${record.turn} step ${record.step}: ${String(error)}`)
    }
  }

  /** @inheritDoc */
  dailySummary(date: string, timeZone: string): TokenUsageDailySummary {
    const { start, end } = localDayWindow(timeZone, date)
    const rows = this.db.prepare(SELECT_GROUPS_SQL).all(start, end) as unknown as GroupRow[]
    const totals = sumGroups(rows)
    return { date, groups: rows, totals }
  }

  /** @inheritDoc */
  dailySummaryRange(startDate: string, endDate: string, timeZone: string): TokenUsageDailySummary {
    const { end } = localDayWindow(timeZone, endDate)
    const { start: startBoundary } = localDayWindow(timeZone, startDate)
    const rows = this.db.prepare(SELECT_GROUPS_RANGE_SQL).all(startBoundary, end) as unknown as GroupRow[]
    const totals = sumGroups(rows)
    return { date: `${startDate}~${endDate}`, groups: rows, totals }
  }

  /** @inheritDoc */
  purge(before: number): number {
    const { changes } = this.db.prepare('DELETE FROM token_usage_events WHERE time < ?').run(before) as { changes: number }
    return changes
  }
}

/** Sum a list of group rows into one cross-group totals row keyed by the sentinel `(total, total)`. */
function sumGroups(rows: readonly GroupRow[]): TokenUsageDailyGroup {
  let requests = 0
  let turns = 0
  let llmMs = 0
  let toolMs = 0
  let uncachedInputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let ttftMs = 0
  let ttftSamples = 0
  let decodeMs = 0
  for (const row of rows) {
    requests += row.requests
    turns += row.turns
    llmMs += row.llmMs
    toolMs += row.toolMs
    uncachedInputTokens += row.uncachedInputTokens
    outputTokens += row.outputTokens
    cacheReadTokens += row.cacheReadTokens
    cacheWriteTokens += row.cacheWriteTokens
    ttftMs += row.ttftMs
    ttftSamples += row.ttftSamples
    decodeMs += row.decodeMs
  }
  return {
    provider: 'total',
    model: 'total',
    requests,
    turns,
    llmMs,
    toolMs,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ttftMs,
    ttftSamples,
    decodeMs,
  }
}

/** Stable random id helper for tests that mint a standalone database path.
 * @returns a unique database filename in the current directory.
 */
export function tempDbPath(): string {
  return `token-usage-${randomUUID()}.db`
}
