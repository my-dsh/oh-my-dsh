# @deepseek-ai/dsh-token-usage

English | [中文](README.zh.md)

Cross-session token-usage persistence: a SQLite-backed `TokenUsageStore` Service Definition that captures per-request provider-reported usage from the session firehose for daily, per-(provider, model) aggregation. The capture side folds step boundaries through the shared `@deepseek-ai/dsh-step-timing` primitives (`step/start` → first token chunk → `assistant/message`) — the same ones `session-stats` consumes, so the TTFT and decode durations agree with the session-scoped projection — and joins the route from the assembled message's `source` (provider/model travel with the usage on `assistant/message`).

## Composition

```yaml
- name: '@deepseek-ai/dsh-token-usage/sqlite-provider'
  config:
    path: !!js dshHomePath('token-usage.db')
- name: '@deepseek-ai/dsh-token-usage'
```

The `sqlite-provider` entry opens (or creates) the database and registers one `SqliteTokenUsageStore` as the `tokenUsageStore` cordis service; the default entry injects that service and registers the `session/event` capture listener. Both plugins have usable defaults; the provider's `path` is the only required configuration.

## The store contract

`ctx.tokenUsageStore` exposes three operations:

- `append(record)` persists one per-call record. Synchronous and fail-contained: it runs inside the `session/event` listener, which cordis dispatches stop-on-throw, so a write failure is logged and swallowed — never propagated into the agent loop.
- `dailySummary(date, timeZone)` aggregates every recorded call for one calendar day (`YYYY-MM-DD` in `timeZone`, a UTC or IANA name), grouped by (provider, model), with cross-group totals; the store bounds the query by the day's epoch `time` window in that zone.
- `dailySummaryRange(startDate, endDate, timeZone)` aggregates every record across the half-open day range in `timeZone`.
- `purge(before)` drops every record whose `time` is strictly before the epoch-millisecond cutoff; returns the number of rows deleted. Default retention is unlimited — the store never auto-expires data.

## The per-call record

One row per (session, turn, step): `time`, `date`, `sessionId`, `provider`, `model`, `turn`, `step`, the four disjoint token buckets (`uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`), optional `reasoningTokens`, and the timing facts `ttftMs`, `llmMs` (step wall time from `step/start` to the assembled `assistant/message`), `toolMs` (matched `tool/call` → `tool/result` wall time landed inside the step), and `decodeMs` (null when the step never produced a first token). The primary key is `(sessionId, turn, step)`, so a re-reported sample for the same step replaces rather than duplicates — matching `token-meter`'s replace-not-add semantics.

## The daily summary

`dailySummary(date, timeZone)` returns `{ date, groups, totals }`. Each group sums the four token buckets, counts `requests` and distinct `turns`, sums the `llmMs` / `toolMs` durations, and carries the TTFT/decode totals plus their sample counts. The `totals` row is the cross-group union (its `turns` is the union of each group's distinct-turn sums, so it may over-count an individual turn that spans more than one provider/model group). Averages are derived client-side so the consumer chooses weighting:

- **Average throughput** (tokens/sec) = `outputTokens / (decodeMs / 1000)`, a weighted mean that resists being skewed by a single fast small request.
- **Average TTFT** = `ttftMs / ttftSamples`, an arithmetic mean (each request's first-token wait is equally significant to the user).
- **Cache-hit ratio** = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`, a billed-input-weighted ratio.

## Schema versioning

The database carries its own monotonic `SCHEMA_VERSION` (currently 3), independent of the session-persistence schema. An empty database initializes at the current version; every other version rejects rather than migrating in place (pre-release stance: backends reject old on-disk formats). The `(time)` index serves both summary reads and `purge`, which all bound rows by epoch `time`; the append-time `date` column stays write-only metadata.

## Model Experience

None, as the package only observes the session stream and persists provider-reported accounting; it never contributes to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Write-only `date` column** — the writer keys each row's `date` in its own local time zone, but every read and purge bounds rows by the epoch `time` window in the caller's zone, so the column is never consulted by shipped queries; dropping it waits for the next breaking schema change.
- **No retention policy** — the store never auto-deletes; growth is bounded by `purge()` calls. Automatic daily retention is deferred until a deployment states a volume requirement.
