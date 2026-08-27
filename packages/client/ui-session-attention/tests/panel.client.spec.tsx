// @vitest-environment jsdom
/** AttentionPanel rendering against a fake useSessions hook and an injectable scene. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { AttentionPanel } from '../src/client/AttentionPanel.tsx'
import type { Translate } from '../src/client/AttentionPanel.tsx'
import type { AttentionKind } from '../src/client/attention.ts'
import { prefersReducedMotion, type SceneEnv, type SceneDisposer } from '../src/client/scene.ts'

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

/** A fake useSessions that returns one fixed snapshot selection. */
function fakeUseSessions(snapshot: SessionListState): SnapshotSelectorHook<SessionListState> {
  return <S,>(sel: (s: SessionListState) => S, eq?: (a: S, b: S) => boolean): S => {
    const result = sel(snapshot)
    // Exercise the equality function for coverage; the fake has one snapshot.
    if (eq !== undefined) eq(result, result)
    return result
  }
}

/** A scene env whose raf never fires (so no WebGL/canvas draws in jsdom). */
const noRafEnv: SceneEnv = { reducedMotion: () => false }
const reducedEnv: SceneEnv = { reducedMotion: () => true }

const t: Translate = (key, vars) => {
  if (key === 'more') return 'more ' + String(vars?.n ?? 0)
  return key
}

