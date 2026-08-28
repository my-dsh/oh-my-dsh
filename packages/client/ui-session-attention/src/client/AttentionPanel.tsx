/**
 * The session-attention overlay panel: renders a character that peeks in from
 * the top-right edge, jumps out to play a kind-specific dance when attention is
 * owed, then retreats back to its peek pose when all sessions are handled.
 *
 * The character animation is a Canvas2D system (see {@link ./character.ts})
 * that supports a user-supplied PNG or falls back to a procedurally drawn
 * creature. The lifecycle state machine (see {@link ./character-lifecycle.ts})
 * drives the peek → enter → dance → exit → peek cycle. State transitions are
 * driven synchronously by `hasAttention` changes; the character scene's own RAF
 * loop animates the progress within the current phase. The attention rows are
 * derived from the standard `useSessions` hook with the same data the sidebar
 * status dots use.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  KIND_META, isAllCompleted, selectAttention,
  type AttentionKind, type AttentionRow,
} from './attention.ts'
import {
  createCharacterScene, prefersReducedMotion,
  ENTER_DURATION, EXIT_DURATION,
  type CharacterEnv, type CharacterDisposer, type CharacterPhase,
} from './character.ts'
import {
  isPanelVisible, INITIAL_STATE, nextState, phaseOf,
  type LifecycleState,
} from './character-lifecycle.ts'
import type { SessionAttentionInjected } from './contract/slots.ts'
import css from './AttentionPanel.module.css'

/** Copy keys: a panel title key, the "+N more" tail key, or a kind label key. */
export type CopyKey = AttentionKind | 'title.action' | 'title.completed' | 'more'

/** Localized copy resolver (key → string, with `{n}` interpolation). */
export type Translate = (key: CopyKey, vars?: { n?: number }) => string

/** Default Chinese copy (used when no translator is injected). */
const DEFAULT_COPY: Record<CopyKey, (vars?: { n?: number }) => string> = {
  'title.action': () => '会话需要你的操作',
  'title.completed': () => '回复完成',
  more: vars => '还有 ' + String(/* v8 ignore next -- more is always called with n */ vars?.n ?? 0) + ' 个会话在等待…',
  approval: () => '等待审批',
  'plan-review': () => '计划待审',
  question: () => '等待回答',
  completed: () => '回复完成',
}

/** Map a kind to its localized kind label. */
function kindLabel(t: Translate, kind: AttentionKind): string {
  return t(kind)
}

/** Props the shell.overlay owner hands the entry (standard `useSessions`). */
export interface AttentionPanelProps extends PropsRuntime<'shell.overlay'>, InjectFace<SessionAttentionInjected> {
  /** Optional localized translator (defaults to Chinese copy). */
  t?: Translate
  /** Optional scene environment override (tests). */
  env?: CharacterEnv
  /** Optional scene factory override (tests); defaults to {@link createCharacterScene}. */
  createScene?: (
    canvas: HTMLCanvasElement,
    imageUrl: string | undefined,
    env: CharacterEnv,
    callbacks: { getPhase: () => CharacterPhase; kind: AttentionKind },
  ) => CharacterDisposer
}

/** Maximum rows shown before a "+N more" tail. */
const MAX_ROWS = 5

/**
 * The attention overlay panel. Renders only a small peeking character while no
 * session needs attention; jumps out to dance and show the full panel when
 * attention is owed.
 * @param props - the standard useSessions hook plus the open-session action.
 */
