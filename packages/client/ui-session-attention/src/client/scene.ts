/**
 * The attention panel's four-distinct 3D animations, one per attention kind,
 * all rendered on a Canvas2D context with hand-written projection and depth
 * sorting. Each kind owns a recognizably different scene so the user can tell
 * at a glance what kind of reminder is awaiting action:
 *
 *  - `approval` — a "lens galaxy": a shell of glowing particles rotates in 3D
 *    around a breathing center halo, circled by a tilted orbit ring that
 *    carries one bright comet with a fading trail (the constellation is
 *    "still in motion, waiting on a verdict").
 *  - `plan-review` — a "radar sweep": two concentric dashed rings with a bright
 *    radial sweep line that rotates like a scanner, reading as a review
 *    scanning the plan.
 *  - `question` — a "signal ripple": a soft breathing core with thin expanding
 *    ring echoes that pulse outward and fade, reading as a question waiting
 *    for a reply.
 *  - `completed` — a calm breathing halo with a slow orbiting set of pulses,
 *    deliberately quiet to read as "finished, no urgency".
 *
 * Every drawable blits the same pre-rendered radial-gradient glow sprite
 * additively (`lighter`), so overlapping particles accumulate luminosity
 * instead of opacity. Projection, frame composition, and per-kind geometry are
 * pure functions over time `t`, kept deterministic (no `Math.random` inside the
 * frame path) so the whole scene is testable in jsdom without a canvas. This
 * package deliberately does not depend on the three.js library: a WebGL render
 * path is unreachable under the per-file 100% coverage gate (jsdom has no WebGL
 * context), and the CDN load used by the dynamic prototype is a network
 * dependency unsuited to a published plugin.
 */

import { KIND_META, type AttentionKind } from './attention.ts'

/** Canvas drawing width (CSS px). */
export const SCENE_WIDTH = 244
/** Canvas drawing height (CSS px). */
export const SCENE_HEIGHT = 148
/** Perspective focal length for 3D projection (larger = flatter sphere). */
export const SCENE_FOCAL = 320

// Visual-only render tunables; none are deployment-varying config. Shared
// pipeline constants keep the four kinds visually consistent in scale.
const GLOW_SPRITE_PX = 64
const HALO_ALPHA_BASE = 0.032
const HALO_ALPHA_WOBBLE = 0.014

// `approval` — swirling lens galaxy.
const LENS_SHELL_POINTS = 56
const LENS_SHELL_INNER = 48
const LENS_SHELL_OUTER = 62
const LENS_RING_RADIUS = 84
const LENS_RING_TILT = 0.42
const LENS_RING_POINTS = 56
const LENS_COMET_SPEED = 1.15
const LENS_COMET_TRAIL = 10
const LENS_SHELL_GLOW = 3.0
const LENS_RING_GLOW = 1.5
const LENS_RING_ALPHA = 0.38
const LENS_COMET_HEAD_GLOW = 3.7
const LENS_COMET_HEAD_ALPHA = 0.9
const LENS_COMET_TRAIL_SPACING = 0.085
const LENS_COMET_TRAIL_GLOW = 2.0
const LENS_COMET_TRAIL_ALPHA = 0.35
const LENS_YAW_SPEED = 0.45
const LENS_PITCH_BASE = 0.12
const LENS_PITCH_WOBBLE_SPEED = 0.23
const LENS_PITCH_WOBBLE_AMPLITUDE = 0.32
const LENS_TWINKLE_SPEED = 2.1
const LENS_PULSE_SPEED = 1.6
const LENS_PULSE_AMPLITUDE = 0.035
const LENS_BREATH_SPEED = 1.1

