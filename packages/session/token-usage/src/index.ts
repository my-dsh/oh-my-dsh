/**
 * Function plugin registering the cross-session token-usage capture side: a
 * `session/event` listener that folds step boundaries and provider-reported
 * usage into per-(session, turn, step) records written to the
 * {@link TokenUsageStore}. The store is the capability's persistence layer;
 * this plugin owns only the capture fold and the append call.
 *
 * Capture mirrors `session-stats`'s timing fold (`step/start` → first token
 * chunk → `assistant/message`) so the TTFT and decode fields agree with the
 * session-scoped projection, and joins the route from the assembled message's
 * `source` (provider/model travel with the usage on `assistant/message`).
 *
 * @module @deepseek-ai/dsh-token-usage
 */

import type { Context } from '@deepseek-ai/cordis'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { dayKey } from './store.ts'
import type { TokenUsageEventRecord } from './types.ts'

export type { TokenUsageDailyGroup, TokenUsageDailySummary, TokenUsageDailySummaryView, TokenUsageEventRecord, TokenUsageGroupView, TokenUsagePurgeRequest, TokenUsagePurgeResult, TokenUsageStore } from './types.ts'
export { SqliteTokenUsageStore, TOKEN_USAGE_APPLICATION_ID, TOKEN_USAGE_SCHEMA_VERSION, dayKey, openTokenUsageDatabase } from './store.ts'

/** Cordis plugin name. */
export const name = 'token-usage'

/**
 * Required services: the session firehose (for `session/event`) and the
 * token-usage store (the persistence layer this plugin feeds). Without the
 * store the fiber stays pending — there is nothing to capture into.
 */
export const inject = ['tokenUsageStore']

/**
 * One open step's timing facts, tracked across the boundary events so the
 * record written at `step/end` carries TTFT, decode duration, and tool wall
 * time.
 */
interface OpenStep {
  readonly turn: number
  readonly step: number
  readonly startTime: number
  firstTokenTime: number | null
  /** Tool wall time from `tool/call` → `tool/result` pairs that landed inside this step. */
  toolMs: number
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  readonly pendingCalls: Record<string, number>
  /**
   * Stashed at `assistant/message` for the `step/end` write. Null before the
   * message assembles or when it carried no usage — in both cases no record is
   * written. The write is deferred to `step/end` because tools execute after
   * `assistant/message` (the agent loop dispatches `executeToolCalls` only
   * after appending the assembled message), so tool wall time is incomplete at
   * message-assembly time.
   */
  record: {
    readonly time: number
    readonly usage: TokenUsage
    readonly provider: string
    readonly model: string
  } | null
}

/**
 * Register the capture listener on this plugin's fiber. The listener folds
 * step boundaries and writes one record per successful model call; write
 * failures are contained inside the store (it logs and swallows) and never
 * reach the agent loop.
 * @param ctx - registrant context carrying the session firehose and the store.
 */
