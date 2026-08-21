# Agent Note: Shared zoned-time wall-clock primitive

Status: implemented

English | [中文](2026-08-20-shared-zoned-time-primitive.zh.md)

## Problem

Transition-safe resolution of a local wall-clock value to an epoch instant existed twice: `resolveLocalInstant` in `@deepseek-ai/dsh-schedule` (schedule rule targets, with overlap/gap error identities) and the private midnight scanner in `@deepseek-ai/dsh-token-usage` (`localDayWindow` for summary reads). Both implemented the same algorithm — `Intl` long-offset parsing, offset sampling around the UTC-shaped guess, exact field-by-field projection verification — and stayed in sync only through a comment that said "mirrors the schedule package". Any change to one side silently risked diverging day boundaries or rule targets.

## Decision

A zero-dependency library package, [`@deepseek-ai/dsh-zoned-time`](../../../../packages/util/zoned-time), owns the algorithm once as `resolveZonedWallClock(timeZone, wallClock)`: it returns every ascending exact instant whose projection reproduces the requested wall clock, plus an `outOfRange` flag for matches dropped solely by the four-digit-year bounds. Consumers layer their own semantics on top:

- Schedule keeps `calendarEpoch` validation and its typed `ScheduleInputError` codes; a gap rejects with `invalid_rule`, an out-of-range match with `time_out_of_range`, and an overlap takes the earliest instant.
- Token-usage keeps day-window arithmetic in `localDayWindow`; a missing boundary instant fails loud with its own message.

The earliest-instant-wins overlap convention now has one home — the primitive's contract — instead of two implementations that happened to agree. Sampling also widens from token-usage's ±24h to ±48h, which covers every real IANA offset magnitude.

## Testing

- `packages/util/zoned-time/tests/zoned-time.spec.ts`: UTC and fixed-offset midnights, explicit millisecond fields, a spring-forward gap returning no instants, a fall-back overlap returning both instants ascending, out-of-range rejections at both four-digit-year bounds via fixed-offset `Etc/GMT±N` zones, non-real dates, non-finite fields, and a loud unsupported-zone failure.
- The schedule domain suite passes unchanged, pinning gap/overlap/out-of-range behavior through the new primitive.
- The token-usage store suite passes unchanged for aggregation and time-zone bucketing.

## Alternatives considered

- **Token-usage depends on `@deepseek-ai/dsh-schedule`** — rejected: schedule is a capability package whose peers drag agent, session, and tool dependencies into a stats package for one private function.
- **Keep both copies with cross-linking comments** — rejected: the duplication already existed and could only drift silently; a comment is not a shared contract.
- **Adopt a Temporal-based implementation** — rejected: `Temporal` is unavailable across the supported engines range; the `Intl`-projection approach remains the platform-supported mechanism.

## Consequences

- One home owns offset sampling, projection verification, and range bounds; schedule and token-usage each deleted their private copies.
- New consumers needing exact zoned instants call the primitive instead of reimplementing the scan.
- The token-usage store's `(time)` index correction ships in the same change and is recorded in the [dashboard note](2026-08-12-cross-session-token-usage-dashboard.md).