// `plan-review` — radar sweep.
const RADAR_RING_INNER = 46
const RADAR_RING_OUTER = 78
const RADAR_RING_DOTS = 80
const RADAR_RING_DASH = 4
const RADAR_RING_DOT_RADIUS = 2.6
const RADAR_RING_ALPHA = 0.16
const RADAR_SWEEP_DOTS = 42
const RADAR_SWEEP_SPEED = 1.7
const RADAR_SWEEP_HALF_WIDE = 0.25
const RADAR_SWEEP_HEAD_ALPHA = 0.95
const RADAR_SWEEP_HEAD_GLOW = 3.2
const RADAR_SWEEP_TRAIL_ALPHA = 0.3
const RADAR_SWEEP_TRAIL_GLOW = 1.9
const RADAR_BLIP_COUNT = 4
const RADAR_BLIP_GLOW = 2.4
const RADAR_BLIP_ALPHA = 0.8

// `question` — expanding ripple.
const RIPPLE_WAVES = 3
const RIPPLE_MAX_RADIUS = 92
const RIPPLE_POINTS_PER_WAVE = 56
const RIPPLE_SPEED = 1.5
const RIPPLE_WAVE_ALPHA = 0.16
const RIPPLE_BASE_ALPHA = 0.35
const RIPPLE_CORE_ALPHA = 0.5
const RIPPLE_CORE_GLOW = 2.8
const RIPPLE_PULSE_SPEED = 2.4
const RIPPLE_PULSE_AMPLITUDE = 0.05
const RIPPLE_BREATH_SPEED = 1.6

// `completed` — calm pulse.
const DONE_RING_RADIUS = 62
const DONE_RING_POINTS = 12
const DONE_RING_SPEED = 0.4
const DONE_RING_ALPHA = 0.5
const DONE_RING_GLOW = 2.2
const DONE_HALO_RADIUS = 46
const DONE_HALO_BREATH = 0.9

/**
 * Whether the user prefers reduced motion (the scene renders one static frame then).
 * @returns `true` when the media query matches; `false` when `matchMedia` is unavailable.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** A 3D point on a shell before perspective projection. */
export interface Point3 {
  theta: number
  phi: number
  r: number
  /** Per-point twinkle phase in radians; defaults to `0` when absent. */
  phase?: number
}

/**
 * Build the lens-shell points in a deterministic Fibonacci-sphere layout so
 * the `approval` scene (and its tests) is reproducible without a random source
 * in the frame path.
 * @param count - number of points.
 * @param innerRadius - minimum shell radius.
 * @param outerRadius - maximum shell radius.
 * @returns the shell points.
 */
export function buildFallbackPoints(
  count: number,
  innerRadius: number,
  outerRadius: number,
): Point3[] {
  // `count === 1` would divide by zero, so guard the smallest legal value.
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pts: Point3[] = []
  const denom = Math.max(1, count - 1)
  for (let i = 0; i < count; i++) {
    const y = i === 0 ? -1 : 1 - (2 * i) / denom
    pts.push({
      theta: golden * i,
      phi: Math.acos(Math.min(1, Math.max(-1, y))),
      r: i === 0 ? innerRadius : innerRadius + (i / denom) * (outerRadius - innerRadius),
      phase: (i / count) * Math.PI * 2,
    })
  }
  return pts
}

/** Projected 2D point with a depth used for size and alpha. */
export interface ProjectedPoint {
  sx: number
  sy: number
  depth: number
}

/**
 * Rotate one Cartesian point by yaw/pitch (radians) and perspective-project it
 * onto the canvas, applying a uniform scale pulse.
 * @param x - world X before rotation.
 * @param y - world Y before rotation.
 * @param z - world Z before rotation.
 * @param yaw - rotation about Y.
 * @param pitch - rotation about X.
 * @param pulse - uniform scale factor.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @param focal - perspective focal length.
 * @returns the projected point.
 */
function projectXYZ(
  x: number, y: number, z: number,
  yaw: number, pitch: number, pulse: number,
  cx: number, cy: number, focal: number,
): ProjectedPoint {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch)
  const scale = focal / (focal + z2)
  return { sx: cx + x1 * pulse * scale, sy: cy + y1 * pulse * scale, depth: z2 }
}

