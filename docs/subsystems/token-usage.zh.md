# Token 用量

[English](token-usage.md) | 中文

`@deepseek-ai/dsh-token-usage` 将会话事件流中的按请求提供方上报用量持久化到 SQLite 存储（`ctx.tokenUsageStore`），并按 (provider, model) 聚合成每日汇总。捕获折叠与 `session-stats` 的计时边界一致（`step/start` → 首个 token chunk → `assistant/message`），因此 TTFT 与 decode 时长与会话作用域投影一致；路由取自组装完成的 `assistant/message` 的 `source`（provider/model 随 usage 一起传递）。Web 仪表盘通过 wire 消费每日汇总；此包不触及任何模型请求。

来源：[`packages/session/token-usage/src/types.ts`](../../packages/session/token-usage/src/types.ts)

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

每 (session, turn, step) 一行；主键为 `(sessionId, turn, step)`，因此同一 step 的重复上报会替换而非追加——与 `token-meter` 的 replace-not-add 语义一致。

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

`totals` 行是跨组并集（其 `turns` 是各组去重 turn 数之和，因此可能高估一个跨多个 provider/model 组的 turn）。平均值在客户端推导，由消费方选择加权方式：吞吐量 = `outputTokens / (decodeMs / 1000)`，TTFT 为算术均值 `ttftMs / ttftSamples`，缓存命中率 = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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