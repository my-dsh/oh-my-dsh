/**
 * The character animation engine: replaces the old particle scene with a
 * single-PNG (or procedural-fallback) character that peeks in from the top-right
 * edge, jumps out, plays a kind-specific "dance", then retreats back to its
 * peek pose. Every per-frame transform is a pure function of elapsed time `t`
 * and a lifecycle `phase` (0→1 progress through the current phase), kept
 * deterministic (no `Math.random` in the frame path) so it is fully testable in
 * jsdom without a real canvas context.
 *
 * Four dances map to the four attention kinds:
 *  - `approval` — an urgent fidget: quick hops, body shake, foot-stomp pulse.
 *  - `plan-review` — a thinking sway: head tilt, slow side-step, chin-rub.
 *  - `question` — a confused wiggle: head-tilt left, bounce, head-tilt right.
 *  - `completed` — a celebration: bounce-jumps, body sway, spin, extra hold.
 *
 * The PNG is drawn with Canvas2D `drawImage` under per-frame
 * translate/rotate/scale/squash transforms. When no PNG is provided (or the
 * image fails to load), {@link drawFallbackCharacter} paints a simple
 * round-bodied creature with eyes and small limbs from Canvas2D paths — so the
 * animation works out-of-the-box without any user asset.
 */
import type { AttentionKind } from './attention.ts'

/** Canvas drawing width (CSS px). */
export const SCENE_WIDTH = 244
/** Canvas drawing height (CSS px). */
export const SCENE_HEIGHT = 148

/** Character anchor: bottom-center of the canvas (the character "stands" here). */
const GROUND_X = SCENE_WIDTH / 2
const GROUND_Y = SCENE_HEIGHT - 18

/** Default character body size (px) when drawn as fallback or as PNG bounding box. */
export const CHARACTER_SIZE = 72

// --- Lifecycle phases -------------------------------------------------------
//
// The character cycles through phases driven by {@link character-lifecycle.ts}.
// Each phase has a duration; `phase` below is normalized progress [0,1].

/** Duration of the peek-out enter animation (seconds). */
export const ENTER_DURATION = 0.6
/** Duration of the exit / retreat animation (seconds). */
export const EXIT_DURATION = 0.5
/** Duration of one dance cycle before it loops (seconds). */
export const DANCE_DURATION = 2.4

// --- Animation easing -------------------------------------------------------

/**
 * Smooth ease-in-out (cubic), used for enter/exit transitions.
 * @param x - linear progress [0,1].
 * @returns eased progress [0,1].
 */
function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * Elastic ease-out: overshoots then settles, used for the "jump out" pop.
 * @param x - linear progress [0,1].
 * @returns eased progress that overshoots 1 then settles.
 */
function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

/**
 * Damped sine bounce: repeated diminishing hops.
 * @param x - linear progress [0,1].
 * @param bounces - number of bounce cycles.
 * @returns a vertical offset in [0,1] that bounces and decays.
 */
function bounce(x: number, bounces: number): number {
  return Math.abs(Math.sin(x * Math.PI * bounces)) * (1 - x * 0.6)
}

// --- Frame state (pure, testable) -------------------------------------------

/** One character frame's full transform state. Pure data — no canvas needed. */
export interface CharacterFrame {
  /** X offset from ground anchor (px, +right). */
  dx: number
  /** Y offset from ground anchor (px, +down / -up). */
  dy: number
  /** Rotation in radians (clockwise). */
  rotation: number
  /** Uniform scale multiplier. */
  scale: number
  /** Horizontal squash factor (1 = normal, <1 = squished horizontally). */
  squashX: number
  /** Vertical squash factor (1 = normal, <1 = squished vertically). */
  squashY: number
  /** Alpha [0,1] for the whole character. */
  alpha: number
  /** Whether to draw the "?" thought-bubble above the character. */
  showQuestionMark: boolean
  /** Whether to draw the "✨" sparkle around the character. */
  showSparkle: boolean
}

/** A neutral idle frame (character fully hidden / peeking). */
const PEEK_FRAME: CharacterFrame = {
  dx: 0,
  dy: CHARACTER_SIZE * 0.55,
  rotation: 0,
  scale: 0.5,
  squashX: 1,
  squashY: 1,
  alpha: 0.7,
  showQuestionMark: false,
  showSparkle: false,
}