/**
 * Project a shell point by yaw/pitch (radians) and perspective-project it onto
 * the canvas.
 * @param point - the shell point.
 * @param yaw - rotation about Y.
 * @param pitch - rotation about X.
 * @param pulse - uniform scale factor.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @param focal - perspective focal length.
 * @returns the projected point.
 */
export function projectPoint(
  point: Point3,
  yaw: number, pitch: number, pulse: number,
  cx: number, cy: number, focal: number,
): ProjectedPoint {
  return projectXYZ(
    point.r * Math.sin(point.phi) * Math.cos(point.theta),
    point.r * Math.cos(point.phi),
    point.r * Math.sin(point.phi) * Math.sin(point.theta),
    yaw, pitch, pulse, cx, cy, focal,
  )
}

/**
 * Alpha for a projected point by its depth (near points stay bright while far
 * ones fade to a whisper, which is what keeps a sphere reading as 3D).
 * @param depth - the projected point's depth.
 * @returns a clamped alpha in `[0.10, 0.85]`.
 */
export function depthAlpha(depth: number): number {
  return Math.max(0.10, Math.min(0.85, (95 - depth) / 150))
}

/**
 * Glow radius for a projected point (nearer = larger, quadratic so the near/far
 * contrast survives additive blending).
 * @param depth - the projected point's depth.
 * @param focal - the perspective focal length.
 * @returns a radius floored at `1.0`.
 */
export function depthRadius(depth: number, focal: number): number {
  return Math.max(1.0, 2.4 * (focal / (focal + depth)) ** 2)
}

/**
 * One orbit-ring point in world space for the lens galaxy: a circle of
 * {@link LENS_RING_RADIUS} tilted about the X axis by {@link LENS_RING_TILT}.
 * @param angle - position on the ring in radians.
 * @returns the ring point's Cartesian coordinates.
 */
function lensRingXYZ(angle: number): { x: number; y: number; z: number } {
  const x = LENS_RING_RADIUS * Math.cos(angle)
  const along = LENS_RING_RADIUS * Math.sin(angle)
  return { x, y: along * Math.sin(LENS_RING_TILT), z: along * Math.cos(LENS_RING_TILT) }
}

/** One frame's drawable state (pure, testable without a canvas). */
export interface FrameState {
  /** Whether to clear before drawing this frame. */
  clear: boolean
  /** Breathing center halo drawn beneath every other drawable. */
  halo: { alpha: number; radius: number }
  /** The drawables to paint, in paint order (last = on top). */
  points: ReadonlyArray<{ sx: number; sy: number; alpha: number; radius: number }>
}

/**
 * `approval` scene: the swirling lens galaxy. A shell of glowing particles
 * rotates in 3D around a breathing core, circled by a tilted ring carrying one
 * bright comet with a fading trail. Reads as "in motion, awaiting a verdict".
 * @param t - elapsed seconds.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @param focal - perspective focal length.
 * @returns the frame state.
 */
