/**
 * Session-attention overlay plugin, browser half: one entry contributed to the
 * root-scoped `shell.overlay` list slot (owned and declared by ui-layout). The
 * entry watches the standard `useSessions` feed (the same data the sidebar
 * status dots use) and renders a character that peeks in from the top-right
 * edge, jumps out to play a kind-specific dance while any session awaits the
 * user's action (approval / plan review / question) or a background session's
 * AI reply finished unopened, then retreats back to its peek pose when all
 * sessions are handled. There is no host half and no locale namespace of its
 * own; copy rides injected defaults.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell.overlay SlotMap declaration (the key's owner)
// into this program so the overlay registration below typechecks against the
// real declaration — no runtime edge to ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AttentionPanel } from './AttentionPanel.tsx'
import type { SessionAttentionInjected } from './contract/slots.ts'

export type { SessionAttentionInjected } from './contract/slots.ts'
export type { AttentionKind, AttentionRow } from './attention.ts'
export type { Translate, AttentionPanelProps } from './AttentionPanel.tsx'

/** Plugin config: a user-supplied character PNG (URL or data-URI). */
export interface Config {
  /** Character image URL or data-URI; undefined uses the procedural fallback. */
  characterImage?: string
}

/** Services required by the session-attention plugin: the slot registry only. */
export const inject = ['slots']

/**
 * Client plugin body: contribute the attention entry to the shell overlay once
 * its declarer is up. The open-session action is built here from the runtime
 * `sessions` service so the component never reaches for ctx. The character
 * image is passed from the plugin config so users can supply a custom PNG.
 * @param ctx - client root context.
 * @param config - plugin config (character image URL).
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const injected = (): SessionAttentionInjected => ({
    openSession: (id) => {
      const sessions = ctx.get('sessions')
      if (sessions !== undefined) sessions.open(id as never)
    },
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-attention-3d',
    order: 80,
    inject: () => {
      const face = injected()
      return config.characterImage !== undefined
        ? { ...face, characterImage: config.characterImage }
        : face
    },
  }, AttentionPanel))
}
