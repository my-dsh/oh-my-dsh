---
description: "Zero-dependency zoned-time utility: local-timezone day bucketing and formatting for token-usage aggregation."
kind: "package-reference"
---

# dsh-zoned-time

English | [中文](README.zh.md)

## Summary

Transition-safe resolution of a local wall-clock value to exact epoch instants in an IANA time zone. One zero-dependency function, `resolveZonedWallClock`, owns the algorithm that schedule rule targets and token-usage day windows previously duplicated.

## Table of Contents

- [API](#api)
- [Usage shape](#usage-shape)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

A fall-back overlap yields two instants and the earliest one is the documented convention (the first occurrence of the repeated wall clock); a spring-forward gap over the requested value yields none. Every instant stays inside the four-digit-year representable range; a match dropped only by that range is reported through `outOfRange` instead.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events. Error identities stay with the callers — schedule maps the outcomes onto its typed `ScheduleInputError` codes, token-usage fails loud with its own message — because gap and range policies are consumer vocabulary, not resolution mechanics.

No invariant companion is published because this pure utility owns no event stream or mutable runtime data; its resolution algebra is enforced by unit tests against real zone transitions.

## API

```ts
import { resolveZonedWallClock } from '@deepseek-ai/dsh-zoned-time'
```

| Export | Role |
|---|---|
| `resolveZonedWallClock(timeZone, wallClock)` | Return `{ instants, outOfRange }` for the requested local fields (`year`, 1-based `month`, `day`, optional `hour`/`minute`/`second`/`millisecond` defaulting to zero). `instants` is ascending; it is empty when no instant projects back (a transition gap, a non-real calendar value such as February 30, or only out-of-range matches). Throws when `timeZone` is unsupported or the platform exposes no usable UTC offset. |
| `ZonedWallClock` | The requested local fields. |
| `ZonedResolution` | The ascending exact instants plus the four-digit-year rejection flag. |

## Usage shape

```ts
import { resolveZonedWallClock } from '@deepseek-ai/dsh-zoned-time'

// The epoch window of one calendar day in the caller's zone.
export function dayWindow(timeZone: string, year: number, month: number, day: number): { start: number; end: number } {
  const midnight = (y: number, m: number, d: number): number => {
    const instant = resolveZonedWallClock(timeZone, { year: y, month: m, day: d }).instants[0]
    if (instant === undefined) throw new Error(`no local midnight in ${timeZone} for ${y}-${m}-${d}`)
    return instant
  }
  return { start: midnight(year, month, day), end: midnight(year, month + 1, day) }
}
```

Callers pass validated integer calendar fields; a non-real or non-finite value produces an empty result rather than an exception from inside `Intl`. Offsets are sampled ±48h around the guess so any real transition adjacent to the value contributes a candidate.

## Model Experience

None, as the package resolves caller-supplied fields into epoch instants and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Platform tzdata bounds correctness** — resolution trusts the runtime's ICU zone database; a stale ICU can misplace historical transitions, and there is no bundled zone data to fall back on.
- **Four-digit-year domain** — instants outside `0001-01-01T00:00:00.000Z` … `9999-12-31T23:59:59.999Z` are never returned, only flagged through `outOfRange`.
- **No parsing or formatting** — the package resolves fields it is given; reading user input into `ZonedWallClock` and rendering instants back to text stay with callers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events. Error identities stay with the callers — schedule maps the outcomes onto its typed `ScheduleInputError` codes, token-usage fails loud with its own message — because gap and range policies are consumer vocabulary, not resolution mechanics.

</details>