export function apply(ctx: Context): void {
  // Per-session open-step state. Keyed by the Session object (which belongs to
  // the session store and outlives any capture fiber), mirroring the
  // telemetry coordinator's WeakMap lifetime choice. Dies with the session.
  const openSteps = new WeakMap<Session, OpenStep>()

  const openStepOf = (session: Session): OpenStep | undefined => openSteps.get(session)
  const setOpenStep = (session: Session, step: OpenStep): void => { openSteps.set(session, step) }
  const clearOpenStep = (session: Session): void => { openSteps.delete(session) }

  ctx.on('session/event', (session, event) => {
    try {
      captureEvent(session, event)
    } catch (error) {
      // Cordis `emit` is stop-on-throw: a failure here would starve every
      // subscriber registered after this plugin. Contain and log.
      ctx.logger.warn(`token-usage: capture failed for ${event.type} in session ${String(session.id)}: ${String(error)}`)
    }
  })

  /**
   * Fold one event into the open-step state. The per-call record is stashed at
   * `assistant/message` and written at `step/end`, after tool calls dispatched
   * by the agent loop have landed their results. Mirrors `session-stats`'s
   * boundary logic so TTFT and decode timings agree with the session-scoped
   * projection.
   */
  function captureEvent(session: Session, event: SessionEvent): void {
    switch (event.type) {
      case 'step/start':
        setOpenStep(session, {
          turn: event.data.turn,
          step: event.data.step,
          startTime: event.time,
          firstTokenTime: null,
          toolMs: 0,
          pendingCalls: {},
          record: null,
        })
        return
      case 'assistant/chunk': {
        const open = openStepOf(session)
        if (open === undefined || open.turn !== event.data.turn || open.step !== event.data.step) return
        if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) return
        setOpenStep(session, { ...open, firstTokenTime: event.time })
        return
      }
      case 'tool/call': {
        const open = openStepOf(session)
        if (open === undefined || open.turn !== event.data.turn || open.step !== event.data.step) return
        setOpenStep(session, { ...open, pendingCalls: { ...open.pendingCalls, [event.data.callId]: event.time } })
        return
      }
      case 'tool/result': {
        const open = openStepOf(session)
        if (open === undefined) return
        // Own-key check mirrors session-stats: callId is provider-minted, so
        // a prototype property name on a result with no recorded call must read
        // as unmatched rather than an inherited function.
        const callId = event.data.message.source.callId
        const dispatched = Object.hasOwn(open.pendingCalls, callId) ? open.pendingCalls[callId] : undefined
        if (dispatched === undefined) return
        const pendingCalls = Object.fromEntries(
          Object.entries(open.pendingCalls).filter(([id]) => id !== callId),
        )
        setOpenStep(session, {
          ...open,
          toolMs: open.toolMs + Math.max(0, event.time - dispatched),
          pendingCalls,
        })
        return
      }
      case 'assistant/message': {
        const open = openStepOf(session)
        if (open === undefined || open.turn !== event.data.turn || open.step !== event.data.step) {
          clearOpenStep(session)
          return
        }
        // A duplicate assembled message (defensive) finds the stash already
        // set; ignore it so the first message's facts are preserved.
        if (open.record !== null) return
        const usage = event.data.usage
        if (usage === undefined) {
          // No provider accounting for this call (e.g. a locally-served step
          // with no usage); nothing durable to record, and no record to
          // update at step/end. Clear so tool events for this step are not
          // tracked against a write that will never happen.
          clearOpenStep(session)
          return
        }
        // Stash the message facts and keep the open step alive: tools execute
        // after this event, so the record is written at step/end with the
        // complete tool wall time.
        const source = event.data.message.source
        setOpenStep(session, {
          ...open,
          record: { time: event.time, usage, provider: source.provider, model: source.model },
        })
        return
      }
      case 'step/end': {
        const open = openStepOf(session)
        if (open === undefined) return
        if (open.record !== null) {
          const record = recordFromStashedStep(session, open)
          ctx.tokenUsageStore.append(record)
        }
        clearOpenStep(session)
        return
      }
      case 'turn/end':
        // Safety net: step/end (in the loop's finally) should have already
        // written and cleared. If it did not (a step that never entered), just
        // clear the open step.
        clearOpenStep(session)
        return
      default:
        return
    }
  }
}

/**
 * Build the per-call record from the stashed `assistant/message` facts and the
 * open step's accumulated timing (including tool wall time from `tool/call` →
 * `tool/result` pairs that landed between `assistant/message` and `step/end`).
 */
function recordFromStashedStep(
  session: Session,
  open: OpenStep,
): TokenUsageEventRecord {
  // The sole caller (`step/end`) invokes this only when `open.record !== null`;
  // a mutable property reached through the parameter cannot be narrowed here.
  // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded at the step/end call site
  const record = open.record!
  const ttftMs = open.firstTokenTime !== null ? Math.max(0, open.firstTokenTime - open.startTime) : null
  const outputTokens = typeof record.usage.outputTokens === 'number' ? record.usage.outputTokens : 0
  const llmMs = Math.max(0, record.time - open.startTime)
  const decodeMs = open.firstTokenTime !== null
    ? Math.max(0, record.time - open.firstTokenTime)
    : null
  return {
    time: record.time,
    date: dayKey(record.time),
    sessionId: String(session.id),
    provider: record.provider,
    model: record.model,
    turn: open.turn,
    step: open.step,
    uncachedInputTokens: record.usage.inputTokens,
    outputTokens,
    cacheReadTokens: record.usage.cacheReadTokens ?? 0,
    cacheWriteTokens: record.usage.cacheWriteTokens ?? 0,
    reasoningTokens: typeof record.usage.reasoningTokens === 'number' ? record.usage.reasoningTokens : null,
    ttftMs,
    llmMs,
    toolMs: open.toolMs,
    decodeMs,
  }
}
