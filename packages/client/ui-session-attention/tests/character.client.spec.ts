// @vitest-environment jsdom
/** Character animation engine: pure frame computation and lifecycle state machine. */
import { describe, expect, it, vi } from 'vitest'
import {
  computeCharacterFrame, paintCharacterFrame, createCharacterScene,
  CHARACTER_SIZE, SCENE_WIDTH, SCENE_HEIGHT,
  ENTER_DURATION, EXIT_DURATION, DANCE_DURATION,
  type CharacterPhase, type CharacterEnv, type CharacterDisposer,
} from '../src/client/character.ts'
import {
  advanceLifecycle, isPanelVisible, INITIAL_STATE, nextState, phaseOf,
} from '../src/client/character-lifecycle.ts'

describe('computeCharacterFrame', () => {
  const kinds = ['approval', 'plan-review', 'question', 'completed'] as const

  it('peek phase renders a partially-hidden, lower-alpha frame', () => {
    const phase: CharacterPhase = { phase: 'peek', progress: 0 }
    const frame = computeCharacterFrame('approval', phase)
    expect(frame.alpha).toBeLessThan(1)
    expect(frame.scale).toBeLessThan(1)
    // Peek hides the body: dy shifts it down (positive).
    expect(frame.dy).toBeGreaterThan(0)
  })

  it('enter phase interpolates from peek to standing as progress goes 0→1', () => {
    const at0 = computeCharacterFrame('approval', { phase: 'enter', progress: 0 })
    const at1 = computeCharacterFrame('approval', { phase: 'enter', progress: 1 })
    // At progress 1, the character should be closer to standing (smaller dy, larger scale).
    expect(at1.dy).toBeLessThanOrEqual(at0.dy)
    expect(at1.scale).toBeGreaterThanOrEqual(at0.scale)
    expect(at1.alpha).toBeGreaterThan(at0.alpha)
  })

  it('dance phase produces distinct motion per attention kind', () => {
    const frames = kinds.map(k =>
      computeCharacterFrame(k, { phase: 'dance', progress: 0.5 }),
    )
    // Every frame should be visible (alpha > 0).
    for (const f of frames) {
      expect(f.alpha).toBeGreaterThan(0)
      expect(f.alpha).toBeLessThanOrEqual(1)
    }
    // Question kind shows the "?" bubble; others do not.
    const questionFrame = computeCharacterFrame('question', { phase: 'dance', progress: 0.5 })
    expect(questionFrame.showQuestionMark).toBe(true)
    const approvalFrame = computeCharacterFrame('approval', { phase: 'dance', progress: 0.5 })
    expect(approvalFrame.showQuestionMark).toBe(false)
    // Completed shows sparkles.
    const completedFrame = computeCharacterFrame('completed', { phase: 'dance', progress: 0.5 })
    expect(completedFrame.showSparkle).toBe(true)
    // Plan-review shows sparkles during its "thinking" window.
    const planFrameMid = computeCharacterFrame('plan-review', { phase: 'dance', progress: 0.5 })
    expect(planFrameMid.showSparkle).toBe(true)
    const planFrameEarly = computeCharacterFrame('plan-review', { phase: 'dance', progress: 0.1 })
    expect(planFrameEarly.showSparkle).toBe(false)
  })

  it('dance cycles produce different motion at progress 0 vs 0.5 for each kind', () => {
    for (const k of kinds) {
      const f0 = computeCharacterFrame(k, { phase: 'dance', progress: 0 })
      const f5 = computeCharacterFrame(k, { phase: 'dance', progress: 0.5 })
      // At least one transform channel differs between two cycle points.
      const differs =
        f0.dx !== f5.dx || f0.dy !== f5.dy || f0.rotation !== f5.rotation ||
        f0.scale !== f5.scale || f0.squashX !== f5.squashX
      expect(differs).toBe(true)
    }
  })

  it('exit phase interpolates back toward the peek pose', () => {
    const at0 = computeCharacterFrame('approval', { phase: 'exit', progress: 0 })
    const at1 = computeCharacterFrame('approval', { phase: 'exit', progress: 1 })
    // At progress 1, dy is higher (character sinks down), scale is smaller.
    expect(at1.dy).toBeGreaterThan(at0.dy)
    expect(at1.scale).toBeLessThan(at0.scale)
  })

  it('all frame values are finite and within sane ranges', () => {
    for (const k of kinds) {
      for (const phase of ['peek', 'enter', 'dance', 'exit'] as const) {
        for (const p of [0, 0.25, 0.5, 0.75, 1]) {
          const f = computeCharacterFrame(k, { phase, progress: p })
          expect(Number.isFinite(f.dx)).toBe(true)
          expect(Number.isFinite(f.dy)).toBe(true)
          expect(Number.isFinite(f.rotation)).toBe(true)
          expect(Number.isFinite(f.scale)).toBe(true)
          expect(f.alpha).toBeGreaterThanOrEqual(0)
          expect(f.alpha).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('lifecycle state machine', () => {
  it('starts in peek state and stays when no attention', () => {
    const tick = advanceLifecycle('peek', false, 0.5)
    expect(tick.state).toBe('peek')
    expect(tick.phase.phase).toBe('peek')
  })

  it('transitions peek → enter when attention arrives', () => {
    const tick = advanceLifecycle('peek', true, 0)
    expect(tick.state).toBe('enter')
    expect(tick.phase.phase).toBe('enter')
    expect(tick.phase.progress).toBe(0)
  })

  it('transitions enter → dance after ENTER_DURATION', () => {
    const tick = advanceLifecycle('enter', true, ENTER_DURATION)
    expect(tick.state).toBe('dance')
    expect(tick.phase.phase).toBe('dance')
  })

  it('stays in enter while progress is below 1', () => {
    const tick = advanceLifecycle('enter', true, ENTER_DURATION * 0.5)
    expect(tick.state).toBe('enter')
    expect(tick.phase.phase).toBe('enter')
    expect(tick.phase.progress).toBeCloseTo(0.5, 1)
  })

  it('stays in exit while progress is below 1 (no attention)', () => {
    const tick = advanceLifecycle('exit', false, EXIT_DURATION * 0.5)
    expect(tick.state).toBe('exit')
    expect(tick.phase.phase).toBe('exit')
    expect(tick.phase.progress).toBeCloseTo(0.5, 1)
  })

  it('loops dance while attention is owed', () => {
    const tick = advanceLifecycle('dance', true, DANCE_DURATION * 1.5)
    expect(tick.state).toBe('dance')
    expect(tick.phase.phase).toBe('dance')
    // Progress wraps: 1.5 cycles → 0.5.
    expect(tick.phase.progress).toBeCloseTo(0.5, 1)
  })

  it('transitions dance → exit when attention clears', () => {
    const tick = advanceLifecycle('dance', false, 0.5)
    expect(tick.state).toBe('exit')
    expect(tick.phase.phase).toBe('exit')
  })

  it('transitions exit → peek when attention stays clear', () => {
    const tick = advanceLifecycle('exit', false, EXIT_DURATION)
    expect(tick.state).toBe('peek')
    expect(tick.phase.phase).toBe('peek')
  })

  it('transitions exit → enter when attention arrives mid-exit', () => {
    const tick = advanceLifecycle('exit', true, 0.3)
    expect(tick.state).toBe('exit') // still in exit until it completes
    const tick2 = advanceLifecycle('exit', true, EXIT_DURATION)
    expect(tick2.state).toBe('enter')
  })

  it('isPanelVisible is false only for peek', () => {
    expect(isPanelVisible('peek')).toBe(false)
    expect(isPanelVisible('enter')).toBe(true)
    expect(isPanelVisible('dance')).toBe(true)
    expect(isPanelVisible('exit')).toBe(true)
  })

  it('INITIAL_STATE is peek', () => {
    expect(INITIAL_STATE).toBe('peek')
  })
})

describe('nextState', () => {
  it('returns enter when attention arrives from peek', () => {
    expect(nextState('peek', true)).toBe('enter')
  })

  it('returns enter when attention arrives from exit', () => {
    expect(nextState('exit', true)).toBe('enter')
  })

  it('returns dance when attention stays and state is enter', () => {
    expect(nextState('enter', true)).toBe('dance')
  })

  it('returns dance when attention stays and state is dance', () => {
    expect(nextState('dance', true)).toBe('dance')
  })

  it('returns peek when no attention and state is peek', () => {
    expect(nextState('peek', false)).toBe('peek')
  })

  it('returns exit when no attention and state is dance', () => {
    expect(nextState('dance', false)).toBe('exit')
  })

  it('returns exit when no attention and state is enter', () => {
    expect(nextState('enter', false)).toBe('exit')
  })
})

describe('phaseOf', () => {
  it('returns peek phase with progress 1 for peek state', () => {
    const phase = phaseOf('peek', 0)
    expect(phase.phase).toBe('peek')
    expect(phase.progress).toBe(1)
  })

  it('returns enter phase with clamped progress for enter state', () => {
    expect(phaseOf('enter', ENTER_DURATION * 0.5).progress).toBeCloseTo(0.5, 1)
    expect(phaseOf('enter', ENTER_DURATION * 2).progress).toBe(1)
  })

  it('returns dance phase with wrapping progress for dance state', () => {
    const phase = phaseOf('dance', DANCE_DURATION * 1.5)
    expect(phase.phase).toBe('dance')
    expect(phase.progress).toBeCloseTo(0.5, 1)
  })

  it('returns exit phase with clamped progress for exit state', () => {
    expect(phaseOf('exit', EXIT_DURATION * 0.5).progress).toBeCloseTo(0.5, 1)
    expect(phaseOf('exit', EXIT_DURATION * 2).progress).toBe(1)
  })
})

describe('paintCharacterFrame on a stub context', () => {
  function newCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
    const calls: string[] = []
    let alpha = 1
    const ctx = {
      get globalAlpha(): number { return alpha },
      set globalAlpha(v: number) { alpha = v },
      clearRect: () => { calls.push('clear') },
      save: () => { calls.push('save') },
      restore: () => { calls.push('restore') },
      scale: () => { calls.push('scale') },
      translate: () => { calls.push('translate') },
      rotate: () => { calls.push('rotate') },
      drawImage: () => { calls.push('drawImage') },
      beginPath: () => { calls.push('beginPath') },
      arc: () => { calls.push('arc') },
      fill: () => { calls.push('fill') },
      fillRect: () => { calls.push('fillRect') },
      fillText: () => { calls.push('fillText') },
      stroke: () => { calls.push('stroke') },
      roundRect: () => { calls.push('roundRect') },
      ellipse: () => { calls.push('ellipse') },
      moveTo: () => { calls.push('moveTo') },
      lineTo: () => { calls.push('lineTo') },
      strokeStyle: '',
      fillStyle: '',
      font: '',
      lineWidth: 0,
      lineCap: '',
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  it('clears and draws the character frame', () => {
    const { ctx, calls } = newCtx()
    const frame = computeCharacterFrame('approval', { phase: 'dance', progress: 0.5 })
    paintCharacterFrame(ctx, frame, null, 1, 0)
    expect(calls).toContain('clear')
    // The fallback character draws body, eyes, etc. — at least beginPath + fill.
    expect(calls.filter(c => c === 'fill').length).toBeGreaterThan(0)
  })

  it('paints nothing when ctx is null', () => {
    const nullFrame = {
      dx: 0, dy: 0, rotation: 0, scale: 1, squashX: 1, squashY: 1,
      alpha: 1, showQuestionMark: false, showSparkle: false,
    }
    expect(() => { paintCharacterFrame(null, nullFrame, null, 1, 0) }).not.toThrow()
  })

  it('draws the question mark bubble when showQuestionMark is true', () => {
    const { ctx, calls } = newCtx()
    const frame = computeCharacterFrame('question', { phase: 'dance', progress: 0.5 })
    paintCharacterFrame(ctx, frame, null, 1, 0)
    expect(calls).toContain('fillText')
  })

  it('draws sparkles when showSparkle is true', () => {
    const { ctx, calls } = newCtx()
    const frame = computeCharacterFrame('completed', { phase: 'dance', progress: 0.5 })
    paintCharacterFrame(ctx, frame, null, 1, 0)
    expect(calls.filter(c => c === 'fillText').length).toBeGreaterThan(0)
  })
})

describe('createCharacterScene', () => {
  function newCanvas(): HTMLCanvasElement {
    return document.createElement('canvas')
  }

  it('runs one frame when raf fires, then disposes', () => {
    let registered = 0
    const raf = (cb: () => void): number => {
      registered += 1
      if (registered === 1) cb()
      return registered
    }
    const caf = vi.fn()
    const env: CharacterEnv = { reducedMotion: () => false, requestAnimationFrame: raf, cancelAnimationFrame: caf }
    const dispose = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'dance', progress: 0 }),
      kind: 'approval',
    })
    expect(registered).toBeGreaterThanOrEqual(1)
    dispose()
    expect(caf).toHaveBeenCalledWith(expect.any(Number))
  })

  it('draws a static frame in reduced-motion mode and disposes', () => {
    const env: CharacterEnv = { reducedMotion: () => true }
    const dispose: CharacterDisposer = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'peek', progress: 0 }),
      kind: 'completed',
    })
    expect(() => { dispose() }).not.toThrow()
  })

  it('paints nothing when 2D context is unavailable but does not throw', () => {
    const env: CharacterEnv = { reducedMotion: () => true }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const dispose = createCharacterScene(newCanvas(), undefined, env, {
        getPhase: () => ({ phase: 'dance', progress: 0 }),
        kind: 'approval',
      })
      dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to dpr 1 when devicePixelRatio is 0', () => {
    const original = window.devicePixelRatio
    try {
      window.devicePixelRatio = 0
      const dispose = createCharacterScene(newCanvas(), undefined, { reducedMotion: () => true }, {
        getPhase: () => ({ phase: 'peek', progress: 0 }),
        kind: 'approval',
      })
      expect(() => { dispose() }).not.toThrow()
    } finally {
      window.devicePixelRatio = original
    }
  })

  it('does not start the loop when raf is unavailable and reducedMotion is false', () => {
    const env: CharacterEnv = { reducedMotion: () => false }
    const dispose = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'dance', progress: 0 }),
      kind: 'approval',
    })
    expect(() => { dispose() }).not.toThrow()
  })

  it('pauses the RAF loop when the tab goes hidden and resumes when it returns', () => {
    let hidden = false
    let visCb: (() => void) | null = null
    let rafHandle = 0
    const raf = vi.fn((cb: () => void): number => { rafHandle += 1; visCb = cb; return rafHandle })
    const caf = vi.fn()
    const env: CharacterEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'dance', progress: 0 }),
      kind: 'approval',
    })
    expect(raf).toHaveBeenCalledTimes(1)
    hidden = true
    visCb!()
    expect(caf).toHaveBeenCalledWith(rafHandle)
    expect(raf).toHaveBeenCalledTimes(1)
    hidden = false
    visCb!()
    expect(raf).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('does not pause/resume in reduced-motion mode', () => {
    let hidden = false
    let visCb: (() => void) | null = null
    const raf = vi.fn()
    const caf = vi.fn()
    const env: CharacterEnv = {
      reducedMotion: () => true,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'peek', progress: 0 }),
      kind: 'approval',
    })
    expect(raf).not.toHaveBeenCalled()
    hidden = true
    visCb!()
    expect(caf).not.toHaveBeenCalled()
    dispose()
  })

  it('unsubscribes the visibility listener on dispose', () => {
    let unsubscribed = false
    let visCb: (() => void) | null = null
    const env: CharacterEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: vi.fn((_: () => void) => 1),
      cancelAnimationFrame: vi.fn(),
      isHidden: () => false,
      onVisibilityChange: (cb) => { visCb = cb; return () => { unsubscribed = true; visCb = null } },
    }
    const dispose = createCharacterScene(newCanvas(), undefined, env, {
      getPhase: () => ({ phase: 'dance', progress: 0 }),
      kind: 'approval',
    })
    dispose()
    expect(unsubscribed).toBe(true)
    expect(() => { if (visCb) visCb() }).not.toThrow()
  })
})

describe('constants', () => {
  it('exports sensible canvas and timing constants', () => {
    expect(SCENE_WIDTH).toBe(244)
    expect(SCENE_HEIGHT).toBe(148)
    expect(CHARACTER_SIZE).toBeGreaterThan(0)
    expect(ENTER_DURATION).toBeGreaterThan(0)
    expect(EXIT_DURATION).toBeGreaterThan(0)
    expect(DANCE_DURATION).toBeGreaterThan(0)
  })
})
