/** Pure attention-selection logic (no React, no canvas). */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import {
  KIND_META, KIND_PRIORITY, attentionRowsKey, isAllCompleted, selectAttention,
  type AttentionKind, type AttentionRow,
} from '../src/client/attention.ts'

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id, displayTitle: id, blank: false, running: false, updatedAt: 0,
    ...overrides,
  } as SessionSummary
}

function state(ids: string[], byId: Record<string, SessionSummary>, current?: string): SessionListState {
  return {
    ids, byId, current, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  } as SessionListState
}

/** Build a typed attention row (SessionId/AttentionKind are branded/literal). */
function row(kind: AttentionKind, id: string, title: string): AttentionRow {
  return { kind, id: id as AttentionRow['id'], title }
}

describe('selectAttention', () => {
  it('surfaces pending interactions and excludes blank rows', () => {
    const s = state(
      ['a', 'b', 'c'],
      {
        a: summary('a', { pendingInteraction: 'approval' }),
        b: summary('b', { blank: true, pendingInteraction: 'question' }),
        c: summary('c', { pendingInteraction: 'plan-review' }),
      },
    )
    expect(selectAttention(s).map(r => r.kind)).toEqual(['approval', 'plan-review'])
  })

  it('surfaces completed sessions including the currently-open one', () => {
    const s = state(
      ['a', 'b', 'c'],
      {
        a: summary('a', { completed: true }),
        b: summary('b', { completed: true }),
        c: summary('c', { completed: true }),
      },
      'b',
    )
    // b is current → still surfaced; clicking its row re-selects and consumes it.
    expect(selectAttention(s).map(r => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('pending interaction outranks completed for the same session', () => {
    const s = state(['a'], { a: summary('a', { pendingInteraction: 'question', completed: true }) })
    expect(selectAttention(s).map(r => r.kind)).toEqual(['question'])
  })

  it('sorts by kind priority then id', () => {
    const s = state(['z', 'y', 'x', 'w'], {
      z: summary('z', { completed: true }),
      y: summary('y', { pendingInteraction: 'question' }),
      x: summary('x', { pendingInteraction: 'approval' }),
      w: summary('w', { pendingInteraction: 'plan-review' }),
    })
    expect(selectAttention(s).map(r => r.id)).toEqual(['x', 'w', 'y', 'z'])
  })

  it('sorts equal-priority rows by id (the `pa === pb` branch)', () => {
    const s = state(['b', 'a'], {
      a: summary('a', { pendingInteraction: 'approval' }),
      b: summary('b', { pendingInteraction: 'approval' }),
    })
    expect(selectAttention(s).map(r => r.id)).toEqual(['a', 'b'])
  })

  it('returns an empty array when nothing needs attention', () => {
    const s = state(['a'], { a: summary('a') })
    expect(selectAttention(s)).toEqual([])
  })

  it('skips ids absent from byId', () => {
    const s = state(['a', 'ghost'], { a: summary('a', { pendingInteraction: 'approval' }) })
    expect(selectAttention(s).map(r => r.id)).toEqual(['a'])
  })
})

describe('attention keys', () => {
  it('attentionRowsKey is stable for equal rows and differs for changed titles', () => {
    const rows = [row('approval', 'a', 'A')]
    expect(attentionRowsKey(rows)).toBe(attentionRowsKey([row('approval', 'a', 'A')]))
    expect(attentionRowsKey(rows)).not.toBe(attentionRowsKey([row('approval', 'a', 'B')]))
  })

  it('isAllCompleted is true only when all rows are completed', () => {
    expect(isAllCompleted([row('completed', 'a', 'A')])).toBe(true)
    expect(isAllCompleted([
      row('completed', 'a', 'A'),
      row('approval', 'b', 'B'),
    ])).toBe(false)
    expect(isAllCompleted([])).toBe(false)
  })

  it('KIND_META and KIND_PRIORITY cover every attention kind', () => {
    const kinds = ['approval', 'plan-review', 'question', 'completed'] as const
    for (const k of kinds) {
      expect(typeof KIND_META[k].color).toBe('string')
      expect(typeof KIND_PRIORITY[k]).toBe('number')
    }
    expect(KIND_PRIORITY.approval).toBeLessThan(KIND_PRIORITY.completed)
  })
})
