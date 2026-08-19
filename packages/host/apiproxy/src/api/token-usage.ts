/**
 * token-usage domain contract: cross-session per-(provider, model) daily
 * aggregation backed by the `tokenUsageStore` Service Definition. Method
 * signatures are the source of truth; payload/value types are derived via
 * RequestPayload / ResponseValue.
 *
 * @module @deepseek-ai/dsh-host-apiproxy/api/token-usage
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type {
  TokenUsageDailyGroup,
} from '@deepseek-ai/dsh-token-usage/types'

export type { TokenUsageDailyGroup, TokenUsageDailySummary } from '@deepseek-ai/dsh-token-usage/types'

/** One (provider, model) group plus its derived averages — the client display row. */
export interface TokenUsageGroupView extends TokenUsageDailyGroup {
  /** Weighted throughput in tokens/sec (outputTokens / (decodeMs / 1000)); null when decodeMs is 0. */
  averageThroughput: number | null
  /** Arithmetic mean TTFT in ms (ttftMs / ttftSamples); null when ttftSamples is 0. */
  averageTtftMs: number | null
  /** Arithmetic mean step wall time in ms (llmMs / requests); null when requests is 0. */
  averageLlmMs: number | null
  /** Cache-hit ratio in [0,1] (cacheReadTokens / billed input); null when billed input is 0. */
  cacheHitRatio: number | null
}

/** The complete daily-summary response: groups plus the cross-group totals view. */
export interface TokenUsageDailySummaryView {
  /** Calendar day the aggregates cover (YYYY-MM-DD). */
  date: string
  /** One row per (provider, model) active on the day, in stable (provider, model) order. */
  groups: readonly TokenUsageGroupView[]
  /** Cross-group totals, keyed by the sentinel `(total, total)`. */
  totals: TokenUsageGroupView
}

/** Token-usage-domain unary methods (the map keys tokenUsage.* of RpcMethodMap). */
export interface TokenUsageApi {
  /**
   * Aggregate every recorded provider call for one calendar day, grouped by
   * (provider, model), with cross-group totals and derived averages. The day
   * is bounded in the caller's time zone by each record's epoch `time`, so
   * the calendar day the browser displays is authoritative.
   * @param request - the day (`YYYY-MM-DD`) and the UTC/IANA zone bounding it.
   * @returns the daily summary; empty `groups` when no records exist for the day.
   */
  dailySummary(request: RpcRequest<{ date: string; timeZone: string }>): Promise<RpcResponse<TokenUsageDailySummaryView>>

  /**
   * Aggregate every recorded provider call across a closed date range,
   * grouped by (provider, model), with cross-group totals and derived
   * averages. Both boundaries are bounded in the caller's time zone.
   * @param request - the inclusive start and end calendar days (`YYYY-MM-DD`) and the UTC/IANA zone bounding them.
   * @returns the range summary; empty `groups` when no records exist in the range.
   */
  dailySummaryRange(
    request: RpcRequest<{ startDate: string; endDate: string; timeZone: string }>,
  ): Promise<RpcResponse<TokenUsageDailySummaryView>>

  /**
   * Drop every record whose `time` is strictly before the cutoff.
   * @param request - the epoch-millisecond cutoff.
   * @returns the number of rows deleted.
   */
  purge(request: RpcRequest<{ before: number }>): Promise<RpcResponse<{ deleted: number }>>
}
