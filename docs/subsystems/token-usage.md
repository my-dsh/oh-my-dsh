# Token Usage

English | [中文](token-usage.zh.md)

`@deepseek-ai/dsh-token-usage` persists per-request provider-reported usage from the session firehose into a SQLite-backed store (`ctx.tokenUsageStore`) and aggregates it into daily per-(provider, model) summaries. The capture fold mirrors `session-stats`'s timing boundaries (`step/start` → first token chunk → `assistant/message`) so the TTFT and decode durations agree with the session-scoped projection, and the route joins the assembled message's `source` (provider/model travel with the usage on `assistant/message`). The web dashboard consumes the daily summary over the wire; nothing here reaches a model request.

Source: [`packages/session/token-usage/src/types.ts`](../../packages/session/token-usage/src/types.ts)

## `TokenUsageEventRecord`

```ts type-equiv
/**
 * The persistable record of one successful provider model call's token
 * accounting, joined with the route that served it. One row per (session,
 * turn, step); written at append time by the provider-backed listener.
 *
 * The four token buckets are disjoint: `uncachedInputTokens` is uncached
 * prompt input only; `cacheReadTokens` / `cacheWriteTokens` are the cache
 * traffic reported alongside it; `outputTokens` already contains any
 * reasoning tokens and they are not added again. These mirror
 * {@link TokenUsageProjection} so the per-call record and the per-session
 * projection never diverge in vocabulary.
 */
interface TokenUsageEventRecord {
  /** Unix epoch milliseconds — the source event's append time. */
  time: number
  /** Calendar day in the aggregation locale (YYYY-MM-DD), derived from `time`. */
  date: string
  /** Stable session id that produced the request. */
  sessionId: string
  /** Provider route key that served the request (e.g. `deepseek`). */
  provider: string
  /** Provider-owned model id that served the request (e.g. `deepseek-chat`). */
  model: string
  /** Turn ordinal within the session. */
  turn: number
  /** Step ordinal within the turn. */
  step: number
  /** Uncached prompt-input tokens billed for the call. */
  uncachedInputTokens: number
  /** Output tokens (reasoning included, not added again). */
  outputTokens: number
  /** Cache-read tokens (cached prompt input). */
  cacheReadTokens: number
  /** Cache-write tokens (prompt input written to the KV cache). */
  cacheWriteTokens: number
  /** Reasoning tokens, when the provider reported them separately; null when folded into output. */
  reasoningTokens: number | null
  /** First-token latency in milliseconds, when the request recorded one; null otherwise. */
  ttftMs: number | null
  /** Step wall time from `step/start` to the assembled `assistant/message`, in milliseconds. */
  llmMs: number
  /** Tool wall time from `tool/call` to `tool/result` pairs that landed inside this step, in milliseconds. */
  toolMs: number
  /** Decode wall time in milliseconds, when output tokens and timing were recorded; null otherwise. */
  decodeMs: number | null
}
```

One row per (session, turn, step); the primary key is `(sessionId, turn, step)`, so a re-reported sample for the same step replaces rather than duplicates — matching `token-meter`'s replace-not-add semantics.

## `TokenUsageDailyGroup`

```ts type-equiv
/**
 * One (provider, model) row of a daily summary: the four disjoint token
 * buckets summed across every recorded call for that day, plus the
 * request-count denominators needed to derive averages client-side.
 *
 * Averages are NOT precomputed here on purpose: the consumer decides
 * weighting. `outputTokens` summed with `decodeMs` yields a weighted
 * throughput (tokens/sec); `ttftMs` summed with `ttftSamples` yields an
 * arithmetic mean TTFT; `cacheReadTokens` over the three input buckets
 * yields the cache-hit ratio. See the README for the exact definitions.
 */
interface TokenUsageDailyGroup {
  /** Provider route key. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Number of recorded calls for this (provider, model) on the day. */
  requests: number
  /** Distinct session turns that produced at least one recorded call for this (provider, model) on the day. */
  turns: number
  /** Summed step wall time (`step/start` → `assistant/message`) over this group's calls. */
  llmMs: number
  /** Summed matched tool call→result wall time over this group's calls. */
  toolMs: number
  /** Summed uncached prompt-input tokens. */
  uncachedInputTokens: number
  /** Summed output tokens (reasoning already included). */
  outputTokens: number
  /** Summed cache-read tokens. */
  cacheReadTokens: number
  /** Summed cache-write tokens. */
  cacheWriteTokens: number
  /** Summed first-token latency over calls that recorded one. */
  ttftMs: number
  /** Calls contributing to `ttftMs`. */
  ttftSamples: number
  /** Summed decode wall time over calls that recorded one. */
  decodeMs: number
}
```

