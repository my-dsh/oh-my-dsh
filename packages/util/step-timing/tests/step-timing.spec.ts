import { describe, expect, it } from 'vitest'
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
} from '../src/index.ts'

describe('step-timing fold', () => {
  it('opens with zeroed boundaries and derives nothing before the message stamps', () => {
    const fold = stepTimingOpen(1, 2, 1_000)
    expect(fold).toEqual({
      turn: 1, step: 2, startTime: 1_000, firstTokenTime: null, toolMs: 0, pendingCalls: {}, messageTime: null,
    })
    expect(stepTimingLlmMs(fold)).toBeNull()
    expect(stepTimingDecodeMs(fold)).toBeNull()
  })

  it('stamps the first token delta only once and keeps the boundary across later deltas', () => {
    let fold = stepTimingOpen(1, 1, 1_000)
    // A non-token chunk changes nothing, down to the reference.
    expect(stepTimingOnToken(fold, 1_100, false)).toBe(fold)
    fold = stepTimingOnToken(fold, 1_200, true)
    expect(fold.firstTokenTime).toBe(1_200)
    // A retry's later token never moves the first-token boundary.
    expect(stepTimingOnToken(fold, 3_000, true)).toBe(fold)
    expect(stepTimingTtftMs(fold)).toBe(200)
  })

  it('pairs out-of-order tool results by id and accrues clamped wall time', () => {
    let fold = stepTimingOpen(1, 1, 0)
    fold = stepTimingOnToolCall(fold, 'a', 1_100)
    fold = stepTimingOnToolCall(fold, 'b', 1_200)
    fold = stepTimingOnToolResult(fold, 'b', 4_200)
    fold = stepTimingOnToolResult(fold, 'a', 1_600)
    expect(fold.toolMs).toBe(3_500)
    expect(fold.pendingCalls).toEqual({})
  })

  it('reads prototype-name callIds as absent keys, not inherited members', () => {
    let fold = stepTimingOpen(1, 1, 0)
    // 'toString' was never dispatched: unmatched, identical reference.
    expect(stepTimingOnToolResult(fold, 'toString', 500)).toBe(fold)
    // The same name pairs normally once its call is recorded.
    fold = stepTimingOnToolCall(fold, 'constructor', 1_000)
    fold = stepTimingOnToolResult(fold, 'constructor', 1_600)
    expect(fold.toolMs).toBe(600)
  })

  it('clamps negative clock skew to zero for every duration', () => {
    let fold = stepTimingOpen(1, 1, 2_000)
    fold = stepTimingOnToken(fold, 1_500, true)
    fold = stepTimingOnMessage(fold, 1_000)
    expect(stepTimingLlmMs(fold)).toBe(0)
    expect(stepTimingTtftMs(fold)).toBe(0)
    expect(stepTimingDecodeMs(fold)).toBe(0)
  })

  it('keeps the first message stamp and folds duplicates to the identical reference', () => {
    let fold = stepTimingOpen(1, 1, 1_000)
    fold = stepTimingOnMessage(fold, 4_800)
    expect(stepTimingOnMessage(fold, 5_000)).toBe(fold)
    expect(stepTimingLlmMs(fold)).toBe(3_800)
  })

  it('derives decode time only from the first-token-to-message window', () => {
    const untimed = stepTimingOnMessage(stepTimingOpen(1, 1, 1_000), 2_000)
    expect(stepTimingDecodeMs(untimed)).toBeNull()

    const timed = stepTimingOnMessage(stepTimingOnToken(stepTimingOpen(1, 1, 1_000), 1_400, true), 4_400)
    expect(stepTimingDecodeMs(timed)).toBe(3_000)
    expect(stepTimingLlmMs(timed)).toBe(3_400)
    expect(stepTimingTtftMs(timed)).toBe(400)
  })

  it('prunes unresolved dispatches at turn end without touching other facts', () => {
    const clean = stepTimingOpen(1, 1, 0)
    expect(stepTimingWithoutPendingCalls(clean)).toBe(clean)

    const pending = stepTimingOnToolCall(clean, 'orphan', 100)
    const pruned = stepTimingWithoutPendingCalls(pending)
    expect(pruned.pendingCalls).toEqual({})
    expect(pruned.startTime).toBe(pending.startTime)
    expect(pruned).not.toBe(pending)
  })
})
