/**
 * Character lifecycle state machine: drives the character through
 * `peek → enter → dance → exit → peek` based on whether attention is owed.
 *
 * The component owns a running clock; this pure module maps
 * (state, hasAttention, elapsedInState) to the next state and the current
 * {@link CharacterPhase} (phase + progress) consumed by {@link character.ts}.
 * All logic is pure and testable without React or canvas.
 */
import {
  ENTER_DURATION, EXIT_DURATION, DANCE_DURATION,
  type CharacterPhase,
} from './character.ts'

/** Lifecycle states the panel can be in. */
export type LifecycleState = 'peek' | 'enter' | 'dance' | 'exit'

/** One tick of the lifecycle: the current state and the phase to render. */
export interface LifecycleTick {
  /** The state to transition to (may be the same as current). */
  state: LifecycleState
  /** The character phase to render this tick. */
  phase: CharacterPhase
}

/** Duration of the peek state before the character settles (seconds). */
const PEEK_SETTLE = 0.3

/**
 * Advance the lifecycle one tick.
 *
 * Transition rules:
 *  - `peek` + hasAttention → `enter` (reset elapsed)
 *  - `enter` (progress=1) → `dance` (reset elapsed)
 *  - `dance` + noAttention → `exit` (reset elapsed)
 *  - `dance` + hasAttention (progress wraps at 1) → stays `dance` (loop)
 *  - `exit` (progress=1) + noAttention → `peek`
 *  - `exit` (progress=1) + hasAttention → `enter` (attention arrived mid-exit)
 *
 * @param current - the current state.
 * @param hasAttention - whether any session needs attention right now.
 * @param elapsedInState - seconds since the current state began.
 * @returns the next state + the character phase to render.
 */
export function advanceLifecycle(
  current: LifecycleState,
  hasAttention: boolean,
  elapsedInState: number,
): LifecycleTick {
  switch (current) {
    case 'peek': {
      const progress = Math.min(1, elapsedInState / PEEK_SETTLE)
      if (hasAttention) {
        return { state: 'enter', phase: { phase: 'enter', progress: 0 } }
      }
      return { state: 'peek', phase: { phase: 'peek', progress } }
    }
    case 'enter': {
      const progress = Math.min(1, elapsedInState / ENTER_DURATION)
      if (progress >= 1) {
        return { state: 'dance', phase: { phase: 'dance', progress: 0 } }
      }
      return { state: 'enter', phase: { phase: 'enter', progress } }
    }
    case 'dance': {
      // The dance loops continuously while attention is owed.
      const progress = (elapsedInState % DANCE_DURATION) / DANCE_DURATION
      if (!hasAttention) {
        return { state: 'exit', phase: { phase: 'exit', progress: 0 } }
      }
      return { state: 'dance', phase: { phase: 'dance', progress } }
    }
    case 'exit': {
      const progress = Math.min(1, elapsedInState / EXIT_DURATION)
      if (progress >= 1) {
        if (hasAttention) {
          return { state: 'enter', phase: { phase: 'enter', progress: 0 } }
        }
        return { state: 'peek', phase: { phase: 'peek', progress: 0 } }
      }
      return { state: 'exit', phase: { phase: 'exit', progress } }
    }
  }
}

/** The initial lifecycle state when the component first mounts. */
export const INITIAL_STATE: LifecycleState = 'peek'

/**
 * Whether the panel should render its full layout (head + rows + canvas)
 * vs. just the small peeking character. `enter`, `dance`, and `exit` render
 * the full panel; `peek` renders only the peeking character.
 * @param state - the current lifecycle state.
 * @returns `true` when the full panel should be visible.
 */
export function isPanelVisible(state: LifecycleState): boolean {
  return state !== 'peek'
}

/**
 * Next lifecycle state given the current one and whether attention is owed.
 * Used by the component to drive synchronous transitions on `hasAttention`.
 * @param state - the current lifecycle state.
 * @param hasAttention - whether any session needs attention right now.
 * @returns the next lifecycle state.
 */
export function nextState(state: LifecycleState, hasAttention: boolean): LifecycleState {
  if (hasAttention) {
    if (state === 'peek' || state === 'exit') return 'enter'
    return 'dance'
  }
  if (state === 'peek') return 'peek'
  return 'exit'
}

/**
 * Compute the character phase from the lifecycle state and the time since the
 * state began. Pure — called by the character scene's RAF loop every frame.
 * @param state - the current lifecycle state.
 * @param elapsed - seconds since the state began.
 * @returns the character phase to render.
 */
export function phaseOf(state: LifecycleState, elapsed: number): CharacterPhase {
  switch (state) {
    case 'peek':
      return { phase: 'peek', progress: 1 }
    case 'enter':
      return { phase: 'enter', progress: Math.min(1, elapsed / ENTER_DURATION) }
    case 'dance':
      return { phase: 'dance', progress: (elapsed % DANCE_DURATION) / DANCE_DURATION }
    case 'exit':
      return { phase: 'exit', progress: Math.min(1, elapsed / EXIT_DURATION) }
  }
}
