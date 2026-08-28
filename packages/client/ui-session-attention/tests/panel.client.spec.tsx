// @vitest-environment jsdom
/** AttentionPanel rendering against a fake useSessions hook and an injectable character scene. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AttentionPanel } from '../src/client/AttentionPanel.tsx'
import type { Translate } from '../src/client/AttentionPanel.tsx'
import type { AttentionKind } from '../src/client/attention.ts'
import { prefersReducedMotion, type CharacterEnv, type CharacterDisposer, type CharacterPhase } from '../src/client/character.ts'

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

/** A fake useSessionPendingInteraction that returns one fixed snapshot. */
function fakeUsePendingInteractions(
  snapshot: ReadonlyMap<SessionId, { kind: string }>,
): SnapshotSelectorHook<ReadonlyMap<SessionId, { kind: string }>> {
  return <S,>(sel: (s: ReadonlyMap<SessionId, { kind: string }>) => S): S => sel(snapshot)
}

/** Build a pending-interaction snapshot from session-id → kind entries. */
function pending(entries: Record<string, string>): ReadonlyMap<SessionId, { kind: string }> {
  const map = new Map<SessionId, { kind: string }>()
  for (const [id, kind] of Object.entries(entries)) map.set(id as SessionId, { kind })
  return map
}

/** Root standard hooks with an empty pending-interaction snapshot. */
const noopRootHooks = {
  useSessionPendingInteraction: fakeUsePendingInteractions(new Map<SessionId, { kind: string }>()) as never,
  useWorkspaces: (() => undefined) as never,
}