function frameApproval(t: number, cx: number, cy: number, focal: number): FrameState {
  const shell = buildFallbackPoints(LENS_SHELL_POINTS, LENS_SHELL_INNER, LENS_SHELL_OUTER)
  const pulse = 1 + Math.sin(t * LENS_PULSE_SPEED) * LENS_PULSE_AMPLITUDE
  const yaw = t * LENS_YAW_SPEED
  const pitch = LENS_PITCH_BASE + Math.sin(t * LENS_PITCH_WOBBLE_SPEED) * LENS_PITCH_WOBBLE_AMPLITUDE

  interface Item {
    sx: number
    sy: number
    depth: number
    style: 'shell' | 'ring'
    phase: number
  }
  const items: Item[] = []
  for (const p of shell) {
    const pr = projectPoint(p, yaw, pitch, pulse, cx, cy, focal)
    items.push({ sx: pr.sx, sy: pr.sy, depth: pr.depth, style: 'shell', phase: p.phase ?? 0 })
  }
  for (let i = 0; i < LENS_RING_POINTS; i++) {
    const q = lensRingXYZ((i / LENS_RING_POINTS) * Math.PI * 2)
    const pr = projectXYZ(q.x, q.y, q.z, yaw, pitch, pulse, cx, cy, focal)
    items.push({ sx: pr.sx, sy: pr.sy, depth: pr.depth, style: 'ring', phase: 0 })
  }
  items.sort((a, b) => b.depth - a.depth)

  const drawables = items.map((it) => {
    if (it.style !== 'ring') {
      const twinkle = 0.82 + 0.18 * Math.sin(t * LENS_TWINKLE_SPEED + it.phase)
      return {
        sx: it.sx, sy: it.sy,
        alpha: Math.min(1, depthAlpha(it.depth) * twinkle),
        radius: depthRadius(it.depth, focal) * LENS_SHELL_GLOW,
      }
    }
    return {
      sx: it.sx, sy: it.sy,
      alpha: depthAlpha(it.depth) * LENS_RING_ALPHA,
      radius: depthRadius(it.depth, focal) * LENS_RING_GLOW,
    }
  })

  // The comet draws last (on top): a bright head chased by trail dots whose
  // alpha falls off quadratically along the trail.
  for (let k = LENS_COMET_TRAIL - 1; k >= 0; k--) {
    const q = lensRingXYZ(t * LENS_COMET_SPEED + k * LENS_COMET_TRAIL_SPACING)
    const pr = projectXYZ(q.x, q.y, q.z, yaw, pitch, pulse, cx, cy, focal)
    const fade = 1 - k / LENS_COMET_TRAIL
    drawables.push({
      sx: pr.sx, sy: pr.sy,
      alpha: k === 0 ? LENS_COMET_HEAD_ALPHA : LENS_COMET_TRAIL_ALPHA * fade * fade,
      radius: depthRadius(pr.depth, focal) * (k === 0 ? LENS_COMET_HEAD_GLOW : LENS_COMET_TRAIL_GLOW),
    })
  }

  return {
    clear: true,
    halo: {
      alpha: HALO_ALPHA_BASE + HALO_ALPHA_WOBBLE * Math.sin(t * LENS_BREATH_SPEED),
      radius: 42,
    },
    points: drawables,
  }
}

/**
 * Build a dashed planar ring of dots centered on the origin, stepping by `dash`
 * so long arcs read as a dashed scan ring.
 * @param radius - circle radius in px.
 * @param count - ring dot count.
 * @param dash - draw only every `dash`-th dot (dash >= 1).
 * @returns `{dx, dy}` offsets around the ring.
 */
function dashedRing(radius: number, count: number, dash: number): Array<{ dx: number; dy: number }> {
  const out: Array<{ dx: number; dy: number }> = []
  for (let i = 0; i < count; i++) {
    if (dash > 1 && i % dash !== 0) continue
    const a = (i / count) * Math.PI * 2
    out.push({ dx: radius * Math.cos(a), dy: radius * Math.sin(a) })
  }
  return out
}

/**
 * `plan-review` scene: a radar sweep. Two concentric dashed rings and a bright
 * radial sweep line that rotates around the center, each with a couple of blips.
 * Reads as a review scanning the plan.
 * @param t - elapsed seconds.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @returns the frame state.
 */