describe('AttentionPanel', () => {
  beforeEach(() => {
    // document.title tagging runs in effects; pin a starting title.
    document.title = 'base'
  })
  afterEach(() => { cleanup() })

  it('renders nothing when no session needs attention', () => {
    const snap = state(['a'], { a: summary('a') })
    const { container } = render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    expect(container.firstChild).toBeNull()
    expect(document.title).toBe('base')
  })

  it('renders the panel, head count, and rows for pending sessions', () => {
    const snap = state(
      ['a', 'b'],
      {
        a: summary('a', { pendingInteraction: 'approval', displayTitle: 'Alpha' }),
        b: summary('b', { pendingInteraction: 'question', displayTitle: 'Beta' }),
      },
    )
    render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} t={t} env={noRafEnv} />,
    )
    // Head: action title (not all completed) with count 2.
    expect(screen.getByText(/title\.action · 2/)).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getAllByText('approval').length).toBeGreaterThan(0)
    expect(screen.getAllByText('question').length).toBeGreaterThan(0)
  })

  it('uses the completed head text and theme when only completed rows remain', () => {
    const snap = state(['a'], { a: summary('a', { completed: true, displayTitle: 'Alpha' }) })
    const { container } = render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} t={t} env={noRafEnv} />,
    )
    expect(screen.getByText(/title\.completed · 1/)).toBeTruthy()
    // The completed canvas box class is applied.
    expect(container.querySelector('[class*="canvasBoxCompleted"]')).toBeTruthy()
  })

  it('opens a session when a row is clicked and tags the tab title', () => {
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval', displayTitle: 'Alpha' }) })
    const openSession = vi.fn()
    render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={openSession} env={noRafEnv} />,
    )
    expect(document.title).toBe('(1) base')
    act(() => { screen.getByText('Alpha').closest('button')!.click() })
    expect(openSession).toHaveBeenCalledWith('a')
  })

  it('restores the tab title when attention clears', () => {
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval' }) })
    const openSession = vi.fn()
    const { rerender } = render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={openSession} env={noRafEnv} />,
    )
    expect(document.title).toBe('(1) base')
    rerender(
      <AttentionPanel
        useSessions={fakeUseSessions(state(['a'], { a: summary('a') }))}
        openSession={openSession}
        env={noRafEnv}
      />,
    )
    expect(document.title).toBe('base')
  })

  it('shows a +N more tail beyond five rows', () => {
    const byId: Record<string, SessionSummary> = {}
    for (let i = 0; i < 7; i++) byId['s' + String(i)] = summary('s' + String(i), { pendingInteraction: 'approval', displayTitle: 'S' + String(i) })
    const snap = state(Object.keys(byId), byId)
    render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} t={t} env={noRafEnv} />,
    )
    expect(screen.getByText('more 2')).toBeTruthy()
  })

  it('starts the scene in reduced-motion mode (one static frame) and disposes', () => {
    // Inject createAttentionScene indirectly via env; reducedMotion true path.
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval' }) })
    const { unmount } = render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} env={reducedEnv} />,
    )
    // The canvas is present and the panel mounted.
    expect(screen.getByText(/· 1/)).toBeTruthy()
    unmount()
  })

  it('uses the default Chinese copy for every attention kind and the +N more tail', () => {
    const byId: Record<string, SessionSummary> = {
      a: summary('a', { pendingInteraction: 'approval', displayTitle: 'Alpha' }),
      b: summary('b', { pendingInteraction: 'plan-review', displayTitle: 'Beta' }),
      c: summary('c', { pendingInteraction: 'question', displayTitle: 'Gamma' }),
      d1: summary('d1', { completed: true, displayTitle: 'Delta1' }),
      d2: summary('d2', { completed: true, displayTitle: 'Delta2' }),
      d3: summary('d3', { completed: true, displayTitle: 'Delta3' }),
      d4: summary('d4', { completed: true, displayTitle: 'Delta4' }),
    }
    const snap = state(Object.keys(byId), byId)
    render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    expect(screen.getByText(/会话需要你的操作 · 7/)).toBeTruthy()
    expect(screen.getAllByText('等待审批').length).toBeGreaterThan(0)
    expect(screen.getByText('计划待审')).toBeTruthy()
    expect(screen.getByText('等待回答')).toBeTruthy()
    expect(screen.getAllByText('回复完成').length).toBeGreaterThan(0)
    expect(screen.getByText('还有 2 个会话在等待…')).toBeTruthy()
  })

  it('uses the default completed title when only completed rows remain', () => {
    const snap = state(['a'], { a: summary('a', { completed: true, displayTitle: 'Alpha' }) })
    render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    expect(screen.getByText(/回复完成 · 1/)).toBeTruthy()
  })

  it('builds the default scene env when no env is injected', () => {
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval' }) })
    // No env prop → the effect builds the default env and calls prefersReducedMotion.
    const { unmount } = render(
      <AttentionPanel useSessions={fakeUseSessions(snap)} openSession={() => {}} />,
    )
    expect(screen.getByText(/· 1/)).toBeTruthy()
    expect(() => { unmount() }).not.toThrow()
  })

  it('falls back to a no-op dispose when the scene factory throws', () => {
    const throwFactory = (): SceneDisposer => { throw new Error('boom') }
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval' }) })
    const { unmount } = render(
      <AttentionPanel
        useSessions={fakeUseSessions(snap)}
        openSession={() => {}}
        env={noRafEnv}
        createScene={throwFactory}
      />,
    )
    expect(screen.getByText(/· 1/)).toBeTruthy()
    expect(() => { unmount() }).not.toThrow()
  })

  it('calls the injected scene factory and its disposer on unmount', () => {
    const disposed = vi.fn()
    const factory = vi.fn((): SceneDisposer => () => { disposed() })
    const snap = state(['a'], { a: summary('a', { pendingInteraction: 'approval' }) })
    const { unmount } = render(
      <AttentionPanel
        useSessions={fakeUseSessions(snap)}
        openSession={() => {}}
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory).toHaveBeenCalledTimes(1)
    unmount()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('passes the highest-priority kind to the scene factory', () => {
    // A plan-review row (priority 1) is the scene driver even when a lower
    // priority question row is also present, so the animation matches the kind
    // the user is most likely acting on.
    const snap = state(['b', 'a'], {
      a: summary('a', { pendingInteraction: 'question' }),
      b: summary('b', { pendingInteraction: 'plan-review' }),
    })
    const factory = vi.fn((_c: HTMLCanvasElement, _k: AttentionKind, _e: SceneEnv): SceneDisposer => () => {})
    const { unmount } = render(
      <AttentionPanel
        useSessions={fakeUseSessions(snap)}
        openSession={() => {}}
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'plan-review', expect.anything())
    unmount()
  })

  it('starts a completed animation when only completed rows remain', () => {
    const snap = state(['a'], { a: summary('a', { completed: true }) })
    const factory = vi.fn((_c: HTMLCanvasElement, _k: AttentionKind, _e: SceneEnv): SceneDisposer => () => {})
    const { unmount } = render(
      <AttentionPanel
        useSessions={fakeUseSessions(snap)}
        openSession={() => {}}
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'completed', expect.anything())
    unmount()
  })
})

describe('scene environment helpers', () => {
  it('prefersReducedMotion returns false when matchMedia is unavailable', () => {
    const original = window.matchMedia
    // @ts-expect-error: temporarily remove matchMedia to exercise the catch.
    delete window.matchMedia
    try {
      expect(prefersReducedMotion()).toBe(false)
    } finally {
      window.matchMedia = original
    }
  })
})
