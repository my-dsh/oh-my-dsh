/**
 * Function plugin registering the cross-session token-usage capture side: a
 * `session/event` listener that folds step boundaries and provider-reported
 * usage into per-(session, turn, step) records written to the
 * {@link TokenUsageStore}. The store is the capability's persistence layer;
 * this plugin owns only the capture fold and the append call.
 *
 * Timing boundaries come from the shared `step-timing` fold — the same
 * primitives `session-stats` folds with, so TTFT and decode durations agree
 * with the session-scoped projection. The record is stashed at
 * `assistant/message` (which joins the route: provider/model travel with the
 * usage on that event) and written at `step/end`, after tools dispatched by
 * the agent loop have landed their results.
 *
 * @module @deepseek-ai/dsh-token-usage
 */

import type { Context } from '@deepseek-ai/cordis'
import { expandAssistantStream, type AssistantStreamRecord, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { StepTimingFold } from '@deepseek-ai/dsh-step-timing'
import {
  stepTimingDecodeMs,
  stepTimingLlmMs,
  stepTimingOnMessage,
  stepTimingOnToken,
  stepTimingOnToolCall,
  stepTimingOnToolResult,
  stepTimingOpen,
  stepTimingTtftMs,
} from '@deepseek-ai/dsh-step-timing'
import { dayKey } from './store.ts'
import type { TokenUsageEventRecord } from './types.ts'

/* jscpd:ignore-start -- Token Usage owns its per-call timing capture independently. */

/** Whether a stream chunk carries a non-empty first-token delta. */
function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** Find the timestamp of the first non-empty token delta in an assistant stream. */
function firstTokenTime(stream: readonly AssistantStreamRecord[]): number | null {
  return expandAssistantStream(stream).find(member => isTokenDelta(member.chunk))?.time ?? null
}

/* jscpd:ignore-end */

export type { TokenUsageDailyGroup, TokenUsageDailySummary, TokenUsageDailySummaryView, TokenUsageEventRecord, TokenUsageGroupView, TokenUsagePurgeRequest, TokenUsagePurgeResult, TokenUsageStore } from './types.ts'
export { SqliteTokenUsageStore, TOKEN_USAGE_APPLICATION_ID, TOKEN_USAGE_SCHEMA_VERSION, dayKey, openTokenUsageDatabase } from './store.ts'
// Type-only re-export so the Typert generator reaches the Remote service in
// `remote.ts` from the public `.` entry; the runtime Remote bundle is `./remote`.
export type { TokenUsageRemoteService } from './remote.ts'

/** Cordis plugin name. */
export const name = 'token-usage'

/**
 * Required services: the session firehose (for `session/event`) and the
 * token-usage store (the persistence layer this plugin feeds). Without the
 * store the fiber stays pending — there is nothing to capture into.
 */
export const inject = ['tokenUsageStore']

/**
 * One open step's capture state: the shared timing fold plus the usage facts
 * stashed at `assistant/message` for the `step/end` write. Null before the
 * message assembles or when it carried no usage — in both cases no record is
 * written. The write is deferred to `step/end` because tools execute after
 * `assistant/message` (the agent loop dispatches `executeToolCalls` only
 * after appending the assembled message), so tool wall time is incomplete at
 * message-assembly time.
 */
interface OpenCapture {
  readonly fold: StepTimingFold
  readonly stash: {
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
  // Per-session open-capture state. Keyed by the Session object (which belongs to
  // the session store and outlives any capture fiber), mirroring the
  // telemetry coordinator's WeakMap lifetime choice. Dies with the session.
  const openCaptures = new WeakMap<Session, OpenCapture>()

  const openCaptureOf = (session: Session): OpenCapture | undefined => openCaptures.get(session)
  const setOpenCapture = (session: Session, open: OpenCapture): void => { openCaptures.set(session, open) }
  const clearOpenCapture = (session: Session): void => { openCaptures.delete(session) }

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
   * Fold one event into the open-capture state. The per-call record is
   * stashed at `assistant/message` and written at `step/end`, after tool calls
   * dispatched by the agent loop have landed their results.
   */
  function captureEvent(session: Session, event: SessionEvent): void {
    switch (event.type) {
      case 'step/start':
        setOpenCapture(session, {
          fold: stepTimingOpen(event.data.turn, event.data.step, event.time),
          stash: null,
        })
        return
      case 'assistant/attempt': {
        const open = openCaptureOf(session)
        if (open === undefined || open.fold.turn !== event.data.turn || open.fold.step !== event.data.step) return
        const first = firstTokenTime(event.data.stream)
        if (first === null) return
        const stamped = stepTimingOnToken(open.fold, first, true)
        if (stamped === open.fold) return
        setOpenCapture(session, { ...open, fold: stamped })
        return
      }
      case 'tool/call': {
        const open = openCaptureOf(session)
        if (open === undefined || open.fold.turn !== event.data.turn || open.fold.step !== event.data.step) return
        setOpenCapture(session, {
          ...open,
          fold: stepTimingOnToolCall(open.fold, event.data.callId, event.time),
        })
        return
      }
      case 'tool/result': {
        const open = openCaptureOf(session)
        if (open === undefined) return
        // Own-key matching against the step's own dispatches lives in the
        // shared fold; an unmatched result returns it unchanged.
        setOpenCapture(session, {
          ...open,
          fold: stepTimingOnToolResult(open.fold, event.data.message.source.callId, event.time),
        })
        return
      }
      case 'assistant/message': {
        const open = openCaptureOf(session)
        if (open === undefined || open.fold.turn !== event.data.turn || open.fold.step !== event.data.step) {
          clearOpenCapture(session)
          return
        }
        // A duplicate assembled message (defensive) finds the stamp already
        // set; ignore it so the first message's facts are preserved. The
        // stash exists exactly when the stamp does, set together below.
        if (open.fold.messageTime !== null) return
        // First-token fallback: the durable stream rides the message event, so
        // a step whose attempt arrived before `step/start` interest still stamps.
        const firstToken = open.fold.firstTokenTime ?? firstTokenTime(event.data.stream)
        let fold = open.fold
        if (firstToken !== null && fold.firstTokenTime === null) {
          fold = stepTimingOnToken(fold, firstToken, true)
        }
        const usage = event.data.usage
        if (usage === undefined) {
          // No provider accounting for this call (e.g. a locally-served step
          // with no usage); nothing durable to record, and no record to
          // update at step/end. Clear so tool events for this step are not
          // tracked against a write that will never happen.
          clearOpenCapture(session)
          return
        }
        // Stash the message facts and keep the open capture alive: tools
        // execute after this event, so the record is written at step/end with
        // the complete tool wall time.
        const source = event.data.message.source
        setOpenCapture(session, {
          fold: stepTimingOnMessage(fold, event.time),
          stash: { usage, provider: source.provider, model: source.model },
        })
        return
      }
      case 'step/end': {
        const open = openCaptureOf(session)
        if (open === undefined) return
        // The stash exists exactly when the shared fold stamped its message,
        // so both guards together fully determine the record's facts.
        if (open.stash !== null && open.fold.messageTime !== null) {
          ctx.tokenUsageStore.append(recordFromStashedStep(session, open.fold, open.stash))
        }
        clearOpenCapture(session)
        return
      }
      case 'turn/end':
        // Safety net: step/end (in the loop's finally) should have already
        // written and cleared. If it did not (a step that never entered), just
        // clear the open capture.
        clearOpenCapture(session)
        return
      default:
        return
    }
  }
}

/**
 * Build the per-call record from the stashed `assistant/message` facts and the
 * shared timing fold (including tool wall time from `tool/call` →
 * `tool/result` pairs that landed between `assistant/message` and `step/end`).
 * The caller has already narrowed both guards (`stash !== null`,
 * `fold.messageTime !== null`); the message-time accessor still returns a
 * nullable contract, so an impossible null fails loud instead of writing a
 * zero-timed row.
 */
function recordFromStashedStep(
  session: Session,
  fold: StepTimingFold,
  stash: NonNullable<OpenCapture['stash']>,
): TokenUsageEventRecord {
  const messageTime = fold.messageTime
  if (messageTime === null) throw new Error('token-usage: stashed record without a stamped message time')
  const llmMs = stepTimingLlmMs(fold)
  if (llmMs === null) throw new Error('token-usage: stashed record without a stamped message time')
  return {
    time: messageTime,
    date: dayKey(messageTime),
    sessionId: String(session.id),
    provider: stash.provider,
    model: stash.model,
    turn: fold.turn,
    step: fold.step,
    uncachedInputTokens: stash.usage.inputTokens,
    outputTokens: typeof stash.usage.outputTokens === 'number' ? stash.usage.outputTokens : 0,
    cacheReadTokens: stash.usage.cacheReadTokens ?? 0,
    cacheWriteTokens: stash.usage.cacheWriteTokens ?? 0,
    reasoningTokens: typeof stash.usage.reasoningTokens === 'number' ? stash.usage.reasoningTokens : null,
    ttftMs: stepTimingTtftMs(fold),
    llmMs,
    toolMs: fold.toolMs,
    decodeMs: stepTimingDecodeMs(fold),
  }
}
