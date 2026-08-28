/**
 * Inject face for the session-attention overlay entry: the action that opens a
 * session when the user clicks one of its rows, plus the optional character
 * image URL. The component receives the standard `useSessions` hook through
 * {@link PropsRuntime} (root scope) — it never reaches for ctx.
 */

/** Inject face handed to the attention panel from the apply closure. */
export interface SessionAttentionInjected {
  /** Open (select) one session in the sidebar. */
  openSession: (id: string) => void
  /** Optional character PNG URL or data-URI; undefined uses the procedural fallback. */
  characterImage?: string
}