function framePlanReview(t: number, cx: number, cy: number): FrameState {
  const drawables: Array<{ sx: number; sy: number; alpha: number; radius: number }> = []
  for (const radius of [RADAR_RING_INNER, RADAR_RING_OUTER]) {
    for (const p of dashedRing(radius, RADAR_RING_DOTS, RADAR_RING_DASH)) {
      drawables.push({
        sx: cx + p.dx, sy: cy + p.dy,
        alpha: RADAR_RING_ALPHA, radius: RADAR_RING_DOT_RADIUS,
      })
    }
  }
  // The sweeping radial arm: head on the leading edge, a fading trail behind.
  const armAngle = t * RADAR_SWEEP_SPEED
  for (let k = 0; k < RADAR_SWEEP_DOTS; k++) {
    const d = k / (RADAR_SWEEP_DOTS - 1)
    const r = RADAR_RING_OUTER * d
    const a = armAngle - Math.PI * RADAR_SWEEP_HALF_WIDE * d
    const fade = 1 - d
    drawables.push({
      sx: cx + r * Math.cos(a),
      sy: cy + r * Math.sin(a),
      alpha: k === RADAR_SWEEP_DOTS - 1 ? RADAR_SWEEP_HEAD_ALPHA : RADAR_SWEEP_TRAIL_ALPHA * fade * fade,
      radius: k === RADAR_SWEEP_DOTS - 1 ? RADAR_SWEEP_HEAD_GLOW : RADAR_SWEEP_TRAIL_GLOW,
    })
  }
  // A few rotating blips ("targets" being scanned).
  for (let b = 0; b < RADAR_BLIP_COUNT; b++) {
    const r = RADAR_RING_INNER + ((t * 0.7 + b * 1.7) % (RADAR_RING_OUTER - RADAR_RING_INNER))
    const a = armAngle + (b * 2.2) % (Math.PI * 2)
    drawables.push({ sx: cx + r * Math.cos(a), sy: cy + r * Math.sin(a), alpha: RADAR_BLIP_ALPHA, radius: RADAR_BLIP_GLOW })
  }
  return {
    clear: true,
    halo: { alpha: HALO_ALPHA_BASE * 0.5, radius: 30 },
    points: drawables,
  }
}

/**
 * `question` scene: a breathing core with expanding ripple rings that echo
 * outward and fade, like a question pulse awaiting a reply.
 * @param t - elapsed seconds.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @returns the frame geometry.
 */
function frameQuestion(t: number, cx: number, cy: number): FrameState {
  const drawables: Array<{ sx: number; sy: number; alpha: number; radius: number }> = []
  // The breathing core.
  const corePulse = RIPPLE_PULSE_AMPLITUDE * Math.sin(t * RIPPLE_PULSE_SPEED)
  drawables.push({
    sx: cx, sy: cy,
    alpha: RIPPLE_CORE_ALPHA,
    radius: RIPPLE_CORE_GLOW * (1 + corePulse),
  })
  // Expanding ripples, each offset in time so they read as a continuous echo.
  for (let w = 0; w < RIPPLE_WAVES; w++) {
    const phase = (t * RIPPLE_SPEED + w / RIPPLE_WAVES) % 1
    const radius = RIPPLE_MAX_RADIUS * phase
    const ringAlpha = RIPPLE_WAVE_ALPHA * (1 - phase)
    for (const p of dashedRing(radius, RIPPLE_POINTS_PER_WAVE, 2)) {
      drawables.push({
        sx: cx + p.dx, sy: cy + p.dy,
        alpha: ringAlpha, radius: RIPPLE_BASE_ALPHA,
      })
    }
  }
  return {
    clear: true,
    halo: {
      alpha: HALO_ALPHA_BASE + HALO_ALPHA_WOBBLE * Math.sin(t * RIPPLE_BREATH_SPEED),
      radius: 26,
    },
    points: drawables,
  }
}

/**
 * `completed` scene: a calm breathing halo with a slow orbiting pulse — quiet,
 * no urgency.
 * @param t - elapsed seconds.
 * @param cx - canvas center X.
 * @param cy - canvas center Y.
 * @returns the frame geometry.
 */
