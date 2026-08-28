/**
 * Token-usage dashboard plugin, browser half: a floating action button plus
 * a modal panel, contributed to the root-scoped `shell.overlay` list slot
 * (owned and declared by ui-layout). The panel shows the daily token-usage
 * summary grouped by (provider, model) — totals, average throughput, average
 * TTFT, and average cache-hit ratio — fetched through the `tokenUsage`
 * domain of the wire client. Copy rides the standard locale seat.
 *
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell.overlay SlotMap declaration (the key's owner)
// into this program so the overlay registration below typechecks against the
// real declaration — no runtime edge to ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { TokenUsageDashboard } from './TokenUsageDashboard.tsx'
import type { TokenUsageDashboardInjected } from './slots.ts'
import { en, zh, type DashboardKey } from './locales.ts'

export type { TokenUsageDashboardInjected } from './slots.ts'
export type { DashboardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The token-usage dashboard copy. */
    'tokenUsage.dashboard': DashboardKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'tokenUsage.dashboard'

/** Required services: the slot registry, the Remote wire namespace, and locale copy. */
export const inject = ['slots', 'locale', 'remote', 'remote.tokenUsage']

/**
 * Client plugin body: register the `tokenUsage.dashboard` dictionaries, then
 * contribute the dashboard entry to the shell overlay once its declarer is up.
 * Zero business face — data and verbs reach the component through the inject
 * face (`api`, `t`) only.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-token-usage: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): TokenUsageDashboardInjected => ({
    api: ctx.remote.tokenUsage,
    t,
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'token-usage-dashboard',
    order: 100,
    locale: NS,
    inject: injected,
  }, TokenUsageDashboard))
}