## `TokenUsageDailySummary`

```ts type-equiv
/**
 * The complete response of a daily-summary query: the per-(provider, model)
 * groups plus the cross-group totals (the union of every group's sums, with
 * `requests` summed and TTFT/decode totals recomputed over the union).
 */
interface TokenUsageDailySummary {
  /** Calendar day the aggregates cover (YYYY-MM-DD). */
  date: string
  /** One row per (provider, model) active on the day, in stable (provider, model) order. */
  groups: readonly TokenUsageDailyGroup[]
  /** Cross-group totals, structured like one group but keyed by the sentinel `(total, total)`. */
  totals: TokenUsageDailyGroup
}
```

The `totals` row is the cross-group union (its `turns` is the union of each group's distinct-turn sums, so it may over-count an individual turn that spans more than one provider/model group). Averages are derived client-side so the consumer chooses weighting: throughput is `outputTokens / (decodeMs / 1000)`, TTFT is the arithmetic mean `ttftMs / ttftSamples`, and the cache-hit ratio is `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtokenusagestore--tokenusagestore"></a>

### `ctx.tokenUsageStore` — `TokenUsageStore`

The TokenUsageStore Service Definition contract: append per-request usage records (synchronous, called from the session firehose hot path — must not throw into the loop), and query the daily summary plus optional purge.

The append entry point is synchronous because it runs inside the `session/event` listener, which cordis dispatches stop-on-throw; the store absorbs its own write errors (logging a warning) and never rethrows.

```ts cordis-catalog
/**
 * Persist one per-request usage record. Synchronous and fail-contained:
 * the firehose listener must not propagate errors into the agent loop.
 * @param record - the per-request record; owned by the store after the call.
 */
append(record: TokenUsageEventRecord): void

/**
 * Aggregate every recorded call for one calendar day, grouped by
 * (provider, model), with cross-group totals. The day is bucketed in the
 * caller's time zone via each record's exact epoch `time`, not the
 * append-time `date` key, so the requested calendar day is authoritative
 * regardless of the writer's zone.
 * @param date - calendar day `YYYY-MM-DD`.
 * @param timeZone - UTC or IANA Area/Location name used to bound the day.
 * @returns the daily summary; an empty `groups` array when no records exist for the day.
 */
dailySummary(date: string, timeZone: string): TokenUsageDailySummary

/**
 * Aggregate every recorded call across a closed date range, grouped by
 * (provider, model), with cross-group totals. Both boundaries are bucketed
 * in the caller's time zone via each record's exact epoch `time`.
 * @param startDate - inclusive start calendar day `YYYY-MM-DD`.
 * @param endDate - inclusive end calendar day `YYYY-MM-DD`.
 * @param timeZone - UTC or IANA Area/Location name used to bound the range.
 * @returns the range summary; an empty `groups` array when no records exist in the range.
 */
dailySummaryRange(startDate: string, endDate: string, timeZone: string): TokenUsageDailySummary

/**
 * Drop every record whose `time` is strictly before `before`.
 * @param before - epoch milliseconds cutoff.
 * @returns the number of rows deleted.
 */
purge(before: number): number
```

Source: [`packages/session/token-usage/src/types.ts`](../../packages/session/token-usage/src/types.ts)
<!-- END GENERATED cordis-surface -->