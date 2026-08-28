# Agent Note: Fix session-attention pendingInteraction data flow and extract standalone bundle

Status: implemented

English | [中文](2026-08-28-session-attention-pending-interaction-fix.zh.md)

## Problem

The session-attention overlay never surfaced `approval` / `plan-review` / `question` rows at runtime — only `completed` reminders worked. The overlay's `selectAttention` read `row.pendingInteraction` from `SessionListState.byId`, but `projectList()` never populates that field: the host `SessionSummary` (in `types.ts`) has no `pendingInteraction` member, and `TitledSessionSummary` extends the host type, so `flattenLineage`'s spread never carries it. The field was a dead declaration on the client `SessionSummary` and `SessionListEntry` types — tests passed because they injected it directly into mock fixtures.

The feature was also not independently installable: unlike token-usage (which has a standalone bundle), the attention panel was inlined into `web-app/cordis.patch.yml` with no separate profile bundle.

## Decision

**Read pending interactions from the `useSessionPendingInteraction` standard hook, not `SessionListState`.** The overlay follows the same pattern as `ui-workspace`: call `useSessions(s => s)` and `useSessionPendingInteraction(s => s)` separately, merge the two snapshots in a `useMemo` calling `selectAttention(list, pending)`. `selectAttention` now accepts an optional `ReadonlyMap<SessionId, { kind: string }>` and maps domain kinds to the three attention statuses via `attentionKindOf` (mirroring ui-workspace's `visiblePendingKind`).

**Remove the dead `pendingInteraction?` fields** from the client `SessionSummary` (`service.ts`) and `SessionListEntry` (`lineage.ts`), and the now-unused `PendingInteractionStatus` import from `lineage.ts`. The `PendingInteractionStatus` type itself remains — `attention.ts` uses it for `AttentionKind`.

**Extract the panel into a standalone bundle** `@deepseek-ai/dsh-session-attention` with one `cordis.patch.yml` row (the client panel only — no host half, no Service Definition, no events). Remove the row from `web-app/cordis.patch.yml` and its `package.json` dependency. Install via `dsh plugin --profile <name> add @deepseek-ai/dsh-session-attention`.

## Consequences

The overlay now surfaces all four attention kinds (approval, plan-review, question, completed) at runtime. The two features (token-usage and session-attention) are both independently installable as profile bundles over any web-surface profile. A profile that mounts `@deepseek-ai/dsh-web-app` must not also install either bundle — the slot entry would register twice.

## Alternatives considered

**Populate `pendingInteraction` in `projectList()` by merging the pendingInteraction mux snapshot into the host list projection.** Rejected: the pending-interaction snapshot lives in the Client session controller's `pendingInteractions` observable (a ui-session provide contribution), not in the host list snapshot `projectList()` consumes. Duplicating it into `SessionListState.byId` would create a second source of truth that drifts from the authoritative `useSessionPendingInteraction` hook, and would require the session controller to subscribe to its own provide contribution inside `projectList`.

**Keep `pendingInteraction?` on the client `SessionSummary` type as a forward-looking declaration.** Rejected: the field was never populated, never read, and removing it surfaces any future accidental reads as a type error rather than a silent `undefined`.

## Related

- [Session-attention overlay](../feature/2026-08-22-session-attention-overlay.md) — the original feature note, now updated by this fix.
