// @vitest-environment jsdom
/** createAttentionScene lifecycle: one-frame loop, reduced-motion, and dispose paths. */
import { describe, expect, it, vi } from 'vitest'
import {
  createAttentionScene, paintFrame, type SceneEnv, type SceneDisposer,
} from '../src/client/scene.ts'

function newCanvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

describe('createAttentionScene', () => {
  it('runs one frame when requestAnimationFrame fires, then disposes', () => {
    // A fake raf that calls the callback once (so the frame body runs) but does
    // not loop: the first registration runs the frame; the frame re-registers,
    // which we decline on the second call.
    let registered = 0
    const raf = (cb: () => void): number => {
      registered += 1
      if (registered === 1) cb() // run the frame body exactly once
      return registered
    }
    const caf = vi.fn()
    const env: SceneEnv = { reducedMotion: () => false, requestAnimationFrame: raf, cancelAnimationFrame: caf }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    expect(registered).toBeGreaterThanOrEqual(1)
    dispose()
    expect(caf).toHaveBeenCalledWith(expect.any(Number))
  })

  it('draws a static frame and disposes with no cancelAnimationFrame in reduced-motion mode', () => {
    const env: SceneEnv = { reducedMotion: () => true }
    const dispose: SceneDisposer = createAttentionScene(newCanvas(), '#34d399', env)
    // reducedMotion draws once synchronously; disposing with no caf still works.
    expect(() => { dispose() }).not.toThrow()
  })

  it('paints nothing when the 2D context is unavailable but does not throw', () => {
    // jsdom's getContext('2d') returns null, so paintFrame receives a null ctx.
    const env: SceneEnv = { reducedMotion: () => true }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
      dispose()
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to dpr 1 when devicePixelRatio is 0 or undefined', () => {
    const original = window.devicePixelRatio
    try {
      window.devicePixelRatio = 0
      const dispose = createAttentionScene(newCanvas(), '#f59e0b', { reducedMotion: () => true })
      expect(() => { dispose() }).not.toThrow()
    } finally {
      window.devicePixelRatio = original
    }
  })

  it('does not start the loop when requestAnimationFrame is unavailable and reducedMotion is false', () => {
    const env: SceneEnv = { reducedMotion: () => false }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    // handle stays 0, so dispose does not call a (absent) cancelAnimationFrame.
    expect(() => { dispose() }).not.toThrow()
  })

  it('pauses the RAF loop when the tab goes hidden and resumes when it returns', () => {
    let hidden = false
    let visCb: (() => void) | null = null
    let rafHandle = 0
    const raf = vi.fn((cb: () => void): number => { rafHandle += 1; visCb = cb; return rafHandle })
    const caf = vi.fn()
    const env: SceneEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    // Loop started: raf was called once.
    expect(raf).toHaveBeenCalledTimes(1)
    // Tab goes hidden → stopLoop cancels the handle.
    hidden = true
    visCb!()
    expect(caf).toHaveBeenCalledWith(rafHandle)
    expect(raf).toHaveBeenCalledTimes(1) // no new frame scheduled
    // Tab returns → startLoop schedules a new frame.
    hidden = false
    visCb!()
    expect(raf).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('does not pause/resume in reduced-motion mode (no loop to pause)', () => {
    let hidden = false
    let visCb: (() => void) | null = null
    const raf = vi.fn()
    const caf = vi.fn()
    const env: SceneEnv = {
      reducedMotion: () => true,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    // No loop started in reduced-motion mode.
    expect(raf).not.toHaveBeenCalled()
    // Visibility toggle does nothing.
    hidden = true
    visCb!()
    expect(caf).not.toHaveBeenCalled()
    dispose()
  })

  it('does not double-start when visibility fires visible while already running', () => {
    const hidden = false
    let visCb: (() => void) | null = null
    let rafHandle = 0
    const raf = vi.fn((_cb: () => void): number => { rafHandle += 1; return rafHandle })
    const caf = vi.fn()
    const env: SceneEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    expect(raf).toHaveBeenCalledTimes(1)
    // Fire "visible" while already running — handle !== 0, so startLoop is skipped.
    visCb!()
    expect(raf).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('does not double-stop when visibility fires hidden while already paused', () => {
    let hidden = false
    let visCb: (() => void) | null = null
    let rafHandle = 0
    const raf = vi.fn((_cb: () => void): number => { rafHandle += 1; return rafHandle })
    const caf = vi.fn()
    const env: SceneEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
      isHidden: () => hidden,
      onVisibilityChange: (cb) => { visCb = cb; return () => { visCb = null } },
    }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    // Pause once.
    hidden = true
    visCb!()
    expect(caf).toHaveBeenCalledTimes(1)
    // Fire "hidden" again — handle is 0, so stopLoop is skipped.
    visCb!()
    expect(caf).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('unsubscribes the visibility listener on dispose', () => {
    let unsubscribed = false
    let visCb: (() => void) | null = null
    const env: SceneEnv = {
      reducedMotion: () => false,
      requestAnimationFrame: vi.fn((_: () => void) => 1),
      cancelAnimationFrame: vi.fn(),
      isHidden: () => false,
      onVisibilityChange: (cb) => { visCb = cb; return () => { unsubscribed = true; visCb = null } },
    }
    const dispose = createAttentionScene(newCanvas(), '#f59e0b', env)
    dispose()
    expect(unsubscribed).toBe(true)
    // After dispose, a visibility callback (if somehow still wired) is a no-op.
    expect(() => { if (visCb) visCb() }).not.toThrow()
  })
})

describe('paintFrame on a stub context', () => {
  function newCtx(): { ctx: CanvasRenderingContext2D; calls: string[]; composite: () => string } {
    const calls: string[] = []
    let alpha = 1
    let composite = 'source-over'
    const ctx = {
      get globalAlpha(): number { return alpha },
      set globalAlpha(v: number) { alpha = v },
      get globalCompositeOperation(): string { return composite },
      set globalCompositeOperation(v: string) { composite = v },
      clearRect: () => { calls.push('clear') },
      drawImage: () => { calls.push('draw') },
    } as unknown as CanvasRenderingContext2D
    return { ctx, calls, composite: () => composite }
  }

  const sprite = {} as CanvasImageSource

  it('clears the full scaled bitmap and blits halo plus points additively', () => {
    const { ctx, calls, composite } = newCtx()
    paintFrame(ctx, {
      clear: true,
      halo: { alpha: 0.04, radius: 10 },
      points: [
        { sx: 1, sy: 2, alpha: 0.5, radius: 3 },
        { sx: 4, sy: 5, alpha: 0.6, radius: 2 },
      ],
    }, sprite, 2)
    expect(calls).toContain('clear')
    // One blit per drawable: the halo plus every point.
    expect(calls.filter(c => c === 'draw')).toHaveLength(3)
    // Alpha and composite mode are restored after the additive pass.
    expect(ctx.globalAlpha).toBe(1)
    expect(composite()).toBe('source-over')
  })

  it('skips clear when the frame does not request it', () => {
    const { ctx, calls } = newCtx()
    paintFrame(ctx, { clear: false, halo: { alpha: 0.04, radius: 10 }, points: [] }, sprite, 1)
    expect(calls).not.toContain('clear')
  })

  it('paints nothing when the sprite is unavailable', () => {
    const { ctx, calls } = newCtx()
    paintFrame(
      ctx,
      { clear: true, halo: { alpha: 0.04, radius: 10 }, points: [{ sx: 0, sy: 0, alpha: 1, radius: 1 }] },
      null,
      1,
    )
    expect(calls).toHaveLength(0)
  })
})
