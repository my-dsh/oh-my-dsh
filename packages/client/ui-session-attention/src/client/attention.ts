/**
 * Pure selection of the "attention" rows this overlay surfaces, derived from
 * the standard {@link SessionListState} the sidebar itself consumes.
 *
 * Two attention kinds mirror the sidebar's status dots:
 *  - a `pendingInteraction` (approval / plan-review / question) — the amber
 *    "waiting for the user" dot;
 *  - a `completed` session (finished running and not opened since) — the
 *    green "done" reminder dot.
 *
 * The selector returns a plain, sorted array so a snapshot selector hook can
 * compare two derivations by value (see {@link attentionRowsKey}) without
 * touching React or the canvas.
 */
import type {
  PendingInteractionStatus, SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'

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
 * Derive the attention rows from one session list snapshot. Blank sessions
 * never surface: a blank row is a provisional New Session that cannot await
 * anything. The currently-open session surfaces like any other when its reply
 * completes.
 * @param state - the useSessions snapshot.
 * @returns the sorted attention rows.
 */
export function selectAttention(state: SessionListState): AttentionRow[] {
  const rows: AttentionRow[] = []
  for (const id of state.ids) {
    const row: SessionSummary | undefined = state.byId[id]
    if (row === undefined || row.blank) continue
    if (row.pendingInteraction !== undefined) {
      rows.push({ kind: row.pendingInteraction, id, title: row.displayTitle })
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
