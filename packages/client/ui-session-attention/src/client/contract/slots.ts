/**
 * Inject face for the session-attention overlay entry: the action that opens a
 * session when the user clicks one of its rows. The component receives the
 * standard `useSessions` hook through {@link PropsRuntime} (root scope) — it
 * never reaches for ctx.
 */

/** The callback the panel calls to open a session by id. */
export interface SessionAttentionInjected {
  /** Open (select) one session in the sidebar. */
  openSession: (id: string) => void
}
