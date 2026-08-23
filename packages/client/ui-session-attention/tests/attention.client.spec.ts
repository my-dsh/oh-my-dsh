/** Pure attention-selection and projection logic (no React, no canvas). */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import {
  KIND_META, KIND_PRIORITY, attentionRowsKey, isAllCompleted, selectAttention,
  type AttentionKind, type AttentionRow,
} from '../src/client/attention.ts'
import {
  SCENE_COMET_TRAIL, SCENE_FOCAL, SCENE_HEIGHT, SCENE_RING_POINTS, SCENE_WIDTH,
  buildFallbackPoints, computeFrame, depthAlpha, depthRadius, projectPoint,
} from '../src/client/scene.ts'

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

describe('scene projection math', () => {
  it('buildFallbackPoints emits the requested count on the shell radius range', () => {
    const rand = (() => 0.5)
    const pts = buildFallbackPoints(3, 10, 20, rand)
    expect(pts).toHaveLength(3)
    for (const p of pts) {
      expect(p.r).toBeGreaterThanOrEqual(10)
      expect(p.r).toBeLessThanOrEqual(20)
      expect(p.theta).toBeGreaterThanOrEqual(0)
      expect(p.theta).toBeLessThanOrEqual(Math.PI * 2)
      // Every shell particle twinkle phase lands in [0, 2π).
      expect(p.phase).toBeGreaterThanOrEqual(0)
      expect(p.phase).toBeLessThanOrEqual(Math.PI * 2)
    }
  })

  it('projectPoint rotates and perspective-projects a point', () => {
    const p = { theta: 0, phi: Math.PI / 2, r: 10 }
    const out = projectPoint(p, 0, 0, 1, 100, 100, SCENE_FOCAL)
    expect(out).toHaveProperty('sx')
    expect(out).toHaveProperty('sy')
    expect(out).toHaveProperty('depth')
    // No rotation: the point lies on +X, focal positive → sx > center.
    expect(out.sx).toBeGreaterThan(100)
  })

  it('depthAlpha and depthRadius clamp and scale by depth', () => {
    expect(depthAlpha(-1000)).toBe(0.85)
    expect(depthAlpha(1000)).toBe(0.10)
    // Nearer (smaller depth) is larger radius and brighter alpha.
    expect(depthRadius(-40, SCENE_FOCAL)).toBeGreaterThan(depthRadius(40, SCENE_FOCAL))
    expect(depthAlpha(-40)).toBeGreaterThan(depthAlpha(40))
    // Both clamp at the floor.
    expect(depthRadius(1000, SCENE_FOCAL)).toBeGreaterThanOrEqual(1.0)
  })

  it('computeFrame composes shell + ring + comet under a breathing halo', () => {
    const pts = buildFallbackPoints(5, 46, 68, (() => 0.2))
    const frame = computeFrame(pts, 1.5, SCENE_WIDTH, SCENE_HEIGHT, SCENE_FOCAL)
    expect(frame.clear).toBe(true)
    // Every shell particle plus every ring dot plus the comet trail draws.
    expect(frame.points).toHaveLength(5 + SCENE_RING_POINTS + SCENE_COMET_TRAIL)
    for (const p of frame.points) {
      expect(p).toBeDefined()
      expect(p.alpha).toBeGreaterThanOrEqual(0)
      expect(p.alpha).toBeLessThanOrEqual(1)
      // The ring's 1.5× glow scale is the smallest multiplier above the 1.0 depth floor.
      expect(p.radius).toBeGreaterThanOrEqual(1.0 * 1.5)
    }
    // The halo breathes within its designed band.
    expect(frame.halo.radius).toBeGreaterThan(0)
    expect(frame.halo.alpha).toBeGreaterThan(0)
    expect(frame.halo.alpha).toBeLessThan(0.1)
  })
})