export function AttentionPanel({
  useSessions, useSessionPendingInteraction, openSession, characterImage, t, env, createScene,
}: AttentionPanelProps) {
  // The session list carries `completed` reminders; pending interactions
  // (approval / plan-review / question) arrive on a separate standard hook.
  // Both are framework-made hooks; the merge is a pure derivation over their
  // snapshots, never its own subscription.
  const list = useSessions(s => s)
  const pending = useSessionPendingInteraction(s => s)
  const rows = useMemo(
    () => selectAttention(list, pending),
    [list, pending],
  )
  const translate: Translate = t ?? ((key, vars) => DEFAULT_COPY[key](vars))
  const count = rows.length
  const hasAttention = count > 0
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const first = count > 0 ? rows[0] : undefined
  const kind = first !== undefined ? first.kind : 'approval'
  const completed = isAllCompleted(rows)

  // --- Lifecycle state ---
  // State transitions are driven synchronously by `hasAttention` changes.
  // enter→dance and exit→peek transitions are driven by a timer.
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>(INITIAL_STATE)
  // Track when the current state began (for the character phase computation).
  const stateStartRef = useRef(performance.now())

  // Synchronous transition when hasAttention changes.
  useEffect(() => {
    stateStartRef.current = performance.now()
    setLifecycleState(prev => nextState(prev, hasAttention))
  }, [hasAttention])

  // Timer-based transitions: enter→dance after ENTER_DURATION, exit→peek after EXIT_DURATION.
  useEffect(() => {
    /* v8 ignore next 7 -- the enter→dance timer fires after ENTER_DURATION (0.6s); tests unmount before it triggers */
    if (lifecycleState === 'enter') {
      const id = setTimeout(() => {
        stateStartRef.current = performance.now()
        setLifecycleState('dance')
      }, ENTER_DURATION * 1000)
      return () => { clearTimeout(id) }
    }
    /* v8 ignore next 7 -- the exit→peek timer fires after EXIT_DURATION (0.5s); tests unmount before it triggers */
    if (lifecycleState === 'exit' && !hasAttention) {
      const id = setTimeout(() => {
        stateStartRef.current = performance.now()
        setLifecycleState('peek')
      }, EXIT_DURATION * 1000)
      return () => { clearTimeout(id) }
    }
  }, [lifecycleState, hasAttention])

  // Tag the browser tab title with the pending count while attention is owed.
  useEffect(() => {
    /* v8 ignore next 2 -- jsdom always has document; the guard is defensive for non-DOM hosts */
    if (typeof document === 'undefined' || count === 0) return
    const original = document.title
    document.title = '(' + String(count) + ') ' + original
    return () => {
      document.title = original
    }
  }, [count])

  // Start/stop the character animation on the canvas. The character scene's
  // own RAF loop reads the phase from a ref each frame.
  useEffect(() => {
    if (!isPanelVisible(lifecycleState)) return
    const canvas = canvasRef.current
    /* v8 ignore next -- the canvas always mounts before this effect runs */
    if (canvas === null) return
    const sceneEnv: CharacterEnv = env ?? {
      reducedMotion: prefersReducedMotion,
      requestAnimationFrame,
      cancelAnimationFrame,
      /* v8 ignore next 5 -- default env callbacks only run when the tab visibility changes, which jsdom never fires */
      isHidden: () => document.hidden,
      onVisibilityChange: (cb) => {
        document.addEventListener('visibilitychange', cb)
        return () => { document.removeEventListener('visibilitychange', cb) }
      },
    }
    const factory = createScene ?? createCharacterScene
    /* v8 ignore next -- defensive initializer; reassigned in both try and catch */
    let dispose: CharacterDisposer = () => {}
    try {
      dispose = factory(canvas, characterImage, sceneEnv, {
        getPhase: () => phaseOf(lifecycleState, (performance.now() - stateStartRef.current) / 1000),
        kind,
      })
    } catch {
      dispose = () => {}
    }
    return () => { dispose() }
  }, [lifecycleState !== 'peek', kind, env, createScene, characterImage, lifecycleState])

  // --- Peek mode: nothing is visible. The character only appears when
  // attention arrives — it peeks in from the edge, dances, then fully
  // retreats. Between notifications the top-right corner is empty.
  if (lifecycleState === 'peek') {
    return <></>
  }

  // --- Full panel: head + character + rows ---
  const shown = rows.slice(0, MAX_ROWS)
  const hidden = count - shown.length
  const headText = (completed ? '✅ ' : '⚡ ') + translate(completed ? 'title.completed' : 'title.action') + ' · ' + String(count)

  return (
    <div className={css.wrap} data-sa3d-wrap>
      <div className={css.panel}>
        <div className={css.head} data-sa3d-head>
          <span>{headText}</span>
        </div>
        <div className={completed ? `${css.canvasBox} ${css.canvasBoxCompleted}` : css.canvasBox}>
          <canvas className={css.canvas} ref={canvasRef} width={244} height={148} />
        </div>
        <div className={css.rows}>
          {shown.map((row: AttentionRow) => {
            const meta = KIND_META[row.kind]
            return (
              <button
                key={row.kind + ':' + row.id}
                className={css.row}
                data-sa3d-row
                data-sa3d-kind={row.kind}
                title={kindLabel(translate, row.kind) + ' · ' + row.title}
                onClick={() => { openSession(row.id) }}
              >
                <span className={css.dot} style={{ background: meta.color }} />
                <span className={css.title} data-sa3d-title>{row.title}</span>
                <span className={css.kind}>{kindLabel(translate, row.kind)}</span>
              </button>
            )
          })}
          {hidden > 0 ? <div className={css.more} data-sa3d-more>{translate('more', { n: hidden })}</div> : null}
        </div>
      </div>
    </div>
  )
}
