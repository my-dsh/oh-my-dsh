# Agent Note: Defer the token-usage record write to step/end to capture tool wall time

Status: implemented

English | [中文](2026-08-18-defer-token-usage-write-to-step-end.zh.md)

## Problem

The token-usage dashboard's 工具耗时 (tool time) column read `0` for every session. The capture fold (introduced by the [cross-session token-usage dashboard](../architecture/2026-08-12-cross-session-token-usage-dashboard.md)) wrote one `TokenUsageEventRecord` per request at the `assistant/message` boundary event, but the agent loop appends `assistant/message` before it dispatches tool calls (`executeToolCalls`, in `packages/core/agent-loop/src/agent.ts`). At message-assembly time `open.toolMs` is still `0`, so every persisted record carried `toolMs: 0` even for steps that ran long-lived tool calls. The `(session_id, turn, step)` primary key replaces rather than appends, so already-written rows stayed zero permanently; the dashboard therefore showed zero tool time for all history written before the fix, and the fix only helps records captured from then on.

## Decision

The capture fold now stashes the `assistant/message` facts (time, usage, provider, model) on the open step and defers the record write to `step/end`, which the loop emits in a `finally` after all tool results for the step have landed. `recordFromStashedStep` builds the record from the stashed message facts plus the open step's accumulated `toolMs` (`tool/call` → `tool/result` pairs by callId), TTFT, and decode time. A duplicate assembled message keeps the first stashed facts; a step whose message carries no usage still writes no record (its open step is cleared so no stray tool time is tracked); a torn step reaching `turn/end` without `step/end` is cleared without writing, so a partial record never leaks into a later step.

## Alternatives considered

**Extract a pure, exported fold and test it with synthetic `session/event` payloads.** Rejected as a wider API and a less faithful probe: the fix's guarantee is about live loop ordering, so the accompanying test drives a real session through `Session.append` and asserts the observed record, rather than a standalone pure function with invented event times.

**Write the record at `tool/result` for the last in-flight call of the step.** Rejected: the capture fold cannot know when a step's calls are complete without the `step/end` boundary, and it would need to buffer or guess.

## Consequences

Records captured after this change carry real tool wall time, matching the dashboard's summed `toolMs` column; before it they carry `toolMs: 0`. The `assistant/message` append time is still the record's `time` (the routing join is preserved), so daily bucketing and TTFT/decode semantics are unchanged. Existing zero rows are not rewritten.

The capture deferral is pinned by `packages/session/token-usage/tests/capture.spec.ts`, which mounts the plugin beside a real session store and a fake `tokenUsageStore`, appends a full step with a tool pair, and asserts nonzero, exact `toolMs`, `llmMs`, `ttftMs`, and `decodeMs`.