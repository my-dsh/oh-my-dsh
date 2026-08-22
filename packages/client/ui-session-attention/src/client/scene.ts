/**
 * The attention panel's 3D animation: a small "planet system" rendered on a
 * Canvas2D context with hand-written perspective projection and depth sorting.
 * A shell of glowing particles rotates in 3D around a breathing center halo,
 * circled by a tilted orbit ring that carries one bright comet with a fading
 * trail. Every drawable is the same pre-rendered radial-gradient glow sprite
 * drawn additively (`lighter`), so overlapping particles accumulate luminosity
 * instead of opacity; per-point depth drives size and alpha, and each shell
 * particle twinkles on its own phase.
 *
 * The design stays dependency-free and fully testable in jsdom: projection,
 * depth falloff, and frame composition are pure functions over time, and the
 * canvas draw is driven by that pure {@link computeFrame} output. This package
 * deliberately does not depend on the three.js library: a WebGL render path is
 * unreachable under the per-file 100% coverage gate (jsdom has no WebGL
 * context), and the CDN load used by the dynamic prototype is a network
 * dependency unsuited to a published plugin. See the package README.
 */

/** Canvas drawing size (CSS px). */
export const SCENE_WIDTH = 244
/** Canvas drawing height (CSS px). */
export const SCENE_HEIGHT = 148
/** Perspective focal length for the projection (larger = flatter sphere). */
export const SCENE_FOCAL = 320
/** Number of particles on the shell. */
export const SCENE_POINTS = 64
/** Shell radius range (px) the particles distribute across. */
export const SCENE_INNER_RADIUS = 48
/** Outer shell radius (px) the particles distribute across. */
export const SCENE_OUTER_RADIUS = 62
/** Orbit-ring radius (px). */
export const SCENE_RING_RADIUS = 86
/** Orbit-ring tilt about the X axis (radians). */
export const SCENE_RING_TILT = 0.42
/** Number of dim particles tracing the orbit ring. */
export const SCENE_RING_POINTS = 60
/** Comet angular speed along the ring (radians per second). */
export const SCENE_COMET_SPEED = 1.15
/** Comet trail dots, including the head. */
export const SCENE_COMET_TRAIL = 10

// Visual-only render tunables; none are deployment-varying config.
const GLOW_SPRITE_PX = 64
const SHELL_GLOW_SCALE = 3.0
const RING_GLOW_SCALE = 1.5
const RING_ALPHA_SCALE = 0.38
const COMET_HEAD_GLOW_SCALE = 3.7
const COMET_HEAD_ALPHA = 0.9
const COMET_TRAIL_SPACING = 0.085
const COMET_TRAIL_GLOW_SCALE = 2.0
const COMET_TRAIL_ALPHA = 0.35
const HALO_RADIUS = 42
const HALO_ALPHA_BASE = 0.032
const HALO_ALPHA_WOBBLE = 0.014
const HALO_BREATH_SPEED = 1.1
const PULSE_SPEED = 1.6
const PULSE_AMPLITUDE = 0.035
const YAW_SPEED = 0.45
const PITCH_BASE = 0.12
const PITCH_WOBBLE_SPEED = 0.23
const PITCH_WOBBLE_AMPLITUDE = 0.32
const TWINKLE_SPEED = 2.1

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

/** A 3D point on the shell before perspective projection. */
export interface Point3 {
  theta: number
  phi: number
  r: number
  /** Per-point twinkle phase in radians; defaults to `0` when absent. */
  phase?: number
}

/**
 * Build the shell points for the particle sphere.
 * @param count - number of points.
 * @param innerRadius - minimum shell radius.
 * @param outerRadius - maximum shell radius.
 * @param rand - injectable RNG (0..1) for deterministic tests.
 * @returns the shell points.
 */
