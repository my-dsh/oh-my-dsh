---
description: "Token consumption dashboard for the web GUI: a floating button opening a modal panel showing daily cross-session token usage aggregated by provider and model."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-token-usage

English | [中文](README.zh.md)

## Summary

Token consumption dashboard for the web GUI. A floating action button pinned to the bottom-right of the shell opens a modal panel that shows the token usage of one calendar day, aggregated cross-session and grouped by `(provider, model)`: the four disjoint token buckets, distinct turns, request count, average throughput, TTFT, LLM step time, and cache-hit ratio. The aggregation lives in the host plugin `@deepseek-ai/dsh-token-usage`; this client package is presentation only.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

The plugin contributes one entry to the root-scoped `shell.overlay` list slot (owned and declared by `@deepseek-ai/dsh-client-ui-layout`), so the dashboard composes into every screen without owning a layout region. Data reaches the component solely through the inject face — the `tokenUsage` domain of the wire client and the bound copy translator — never through `ctx`. The fetch lifecycle (loading / ready / error) and the selected date stay component-local: nothing here survives a remount or is read by another entry. The panel sends the browser zone (`browserTimeZone`) alongside each day it aggregates, so the host bounds that day by the same zone that derived its date keys.

The grouped rows are the per-`(provider, model)` aggregates; a cross-group totals row renders first, emphasized. Every displayed value is a pure function of the summary the host returns: throughput is `outputTokens / (decodeMs / 1000)` (decode-weighted), TTFT is the arithmetic mean `ttftMs / ttftSamples`, and the cache-hit ratio is `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`. The host derives those averages before they cross the wire, so the panel mirrors the host's definitions exactly. The cross-group total card sums all four buckets (billed tokens: uncached input plus cache reads and writes plus output), not uncached input plus output alone.

No invariant companion is published because the dashboard is a browser-side pure presentation (FAB + panel) registering into a slot owned by another package; it emits no cordis events and owns no cross-plugin mutable state, and its disposal is proven by the slot registration's HMR-safety test.

<a id="model-experience"></a>
## Model Experience

None, as the dashboard renders a browser statistics UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Day bucketing follows the browser zone** — the host plugin stored each record's `date` key in its own local timezone, so reads now bound by epoch time and re-bucket per the `timeZone` the panel supplies. The day the browser displays is authoritative: the host bounds that day by the same zone that derived its date keys. Offer a timezone control to let a viewer see a day in a zone other than their browser's has not yet been added, and a misconfigured or unknown zone falls back to a details failure on the panel.
- **Refresh is manual** — the panel fetches on open and on date change, and on the refresh action. There is no live push of usage deltas, since the dashboard is an on-demand statistic and not a streaming surface.
- **Purge is host-side only** — the wire exposes `tokenUsage.purge` for maintenance, but the panel performs no destructive action; a retention control is deferred until a deployment states a policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The panel reads the `tokenUsage` wire domain through the inject face (`api.tokenUsage.dailySummary({ date, timeZone })`), not through `ctx`. The fetch lifecycle and selected date are component-local; no store or cross-entry state is declared.

</details>
