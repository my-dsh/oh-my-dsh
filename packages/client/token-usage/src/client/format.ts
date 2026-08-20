/**
 * Pure formatting helpers for the token-usage dashboard. Every value the
 * panel renders is a pure function of the daily-summary view it received:
 * no rounding ambiguity, no locale-specific number shaping, and no mutation.
 */

import type { TokenUsageDailySummaryView, TokenUsageGroupView } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Compact token-count rendering with SI magnitude suffixes. Counts below
 * 1000 render as-is; larger counts scale down to one decimal with `K`, `M`,
 * or `B` appended (thousands, millions, billions) so dashboard totals stay
 * readable at deployment scale.
 * @param value - the token count.
 * @returns the compact string, or `0` for a null/undefined count.
 */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0'
  return compactNumber(value)
}

/**
 * Scale a non-negative token count to a magnitude-suffixed compact string.
 * @param value - the token count.
 * @returns e.g. `999`, `1.2K`, `3.4M`, or `1.5B`.
 */
function compactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs < 1_000) return String(Math.round(value))
  if (abs < 1_000_000) return formatScale(value / 1_000, 'K')
  if (abs < 1_000_000_000) return formatScale(value / 1_000_000, 'M')
  return formatScale(value / 1_000_000_000, 'B')
}

/**
 * Render a scaled value with one decimal, dropping the trailing `.0`.
 * @param scaled - the count divided by its magnitude.
 * @param suffix - the magnitude unit (`K`, `M`, `B`).
 * @returns e.g. `2K` for 2000 and `1.2M` for 1200000.
 */
function formatScale(scaled: number, suffix: string): string {
  const rounded = Math.round(scaled * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text}${suffix}`
}

/**
 * Throughput as tokens-per-second with one decimal and a `tokens/s` suffix.
 * @param group - the row view carrying the derived average.
 * @returns `—` when the average is absent (no decode timing sampled).
 */
export function formatThroughput(group: TokenUsageGroupView): string {
  if (group.averageThroughput === null) return '—'
  return `${group.averageThroughput.toFixed(1)} tokens/s`
}

/**
 * TTFT (first-token latency) as milliseconds.
 * @param group - the row view carrying the derived average.
 * @returns `—` when no TTFT sample was recorded for the row.
 */
export function formatTtft(group: TokenUsageGroupView): string {
  if (group.averageTtftMs === null) return '—'
  return `${Math.round(group.averageTtftMs)} ms`
}

/**
 * TTFT as seconds with two decimals, suitable for summary cards.
 * @param averageTtftMs - the derived mean first-token latency, in ms.
 * @returns `—` when the average is absent.
 */
export function formatTtftSeconds(averageTtftMs: number | null): string {
  if (averageTtftMs === null) return '—'
  return `${(averageTtftMs / 1000).toFixed(2)} s`
}

/**
 * Compact duration: `812ms` under a second, `45.2s` under a minute, `2m42s`
 * from there on. Used for the derived average LLM step time and the summed
 * tool wall time.
 * @param ms - the duration in milliseconds.
 * @returns the compact display string, or `—` when the duration is absent.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/**
 * Cache-hit ratio as a percentage with one decimal.
 * @param group - the row view carrying the derived ratio.
 * @returns `—` when the ratio is absent (no billed input tokens).
 */
export function formatCacheHit(group: TokenUsageGroupView): string {
  if (group.cacheHitRatio === null) return '—'
  return `${(group.cacheHitRatio * 100).toFixed(1)}%`
}

/**
 * Today's date as a `YYYY-MM-DD` key in the user's local timezone.
 * @returns the day key for the current instant.
 */
export function todayLocalKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The browser's current canonical IANA time zone, sent to the host so the
 * store binds the requested calendar day by the same zone the browser used
 * to derive its date keys.
 * @returns the canonical UTC or IANA Area/Location zone for the current instant.
 */
export function browserTimeZone(): string {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new Error('browser time zone is unavailable')
  }
  return timeZone
}

/**
 * The local day key for the instant `days` days before today. Pass `0` to
 * get today, `1` for yesterday. Calendar math (not a fixed offset) keeps it
 * correct across month and year boundaries.
 * @param days - the non-negative number of days to step back.
 * @returns the `YYYY-MM-DD` key for that day in the user's local timezone.
 */
export function daysAgoLocalKey(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Yesterday's date as a `YYYY-MM-DD` key in the user's local timezone.
 * @returns the day key for the instant one day before today.
 */
export function yesterdayLocalKey(): string {
  return daysAgoLocalKey(1)
}

/**
 * Start of the current month as a `YYYY-MM-DD` key.
 * @returns the first calendar day of the current month.
 */
export function startOfMonthLocalKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

/**
 * Start of the previous month as a `YYYY-MM-DD` key.
 * @returns the first calendar day of the month before the current month.
 */
export function startOfLastMonthLocalKey(): string {
  const now = new Date()
  const month = now.getMonth()
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const lastMonth = month === 0 ? 0 : month - 1
  return `${year}-${String(lastMonth + 1).padStart(2, '0')}-01`
}

/**
 * End of the previous month as a `YYYY-MM-DD` key.
 * @returns the last calendar day of the month before the current month.
 */
export function endOfLastMonthLocalKey(): string {
  const now = new Date()
  const month = now.getMonth()
  const year = month === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const lastMonth = month === 0 ? 0 : month - 1
  const lastDay = new Date(year, lastMonth + 1, 0).getDate()
  return `${year}-${String(lastMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/**
 * Start of the month containing the given date.
 * @param dateKey - `YYYY-MM-DD`.
 * @returns the first day of that month.
 */
export function startOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

/**
 * End of the month containing the given date.
 * @param dateKey - `YYYY-MM-DD`.
 * @returns the last day of that month.
 */
export function endOfMonth(dateKey: string): string {
  const [yearStr, monthStr] = dateKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const lastDay = new Date(year, month, 0).getDate()
  const monthPad = String(month).padStart(2, '0')
  const dayPad = String(lastDay).padStart(2, '0')
  return `${yearStr}-${monthPad}-${dayPad}`
}

/**
 * The per-(provider, model) rows in stable display order (provider, then
 * model). The cross-group totals live in a separate field on the summary
 * and render independently, so they are excluded here.
 * @param summary - the daily summary view carrying the grouped rows.
 * @returns the per-(provider, model) rows in stable (provider, model) display order.
 */
export function orderedGroups(summary: TokenUsageDailySummaryView): readonly TokenUsageGroupView[] {
  const rows = [...summary.groups]
  rows.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1
    if (a.model !== b.model) return a.model < b.model ? -1 : 1
    return 0
  })
  return rows
}
