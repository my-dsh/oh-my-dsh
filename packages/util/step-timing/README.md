---
description: "Zero-dependency step-timing utility: elapsed and split timers for measuring agent-loop step durations."
kind: "package-reference"
---

# dsh-step-timing

English | [中文](README.zh.md)

## Summary

The pure timing fold of one agent-loop step: boundaries, first-token stamping, matched tool call→result wall time, message stamping, and nullable duration accessors. One zero-dependency library owns the algebra that `session-stats`'s whole-log projection and `token-usage`'s per-request capture previously implemented twice, so their TTFT and decode figures cannot drift apart.

## Table of Contents

- [API](#api)
- [Usage shape](#usage-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

Every function is **pure and reference-stable**: a fold that observes nothing returns the identical object, so projection change feeds can gate emissions with `Object.is`, and the plain-JSON state survives persisted-cache round trips. Tool pairing matches only the step's own pending keys — a provider-minted callId colliding with an `Object` prototype property reads as unmatched, never as an inherited member. Durations clamp negative clock skew to zero; decode time requires both the first-token and message stamps.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events. Usage guarding, route joins, turn/step counting, and record writes stay with consumers — those are durable-log or capture concerns, not timing mechanics.

## API

```ts
import { stepTimingDecodeMs, stepTimingLlmMs, stepTimingOnMessage, stepTimingOnToken, stepTimingOnToolCall, stepTimingOnToolResult, stepTimingOpen, stepTimingTtftMs, stepTimingWithoutPendingCalls } from '@deepseek-ai/dsh-step-timing'
```

| Export | Role |
|---|---|
| `stepTimingOpen(turn, step, startTime)` | Open one step's fold at its `step/start` instant. |
| `stepTimingOnToken(fold, time, tokenDelta)` | Stamp TTFT from the first token delta only; later deltas (including post-retry) return the same reference. |
| `stepTimingOnToolCall(fold, callId, time)` | Record a dispatch instant in the step's pending map. |
| `stepTimingOnToolResult(fold, callId, time)` | Pair against own pending keys, accrue clamped tool wall time, drop the entry; unmatched results return the same reference. |
| `stepTimingOnMessage(fold, time)` | Stamp the assembled-message instant once; duplicates return the same reference. |
| `stepTimingWithoutPendingCalls(fold)` | Drop unresolved dispatches (turn-end prune); no-op folds return the same reference. |
| `stepTimingLlmMs(fold)` / `stepTimingTtftMs(fold)` / `stepTimingDecodeMs(fold)` | Read clamped durations; null until their stamps exist (`llmMs` needs the message, `ttftMs` the first token, `decodeMs` both). |

## Usage shape

```ts
import { stepTimingDecodeMs, stepTimingLlmMs, stepTimingOnMessage, stepTimingOnToken, stepTimingOpen } from '@deepseek-ai/dsh-step-timing'

// One step's wall-time facts from controlled event times.
export function stepTimes(events: { at: number; kind: 'start' | 'token' | 'message' }[]): { llmMs: number | null; decodeMs: number | null } {
  let fold = stepTimingOpen(1, 1, events[0]?.at ?? 0)
  for (const event of events) {
    if (event.kind === 'token') fold = stepTimingOnToken(fold, event.at, true)
    if (event.kind === 'message') fold = stepTimingOnMessage(fold, event.at)
  }
  return { llmMs: stepTimingLlmMs(fold), decodeMs: stepTimingDecodeMs(fold) }
}
```

The fold stays open across the whole step — tools execute after the assistant message assembles, so results landing between `assistant/message` and `step/end` still accrue into `toolMs`.

## Model Experience

None, as the package folds caller-supplied timestamps into durations and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One open step per fold** — the primitive tracks exactly the current step's boundaries; whole-log accumulation, turn counting, and multi-step state machines stay with consumers.
- **Trusts consumer predicates** — "is this chunk a token delta" is decided by callers (the shared `isTokenDelta` helper), so an empty-delta policy change on the caller side changes TTFT here.
- **No retry semantics** — an in-step `llm/retry` never resets the first-token boundary by design, matching the client window fold; a different policy requires a new primitive, not an option flag.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events. Usage guarding, route joins, turn/step counting, and record writes stay with consumers — those are durable-log or capture concerns, not timing mechanics.

</details>
