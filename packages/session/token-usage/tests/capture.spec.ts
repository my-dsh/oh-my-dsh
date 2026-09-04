/**
 * The token-usage capture fold: mounting the plugin beside a real session
 * store and a fake `tokenUsageStore` service, then appending step boundary,
 * attempt, tool-pair, and assembled-message events to a live session. The
 * record is written at `step/end` — not `assistant/message` — so tool wall
 * time, which the agent loop accrues only after it dispatches tool calls,
 * lands in the persisted record. Pinning that deferral is the point of this
 * suite: writing at `assistant/message` would make every agent step's
 * `toolMs` decay to zero, the exact regression the deferral fixes.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolCallId, createAssistantMessage, createToolResultMessage, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { apply as tokenUsageApply } from '../src/index.ts'
import type { TokenUsageEventRecord } from '../src/types.ts'

/** A fake store recording every appended record, provided as `tokenUsageStore`. */
class FakeStore extends Service {
  readonly records: TokenUsageEventRecord[] = []

  constructor(ctx: Context) {
    super(ctx, 'tokenUsageStore')
  }

  append(record: TokenUsageEventRecord): void {
    this.records.push(record)
  }
}

/** Mount the session store, the fake store, and the capture plugin. */
async function harness(): Promise<{ ctx: Context; store: FakeStore; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const store = new FakeStore(ctx)
  await ctx.plugin({ name: 'token-usage', inject: ['tokenUsageStore'], apply: tokenUsageApply })
  const session = ctx.sessions.create(SessionId('capture'))
  return { ctx, store, session }
}

/** Wait far enough that the real clock yields a measurable timing gap. */
function gap(ms = 3): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Build a compact stream record containing one text-delta chunk at the given time. */
function textStream(time: number, text: string): AssistantStreamRecord[] {
  return [{ type: 'chunk', time, chunk: { type: 'text-delta', index: 0, text } }]
}

describe('token-usage capture fold', () => {
  it('defers the record to step/end so tool wall time is nonzero and correct', async () => {
    const { store, session } = await harness()
    const usage = { inputTokens: 10, outputTokens: 60, cacheReadTokens: 5 }

    const stepStart = session.append('step/start', { turn: 1, step: 1 })
    // A real gap so first-token latency is a positive, bounded time.
    await gap()
    const attemptTime = Date.now()
    session.append('assistant/attempt', { turn: 1, step: 1, stream: textStream(attemptTime, 'a') })
    await gap()
    const message = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'answer' }],
        source: { provider: 'mock', model: 'mock-model' },
      }),
      stream: [],
      usage,
    }, { surfaceOp: 'append' })
    // No record yet: the write waits for tools to land.
    expect(store.records).toHaveLength(0)

    await gap()
    const toolCall = session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call_1'), name: 'read', arguments: '{}' })
    await gap(8)
    const toolResult = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: ToolCallId('call_1'), content: [{ type: 'text', text: 'ok' }], isError: false }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })

    expect(store.records).toHaveLength(1)
    const record = store.records[0]!
    expect(record.provider).toBe('mock')
    expect(record.model).toBe('mock-model')
    expect(record.turn).toBe(1)
    expect(record.step).toBe(1)
    expect(record.sessionId).toBe('capture')
    expect(record.uncachedInputTokens).toBe(10)
    expect(record.outputTokens).toBe(60)
    expect(record.cacheReadTokens).toBe(5)
    // Tool wall time is the call→result gap, not zero.
    expect(record.toolMs).toBeGreaterThan(0)
    expect(record.toolMs).toBe(toolResult.time - toolCall.time)
    // Model time spans step/start → assembled message; first-token latency
    // spans step/start → first token in the stream; decode spans first token → message.
    expect(record.llmMs).toBe(message.time - stepStart.time)
    expect(record.ttftMs).toBe(attemptTime - stepStart.time)
    expect(record.decodeMs).toBe(message.time - attemptTime)
  })

  it('keeps the first message facts across a defensive duplicate assistant/message', async () => {
    const { store, session } = await harness()
    const usage = { inputTokens: 3, outputTokens: 9 }

    session.append('step/start', { turn: 1, step: 2 })
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'a' }],
        source: { provider: 'mock', model: 'mock-model' },
      }),
      stream: [],
      usage,
    }, { surfaceOp: 'append' })
    // A duplicate assembled message must not replace the stashed facts.
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'replacement' }],
        source: { provider: 'other', model: 'other-model' },
      }),
      stream: [],
      usage: { inputTokens: 99, outputTokens: 99 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 2 })

    expect(store.records).toHaveLength(1)
    const record = store.records[0]!
    expect(record.provider).toBe('mock')
    expect(record.model).toBe('mock-model')
    expect(record.uncachedInputTokens).toBe(3)
    expect(record.outputTokens).toBe(9)
  })

  it('writes no record for a no-usage step or a cancelled step', async () => {
    const { store, session } = await harness()
    // No-usage step: tool events must not be tracked against a never-written record.
    session.append('step/start', { turn: 1, step: 3 })
    session.append('tool/call', { turn: 1, step: 3, callId: ToolCallId('call_x'), name: 'read', arguments: '{}' })
    session.append('assistant/message', {
      turn: 1,
      step: 3,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'local' }],
        source: { provider: 'mock', model: 'mock-model' },
      }),
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 3 })
    // Cancelled step: step/start but no assembled message → no record.
    session.append('step/start', { turn: 1, step: 4 })
    session.append('step/end', { turn: 1, step: 4 })

    expect(store.records).toHaveLength(0)
  })

  it('drops a stashed-but-unwritten record at turn/end without leaking into the next step', async () => {
    const { store, session } = await harness()
    // The loop always appends step/end after a messaged step, so a stashed
    // record that reaches turn/end is a torn step: the safety net clears the
    // open step without writing (token capture never misattributes it).
    session.append('step/start', { turn: 1, step: 5 })
    session.append('assistant/message', {
      turn: 1,
      step: 5,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'x' }],
        source: { provider: 'mock', model: 'mock-model' },
      }),
      stream: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A brand-new step must not inherit the erstwhile open step's record.
    session.append('step/start', { turn: 2, step: 1 })
    session.append('step/end', { turn: 2, step: 1 })

    expect(store.records).toHaveLength(0)
  })
})
