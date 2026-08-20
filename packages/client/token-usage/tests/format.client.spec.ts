// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { TokenUsageDailySummaryView, TokenUsageGroupView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  browserTimeZone,
  daysAgoLocalKey,
  endOfLastMonthLocalKey,
  endOfMonth,
  formatCacheHit,
  formatDuration,
  formatThroughput,
  formatTtft,
  formatTtftSeconds,
  formatTokens,
  orderedGroups,
  startOfLastMonthLocalKey,
  startOfMonth,
  startOfMonthLocalKey,
  todayLocalKey,
  yesterdayLocalKey,
} from '../src/client/format.ts'

/** A group row with the averages already derived (the host computes them). */
function group(over: Partial<TokenUsageGroupView> & Pick<TokenUsageGroupView, 'provider' | 'model'>): TokenUsageGroupView {
  return {
    requests: 1,
    turns: 1,
    llmMs: 0,
    toolMs: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ttftMs: 0,
    ttftSamples: 0,
    decodeMs: 0,
    averageThroughput: null,
    averageTtftMs: null,
    averageLlmMs: null,
    cacheHitRatio: null,
    ...over,
  }
}

describe('token-usage format helpers', () => {
  it('renders token counts as compact numbers with K/M/B units, 0 for absent values', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_234)).toBe('1.2K')
    expect(formatTokens(2_000)).toBe('2K')
    expect(formatTokens(12_345)).toBe('12.3K')
    expect(formatTokens(1_234_567)).toBe('1.2M')
    expect(formatTokens(3_400_000)).toBe('3.4M')
    expect(formatTokens(1_500_000_000)).toBe('1.5B')
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(null)).toBe('0')
    expect(formatTokens(undefined)).toBe('0')
  })

  it('renders throughput with one decimal and a tokens/s suffix, — when absent', () => {
    expect(formatThroughput(group({ provider: 'p', model: 'm', averageThroughput: 134.105 }))).toBe('134.1 tokens/s')
    expect(formatThroughput(group({ provider: 'p', model: 'm' }))).toBe('—')
  })

  it('renders TTFT in ms, — when no sample was recorded', () => {
    expect(formatTtft(group({ provider: 'p', model: 'm', averageTtftMs: 4320.4 }))).toBe('4320 ms')
    expect(formatTtft(group({ provider: 'p', model: 'm' }))).toBe('—')
  })

  it('renders TTFT in seconds for summary cards', () => {
    expect(formatTtftSeconds(4320.4)).toBe('4.32 s')
    expect(formatTtftSeconds(2405)).toBe('2.40 s')
    expect(formatTtftSeconds(null)).toBe('—')
  })

  it('renders a compact duration, — when absent', () => {
    expect(formatDuration(812)).toBe('812ms')
    expect(formatDuration(45_200)).toBe('45.2s')
    expect(formatDuration(162_000)).toBe('2m42s')
    expect(formatDuration(null)).toBe('—')
  })

  it('renders cache-hit ratio as a percentage with one decimal, — when no billed input', () => {
    expect(formatCacheHit(group({ provider: 'p', model: 'm', cacheHitRatio: 0.7188 }))).toBe('71.9%')
    expect(formatCacheHit(group({ provider: 'p', model: 'm' }))).toBe('—')
  })

  it('orders per-(provider, model) groups by provider then model and excludes the totals row', () => {
    const summary: TokenUsageDailySummaryView = {
      date: '2026-08-10',
      groups: [
        group({ provider: 'zeta', model: 'z-1' }),
        group({ provider: 'alpha', model: 'a-2' }),
        group({ provider: 'alpha', model: 'a-1' }),
      ],
      totals: group({ provider: 'total', model: 'total' }),
    }
    const ordered = orderedGroups(summary)
    expect(ordered.map(g => `${g.provider}/${g.model}`)).toEqual(['alpha/a-1', 'alpha/a-2', 'zeta/z-1'])
    expect(ordered.find(g => g.provider === 'total')).toBeUndefined()
  })

  it('produces a YYYY-MM-DD local day key for the current instant', () => {
    expect(todayLocalKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(yesterdayLocalKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('resolves the browser zone as canonical UTC or IANA Area/Location', () => {
    const zone = browserTimeZone()
    expect(typeof zone).toBe('string')
    expect(zone.length).toBeGreaterThan(0)
    expect(zone).toMatch(/^(UTC|[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+)$/)
  })

  it('steps back the requested number of calendar days, crossing month and year boundaries', () => {
    expect(daysAgoLocalKey(0)).toBe(todayLocalKey())
    expect(daysAgoLocalKey(1)).toBe(yesterdayLocalKey())
    // 2026-08-10 minus 6 days is 2026-08-04; minus 11 days crosses into July.
    vi.useFakeTimers().setSystemTime(new Date(2026, 7, 10, 12, 0, 0))
    try {
      expect(daysAgoLocalKey(6)).toBe('2026-08-04')
      expect(daysAgoLocalKey(11)).toBe('2026-07-30')
      // Cross a year boundary.
      vi.setSystemTime(new Date(2026, 0, 3, 12, 0, 0))
      expect(daysAgoLocalKey(5)).toBe('2025-12-29')
    } finally {
      vi.useRealTimers()
    }
  })

  it('computes month boundaries from a date key', () => {
    expect(startOfMonth('2026-08-15')).toBe('2026-08-01')
    expect(endOfMonth('2026-08-15')).toBe('2026-08-31')
    expect(startOfMonth('2026-02-05')).toBe('2026-02-01')
    expect(endOfMonth('2026-02-05')).toBe('2026-02-28')
  })

  it('computes local month boundaries from the current instant', () => {
    const today = todayLocalKey()
    expect(startOfMonthLocalKey()).toBe(startOfMonth(today))
    expect(endOfLastMonthLocalKey()).toBe(endOfMonth(startOfLastMonthLocalKey()))
  })
})