function frameCompleted(t: number, cx: number, cy: number): FrameState {
  const drawables: Array<{ sx: number; sy: number; alpha: number; radius: number }> = []
  const angle = t * DONE_RING_SPEED
  for (let i = 0; i < DONE_RING_POINTS; i++) {
    const a = angle + (i / DONE_RING_POINTS) * Math.PI * 2
    drawables.push({
      sx: cx + DONE_RING_RADIUS * Math.cos(a),
      sy: cy + DONE_RING_RADIUS * Math.sin(a),
      alpha: DONE_RING_ALPHA,
      radius: DONE_RING_GLOW,
    })
  }
  return {
    clear: true,
    halo: {
      alpha: HALO_ALPHA_BASE + HALO_ALPHA_WOBBLE * Math.sin(t * DONE_HALO_BREATH),
      radius: DONE_HALO_RADIUS,
    },
    points: drawables,
  }
}

/**
 * Compute the current frame for the animation of one attention kind.
 * @param kind - the attention kind whose scene to render.
 * @param t - elapsed seconds.
 * @param width - canvas width (CSS px) used to center the scene.
 * @param height - canvas height (CSS px) used to center the scene.
 * @param focal - perspective focal length.
 * @returns the frame's drawable state.
 */
export function computeScene(
  kind: AttentionKind,
  t: number,
  width: number,
  height: number,
  focal: number,
): FrameState {
  const cx = width / 2
  const cy = height / 2
  switch (kind) {
    case 'approval':
      return frameApproval(t, cx, cy, focal)
    case 'plan-review':
      return framePlanReview(t, cx, cy)
    case 'question':
      return frameQuestion(t, cx, cy)
    case 'completed':
      return frameCompleted(t, cx, cy)
  }
}

/** Environment the scene factory reads instead of raw globals (testable). */
export interface SceneEnv {
  /** Whether motion should be reduced. */
  reducedMotion: () => boolean
  /** requestAnimationFrame (ambient, guarded). */
  requestAnimationFrame?: (cb: () => void) => number
  /** cancelAnimationFrame (ambient, guarded). */
  cancelAnimationFrame?: (debounce: number) => void
  /** Whether the document is currently hidden (tab in background). */
  isHidden?: () => boolean
  /** Subscribe to visibility changes; close over the unsubscriber. */
  onVisibilityChange?: (cb: () => void) => () => void
}

/** A started scene's teardown. */
export type SceneDisposer = () => void

/**
 * Pre-render the radial-gradient glow sprite all drawables share. Stops are
 * built by appending 8-digit hex alpha suffixes to the accent, so `accent`
 * must be `#rrggbb` (the `KIND_META` colors are).
 * @param accent - the `#rrggbb` accent color baked into the sprite.
 * @returns the sprite canvas, or `null` when no 2D context exists (jsdom).
 */
function createGlowSprite(accent: string): HTMLCanvasElement | null {
  const sprite = document.createElement('canvas')
  sprite.width = GLOW_SPRITE_PX
  sprite.height = GLOW_SPRITE_PX
  const g = sprite.getContext('2d')
  // jsdom has no 2D context; return null so paint skips (covered by test).
  if (g === null) return null
  /* v8 ignore start -- the gradient fill needs a real 2D context, which jsdom never provides */
  const gradient = g.createRadialGradient(
    GLOW_SPRITE_PX / 2, GLOW_SPRITE_PX / 2, 0,
    GLOW_SPRITE_PX / 2, GLOW_SPRITE_PX / 2, GLOW_SPRITE_PX / 2,
  )
  gradient.addColorStop(0, accent + 'ff')
  gradient.addColorStop(0.38, accent + '59')
  gradient.addColorStop(1, accent + '00')
  g.fillStyle = gradient
  g.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX)
  return sprite
  /* v8 ignore stop */
}