/** A fully-visible standing frame. */
const STAND_FRAME: CharacterFrame = {
  dx: 0,
  dy: 0,
  rotation: 0,
  scale: 1,
  squashX: 1,
  squashY: 1,
  alpha: 1,
  showQuestionMark: false,
  showSparkle: false,
}

/** Helper: clamp a value to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Compute the enter-transition frame: character slides up from its peek pose
 * to a standing pose with an elastic overshoot.
 * @param p - normalized phase progress [0,1].
 * @returns the enter frame.
 */
function enterFrame(p: number): CharacterFrame {
  const e = easeOutBack(clamp(p, 0, 1))
  return {
    ...STAND_FRAME,
    dy: PEEK_FRAME.dy * (1 - e),
    scale: 0.5 + 0.5 * clamp(e, 0, 1.15),
    alpha: clamp(0.7 + 0.3 * p, 0, 1),
  }
}

/**
 * Compute the exit-transition frame: character slides back down to its peek pose.
 * @param p - normalized phase progress [0,1].
 * @returns the exit frame.
 */
function exitFrame(p: number): CharacterFrame {
  const e = easeInOut(clamp(p, 0, 1))
  return {
    dx: STAND_FRAME.dx + (PEEK_FRAME.dx - STAND_FRAME.dx) * e,
    dy: STAND_FRAME.dy + (PEEK_FRAME.dy - STAND_FRAME.dy) * e,
    rotation: STAND_FRAME.rotation + (PEEK_FRAME.rotation - STAND_FRAME.rotation) * e,
    scale: STAND_FRAME.scale + (PEEK_FRAME.scale - STAND_FRAME.scale) * e,
    squashX: 1,
    squashY: 1,
    alpha: 1 - 0.3 * e,
    showQuestionMark: false,
    showSparkle: false,
  }
}

// --- Per-kind dance frames --------------------------------------------------
//
// Each dance is a 0→1 cycle over DANCE_DURATION seconds. The character is
// already standing (enter complete). We layer kind-specific motion on top.

/**
 * `approval` dance: urgent fidget — quick hops, body shake, foot stomp.
 * @param c - cycle progress [0,1].
 * @returns the dance frame.
 */
function danceApproval(c: number): CharacterFrame {
  const hop = bounce(c * 2, 2) * 14
  const shake = Math.sin(c * Math.PI * 8) * 3
  const stomp = Math.sin(c * Math.PI * 6) * 0.04
  return {
    dx: shake,
    dy: -hop,
    rotation: shake * 0.01,
    scale: 1,
    squashX: 1 + stomp,
    squashY: 1 - stomp,
    alpha: 1,
    showQuestionMark: false,
    showSparkle: false,
  }
}

/**
 * `plan-review` dance: thinking sway — slow side-step, head tilt, chin rub.
 * @param c - cycle progress [0,1].
 * @returns the dance frame.
 */
function dancePlanReview(c: number): CharacterFrame {
  const sway = Math.sin(c * Math.PI * 2) * 16
  const tilt = Math.sin(c * Math.PI * 2) * 0.12
  const breathe = 1 + Math.sin(c * Math.PI * 4) * 0.02
  return {
    dx: sway,
    dy: 0,
    rotation: tilt,
    scale: breathe,
    squashX: 1,
    squashY: 1,
    alpha: 1,
    showQuestionMark: false,
    showSparkle: c > 0.3 && c < 0.7,
  }
}

/**
 * `question` dance: confused wiggle — alternating head tilts with a "?" bubble.
 * @param c - cycle progress [0,1].
 * @returns the dance frame.
 */
function danceQuestion(c: number): CharacterFrame {
  const wiggle = Math.sin(c * Math.PI * 3) * 0.15
  const bob = Math.abs(Math.sin(c * Math.PI * 2)) * 4
  return {
    dx: 0,
    dy: -bob,
    rotation: wiggle,
    scale: 1,
    squashX: 1,
    squashY: 1,
    alpha: 1,
    showQuestionMark: true,
    showSparkle: false,
  }
}

/**
 * `completed` dance: celebration — bounce jumps, sway, spin, sparkle.
 * @param c - cycle progress [0,1].
 * @returns the dance frame.
 */
