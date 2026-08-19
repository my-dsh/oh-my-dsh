/**
 * Zod schemas for the token-usage domain wire contract.
 *
 * @module @deepseek-ai/dsh-host-apiproxy/api/token-usage.schema
 */

import { z } from 'zod'
import type { Wire } from '../api/rpc.schema.ts'
import type { RequestPayload, ResponseValue } from '../api/rpc-map.ts'

/** YYYY-MM-DD day string. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** UTC or IANA Area/Location time-zone selector. */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/**
 * A UTC or IANA Area/Location time-zone selector that resolves in this
 * runtime (rejects aliases and unsupported names, like the request-context
 * browser-zone boundary).
 */
const timeZoneSchema = z
  .string()
  .refine(value => value === 'UTC' || IANA_TIME_ZONE.test(value), {
    message: 'timeZone must be UTC or an IANA Area/Location name',
  })
  .refine((value) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone === value
    } catch {
      return false
    }
  }, {
    message: 'timeZone must resolve to a canonical UTC or IANA Area/Location name',
  })

/** tokenUsage.dailySummary request payload. */
export const tokenUsageDailySummaryRequestSchema = z.object({
  date: z.string().regex(DAY_PATTERN, 'date must be YYYY-MM-DD'),
  timeZone: timeZoneSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'tokenUsage.dailySummary'>>>

/** tokenUsage.dailySummaryRange request payload. */
export const tokenUsageDailySummaryRangeRequestSchema = z.object({
  startDate: z.string().regex(DAY_PATTERN, 'startDate must be YYYY-MM-DD'),
  endDate: z.string().regex(DAY_PATTERN, 'endDate must be YYYY-MM-DD'),
  timeZone: timeZoneSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'tokenUsage.dailySummaryRange'>>>

/** One (provider, model) group row of the daily-summary response. */
export const tokenUsageGroupViewSchema = z.object({
  provider: z.string(),
  model: z.string(),
  requests: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSamples: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  averageThroughput: z.number().nonnegative().nullable(),
  averageTtftMs: z.number().nonnegative().nullable(),
  averageLlmMs: z.number().nonnegative().nullable(),
  cacheHitRatio: z.number().min(0).max(1).nullable(),
}).strict()

/** tokenUsage.dailySummary response value. */
export const tokenUsageDailySummaryValueSchema = z.object({
  date: z.string(),
  groups: z.array(tokenUsageGroupViewSchema),
  totals: tokenUsageGroupViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'tokenUsage.dailySummary'>>>

/** tokenUsage.purge request payload. */
export const tokenUsagePurgeRequestSchema = z.object({
  before: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<RequestPayload<'tokenUsage.purge'>>>

/** tokenUsage.purge response value. */
export const tokenUsagePurgeValueSchema = z.object({
  deleted: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'tokenUsage.purge'>>>
