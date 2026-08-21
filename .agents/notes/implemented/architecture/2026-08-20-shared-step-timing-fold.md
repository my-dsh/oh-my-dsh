# Agent Note: Shared step-timing fold

Status: implemented

English | [中文](2026-08-20-shared-step-timing-fold.zh.md)

## Problem

Two consumers folded identical agent-loop step timing from `session/event` streams with independent state machines: `@deepseek-ai/dsh-session-stats`'s whole-log projection and `@deepseek-ai/dsh-token-usage`'s per-request capture. Both implemented first-token stamping, own-key `tool/call` → `tool/result` pairing, clamped wall-time math, and duplicate-message guards, and a comment on each side claimed agreement with the other. The token-usage capture also deferred its record write to `step/end` while session-stats closed its open boundary at `assistant/message`, so the "same" fold had drifted into two shapes that only tests kept honest.

## Decision

A zero-dependency library package, [`@deepseek-ai/dsh-step-timing`](../../../../packages/util/step-timing), owns one pure fold per open step (`StepTimingFold` plus `stepTiming*` functions): boundaries, first-token stamp, matched tool pairs inside the step, message stamping, pending-call pruning, and nullable duration accessors. Every function returns the identical reference when nothing changed, so `Object.is` change-feed gating keeps working, and the plain-JSON state survives persisted-cache round trips.

Both consumers now delegate their timing arithmetic:

- **session-stats** keeps turn/step counting, usage guarding, and totals accrual (model time at message assembly, tool time at each result — the moments its change feed has always emitted). Its persisted fold state changes shape (`pendingCalls` move inside the open step), so `stateVersion` bumps 1 → 2 and old cache rows recompute; the wire view is unchanged.
- **token-usage** keeps the usage/route stash and the `step/end` record write; the stash exists exactly when the fold stamped its message, which is what the write guard checks.

The fold stays open until `step/end` in both consumers, so tool results landing after `assistant/message` accrue everywhere; session-stats previously paired such late results through a top-level pending map, whose leftover-pruning at turn/end becomes per-step scoping with identical outcomes.

## Testing

- `packages/util/step-timing/tests/step-timing.spec.ts`: reference stability on no-op folds, first-token-wins across retries, out-of-order pairing by callId, prototype-name callId safety, clock-skew clamping, duplicate-message identity, decode requiring both stamps, and turn-end pruning.
- The full session-stats suite passes unchanged — including the pinned regressions (cancelled step counts untimed, max-tokens host message adds no step), reference-identity expectations, and the real-composition loader test.
- The full token-usage capture and store suites pass unchanged, as do the ui-conversation consumer suites over the unchanged wire view.

## Alternatives considered

- **Move session-stats' boundary close to `step/end` and drop the top-level pending map without a shared package** — rejected: it fixes only one of the two copies and leaves the token-usage side hand-mirroring again.
- **Fold usage and route joins into the shared primitive** — rejected: usage guarding is a durable-log input concern unique to projections and the route join belongs to capture; sharing them would couple the primitive to model vocabulary.
- **Have token-usage read session-stats' projection instead of folding** — rejected: projections are session-scoped read models, while capture needs one durable cross-session row per request keyed by `(sessionId, turn, step)`; deriving rows from another unit's totals would lose the per-request granularity.

## Consequences

- One home owns step timing algebra; the two event-fold implementations that could silently drift are gone, and a future consumer (for example an OTel span backend) inherits tested boundaries instead of copying them.
- session-stats persisted caches written before this change are invalidated once by the `stateVersion` bump and rebuilt from the log.
- The [token-usage dashboard note](2026-08-12-cross-session-token-usage-dashboard.md)'s "mirrors session-stats" wording is superseded by the shared fold; that note's storage facts remain authoritative.