function danceCompleted(c: number): CharacterFrame {
  const jump = bounce(c * 3, 3) * 18
  const sway = Math.sin(c * Math.PI * 2) * 8
  const spin = c < 0.5 ? 0 : (c - 0.5) * 2 * Math.PI * 0.5
  return {
    dx: sway,
    dy: -jump,
    rotation: spin,
    scale: 1,
    squashX: 1,
    squashY: 1,
    alpha: 1,
    showQuestionMark: false,
    showSparkle: true,
  }
}

/**
 * Map an attention kind to its dance frame function.
 */
const DANCE_FN: Record<AttentionKind, (c: number) => CharacterFrame> = {
  approval: danceApproval,
  'plan-review': dancePlanReview,
  question: danceQuestion,
  completed: danceCompleted,
}

/** Lifecycle phase identifiers, driven by {@link character-lifecycle.ts}. */
export type LifecyclePhase = 'peek' | 'enter' | 'dance' | 'exit'

/** Which lifecycle phase the character is currently in. */
export interface CharacterPhase {
  phase: LifecyclePhase
  /** Normalized progress within the current phase [0,1]. */
  progress: number
}

/**
 * Compute one character frame from the attention kind, elapsed time, and
 * current lifecycle phase. Pure — no canvas, no globals, fully testable.
 *
 * @param kind - the attention kind whose dance to play.
 * @param phase - the current lifecycle phase and progress.
 * @returns the character frame transform state.
 */
export function computeCharacterFrame(
  kind: AttentionKind,
  phase: CharacterPhase,
): CharacterFrame {
  switch (phase.phase) {
    case 'peek':
      return PEEK_FRAME
    case 'enter':
      return enterFrame(phase.progress)
    case 'dance':
      return DANCE_FN[kind](phase.progress)
    case 'exit':
      return exitFrame(phase.progress)
  }
}

// --- Lifecycle timing -------------------------------------------------------

/** Whether the user prefers reduced motion (renders one static frame). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// --- Drawing ----------------------------------------------------------------

/** Environment the character scene reads instead of raw globals (testable). */
export interface CharacterEnv {
  /** Whether motion should be reduced. */
  reducedMotion: () => boolean
  /** requestAnimationFrame (ambient, guarded). */
  requestAnimationFrame?: (cb: () => void) => number
  /** cancelAnimationFrame (ambient, guarded). */
  cancelAnimationFrame?: (handle: number) => void
  /** Whether the document is currently hidden (tab in background). */
  isHidden?: () => boolean
  /** Subscribe to visibility changes; return the unsubscriber. */
  onVisibilityChange?: (cb: () => void) => () => void
}

/** A started character scene's teardown. */
export type CharacterDisposer = () => void

/**
 * Draw the fallback character body (no PNG): a round-bodied creature with
 * eyes, a small smile, and stubby limbs. Pure canvas drawing — does not touch
 * globals, accepts an explicit context.
 * @param ctx - the canvas 2D context (or null when unavailable).
 * @param frame - the character frame transform.
 * @param size - the character body size in px.
 */