export function buildFallbackPoints(
  count: number,
  innerRadius: number,
  outerRadius: number,
  rand: () => number = Math.random,
): Point3[] {
  const pts: Point3[] = []
  for (let i = 0; i < count; i++) {
    pts.push({
      theta: rand() * Math.PI * 2,
      phi: Math.acos(2 * rand() - 1),
      r: innerRadius + rand() * (outerRadius - innerRadius),
      phase: rand() * Math.PI * 2,
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
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  pulse: number,
  cx: number,
  cy: number,
  focal: number,
): ProjectedPoint {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  const y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch)
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch)
  const scale = focal / (focal + z2)
  return { sx: cx + x1 * pulse * scale, sy: cy + y1 * pulse * scale, depth: z2 }
}

/**
 * Rotate one shell point by yaw/pitch (radians) and perspective project it onto
 * the canvas, applying a uniform scale pulse.
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
  yaw: number,
  pitch: number,
  pulse: number,
  cx: number,
  cy: number,
  focal: number,
): ProjectedPoint {
  return projectXYZ(
    point.r * Math.sin(point.phi) * Math.cos(point.theta),
    point.r * Math.cos(point.phi),
    point.r * Math.sin(point.phi) * Math.sin(point.theta),
    yaw, pitch, pulse, cx, cy, focal,
  )
}

/**
 * Alpha for a projected point by its depth (near particles stay bright while
 * far ones fade to a whisper, which is what keeps the sphere reading as 3D).
 * @param depth - the projected point's depth.
 * @returns a clamped alpha in `[0.10, 0.85]`.
 */
export function depthAlpha(depth: number): number {
  return Math.max(0.10, Math.min(0.85, (95 - depth) / 150))
}

/**
 * Glow core radius for a projected point (nearer = larger, quadratic so the
 * near/far contrast survives the additive blending).
 * @param depth - the projected point's depth.
 * @param focal - the perspective focal length.
 * @returns a radius floored at `1.0`, scaled by `(focal / (focal + depth))^2`.
 */
export function depthRadius(depth: number, focal: number): number {
  return Math.max(1.0, 2.4 * (focal / (focal + depth)) ** 2)
}

/**
 * One orbit-ring point in world space: a circle of {@link SCENE_RING_RADIUS}
 * tilted about the X axis by {@link SCENE_RING_TILT}.
 * @param angle - position on the ring in radians.
 * @returns the ring point's Cartesian coordinates.
 */
function ringXYZ(angle: number): { x: number; y: number; z: number } {
  const x = SCENE_RING_RADIUS * Math.cos(angle)
  const along = SCENE_RING_RADIUS * Math.sin(angle)
  return { x, y: along * Math.sin(SCENE_RING_TILT), z: along * Math.cos(SCENE_RING_TILT) }
}

/** One frame's drawable state (pure, testable without a canvas). */
export interface FrameState {
  /** Whether to clear before drawing this frame. */
  clear: boolean
  /** Breathing center halo drawn beneath every other drawable. */
  halo: { alpha: number; radius: number }
  /** The projected, depth-sorted drawables followed by the comet trail (on top). */
  points: ReadonlyArray<{ sx: number; sy: number; alpha: number; radius: number }>
}

/**
 * Compute one frame: project every shell particle and ring dot, depth-sort
 * them, append the comet and its fading trail, and derive the halo breath.
 * Pure over time `t` and the point set.
 * @param points - the shell points.
 * @param t - elapsed seconds.
 * @param width - canvas width.
 * @param height - canvas height.
 * @param focal - perspective focal length.
 * @returns the frame's drawable state.
 */
export function computeFrame(
  points: readonly Point3[],
  t: number,
  width: number,
  height: number,
  focal: number,
): FrameState {
  const cx = width / 2
  const cy = height / 2
  const pulse = 1 + Math.sin(t * PULSE_SPEED) * PULSE_AMPLITUDE
  const yaw = t * YAW_SPEED
  const pitch = PITCH_BASE + Math.sin(t * PITCH_WOBBLE_SPEED) * PITCH_WOBBLE_AMPLITUDE

  // Style rides through the sort: shell particles twinkle on their own phase,
  // ring dots stay dimmer and smaller than the shell at the same depth.
  interface Item {
    sx: number
    sy: number
    depth: number
    style: 'shell' | 'ring'
    phase: number
  }
  const items: Item[] = []
  for (const p of points) {
    const pr = projectPoint(p, yaw, pitch, pulse, cx, cy, focal)
    items.push({ sx: pr.sx, sy: pr.sy, depth: pr.depth, style: 'shell', phase: p.phase ?? 0 })
  }
  for (let i = 0; i < SCENE_RING_POINTS; i++) {
    const q = ringXYZ((i / SCENE_RING_POINTS) * Math.PI * 2)
    const pr = projectXYZ(q.x, q.y, q.z, yaw, pitch, pulse, cx, cy, focal)
    items.push({ sx: pr.sx, sy: pr.sy, depth: pr.depth, style: 'ring', phase: 0 })
  }
  items.sort((a, b) => b.depth - a.depth)

  const drawables = items.map((it) => {
    if (it.style === 'shell') {
      const twinkle = 0.82 + 0.18 * Math.sin(t * TWINKLE_SPEED + it.phase)
      return {
        sx: it.sx,
        sy: it.sy,
        alpha: Math.min(1, depthAlpha(it.depth) * twinkle),
        radius: depthRadius(it.depth, focal) * SHELL_GLOW_SCALE,
      }
    }
    return {
      sx: it.sx,
      sy: it.sy,
      alpha: depthAlpha(it.depth) * RING_ALPHA_SCALE,
      radius: depthRadius(it.depth, focal) * RING_GLOW_SCALE,
    }
  })

  // The comet draws last (on top): a bright head chased by trail dots whose
  // alpha falls off quadratically along the trail.
  for (let k = SCENE_COMET_TRAIL - 1; k >= 0; k--) {
    const q = ringXYZ(t * SCENE_COMET_SPEED + k * COMET_TRAIL_SPACING)
    const pr = projectXYZ(q.x, q.y, q.z, yaw, pitch, pulse, cx, cy, focal)
    const fade = 1 - k / SCENE_COMET_TRAIL
    drawables.push({
      sx: pr.sx,
      sy: pr.sy,
      alpha: k === 0 ? COMET_HEAD_ALPHA : COMET_TRAIL_ALPHA * fade * fade,
      radius: depthRadius(pr.depth, focal) * (k === 0 ? COMET_HEAD_GLOW_SCALE : COMET_TRAIL_GLOW_SCALE),
    })
  }

  return {
    clear: true,
    halo: {
      alpha: HALO_ALPHA_BASE + HALO_ALPHA_WOBBLE * Math.sin(t * HALO_BREATH_SPEED),
      radius: HALO_RADIUS,
    },
    points: drawables,
  }
}

/** Environment the scene factory reads instead of raw globals (testable). */
export interface SceneEnv {
  /** Whether motion should be reduced. */
  reducedMotion: () => boolean
  /** requestAnimationFrame (ambient, guarded). */
  requestAnimationFrame?: (cb: () => void) => number
  /** cancelAnimationFrame (ambient, guarded). */
  cancelAnimationFrame?: (handle: number) => void
  /** Whether the document is currently hidden (tab in background). */
  isHidden?: () => boolean
  /** Subscribe to visibility changes; returns an unsubscribe. */
  onVisibilityChange?: (cb: () => void) => () => void
}

/** A started scene's teardown. */
export type SceneDisposer = () => void

/**
 * Pre-render the radial-gradient glow sprite all drawables share. Stops are
 * built by appending 8-digit-hex alpha suffixes to the accent, so `accent`
 * must be `#rrggbb` (the `KIND_META` colors are).
 * @param accent - the `#rrggbb` accent color baked into the sprite.
 * @returns the sprite canvas, or `null` when no 2D context exists (jsdom).
 */
function createGlowSprite(accent: string): HTMLCanvasElement | null {
  const sprite = document.createElement('canvas')
  sprite.width = GLOW_SPRITE_PX
  sprite.height = GLOW_SPRITE_PX
  const g = sprite.getContext('2d')
  /* v8 ignore next 1 -- the sprite-drawing fall-through needs a real 2D context, which jsdom never provides */
  if (g === null) return null
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
}

/**
 * Paint one frame onto a 2D context. Separated from {@link createAttentionScene}
 * so a test can assert the draw without an animation loop. Everything blits the
 * same sprite additively; the caller owns restoring nothing because this
 * function restores alpha and composite mode itself.
 * @param ctx - the canvas 2D context (or null when unavailable).
 * @param frame - the frame state.
 * @param sprite - the glow sprite (or null when unavailable).
 * @param scale - device-pixel-ratio scale applied to coordinates/sizes; the
 *   clear always covers the full scaled bitmap so no residue accumulates.
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
 * Start the glowing planet-system animation on the canvas. Returns a disposer
 * that stops the loop. When the 2D context is unavailable (jsdom) the loop still
 * runs but paints nothing; the pure {@link computeFrame} is covered separately.
 * The loop pauses (cancels its RAF) when the document is hidden and resumes from
 * the same elapsed time when the tab returns, so a backgrounded tab does not burn
 * cycles on a nobody-is-looking animation.
 * @param canvas - the target canvas element.
 * @param accent - the `#rrggbb` accent color.
 * @param env - environment (reads reduced-motion; the frame loop; tab visibility).
 * @returns the scene disposer.
 */
export function createAttentionScene(
  canvas: HTMLCanvasElement,
  accent: string,
  env: SceneEnv,
): SceneDisposer {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = SCENE_WIDTH * dpr
  canvas.height = SCENE_HEIGHT * dpr
  const g = canvas.getContext('2d')
  const sprite = createGlowSprite(accent)
  const points = buildFallbackPoints(SCENE_POINTS, SCENE_INNER_RADIUS, SCENE_OUTER_RADIUS)
  const raf = env.requestAnimationFrame
  const caf = env.cancelAnimationFrame
  // Track elapsed time across pauses so the animation resumes seamlessly after
  // a backgrounded tab returns — `t0` is rebased at each resume by the paused
  // elapsed so the sphere keeps spinning from where it left off.
  let t0 = performance.now()
  let elapsed = 0
  let handle = 0
  let disposed = false
  const frame = (): void => {
    // requestAnimationFrame is always defined when this body runs (it is the
    // only caller), so the `: 0` arm is unreachable; kept as a closed backstop.
    /* v8 ignore next */
    handle = raf ? raf(frame) : 0
    const t = (performance.now() - t0) / 1000 + elapsed
    paintFrame(g, computeFrame(points, t, SCENE_WIDTH, SCENE_HEIGHT, SCENE_FOCAL), sprite, dpr)
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
    paintFrame(g, computeFrame(points, 0, SCENE_WIDTH, SCENE_HEIGHT, SCENE_FOCAL), sprite, dpr)
  } else {
    startLoop()
  }
  // Pause the RAF loop when the tab goes background; resume when it returns,
  // so a hidden tab does not burn cycles on a nobody-is-looking animation.
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
