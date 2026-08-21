# @deepseek-ai/dsh-client-token-usage

English | [中文](README.zh.md)

Token consumption dashboard for the web GUI. A floating action button pinned to the bottom-right of the shell opens a modal panel that shows the token usage of one calendar day, aggregated cross-session and grouped by `(provider, model)`: the four disjoint token buckets (uncached input, cache read, cache write, output), distinct turns, request count, average throughput (weighted tokens/sec), average TTFT (first-token latency), average LLM step time, matched tool wall time, and average cache-hit ratio. The panel carries a date picker (today by default) and a refresh action.

The plugin contributes one entry to the root-scoped `shell.overlay` list slot (owned and declared by `@deepseek-ai/dsh-client-ui-layout`), so the dashboard composes into every screen without owning a layout region. Data reaches the component solely through the inject face — the `tokenUsage` domain of the wire client (`api.tokenUsage.dailySummary({ date, timeZone })`) and the bound copy translator — never through `ctx`. The fetch lifecycle (loading / ready / error) and the selected date stay component-local: nothing here survives a remount or is read by another entry. The panel sends the browser zone (`browserTimeZone`) alongside each day it aggregates, so the host bounds that day by the same zone that derived its date keys.

The grouped rows are the per-`(provider, model)` aggregates; a cross-group totals row renders first, emphasized. Every displayed value is a pure function of the summary the host returns: throughput is `outputTokens / (decodeMs / 1000)` (decode-weighted), TTFT is the arithmetic mean `ttftMs / ttftSamples`, and the cache-hit ratio is `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`. The host derives those averages before they cross the wire, so the panel mirrors the host's definitions exactly. The cross-group total card sums all four buckets (billed tokens: uncached input plus cache reads and writes plus output), not uncached input plus output alone.

The aggregation itself lives in the host plugin `@deepseek-ai/dsh-token-usage` and its SQLite provider; this client package is presentation only.

## Model Experience

None, as the dashboard renders a browser statistics UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Day bucketing follows the browser zone** — the host plugin stored each record's `date` key in its own local timezone, so reads now bound by epoch time and re-bucket per the `timeZone` the panel supplies. The day the browser displays is authoritative: the host bounds that day by the same zone that derived its date keys. Offer a timezone control to let a viewer see a day in a zone other than their browser's has not yet been added, and a misconfigured or unknown zone falls back to a details failure on the panel.
- **Refresh is manual** — the panel fetches on open and on date change, and on the refresh action. There is no live push of usage deltas, since the dashboard is an on-demand statistic and not a streaming surface.
- **Purge is host-side only** — the wire exposes `tokenUsage.purge` for maintenance, but the panel performs no destructive action; a retention control is deferred until a deployment states a policy.
