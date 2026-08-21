/**
 * The pure timing fold of one agent-loop step, shared by every consumer that
 * must agree on step wall-time boundaries: `session-stats`'s whole-log
 * projection and `token-usage`'s per-request capture both fold the same event
 * relations — `step/start` opens the boundary, the first token delta stamps
 * TTFT, matched `tool/call` → `tool/result` pairs accrue tool wall time, and
 * the first assembled `assistant/message` closes the model-time window.
 *
 * Every function is pure and returns the identical reference when nothing
 * changed, so projection folds can gate their change feeds with `Object.is`.
 * The fold state is plain JSON and survives a persisted-cache round trip.
 *
 * Consumers keep their own vocabulary on top: usage guarding, route joins,
 * turn/step counting, and record writes stay caller-side.
 *
 * @module @deepseek-ai/dsh-step-timing
 */

/** One open step's timing facts: boundaries, first token, tool pairs, message stamp. */
export interface StepTimingFold {
  /** Turn ordinal the step belongs to; consumers match incoming events against it. */
  readonly turn: number
  /** Step ordinal within the turn. */
  readonly step: number
  /** Epoch milliseconds of `step/start`. */
  readonly startTime: number
  /** Epoch milliseconds of the first token delta inside the step; null before one lands. */
  readonly firstTokenTime: number | null
  /** Matched `tool/call` → `tool/result` wall time accrued inside the step, in milliseconds. */
  readonly toolMs: number
  /** Dispatch instants of tool calls whose result has not landed, by callId. */
  readonly pendingCalls: Readonly<Record<string, number>>
  /**
   * Epoch milliseconds of the step's first assembled assistant message; null
   * before it assembles. A duplicate message never overwrites the first stamp.
   */
  readonly messageTime: number | null
}

/**
 * Open the timing fold for one entered step.
 * @param turn - turn ordinal from the `step/start` event.
 * @param step - step ordinal from the `step/start` event.
 * @param startTime - epoch milliseconds of the `step/start` event.
 * @returns the initial fold state.
 */
export function stepTimingOpen(turn: number, step: number, startTime: number): StepTimingFold {
  return {
    turn,
    step,
    startTime,
    firstTokenTime: null,
    toolMs: 0,
    pendingCalls: {},
    messageTime: null,
  }
}

/**
 * Fold one stream chunk into the open step. Only the first token delta stamps
 * anything — later deltas (including those after an in-step retry) never move
 * the first-token boundary.
 * @param fold - the open step's fold state.
 * @param time - epoch milliseconds of the chunk event.
 * @param tokenDelta - whether the chunk carries a non-empty token delta, as decided by the consumer's chunk predicate.
 * @returns the updated fold, or the identical reference when nothing stamped.
 */
export function stepTimingOnToken(fold: StepTimingFold, time: number, tokenDelta: boolean): StepTimingFold {
  if (fold.firstTokenTime !== null || !tokenDelta) return fold
  return { ...fold, firstTokenTime: time }
}

/**
 * Record a tool-call dispatch instant inside the open step.
 * @param fold - the open step's fold state.
 * @param callId - provider-minted call id from the `tool/call` event.
 * @param time - epoch milliseconds of the dispatch.
 * @returns the updated fold.
 */
export function stepTimingOnToolCall(fold: StepTimingFold, callId: string, time: number): StepTimingFold {
  return { ...fold, pendingCalls: { ...fold.pendingCalls, [callId]: time } }
}

/**
 * Fold one tool result into the open step. Pairing matches only the step's
 * own pending keys — a provider-minted callId colliding with an `Object`
 * prototype property ('constructor', 'toString') reads as unmatched rather
 * than as an inherited member — and an unmatched result changes nothing.
 * @param fold - the open step's fold state.
 * @param callId - provider-minted call id from the `tool/result` event.
 * @param time - epoch milliseconds of the result event.
 * @returns the updated fold, or the identical reference when the result matched no pending call.
 */
export function stepTimingOnToolResult(fold: StepTimingFold, callId: string, time: number): StepTimingFold {
  const dispatched = Object.hasOwn(fold.pendingCalls, callId) ? fold.pendingCalls[callId] : undefined
  if (dispatched === undefined) return fold
  const pendingCalls = Object.fromEntries(
    Object.entries(fold.pendingCalls).filter(([id]) => id !== callId),
  )
  return {
    ...fold,
    toolMs: fold.toolMs + Math.max(0, time - dispatched),
    pendingCalls,
  }
}

/**
 * Stamp the step's assembled-message instant. The first stamp wins: a
 * defensive duplicate message folds to the identical reference.
 * @param fold - the open step's fold state.
 * @param time - epoch milliseconds of the `assistant/message` event.
 * @returns the updated fold, or the identical reference when a message was already stamped.
 */
export function stepTimingOnMessage(fold: StepTimingFold, time: number): StepTimingFold {
  if (fold.messageTime !== null) return fold
  return { ...fold, messageTime: time }
}

/**
 * Drop every unresolved tool dispatch from the fold. Turn-end prune parity:
 * results always land within their turn, so leftovers belong to a cancelled
 * or failed turn and must not sit in durable state forever.
 * @param fold - the fold state to prune.
 * @returns the pruned fold, or the identical reference when no dispatch was pending.
 */
export function stepTimingWithoutPendingCalls(fold: StepTimingFold): StepTimingFold {
  if (Object.keys(fold.pendingCalls).length === 0) return fold
  return { ...fold, pendingCalls: {} }
}

/**
 * The step's model wall time: `step/start` → first assembled message, clamped
 * at zero against clock skew.
 * @param fold - the fold state to read.
 * @returns the duration in milliseconds, or null before a message has been stamped.
 */
export function stepTimingLlmMs(fold: StepTimingFold): number | null {
  if (fold.messageTime === null) return null
  return Math.max(0, fold.messageTime - fold.startTime)
}

/**
 * The step's first-token latency: `step/start` → first token delta, clamped
 * at zero against clock skew.
 * @param fold - the fold state to read.
 * @returns the duration in milliseconds, or null when no token delta landed.
 */
export function stepTimingTtftMs(fold: StepTimingFold): number | null {
  if (fold.firstTokenTime === null) return null
  return Math.max(0, fold.firstTokenTime - fold.startTime)
}

/**
 * The step's decode wall time: first token delta → assembled message, clamped
 * at zero against clock skew. A cancelled step assembles no message, so its
 * partial stream time stays uncounted.
 * @param fold - the fold state to read.
 * @returns the duration in milliseconds, or null without both a first token and an assembled message.
 */
export function stepTimingDecodeMs(fold: StepTimingFold): number | null {
  if (fold.firstTokenTime === null || fold.messageTime === null) return null
  return Math.max(0, fold.messageTime - fold.firstTokenTime)
}
