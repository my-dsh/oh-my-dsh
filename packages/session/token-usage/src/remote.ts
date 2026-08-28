/**
 * The token-usage Remote service: exposes the `tokenUsageStore` query and
 * purge methods across the Typert Remote boundary as the `tokenUsage` wire
 * namespace (`ctx.remote.tokenUsage` on the Client). Each summary the store
 * returns is projected to the display view carrying derived averages, so
 * the Client renders pure data without re-deriving.
 *
 * The append hot path stays on the capture plugin (`apply` in `index.ts`);
 * this service owns only the read/purge surface the dashboard calls.
 *
 * @module @deepseek-ai/dsh-token-usage/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TokenUsageDailyGroup,
  TokenUsageDailySummary,
  TokenUsageDailySummaryView,
  TokenUsageGroupView,
  TokenUsagePurgeResult,
  TokenUsageStore,
} from './types.ts'

/**
 * Project one aggregated group into the display row by deriving the averages
 * the dashboard reads. Throughput is output tokens over decode seconds; TTFT
 * and LLM-step time are arithmetic means; cache-hit ratio is cache-read over
 * billed input. Each average is `null` when its denominator is zero so the
 * formatter renders `—` rather than `NaN`.
 * @param group - the summed (provider, model) group from the store.
 * @returns the group plus its four derived averages.
 */
function groupView(group: TokenUsageDailyGroup): TokenUsageGroupView {
  const averageThroughput = group.decodeMs > 0
    ? group.outputTokens / (group.decodeMs / 1000)
    : null
  const averageTtftMs = group.ttftSamples > 0
    ? group.ttftMs / group.ttftSamples
    : null
  const averageLlmMs = group.requests > 0
    ? group.llmMs / group.requests
    : null
  const billedInput = group.uncachedInputTokens + group.cacheReadTokens + group.cacheWriteTokens
  const cacheHitRatio = billedInput > 0
    ? group.cacheReadTokens / billedInput
    : null
  return { ...group, averageThroughput, averageTtftMs, averageLlmMs, cacheHitRatio }
}

/**
 * Project a full daily summary into the display view: every group plus the
 * cross-group totals row, each carrying derived averages.
 * @param summary - the store's aggregated summary.
 * @returns the summary with derived-average groups and totals.
 */
function summaryView(summary: TokenUsageDailySummary): TokenUsageDailySummaryView {
  return {
    date: summary.date,
    groups: summary.groups.map(groupView),
    totals: groupView(summary.totals),
  }
}

/**
 * Token-usage Remote service (`ctx.tokenUsageRemote`): the read/purge surface
 * of the `tokenUsageStore` projected to display views.
 */
export class TokenUsageRemoteService extends TypertRemoteService {
  static inject = ['tokenUsageStore']

  private readonly store: TokenUsageStore

  constructor(ctx: Context) {
    super(ctx, 'tokenUsage')
    this.store = ctx.tokenUsageStore
  }

  /**
   * Aggregate every recorded provider call for one calendar day, grouped by
   * (provider, model), with cross-group totals and derived averages. The day
   * is bounded in the caller's time zone by each record's epoch `time`.
   * @param date - calendar day `YYYY-MM-DD`.
   * @param timeZone - UTC or IANA Area/Location name bounding the day.
   * @returns the daily summary view; empty `groups` when no records exist.
   */
  @Remote('dailySummary')
  dailySummary(date: string, timeZone: string): TokenUsageDailySummaryView {
    return summaryView(this.store.dailySummary(date, timeZone))
  }

  /**
   * Aggregate every recorded provider call across a closed date range,
   * grouped by (provider, model), with cross-group totals and derived
   * averages. Both boundaries are bounded in the caller's time zone.
   * @param startDate - inclusive start calendar day `YYYY-MM-DD`.
   * @param endDate - inclusive end calendar day `YYYY-MM-DD`.
   * @param timeZone - UTC or IANA Area/Location name bounding the range.
   * @returns the range summary view; empty `groups` when no records exist.
   */
  @Remote('dailySummaryRange')
  dailySummaryRange(startDate: string, endDate: string, timeZone: string): TokenUsageDailySummaryView {
    return summaryView(this.store.dailySummaryRange(startDate, endDate, timeZone))
  }

  /**
   * Drop every record whose `time` is strictly before the cutoff.
   * @param before - epoch milliseconds cutoff.
   * @returns the number of rows deleted.
   */
  @Remote('purge')
  purge(before: number): TokenUsagePurgeResult {
    return { deleted: this.store.purge(before) }
  }
}

/** Typert Remote namespace contract typed for Client consumers. */
export interface TokenUsageRemote {
  dailySummary(date: string, timeZone: string): Promise<TokenUsageDailySummaryView>
  dailySummaryRange(startDate: string, endDate: string, timeZone: string): Promise<TokenUsageDailySummaryView>
  purge(before: number): Promise<TokenUsagePurgeResult>
}

export default TokenUsageRemoteService