function drawFallbackCharacter(
  ctx: CanvasRenderingContext2D | null,
  frame: CharacterFrame,
  size: number,
): void {
  /* v8 ignore next -- jsdom has no 2D context; paintCharacterFrame already guards this */
  if (ctx === null) return
  ctx.save()
  ctx.globalAlpha = frame.alpha
  const cx = GROUND_X + frame.dx
  const cy = GROUND_Y + frame.dy - size * frame.scale * 0.5
  ctx.translate(cx, cy)
  ctx.rotate(frame.rotation)
  ctx.scale(frame.scale * frame.squashX, frame.scale * frame.squashY)

  // Body: rounded rectangle.
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  const r = size * 0.18
  const bw = size * 0.7
  const bh = size * 0.72
  ctx.roundRect(-bw / 2, -bh / 2, bw, bh, r)
  ctx.fill()

  // Cheeks (subtle blush).
  ctx.fillStyle = 'rgba(251, 113, 133, .45)'
  ctx.beginPath()
  ctx.arc(-bw * 0.28, bh * 0.05, size * 0.08, 0, Math.PI * 2)
  ctx.arc(bw * 0.28, bh * 0.05, size * 0.08, 0, Math.PI * 2)
  ctx.fill()

  // Eyes.
  ctx.fillStyle = '#1a1a2e'
  ctx.beginPath()
  ctx.arc(-size * 0.14, -size * 0.08, size * 0.06, 0, Math.PI * 2)
  ctx.arc(size * 0.14, -size * 0.08, size * 0.06, 0, Math.PI * 2)
  ctx.fill()

  // Mouth: small smile.
  ctx.strokeStyle = '#1a1a2e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, size * 0.04, size * 0.1, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()

  // Arms (stubby lines on each side).
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-bw * 0.5, 0)
  ctx.lineTo(-bw * 0.5 - size * 0.12, size * 0.08)
  ctx.moveTo(bw * 0.5, 0)
  ctx.lineTo(bw * 0.5 + size * 0.12, size * 0.08)
  ctx.stroke()

  // Feet.
  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.ellipse(-size * 0.16, bh * 0.5, size * 0.1, size * 0.05, 0, 0, Math.PI * 2)
  ctx.ellipse(size * 0.16, bh * 0.5, size * 0.1, size * 0.05, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

/**
 * Draw the character PNG with the per-frame transform. When `image` is null
 * (not loaded or failed), falls back to the procedural character.
 * @param ctx - the canvas 2D context (or null).
 * @param frame - the character frame transform.
 * @param image - the loaded PNG, or null for fallback.
 * @param size - the character body size in px.
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D | null,
  frame: CharacterFrame,
  image: HTMLImageElement | null,
  size: number,
): void {
  /* v8 ignore next -- jsdom has no 2D context; paintCharacterFrame already guards this */
  if (ctx === null) return
  /* v8 ignore next 10 -- jsdom cannot load Image; the PNG blit path only runs in a real browser */
  if (image !== null && image.complete && image.naturalWidth > 0) {
    ctx.save()
    ctx.globalAlpha = frame.alpha
    const cx = GROUND_X + frame.dx
    const cy = GROUND_Y + frame.dy - size * frame.scale * 0.5
    ctx.translate(cx, cy)
    ctx.rotate(frame.rotation)
    ctx.scale(frame.scale * frame.squashX, frame.scale * frame.squashY)
    ctx.drawImage(image, -size / 2, -size / 2, size, size)
    ctx.restore()
  } else {
    drawFallbackCharacter(ctx, frame, size)
  }
}

/**
 * Draw the "?" thought-bubble above the character's head.
 * @param ctx - the canvas 2D context (or null).
 * @param frame - the character frame (to position the bubble).
 * @param size - the character body size in px.
 */
function drawQuestionMark(
  ctx: CanvasRenderingContext2D | null,
  frame: CharacterFrame,
  size: number,
): void {
  /* v8 ignore next -- jsdom has no 2D context; paintCharacterFrame already guards this */
  if (ctx === null || !frame.showQuestionMark) return
  ctx.save()
  ctx.globalAlpha = frame.alpha * 0.85
  const cx = GROUND_X + frame.dx
  const topY = GROUND_Y + frame.dy - size * frame.scale - 14
  ctx.fillStyle = '#22d3ee'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', cx, topY)
  ctx.restore()
}

/**
 * Draw sparkles ("✨") around the character.
 * @param ctx - the canvas 2D context (or null).
 * @param frame - the character frame (for positioning).
 * @param size - the character body size in px.
 * @param t - elapsed time (for sparkle twinkle).
 */
function drawSparkles(
  ctx: CanvasRenderingContext2D | null,
  frame: CharacterFrame,
  size: number,
  t: number,
): void {
  /* v8 ignore next -- jsdom has no 2D context; paintCharacterFrame already guards this */
  if (ctx === null || !frame.showSparkle) return
  ctx.save()
  ctx.globalAlpha = frame.alpha * (0.5 + 0.5 * Math.sin(t * 4))
  const cx = GROUND_X + frame.dx
  const cy = GROUND_Y + frame.dy - size * frame.scale * 0.5
  ctx.fillStyle = '#fde047'
  ctx.font = '14px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const offsets = [
    { x: -size * 0.7, y: -size * 0.5, p: 0 },
    { x: size * 0.7, y: -size * 0.3, p: 1.2 },
    { x: -size * 0.5, y: size * 0.1, p: 2.4 },
    { x: size * 0.5, y: size * 0.2, p: 3.6 },
  ]
  for (const o of offsets) {
    ctx.globalAlpha = frame.alpha * (0.4 + 0.6 * Math.abs(Math.sin(t * 3 + o.p)))
    ctx.fillText('✨', cx + o.x, cy + o.y)
  }
  ctx.restore()
}

