/**
 * The entry contributes to the root-scoped `shell.overlay` list slot (owned and
 * declared by ui-layout); the locale copy rides the standard `locale` seat.
 */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'

/**
 * Injected business face of the TokenUsageDashboard overlay entry: the wire
 * faces the panel reads through and the bound copy translator.
 */
export interface TokenUsageDashboardInjected {
  /** Wire faces the dashboard reads through (the tokenUsage domain). */
  api: Pick<IApiClient, 'tokenUsage'>
  /** Bound translator for the `tokenUsage.dashboard` namespace. */
  t: (key: keyof typeof en) => string
}
