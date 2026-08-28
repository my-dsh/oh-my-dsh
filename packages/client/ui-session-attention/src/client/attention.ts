/**
 * Pure selection of the "attention" rows this overlay surfaces, derived from
 * the standard {@link SessionListState} plus the pending-interaction
 * snapshot. The session list carries `completed` (the green "done" reminder);
 * pending interactions (approval / plan-review / question) arrive on a
 * separate standard hook — {@link selectAttention} merges the two so the
 * caller drives both feeds through one pure derivation.
 *
 * The selector returns a plain, sorted array so a snapshot selector hook can
 * compare two derivations by value (see {@link attentionRowsKey}) without
 * touching React or the canvas.
 */
import type {
  PendingInteractionStatus, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Attention kind union this overlay surfaces. */
export type AttentionKind = PendingInteractionStatus | 'completed'

/** One attention row the panel renders. */
export interface AttentionRow {
  kind: AttentionKind
  id: SessionId
  title: string
}

/** Display metadata per attention kind (color + localized label key). */
export const KIND_META: Readonly<Record<AttentionKind, { color: string }>> = {
  approval: { color: '#f59e0b' },
  'plan-review': { color: '#a78bfa' },
  question: { color: '#22d3ee' },
  completed: { color: '#34d399' },
}

/** Sort priority: a session awaiting the user outranks a finished one. */
export const KIND_PRIORITY: Readonly<Record<AttentionKind, number>> = {
  approval: 0,
  'plan-review': 1,
  question: 2,
  completed: 3,
}

/**
 * Map a domain pending-interaction kind to the three attention statuses this
 * overlay surfaces. Mirrors ui-workspace's {@code visiblePendingKind}:
 * unknown kinds do not surface.
 * @param kind - domain-owned interaction kind string.
 * @returns the matching attention status, or `undefined` for unknown kinds.
 */
export function attentionKindOf(kind: string | undefined): PendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

/**
 * Derive the attention rows from one session list snapshot plus the
 * pending-interaction snapshot. Blank sessions never surface: a blank row is
 * a provisional New Session that cannot await anything. The currently-open
 * session surfaces like any other when its reply completes. A pending
 * interaction outranks a completed reminder for the same session.
 * @param state - the useSessions snapshot.
 * @param pending - the useSessionPendingInteraction snapshot (sessionId → interaction).
 * @returns the sorted attention rows.
 */
export function selectAttention(
  state: SessionListState,
  pending?: ReadonlyMap<SessionId, { kind: string }>,
): AttentionRow[] {
  const rows: AttentionRow[] = []
  for (const id of state.ids) {
    const row: SessionSummary | undefined = state.byId[id]
    if (row === undefined || row.blank) continue
    const kind = pending !== undefined ? attentionKindOf(pending.get(id)?.kind) : undefined
    if (kind !== undefined) {
      rows.push({ kind, id, title: row.displayTitle })
    } else if (row.completed === true) {
      rows.push({ kind: 'completed', id, title: row.displayTitle })
    }
  }
  rows.sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind]
    const pb = KIND_PRIORITY[b.kind]
    if (pa !== pb) return pa - pb
    // Session ids are unique within one list, so ids are never equal here; the
    // `: 0` arm is a closed-union backstop for a forged input.
    /* v8 ignore next */
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return rows
}

/**
 * Stable value key for two attention row arrays (hook equality).
 * @param rows - the attention rows to key.
 * @returns a `'kind|id|title'`-joined string that changes on any visible edit.
 */
export function attentionRowsKey(rows: readonly AttentionRow[]): string {
  return rows.map(r => r.kind + ':' + r.id + ':' + r.title).join('|')
}

/**
 * Whether every row is a background reply completion (drives the green theme).
 * @param rows - the attention rows to test.
 * @returns `true` only when `rows` is non-empty and every row is `completed`.
 */
export function isAllCompleted(rows: readonly AttentionRow[]): boolean {
  return rows.length > 0 && rows.every(r => r.kind === 'completed')
}
