# @deepseek-ai/dsh-client-token-usage

English | [中文](README.zh.md)

Token consumption dashboard for the web GUI. A floating action button pinned to the bottom-right of the shell opens a modal panel that shows the token usage of one calendar day, aggregated cross-session and grouped by `(provider, model)`: summed input and output tokens, request count, average throughput (weighted tokens/sec), average TTFT (first-token latency), and average cache-hit ratio. The panel carries a date picker (today by default) and a refresh action.

The plugin contributes one entry to the root-scoped `shell.overlay` list slot (owned and declared by `@deepseek-ai/dsh-client-ui-layout`), so the dashboard composes into every screen without owning a layout region. Data reaches the component solely through the inject face — the `tokenUsage` domain of the wire client (`api.tokenUsage.dailySummary({ date })`) and the bound copy translator — never through `ctx`. The fetch lifecycle (loading / ready / error) and the selected date stay component-local: nothing here survives a remount or is read by another entry.

The grouped rows are the per-`(provider, model)` aggregates; a cross-group totals row renders first, emphasized. Every displayed value is a pure function of the summary the host returns: throughput is `outputTokens / (decodeMs / 1000)` (decode-weighted), TTFT is the arithmetic mean `ttftMs / ttftSamples`, and the cache-hit ratio is `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`. The host derives those averages before they cross the wire, so the panel mirrors the host's definitions exactly.

The aggregation itself lives in the host plugin `@deepseek-ai/dsh-token-usage` and its SQLite provider; this client package is presentation only.

## Model Experience

None, as the dashboard renders a browser statistics UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Day bucketing uses local timezone** — the host plugin buckets records by calendar day in the local timezone; the panel sends the day it wants aggregated rather than re-bucketing client-side, so the two can never disagree.
- **Refresh is manual** — the panel fetches on open and on date change, and on the refresh action. There is no live push of usage deltas, since the dashboard is an on-demand statistic and not a streaming surface.
- **Purge is host-side only** — the wire exposes `tokenUsage.purge` for maintenance, but the panel performs no destructive action; a retention control is deferred until a deployment states a policy.
