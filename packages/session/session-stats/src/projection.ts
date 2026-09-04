/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * embedded streams, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * The wall-time boundaries come from the shared `step-timing` fold, which
 * mirrors the client window fold field by field (`deriveStats` in
 * dsh-client-ui-conversation, that fold's whole-window fallback role): model
 * time is `step/start` → `assistant/message`, first token is the first
 * non-empty delta chunk and survives an in-step `llm/retry`, decode spans
 * first token → assembled message on steps that also report output tokens,
 * and tool time pairs `tool/call` → `tool/result` by callId. The open fold
 * stays open until `step/end` so tool results landing after the message
 * still accrue; a cancelled step assembles no message, so its partial stream
 * time stays uncounted in every time figure — matching the window, which
 * renders it as an untimed interrupted node.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import { expandAssistantStream, type AssistantStreamRecord, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
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
  stepTimingWithoutPendingCalls,
} from '@deepseek-ai/dsh-step-timing'

/* jscpd:ignore-start -- Session Stats owns its whole-log timing projection independently. */

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


/** First non-empty token timestamp in one durable Assistant stream. */
function firstTokenTime(stream: readonly AssistantStreamRecord[]): number | null {
  return expandAssistantStream(stream).find(member => isTokenDelta(member.chunk))?.time ?? null
}

/* jscpd:ignore-end */

/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  /** Distinct turns with at least one closed step so far. */
  turns: number
  /** Closed steps so far. */
  steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
}

/**
 * Fold state: the totals plus the open step's shared timing fold. Turn
 * numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** The open step's timing fold; null outside a step. It closes at `step/end`. */
  openStep: StepTimingFold | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
}).strict()

/** The persisted shape of one open step's timing fold (the unit's input boundary). */
const openStepSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  startTime: z.number().nonnegative(),
  firstTokenTime: z.number().nonnegative().nullable(),
  toolMs: z.number().nonnegative(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
  messageTime: z.number().nonnegative().nullable(),
})

/**
 * The fold state's shape (totals plus the open timing fold), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openStep: openStepSchema.nullable(),
})

/**
 * Provider-reported completion tokens, guarded the way the window fold guards
 * node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the output-token count, or null when unreported or invalid.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** The `sessionStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const sessionStatsProjectionDefinition = {
  key: 'sessionStats',
  stateVersion: 2,
  stateSchema: sessionStatsStateSchema,
  init: () => ({
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    lastTurn: null,
    openStep: null,
  }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'step/start':
        return {
          ...state,
          openStep: stepTimingOpen(event.data.turn, event.data.step, event.time),
        }
      case 'assistant/attempt': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        const first = firstTokenTime(event.data.stream)
        if (first === null) return state
        const stamped = stepTimingOnToken(open, first, true)
        if (stamped === open) return state
        return { ...state, openStep: stamped }
      }
      case 'tool/call': {
        const open = state.openStep
        if (open === null) return state
        return { ...state, openStep: stepTimingOnToolCall(open, event.data.callId, event.time) }
      }
      case 'tool/result': {
        const open = state.openStep
        if (open === null) return state
        const folded = stepTimingOnToolResult(open, event.data.message.source.callId, event.time)
        if (folded === open) return state
        // Totals accrue at result time (the change-feed moment clients see),
        // mirroring the fold's per-step accrual.
        const added = folded.toolMs - open.toolMs
        return { ...state, openStep: folded, toolMs: state.toolMs + Math.max(0, added) }
      }
      case 'assistant/message': {
        const open = state.openStep
        // One assembled message per step: after the first stamp, a defensive
        // duplicate folds to the identical reference.
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        // First-token fallback: the durable stream rides the message event, so
        // a step whose attempt arrived before `step/start` interest still stamps.
        const firstToken = open.firstTokenTime ?? firstTokenTime(event.data.stream)
        const stamped = firstToken === null || open.firstTokenTime !== null
          ? open
          : stepTimingOnToken(open, firstToken, true)
        const next = stepTimingOnMessage(stamped, event.time)
        if (next === open) return state
        const llmMs = stepTimingLlmMs(next)
        if (llmMs === null) return state
        const updated: SessionStatsState = {
          ...state,
          openStep: next,
          llmMs: state.llmMs + llmMs,
        }
        const ttftMs = stepTimingTtftMs(next)
        if (ttftMs !== null) {
          updated.ttftMs += ttftMs
          updated.ttftSteps += 1
          const outputTokens = usageOutputTokens(event.data.usage)
          if (outputTokens !== null) {
            const decodeMs = stepTimingDecodeMs(next)
            if (decodeMs !== null) {
              updated.decodeMs += decodeMs
              updated.decodeTokens += outputTokens
            }
          }
        }
        return updated
      }
      case 'step/end':
        return {
          ...state,
          turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
          steps: state.steps + 1,
          lastTurn: event.data.turn,
          openStep: null,
        }
      case 'turn/end': {
        // A call whose result never landed belongs to a cancelled or failed
        // turn; results always land within their turn, so drop the leftovers
        // instead of growing persisted state forever.
        const open = state.openStep
        if (open === null) return state
        const pruned = stepTimingWithoutPendingCalls(open)
        if (pruned === open) return state
        return { ...state, openStep: pruned }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: sessionStatsSchema,
    view: state => ({
      turns: state.turns,
      steps: state.steps,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      ttftMs: state.ttftMs,
      ttftSteps: state.ttftSteps,
      decodeMs: state.decodeMs,
      decodeTokens: state.decodeTokens,
    }),
  },
} satisfies ProjectionDefinition<'sessionStats', SessionStatsState>
