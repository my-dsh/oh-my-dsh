# Agent Note: Cross-session token-usage dashboard

Status: implemented

English | [中文](2026-08-12-cross-session-token-usage-dashboard.zh.md)

## Problem

Users need visibility into their token consumption across sessions. The existing `dsh-token-meter` plugin measures per-session pressure for compaction decisions, but there is no cross-session aggregation or web UI surface for consumption analysis. Operators and developers want to answer: how many tokens did I use today, broken down by provider and model, with average throughput and cache-hit ratios?

The data must survive session teardown (unlike in-memory projections), aggregate across all active sessions without scanning session logs, and present in the web GUI without polluting the session log or agent loop.

## Decision

### Three-delivery architecture: host plugin + RPC transport + client plugin

The feature splits into three packages, each following the repo's capability-seam pattern:

1. **Host plugin** (`@deepseek-ai/dsh-token-usage`, `packages/session/token-usage/`) — the Service Definition (`TokenUsageStore`) plus its independent SQLite provider and a `session/event` listener that appends one per-request usage record. This is the durable fact source.

2. **Centralized RPC transport extension** (`packages/host/apiproxy/`) — three unary methods (`tokenUsage.dailySummary`, `tokenUsage.dailySummaryRange`, and `tokenUsage.purge`) added to the existing apiproxy layer, following the documented extension point: one new file pair + one field on `ApiProxy` + one map row.

3. **Client plugin** (`@deepseek-ai/dsh-client-token-usage`, `packages/client/token-usage/`) — a floating action button (FAB) and modal panel contributed to the root-scoped `shell.overlay` list slot, showing the daily summary grouped by (provider, model).

4. **Aggregation bundle** (`@deepseek-ai/dsh-token-usage-dashboard`, `packages/bundle/token-usage-dashboard/`) — a profile patch-layer inserting the host-side listener + SQLite provider over any profile.

### SQLite store with independent database

The store owns its own SQLite database file (not shared with session-persistence or session-query), with a monotonic `SCHEMA_VERSION = 2` and application id `0x44535455` ('DSTU'). This isolation means the store's schema evolution never couples to session persistence or any other SQLite consumer.

The `token_usage_events` table stores one row per (session, turn, step) with a `PRIMARY KEY (session_id, turn, step)` and an index on `(date, provider, model)`. The `INSERT ... ON CONFLICT DO UPDATE` pattern means re-appending a record for the same (session, turn, step) replaces rather than duplicates — the host's session-event replay semantics already guarantee idempotent event delivery. Summary reads bound the query by each record's exact epoch `time` window in the caller-supplied time zone (`dailySummary(date, timeZone)`) rather than by the append-time `date` key, so they scan the small table without using the `date` index; a `time` index is deferred until a deployment demonstrates growth that warrants it.

### Session-event listener mirrors session-stats projection timing

The listener attaches to `ctx.on('session/event')` and tracks open (turn, step) state per session via a WeakMap. It captures `step/start` → first `assistant/chunk` (for TTFT timing) → `assistant/message` (for usage + provider/model join). This is the same timing fold as `session-stats`'s projection: the first assistant/message with a `usage` field is the single join point where token buckets and route identity co-exist.

The `append()` call is fail-contained: it catches write errors and logs a warning, never propagating into the cordis `session/event` dispatch (which is stop-on-throw).

### Wire averages are derived, not stored

The host computes three derived averages before the data crosses the wire:

- **Throughput**: `outputTokens / (decodeMs / 1000)` — decode-weighted tokens/sec, not request-count-averaged. This weights toward requests that actually produced output.
- **TTFT**: arithmetic mean `ttftMs / ttftSamples` — only calls that recorded a TTFT contribute.
- **Cache-hit ratio**: `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` — the three input buckets sum to billed input.

The client renders these values verbatim without re-deriving.

### Client plugin uses shell.overlay with component-local state

The FAB + panel contribute to the `shell.overlay` list slot (owned by ui-layout) via `ctx.slots.inject('shell.overlay', () => ctx.slots.register(...))`. The panel's fetch lifecycle (loading/ready/error) and selected date are component-local: nothing here survives a remount or is read by another entry, which matches the slot-system live-data discipline (rule 5: "only the component knows it → local state").

The inject face returns `{ api, t }` — the wire client's `tokenUsage` domain and the bound locale translator. The component never sees `ctx`.

### Fixture data for development and testing

The connection fixture (`fixture.ts`) returns a fixed two-group daily summary (deepseek-chat + deepseek-reasoner) with computed totals, so the dashboard renders a populated table in dev mode and fixture-driven tests without a running host.

## Testing

- **Host store unit test** (`packages/session/token-usage/tests/store.spec.ts`): covers cross-group aggregation, empty-day response, upsert semantics, purge, and application-id stamping. Uses a temp directory per test with automatic cleanup.
- **Client format unit test** (`packages/client/token-usage/tests/format.client.spec.ts`): covers all formatting helpers (token counts, throughput, TTFT, cache-hit ratio, ordering, today's UTC key) as pure functions.
- **Typecheck aggregates**: both `tsconfig.host.json` and `tsconfig.client.json` pass with 0 errors.
- **Lint**: oxlint passes with 0 warnings and 0 errors across all new and modified files.
- **Fixture FakeApiClient stubs**: both `connection/tests/fake-api.client.ts` and `runtime/tests/fake-api.client.ts` updated with `tokenUsage` members; both apiproxy test fixtures (`client-handler.spec.ts`, `fetch-carrier.spec.ts`) updated.

## Alternatives considered

- **Scan session logs at query time** — rejected because it requires loading and folding every session's event log for each dashboard refresh, which is O(total-sessions × events-per-session). The append-time aggregation keeps queries O(groups-per-day).
- **Use session-persistence's SQLite database** — rejected because the token-usage schema is independent and evolves separately. Sharing a database couples migration timelines and increases the blast radius of a schema change.
- **Client-side aggregation from session telemetry** — rejected because it would require every browser tab to hold all session data in memory, and the data would be lost on page refresh. The host is the authoritative source.
- **Store precomputed averages** — rejected because the store's contract is to store raw sums; consumers decide weighting. The host's `tokenUsageGroupView` helper derives averages at read time, keeping the store schema stable when averaging semantics change.
- **Component-local store factory** — rejected because the panel's data is component-local (not shared across entries, doesn't survive remounts). A `createXXXStore()` factory adds ceremony without benefit for a self-contained on-demand fetch.

## Consequences

- Token consumption is queryable cross-session without scanning logs. The append-time hot path costs one synchronous SQLite insert per successful model call.
- The independent database means the token-usage store can be backed up, purged, or moved independently. The `tokenUsage.purge(before?)` method handles retention.
- The client panel composes into every screen via `shell.overlay` without owning a layout region. It fetches on demand and shows nothing until the user clicks the FAB.
- Day bucketing follows the caller's time zone: the writer keys each row's `date` in its own local zone, and summary reads re-bucket by the caller-supplied `timeZone` through each record's exact epoch `time` window, so the requested calendar day is authoritative regardless of the writer's zone. These reads scan the small table without an index, an accepted tradeoff until a deployment demonstrates growth.
- The feature is opt-in at the profile level via the `token-usage-dashboard` bundle. The default `dsh web` composition includes it via the web-app bundle's patch.