/** A scene env whose raf never fires (so no canvas draws in jsdom). */
const noRafEnv: CharacterEnv = { reducedMotion: () => false }
const reducedEnv: CharacterEnv = { reducedMotion: () => true }

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

  it('renders nothing when no session needs attention (peek mode)', () => {
    const snap = state(['a'], { a: summary('a') })
    const { container } = render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    // Peek mode: nothing renders — no wrap, no panel head/rows.
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(/· \d/)).toBeNull()
    expect(document.title).toBe('base')
  })

  it('renders the panel, head count, and rows for pending sessions', () => {
    const snap = state(
      ['a', 'b'],
      {
        a: summary('a', { displayTitle: 'Alpha' }),
        b: summary('b', { displayTitle: 'Beta' }),
      },
    )
    render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval', b: 'question' })) as never}
        openSession={() => {}} t={t} env={noRafEnv} />,
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
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)} openSession={() => {}} t={t} env={noRafEnv} />,
    )
    expect(screen.getByText(/title\.completed · 1/)).toBeTruthy()
    // The completed canvas box class is applied.
    expect(container.querySelector('[class*="canvasBoxCompleted"]')).toBeTruthy()
  })

  it('opens a session when a row is clicked and tags the tab title', () => {
    const snap = state(['a'], { a: summary('a', { displayTitle: 'Alpha' }) })
    const openSession = vi.fn()
    render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={openSession} env={noRafEnv} />,
    )
    expect(document.title).toBe('(1) base')
    act(() => { screen.getByText('Alpha').closest('button')!.click() })
    expect(openSession).toHaveBeenCalledWith('a')
  })

  it('restores the tab title when attention clears', () => {
    const snap = state(['a'], { a: summary('a') })
    const openSession = vi.fn()
    const { rerender } = render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={openSession} env={noRafEnv} />,
    )
    expect(document.title).toBe('(1) base')
    rerender(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(state(['a'], { a: summary('a') }))}
        openSession={openSession}
        env={noRafEnv}
      />,
    )
    expect(document.title).toBe('base')
  })

  it('shows a +N more tail beyond five rows', () => {
    const byId: Record<string, SessionSummary> = {}
    const pendingEntries: Record<string, string> = {}
    for (let i = 0; i < 7; i++) {
      byId['s' + String(i)] = summary('s' + String(i), { displayTitle: 'S' + String(i) })
      pendingEntries['s' + String(i)] = 'approval'
    }
    const snap = state(Object.keys(byId), byId)
    render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending(pendingEntries)) as never}
        openSession={() => {}} t={t} env={noRafEnv} />,
    )
    expect(screen.getByText('more 2')).toBeTruthy()
  })

  it('starts the character scene in reduced-motion mode (one static frame) and disposes', () => {
    const snap = state(['a'], { a: summary('a') })
    const { unmount } = render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={() => {}} env={reducedEnv} />,
    )
    // The panel mounted.
    expect(screen.getByText(/· 1/)).toBeTruthy()
    unmount()
  })

  it('uses the default Chinese copy for every attention kind and the +N more tail', () => {
    const byId: Record<string, SessionSummary> = {
      a: summary('a', { displayTitle: 'Alpha' }),
      b: summary('b', { displayTitle: 'Beta' }),
      c: summary('c', { displayTitle: 'Gamma' }),
      d1: summary('d1', { completed: true, displayTitle: 'Delta1' }),
      d2: summary('d2', { completed: true, displayTitle: 'Delta2' }),
      d3: summary('d3', { completed: true, displayTitle: 'Delta3' }),
      d4: summary('d4', { completed: true, displayTitle: 'Delta4' }),
    }
    const snap = state(Object.keys(byId), byId)
    render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval', b: 'plan-review', c: 'question' })) as never}
        openSession={() => {}} env={noRafEnv} />,
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
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    expect(screen.getByText(/回复完成 · 1/)).toBeTruthy()
  })

  it('builds the default scene env when no env is injected', () => {
    const snap = state(['a'], { a: summary('a') })
    const { unmount } = render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={() => {}} />,
    )
    expect(screen.getByText(/· 1/)).toBeTruthy()
    expect(() => { unmount() }).not.toThrow()
  })

  it('falls back to a no-op dispose when the scene factory throws', () => {
    const throwFactory = (): CharacterDisposer => { throw new Error('boom') }
    const snap = state(['a'], { a: summary('a') })
    const { unmount } = render(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
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
    const factory = vi.fn((): CharacterDisposer => () => { disposed() })
    const snap = state(['a'], { a: summary('a') })
    const { unmount } = render(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
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
    const snap = state(['b', 'a'], {
      a: summary('a'),
      b: summary('b'),
    })
    const factory = vi.fn(
      (_c: HTMLCanvasElement, _img: string | undefined, _e: CharacterEnv,
        _cb: { getPhase: () => CharacterPhase; kind: AttentionKind }): CharacterDisposer => () => {},
    )
    const { unmount } = render(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'question', b: 'plan-review' })) as never}
        openSession={() => {}}
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory.mock.calls[0]![3].kind).toBe('plan-review')
    unmount()
  })

  it('starts a completed animation when only completed rows remain', () => {
    const snap = state(['a'], { a: summary('a', { completed: true }) })
    const factory = vi.fn(
      (_c: HTMLCanvasElement, _img: string | undefined, _e: CharacterEnv,
        _cb: { getPhase: () => CharacterPhase; kind: AttentionKind }): CharacterDisposer => () => {},
    )
    const { unmount } = render(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(snap)}
        openSession={() => {}}
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory.mock.calls[0]![3].kind).toBe('completed')
    unmount()
  })

  it('accepts a characterImage prop and passes it to the scene factory', () => {
    const snap = state(['a'], { a: summary('a') })
    const factory = vi.fn(
      (_c: HTMLCanvasElement, _img: string | undefined, _e: CharacterEnv,
        _cb: { getPhase: () => CharacterPhase; kind: AttentionKind }): CharacterDisposer => () => {},
    )
    render(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(snap)}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={() => {}}
        characterImage="data:image/png;base64,abc"
        env={noRafEnv}
        createScene={factory}
      />,
    )
    expect(factory.mock.calls[0]![1]).toBe('data:image/png;base64,abc')
  })

  it('transitions from peek to panel when attention arrives', () => {
    const snap = state(['a'], { a: summary('a') })
    const { rerender } = render(
      <AttentionPanel {...noopRootHooks} useSessions={fakeUseSessions(snap)} openSession={() => {}} env={noRafEnv} />,
    )
    // Initially peek: no panel head.
    expect(screen.queryByText(/· \d/)).toBeNull()
    // Attention arrives.
    rerender(
      <AttentionPanel
        {...noopRootHooks}
        useSessions={fakeUseSessions(state(['a'], { a: summary('a', { displayTitle: 'Alpha' }) }))}
        useSessionPendingInteraction={fakeUsePendingInteractions(pending({ a: 'approval' })) as never}
        openSession={() => {}}
        env={noRafEnv}
      />,
    )
    // After re-render, the lifecycle effect runs and eventually the panel shows.
    // The RAF tick drives enter→dance; for this test we just check the panel
    // head appears (the lifecycle transitions through enter to dance).
    expect(screen.getByText('Alpha')).toBeTruthy()
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