/**
 * Paint one frame onto a 2D context. Everything blits the same sprite
 * additively; this function restores alpha and composite mode itself.
 * @param now - the canvas 2D context (or null when unavailable).
 * @param frame - the frame state.
 * @param sprite - the glow sprite (or null when unavailable).
 * @param scale - device-pixel-ratio scale applied to coordinates and sizes.
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D | null,
  frame: FrameState,
  sprite: CanvasImageSource | null,
  scale: number,
): void {
  if (ctx === null || sprite === null) return
  if (frame.clear) ctx.clearRect(0, 0, SCENE_WIDTH * scale, SCENE_HEIGHT * scale)
  const previousOperation = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = frame.halo.alpha
  const haloSize = frame.halo.radius * 2 * scale
  ctx.drawImage(
    sprite,
    (SCENE_WIDTH / 2 - frame.halo.radius) * scale,
    (SCENE_HEIGHT / 2 - frame.halo.radius) * scale,
    haloSize, haloSize,
  )
  for (const p of frame.points) {
    ctx.globalAlpha = p.alpha
    const size = p.radius * 2 * scale
    ctx.drawImage(sprite, p.sx * scale - size / 2, p.sy * scale - size / 2, size, size)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = previousOperation
}

/**
 * Start the kind-specific animation on a canvas and return a disposer that
 * stops the loop. When the 2D context is unavailable (jsdom) the loop still runs
 * but paints nothing; the pure {@link computeScene} is covered separately. The
 * loop pauses (cancels its RAF) when the document is hidden and resumes from the
 * same elapsed time when the tab returns.
 * @param canvas - the target canvas element.
 * @param kind - the attention kind whose scene to render.
 * @param env - environment (reduced-motion; the frame loop; tab visibility).
 * @returns the scene disposer.
 */
export function createAttentionScene(
  canvas: HTMLCanvasElement,
  kind: AttentionKind,
  env: SceneEnv,
): SceneDisposer {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = SCENE_WIDTH * dpr
  canvas.height = SCENE_HEIGHT * dpr
  const g = canvas.getContext('2d')
  const accent = KIND_META[kind].color
  const sprite = createGlowSprite(accent)
  const raf = env.requestAnimationFrame
  const caf = env.cancelAnimationFrame
  // Track elapsed time across pauses so the loop resumes seamlessly after a
  // backgrounded tab returns — `t0` is rebased at each resume by the paused
  // elapsed so the scene keeps running from where it left off.
  let t0 = performance.now()
  let elapsed = 0
  let handle = 0
  let disposed = false
  const frame = (): void => {
    // requestAnimationFrame is always defined when this body runs (it is the
    // only caller), so the `: 0` arm is unreachable; kept as a closed backstop.
    /* v8 ignore next -- `raf` is always defined when `frame` runs (its sole caller) */
    handle = raf ? raf(frame) : 0
    const t = (performance.now() - t0) / 1000 + elapsed
    paintFrame(g, computeScene(kind, t, SCENE_WIDTH, SCENE_HEIGHT, SCENE_FOCAL), sprite, dpr)
  }
  const startLoop = (): void => {
    t0 = performance.now()
    handle = raf ? raf(frame) : 0
  }
  const stopLoop = (): void => {
    if (handle !== 0 && caf !== undefined) caf(handle)
    handle = 0
    elapsed += (performance.now() - t0) / 1000
  }
  if (env.reducedMotion()) {
    paintFrame(g, computeScene(kind, 0, SCENE_WIDTH, SCENE_HEIGHT, SCENE_FOCAL), sprite, dpr)
  } else {
    startLoop()
  }
  // Pause the RAF loop when the tab goes background; resume when it returns, so
  // a hidden tab does not burn cycles on a nobody-is-looking animation.
  const onVis = (): void => {
    if (disposed || env.reducedMotion()) return
    if (env.isHidden?.() === true) {
      if (handle !== 0) stopLoop()
    } else if (handle === 0) {
      startLoop()
    }
  }
  const offVis = env.onVisibilityChange?.(onVis) ?? (() => {})
  return () => {
    disposed = true
    offVis()
    if (handle !== 0 && caf !== undefined) caf(handle)
    handle = 0
  }
}