/**
 * Paint one character frame onto a 2D context. Clears the frame, draws the
 * character (PNG or fallback), then the "?" bubble and sparkles if active.
 * @param ctx - the canvas 2D context (or null when unavailable).
 * @param frame - the character frame state.
 * @param image - the loaded character PNG, or null for fallback.
 * @param scale - device-pixel-ratio scale.
 * @param t - elapsed time (for sparkle animation).
 */
export function paintCharacterFrame(
  ctx: CanvasRenderingContext2D | null,
  frame: CharacterFrame,
  image: HTMLImageElement | null,
  scale: number,
  t: number,
): void {
  if (ctx === null) return
  ctx.clearRect(0, 0, SCENE_WIDTH * scale, SCENE_HEIGHT * scale)
  ctx.save()
  ctx.scale(scale, scale)
  drawCharacter(ctx, frame, image, CHARACTER_SIZE)
  drawQuestionMark(ctx, frame, CHARACTER_SIZE)
  drawSparkles(ctx, frame, CHARACTER_SIZE, t)
  ctx.restore()
}

// --- Scene lifecycle (RAF loop) ---------------------------------------------

/** The phase sequence driven by the component. */
export interface CharacterSceneCallbacks {
  /** Return the current lifecycle phase + progress. */
  getPhase: () => CharacterPhase
  /** The attention kind currently active. */
  kind: AttentionKind
}

/**
 * Start the character animation on a canvas and return a disposer that stops
 * the loop. Loads the character PNG from `imageUrl` (if provided); when the
 * image fails or is absent, the procedural fallback draws instead. The loop
 * pauses when the tab is hidden and resumes from the same elapsed time.
 *
 * @param canvas - the target canvas element.
 * @param imageUrl - optional character PNG URL (or data-URI).
 * @param env - environment (reduced-motion, RAF, tab visibility).
 * @param callbacks - lifecycle phase + kind provider.
 * @returns the scene disposer.
 */
export function createCharacterScene(
  canvas: HTMLCanvasElement,
  imageUrl: string | undefined,
  env: CharacterEnv,
  callbacks: CharacterSceneCallbacks,
): CharacterDisposer {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = SCENE_WIDTH * dpr
  canvas.height = SCENE_HEIGHT * dpr
  const g = canvas.getContext('2d')

  // Load the character PNG if provided; null means use the fallback.
  let image: HTMLImageElement | null = null
  /* v8 ignore next 6 -- jsdom Image never fires onload/onerror; covered by the null path */
  if (imageUrl !== undefined && imageUrl !== '') {
    image = new Image()
    image.onload = () => { /* loaded; drawCharacter will use it */ }
    image.onerror = () => { image = null }
    image.src = imageUrl
  }

  const raf = env.requestAnimationFrame
  const caf = env.cancelAnimationFrame
  let t0 = performance.now()
  let elapsed = 0
  let handle = 0
  let disposed = false

  const frame = (): void => {
    /* v8 ignore next -- raf is always defined when frame runs (its sole caller) */
    handle = raf ? raf(frame) : 0
    const t = (performance.now() - t0) / 1000 + elapsed
    const phase = callbacks.getPhase()
    const charFrame = computeCharacterFrame(callbacks.kind, phase)
    paintCharacterFrame(g, charFrame, image, dpr, t)
  }

  const startLoop = (): void => {
    t0 = performance.now()
    handle = raf ? raf(frame) : 0
  }
  const stopLoop = (): void => {
    /* v8 ignore next -- caf is always defined when a handle exists (startLoop requires raf) */
    if (handle !== 0 && caf !== undefined) caf(handle)
    handle = 0
    elapsed += (performance.now() - t0) / 1000
  }

  if (env.reducedMotion()) {
    const phase = callbacks.getPhase()
    paintCharacterFrame(g, computeCharacterFrame(callbacks.kind, phase), image, dpr, 0)
  } else {
    startLoop()
  }

  const onVis = (): void => {
    if (disposed || env.reducedMotion()) return
    /* v8 ignore next 4 -- visibility branch coverage: the isHidden false / handle===0 path needs a running loop */
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
