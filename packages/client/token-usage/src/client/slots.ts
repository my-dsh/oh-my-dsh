/**
 * The entry contributes to the root-scoped `shell.overlay` list slot (owned and
 * declared by ui-layout); the locale copy rides the standard `locale` seat.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TokenUsageDailySummaryView } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'

/** The Remote `tokenUsage` namespace methods the dashboard reads through. */
export interface TokenUsageApiFace {
  dailySummary(date: string, timeZone: string): Promise<RemoteResult<TokenUsageDailySummaryView>>
  dailySummaryRange(startDate: string, endDate: string, timeZone: string): Promise<RemoteResult<TokenUsageDailySummaryView>>
}

/**
 * Injected business face of the TokenUsageDashboard overlay entry: the wire
 * faces the panel reads through and the bound copy translator.
 */
export interface TokenUsageDashboardInjected {
  /** Wire faces the dashboard reads through (the tokenUsage domain). */
  api: TokenUsageApiFace
  /** Bound translator for the `tokenUsage.dashboard` namespace. */
  t: (key: keyof typeof en) => string
}
